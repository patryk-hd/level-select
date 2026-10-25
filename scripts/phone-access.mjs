// Level Select on your phone, over your home Wi-Fi. Off until you turn it on (On your phone,
// in the sidebar). Then a second address listens on your home network, for phones you pair:
// - Pairing is a code in a QR code, shown on this computer: it works once, for 10 minutes.
// - A paired phone keeps a signed cookie; forgetting the phone (or turning access off) ends it.
// - Only this computer's own network addresses are answered (as serve.mjs does for 127.0.0.1).
// - The phone browses and tracks (plans, progress: tracking-store.mjs). Importing, updating
//   and adding games stay on this computer.
// Nothing goes through the internet: the phone talks to this computer directly.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { qrSvg } from './qr.mjs';

export const PHONE_FILE = 'library/data/phone.json';
export const PAIR_MINUTES = 10;
const COOKIE = 'ls_phone';
// What a phone may reach under /__retro_library/ (everything else there is this computer's).
const ICON_FILES = ['app-icon-180.png', 'app-icon-192.png', 'app-icon-512.png', 'app-icon-maskable-512.png', 'app-icon-monochrome-512.png'];
const APP_ICONS = new Set(ICON_FILES.map(file => `/assets/${file}`));
// Phones keep pictures for a day (serve.mjs), and a home screen keeps the icon it was added
// with: the icons' addresses carry a version from their contents, so a new icon is new to them.
export async function iconVersion(root) {
  const hash = createHash('sha256');
  for (const file of ICON_FILES) hash.update(await readFile(path.join(root, 'assets', file)).catch(() => Buffer.alloc(0)));
  return hash.digest('hex').slice(0, 8);
}
const PHONE_ROUTES = [/^\/__retro_library\/tracking$/, /^\/__retro_library\/cover\//, /^\/__retro_library\/esde-media\//];

export const phonePort = port => Number(process.env.RETRO_LIBRARY_PHONE_PORT || port + 1);

// This computer's addresses on home networks (private IPv4 ranges), Wi-Fi and Ethernet first.
export function lanAddresses(interfaces = os.networkInterfaces()) {
  const isPrivate = ip => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return Object.entries(interfaces).flatMap(([name, list]) => (list ?? [])
    .filter(item => item.family === 'IPv4' && !item.internal && isPrivate(item.address))
    .map(item => ({ name, address: item.address })))
    .sort((a, b) => Number(/^(en|eth|wl|Wi-?Fi|Ethernet)/i.test(b.name)) - Number(/^(en|eth|wl|Wi-?Fi|Ethernet)/i.test(a.name)))
    .map(item => item.address);
}

export function deviceName(userAgent = '') {
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? 'Android phone' : 'Android tablet';
  if (/Macintosh|Windows|Linux/.test(userAgent)) return 'Computer';
  return 'Phone or tablet';
}

const sign = (secret, id) => createHmac('sha256', secret).update(id).digest('base64url');
export function cookieValue(secret, id) { return `${id}.${sign(secret, id)}`; }
export function deviceFromCookie(header, secret, devices) {
  const value = String(header ?? '').split(/;\s*/).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!value) return null;
  const [id, mac] = value.split('.');
  if (!id || !mac || !devices[id]) return null;
  const expected = Buffer.from(sign(secret, id)), given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

async function readSettings(root) {
  try {
    const data = JSON.parse(await readFile(path.join(root, PHONE_FILE), 'utf8'));
    if (typeof data.secret === 'string' && data.secret.length >= 32 && data.devices && typeof data.devices === 'object') return { enabled: Boolean(data.enabled), secret: data.secret, devices: data.devices };
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  return { enabled: false, secret: randomBytes(32).toString('hex'), devices: {} };
}
async function writeSettings(root, settings) {
  const file = path.join(root, PHONE_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(settings, null, 1)); await rename(`${file}.tmp`, file);
}

const page = (title, text) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Level Select</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#13120f;color:#f4f1ea;font:17px/1.55 system-ui,sans-serif;padding:24px;box-sizing:border-box}main{max-width:30rem}.mark{width:52px;height:52px;border-radius:14px;background:#e8b96f;color:#1a1408;display:grid;place-items:center;font:700 30px system-ui;margin-bottom:18px}h1{font-size:1.6rem;margin:0 0 10px}p{color:#b6ae9f;margin:0 0 10px}strong{color:#f4f1ea}</style></head>
<body><main><div class="mark" aria-hidden="true">L</div><h1>${title}</h1>${text}</main></body></html>`;
const PAIR_HELP = '<p>On your computer, open <strong>Level Select → On your phone</strong>, turn on phone access and scan the code with this phone’s camera.</p><p>Your phone and your computer need to be on the same Wi-Fi.</p>';

// handle(req, res, context) is the app's own request handler (serve.mjs).
export function createPhoneAccess({ root, port, handle, interfaces = () => os.networkInterfaces(), now = () => Date.now() }) {
  const listenPort = phonePort(port);
  let settings = null, server = null, error = null, saving = Promise.resolve(), icons = '';
  const codes = new Map();
  const save = () => { saving = saving.then(() => writeSettings(root, settings)).catch(() => {}); return saving; };
  const seen = new Map();

  const hosts = () => new Set([...lanAddresses(interfaces()), `${os.hostname().toLowerCase().replace(/\.local$/, '')}.local`].map(host => `${host}:${listenPort}`));
  const canWrite = req => req.method === 'POST' && req.headers.origin === `http://${req.headers.host}` &&
    req.headers['x-retro-library'] === '1' && String(req.headers['content-type'] ?? '').startsWith('application/json');

  async function onRequest(req, res) {
    const allowedHosts = hosts(), host = String(req.headers.host ?? '').toLowerCase();
    if (!allowedHosts.has(host)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Forbidden'); return; }
    const url = new URL(req.url, `http://${host}`), html = (status, title, text, headers = {}) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', ...headers }); res.end(page(title, text)); };
    if (url.pathname === '/__phone/pair') {
      const code = url.searchParams.get('code') ?? '', expires = codes.get(code);
      if (!expires || expires < now()) { codes.delete(code); html(403, 'This code has expired', `<p>Pairing codes work once, for ${PAIR_MINUTES} minutes.</p>${PAIR_HELP.replace('turn on phone access and scan', 'choose <strong>New code</strong> and scan')}`); return; }
      codes.delete(code);
      const id = randomUUID();
      settings.devices[id] = { name: deviceName(req.headers['user-agent']), pairedAt: new Date(now()).toISOString(), lastSeen: new Date(now()).toISOString() };
      await save();
      res.writeHead(302, { Location: '/library/backlog.html', 'Cache-Control': 'no-store', 'Set-Cookie': `${COOKIE}=${cookieValue(settings.secret, id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${400 * 86400}` });
      res.end(); return;
    }
    // Its name and icons when you add it to a home screen: public, nothing of yours, so a phone
    // gets them even when it asks without its cookie (Android fetches the manifest that way).
    if (url.pathname === '/__phone/manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ name: 'Level Select', short_name: 'Level Select', start_url: '/library/backlog.html', scope: '/', display: 'browser', background_color: '#13120f', theme_color: '#13120f',
        icons: [{ src: `/assets/app-icon-192.png?v=${icons}`, sizes: '192x192', type: 'image/png' }, { src: `/assets/app-icon-512.png?v=${icons}`, sizes: '512x512', type: 'image/png' }, { src: `/assets/app-icon-maskable-512.png?v=${icons}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }, { src: `/assets/app-icon-monochrome-512.png?v=${icons}`, sizes: '512x512', type: 'image/png', purpose: 'monochrome' }] }));
      return;
    }
    if (APP_ICONS.has(url.pathname)) { await handle(req, res, { hosts: allowedHosts, canWrite: () => false, phone: true }); return; }
    const device = deviceFromCookie(req.headers.cookie, settings.secret, settings.devices);
    if (!device) { html(401, 'Pair this phone first', PAIR_HELP); return; }
    if (now() - (seen.get(device) ?? 0) > 60_000) { seen.set(device, now()); settings.devices[device].lastSeen = new Date(now()).toISOString(); save(); }
    if (url.pathname.startsWith('/__retro_library/') && !PHONE_ROUTES.some(route => route.test(url.pathname))) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: 'Do this on your computer: importing, updating and adding games happen there.' })); return;
    }
    await handle(req, res, { hosts: allowedHosts, canWrite, phone: true });
  }

  async function start() {
    if (server) return;
    error = null;
    const candidate = http.createServer((req, res) => onRequest(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }));
    await new Promise(resolve => {
      candidate.once('error', failure => { error = failure.code === 'EADDRINUSE' ? `Another program is using port ${listenPort}.` : failure.message; resolve(); });
      candidate.listen(listenPort, '0.0.0.0', () => { server = candidate; resolve(); });
    });
  }
  async function stop() {
    if (!server) return;
    const closing = server; server = null;
    await new Promise(resolve => { closing.close(() => resolve()); closing.closeAllConnections(); });
  }

  return {
    async init() { settings = await readSettings(root); icons = await iconVersion(root); if (settings.enabled) await start(); return this; },
    status() {
      const addresses = lanAddresses(interfaces());
      return { enabled: settings.enabled, running: Boolean(server), error, port: listenPort, addresses,
        devices: Object.entries(settings.devices).map(([id, device]) => ({ id, ...device })).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)) };
    },
    async enable() { settings.enabled = true; await save(); await start(); return this.status(); },
    async disable() { settings.enabled = false; codes.clear(); await save(); await stop(); return this.status(); },
    // A one-time link for the phone to open, and its QR code.
    pair() {
      if (!server) throw Object.assign(new Error('Turn on phone access first.'), { status: 409 });
      const address = lanAddresses(interfaces())[0];
      if (!address) throw Object.assign(new Error('This computer isn’t on a home network (Wi-Fi or Ethernet) right now.'), { status: 409 });
      for (const [code, expires] of codes) if (expires < now()) codes.delete(code);
      const code = randomBytes(16).toString('hex'), expiresAt = now() + PAIR_MINUTES * 60_000;
      codes.set(code, expiresAt);
      const url = `http://${address}:${listenPort}/__phone/pair?code=${code}`;
      return { url, address: `http://${address}:${listenPort}`, expiresAt: new Date(expiresAt).toISOString(), svg: qrSvg(url, { label: 'Code to pair your phone' }) };
    },
    async forget(id) { delete settings.devices[id]; seen.delete(id); await save(); return this.status(); },
    stop,
  };
}

// GET/POST /__retro_library/phone on this computer only (serve.mjs never passes it to a phone).
export async function handlePhone(req, res, { phone, canWrite }) {
  if (new URL(req.url, 'http://x').pathname !== '/__retro_library/phone') return false;
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  try {
    if (req.method === 'GET') { send(200, phone.status()); return true; }
    if (!canWrite(req)) { send(403, { error: 'Forbidden' }); return true; }
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2048) { send(413, { error: 'Too large.' }); return true; } }
    const { action, id } = JSON.parse(body || '{}');
    if (action === 'enable') send(200, await phone.enable());
    else if (action === 'disable') send(200, await phone.disable());
    else if (action === 'pair') send(200, phone.pair());
    else if (action === 'forget' && typeof id === 'string') send(200, await phone.forget(id));
    else send(400, { error: 'Unknown action.' });
  } catch (error) { send(error.status ?? 500, { error: error.message }); }
  return true;
}

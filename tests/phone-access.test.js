import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { readTracking, writeTracking, handleTracking } from '../scripts/tracking-store.mjs';
import { createPhoneAccess, lanAddresses, deviceName, cookieValue, deviceFromCookie, handlePhone } from '../scripts/phone-access.mjs';
import { qrMatrix, qrSvg } from '../scripts/qr.mjs';
import { serverAdapter, RevisionConflict } from '../tracking/persistence.js';
import { emptyState, ensureTarget } from '../tracking/domain.js';

const temp = async t => { const dir = await mkdtemp(path.join(tmpdir(), 'level-select-phone-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
const at = revision => ({ ...emptyState('personal'), revision });

test('the app keeps tracking: saves land only on the version they were made from', async t => {
  const root = await temp(t);
  assert.equal(await readTracking(root, 'personal'), null);
  assert.deepEqual((await writeTracking(root, 'personal', { base: 0, state: at(1) })).state.revision, 1);
  const stale = await writeTracking(root, 'personal', { base: 0, state: at(1) });
  assert.equal(stale.conflict, true); assert.equal(stale.state.revision, 1);
  assert.equal((await writeTracking(root, 'personal', { base: 1, state: at(2) })).state.revision, 2);
  // A browser's own copy is handed over only while nothing is stored.
  assert.equal((await writeTracking(root, 'personal', { seed: true, state: at(9) })).conflict, true);
  assert.equal((await writeTracking(root, 'sample', { seed: true, state: { ...emptyState('sample'), revision: 9 } })).state.revision, 9);
  await assert.rejects(writeTracking(root, 'personal', { base: 2, state: { ...emptyState('sample'), revision: 3 } }), /another workspace/);
  await assert.rejects(writeTracking(root, 'personal', { base: 2, state: { ...at(3), schemaVersion: 1 } }));
  await assert.rejects(readTracking(root, '../secrets'), /Unknown tracking workspace/);
  // Two saves at once: one wins, one is told about the newer version.
  const [a, b] = await Promise.all([writeTracking(root, 'personal', { base: 2, state: at(3) }), writeTracking(root, 'personal', { base: 2, state: at(3) })]);
  assert.equal([a, b].filter(result => result.conflict).length, 1);
});

test('tracking requests need the server’s own write check', async t => {
  const root = await temp(t), calls = [];
  const response = () => ({ status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = body; calls.push(this); } });
  const request = (method, body, url = '/__retro_library/tracking') => Object.assign((async function* () { if (body) yield Buffer.from(JSON.stringify(body)); })(), { method, url, headers: {} });
  assert.equal(await handleTracking(request('GET', null, '/elsewhere'), response(), { root, canWrite: () => true }), false);
  let res = response(); await handleTracking(request('POST', { namespace: 'personal', base: 0, state: at(1) }), res, { root, canWrite: () => false });
  assert.equal(res.status, 403);
  res = response(); await handleTracking(request('POST', { namespace: 'personal', base: 0, state: at(1) }), res, { root, canWrite: () => true });
  assert.equal(res.status, 200);
  res = response(); await handleTracking(request('GET', null, '/__retro_library/tracking?namespace=personal'), res, { root, canWrite: () => false });
  assert.equal(JSON.parse(res.body).state.revision, 1);
  res = response(); await handleTracking(request('POST', { namespace: 'personal', base: 0, state: at(1) }), res, { root, canWrite: () => true });
  assert.equal(res.status, 409);
});

// A fake app (tracking-store's rules) and a fake browser store with its slots.
function fakeApp(stored = null) {
  const app = { stored, fetch: async (url, options = {}) => {
    if (!options.method) return new Response(JSON.stringify({ state: app.stored }), { headers: { 'Content-Type': 'application/json' } });
    const { base, state, seed } = JSON.parse(options.body);
    if (seed ? app.stored : (app.stored?.revision ?? 0) !== base) return new Response(JSON.stringify({ conflict: true, state: app.stored }), { status: 409 });
    app.stored = state; return new Response(JSON.stringify({ state }));
  } };
  return app;
}
function fakeBrowser(own = null) {
  const slots = new Map();
  return { slots, read: async () => own, getSlot: async key => slots.get(key) ?? null, putSlot: async (key, value) => { slots.set(key, value); return value; } };
}
// A note on a game, as the app records one (a target, and an annotation on it).
const withNote = (state, id, notes) => {
  const next = structuredClone(state), target = ensureTarget(next, { ref: { provider: 'catalog', id }, title: id });
  next.annotations[target.id] = { id: target.id, targetId: target.id, source: { provider: 'catalog', id }, notes };
  return next;
};
const noteOf = (state, id) => Object.values(state.annotations).find(entry => entry.source.id === id)?.notes;

test('a browser hands its own tracking to the app once, then saves through it and keeps a copy', async () => {
  const app = fakeApp(), browser = fakeBrowser(at(4)), adapter = serverAdapter({ fetch: app.fetch, local: browser });
  assert.equal((await adapter.read('personal')).revision, 4);
  assert.equal(app.stored.revision, 4);
  assert.ok(browser.slots.get('handed-over:personal'));
  assert.equal((await adapter.compareAndSwap('personal', 4, at(5))).revision, 5);
  await assert.rejects(adapter.compareAndSwap('personal', 4, at(5)), RevisionConflict);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(browser.slots.get('app-copy:personal').revision, 5);
  // Its own tracking is never overwritten, and isn't handed over twice.
  assert.equal((await browser.read()).revision, 4);
  app.stored = at(7); assert.equal((await adapter.read('personal')).revision, 7);
  assert.equal(adapter.earlier('personal'), null);
});

test('a second browser’s own tracking joins when nothing differs, and is kept (and offered) when it does', async () => {
  const shared = withNote(at(3), 'a', 'shared note');
  const joined = fakeApp(shared), adds = serverAdapter({ fetch: joined.fetch, local: fakeBrowser(withNote(at(2), 'b', 'this browser')) });
  const merged = await adds.read('personal');
  assert.equal(merged.revision, 4);
  assert.equal(noteOf(merged, 'a'), 'shared note');
  assert.equal(noteOf(merged, 'b'), 'this browser');
  const notices = [], differs = fakeApp(shared), browser = fakeBrowser(withNote(at(9), 'a', 'different note'));
  const keeps = serverAdapter({ fetch: differs.fetch, local: browser, onNotice: message => notices.push(message) });
  assert.equal(noteOf(await keeps.read('personal'), 'a'), 'shared note');
  assert.equal(differs.stored.revision, 3);
  assert.match(notices[0], /Nothing is lost/);
  assert.equal(noteOf(keeps.earlier('personal'), 'a'), 'different note');
  assert.equal(browser.slots.get('handed-over:personal'), undefined);
});

test('QR codes: the smallest version that fits, with finder squares in three corners', () => {
  assert.equal(qrMatrix('A').length, 21);
  const link = qrMatrix('http://192.168.1.23:8766/__phone/pair?code=3f9a0c1d2e4b5a6978808a9bacbdcedf');
  assert.equal(link.length, 37); // version 5
  const finder = (m, x, y) => [0, 6].every(d => m[y][x + d] && m[y + d][x]) && m[y + 3][x + 3] && !m[y + 1][x + 1];
  for (const m of [qrMatrix('A'), link, qrMatrix('x'.repeat(200))]) {
    const n = m.length; assert.ok(finder(m, 0, 0) && finder(m, n - 7, 0) && finder(m, 0, n - 7));
    assert.ok(m[n - 8][8]); // the always-dark module
  }
  assert.throws(() => qrMatrix('x'.repeat(300)), /Too long/);
  assert.match(qrSvg('A'), /^<svg[^>]+viewBox="0 0 29 29"/);
});

test('phone helpers: home-network addresses, device names, signed cookies', () => {
  assert.deepEqual(lanAddresses({ lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], utun3: [{ family: 'IPv4', address: '10.8.0.2', internal: false }],
    en0: [{ family: 'IPv4', address: '192.168.1.23', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }], en9: [{ family: 'IPv4', address: '81.2.3.4', internal: false }] }), ['192.168.1.23', '10.8.0.2']);
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'iPhone');
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari'), 'Android phone');
  const secret = 'a'.repeat(64), devices = { abc: {} }, cookie = `other=1; ls_phone=${cookieValue(secret, 'abc')}`;
  assert.equal(deviceFromCookie(cookie, secret, devices), 'abc');
  assert.equal(deviceFromCookie(cookie, 'b'.repeat(64), devices), null);
  assert.equal(deviceFromCookie(cookie.replace('abc.', 'abd.'), secret, { abd: {} }), null);
  assert.equal(deviceFromCookie(cookie, secret, {}), null);
});

test('phone access: off until turned on, pairs once per code, then serves only what a phone may use', async t => {
  const root = await temp(t), port = 40000 + Math.floor(Math.random() * 20000), seen = [];
  process.env.RETRO_LIBRARY_PHONE_PORT = String(port);
  t.after(() => { delete process.env.RETRO_LIBRARY_PHONE_PORT; });
  const interfaces = () => ({ en0: [{ family: 'IPv4', address: '192.168.7.9', internal: false }] });
  const handle = async (req, res, context) => { seen.push({ path: req.url, phone: context.phone, write: context.canWrite(req) }); res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('app'); };
  const phone = await createPhoneAccess({ root, port: 1, handle, interfaces }).init();
  t.after(() => phone.stop());
  const get = (url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, agent: false, headers: { Host: `192.168.7.9:${port}`, ...headers } }, res => { let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body })); });
    req.on('error', reject); req.end();
  });
  assert.equal(phone.status().running, false);
  await assert.rejects(get('/'), /ECONNREFUSED/);
  assert.throws(() => phone.pair(), /Turn on phone access first/);
  await phone.enable();
  assert.equal(phone.status().running, true);
  assert.equal((await get('/library/index.html')).status, 401);
  // A home screen gets its name and icon even without the cookie; nothing else does.
  const manifest = await get('/__phone/manifest.webmanifest');
  assert.equal(manifest.status, 200); assert.equal(JSON.parse(manifest.body).name, 'Level Select');
  assert.deepEqual(JSON.parse(manifest.body).icons.map(icon => icon.purpose ?? 'any'), ['any', 'any', 'maskable', 'monochrome']);
  assert.ok(JSON.parse(manifest.body).icons.every(icon => /\?v=[0-9a-f]{8}$/.test(icon.src)), 'icon addresses carry a version');
  assert.equal((await get('/assets/app-icon-180.png')).body, 'app');
  assert.equal((await get('/assets/favicon.svg')).status, 401);
  assert.equal((await get('/library/index.html', { Host: `attacker.example:${port}` })).status, 403);
  assert.equal((await get('/__phone/pair?code=guess')).status, 403);
  const { url, svg } = phone.pair();
  assert.match(url, new RegExp(`^http://192\\.168\\.7\\.9:${port}/__phone/pair\\?code=[0-9a-f]{32}$`));
  assert.match(svg, /^<svg/);
  const paired = await get(new URL(url).pathname + new URL(url).search, { 'User-Agent': 'Mozilla/5.0 (iPhone)' });
  assert.equal(paired.status, 302);
  const cookie = paired.headers['set-cookie'][0].split(';')[0];
  assert.match(paired.headers['set-cookie'][0], /HttpOnly; SameSite=Lax/);
  assert.equal((await get(new URL(url).pathname + new URL(url).search)).status, 403); // used once
  assert.equal((await get('/library/index.html', { Cookie: cookie })).body, 'app');
  assert.equal((await get('/__retro_library/sources', { Cookie: cookie })).status, 403);
  assert.equal((await get('/__retro_library/tracking?namespace=personal', { Cookie: cookie })).body, 'app');
  await get('/__retro_library/tracking', { Cookie: cookie, Origin: `http://192.168.7.9:${port}`, 'X-Retro-Library': '1', 'Content-Type': 'application/json' }, 'POST');
  await get('/__retro_library/tracking', { Cookie: cookie, Origin: 'http://attacker.example', 'X-Retro-Library': '1', 'Content-Type': 'application/json' }, 'POST');
  assert.deepEqual(seen.map(item => [item.path, item.phone, item.write]), [['/assets/app-icon-180.png', true, false], ['/library/index.html', true, false], ['/__retro_library/tracking?namespace=personal', true, false], ['/__retro_library/tracking', true, true], ['/__retro_library/tracking', true, false]]);
  const [device] = phone.status().devices;
  assert.equal(device.name, 'iPhone');
  assert.ok(!JSON.stringify(phone.status()).includes(cookie.split('=')[1]));
  await phone.forget(device.id);
  assert.equal((await get('/library/index.html', { Cookie: cookie })).status, 401);
  await phone.disable();
  await assert.rejects(get('/'), /ECONNREFUSED/);
  assert.equal(JSON.parse(await readFile(path.join(root, 'library/data/phone.json'), 'utf8')).enabled, false);
});

test('phone settings answer this computer only, through its own write check', async () => {
  const phone = { status: () => ({ enabled: false }), enable: async () => ({ enabled: true }) };
  const response = () => ({ writeHead(status) { this.status = status; }, end(body) { this.body = body; } });
  const post = body => Object.assign((async function* () { yield Buffer.from(JSON.stringify(body)); })(), { method: 'POST', url: '/__retro_library/phone', headers: {} });
  let res = response(); await handlePhone(post({ action: 'enable' }), res, { phone, canWrite: () => false }); assert.equal(res.status, 403);
  res = response(); await handlePhone(post({ action: 'enable' }), res, { phone, canWrite: () => true }); assert.equal(JSON.parse(res.body).enabled, true);
  res = response(); await handlePhone(post({ action: 'explode' }), res, { phone, canWrite: () => true }); assert.equal(res.status, 400);
});

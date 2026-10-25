// Your library to take along: a copy the Level Select phone app (the showcase site's /phone/,
// installable, works offline) opens on your phone. One file with your library, wishlist,
// scores and plan, compressed, and encrypted when you set a passphrase. Your own cloud
// folder (iCloud Drive, Google Drive, Dropbox, OneDrive) can carry it: Level Select keeps
// the file there up to date, and the phone opens it from that folder. Nobody else's server.
//
// The file: { format, version, createdAt, encrypted, data } where data is base64 of the
// gzipped JSON payload, or of its AES-256-GCM encryption (ciphertext + 16-byte tag) with a key
// from PBKDF2-SHA-256 over your passphrase (kdf: salt, iterations; iv). Browsers' Web Crypto
// opens it as is (library/copy.js).
import { readFile, writeFile, rename, mkdir, readdir, stat } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { readSnapshot, parseData, serialize } from './snapshot.mjs';
import { readRatingsSnapshot } from './ratings-snapshot.mjs';
import { readTracking } from './tracking-store.mjs';
import { readSecrets, updateSecrets } from './sources.mjs';
import { qrSvg } from './qr.mjs';

export const COPY_FORMAT = 'level-select-copy', COPY_VERSION = 1, COPY_NAME = 'level-select-copy.json', COPY_FOLDER = 'Level Select';
export const ITERATIONS = 600_000;
// Where the phone app lives: the showcase site's phone/ (LEVEL_SELECT_PHONE_APP sets another).
export const PHONE_APP_URL = process.env.LEVEL_SELECT_PHONE_APP || 'https://patryk-hd.github.io/level-select/phone/';
const SETTINGS = 'library/data/phone.json';

// ---------- what goes in
const igdbCover = id => `https://images.igdb.com/igdb/image/upload/t_cover_big/${encodeURIComponent(id)}.jpg`;
const steamCover = id => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${encodeURIComponent(id)}/library_600x900.jpg`;
const local = url => Boolean(url) && !/^https:\/\//.test(url);
// Artwork from your launchers stays on this computer (it's gigabytes): the copy points to the
// game's public cover instead: IGDB's, then Steam's, then the Game Atlas's, or none.
export function publicCovers(games, { igdb = null, connections = null, catalog = null } = {}) {
  const atlas = new Map((catalog?.games ?? []).map(game => [game.id, game.cover?.url]));
  const fromAtlas = id => (connections?.byOwned?.[id] ?? []).filter(match => match.status === 'accepted').map(match => atlas.get(match.id)).find(Boolean);
  for (const game of games) {
    if (local(game.background)) game.background = '';
    if (!local(game.cover)) continue;
    const ids = [...(game.copies ?? []).map(copy => copy.igdb?.id), game.igdb?.id].filter(Boolean);
    const image = ids.map(id => igdb?.games?.[id]?.cover).find(Boolean);
    const steam = game.steamAppId ?? game.copies?.find(copy => copy.steamAppId)?.steamAppId;
    game.cover = image ? igdbCover(image) : steam ? steamCover(steam) : fromAtlas(game.id) ?? '';
  }
  return games;
}

export async function buildPayload(root) {
  const snapshot = await readSnapshot(root, { local: true });
  const owned = parseData(snapshot.owned.source, 'PLAYNITE_LIBRARY');
  const igdb = JSON.parse(await readFile(path.join(root, 'library/data/igdb.json'), 'utf8').catch(() => 'null'));
  const catalog = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
  publicCovers(owned.PLAYNITE_LIBRARY, { igdb, connections: snapshot.connections, catalog });
  return {
    createdAt: new Date().toISOString(), sample: !snapshot.owned.local,
    files: {
      'library/data/library-data.js': serialize(owned),
      'library/data/wishlist-data.js': snapshot.wishlist.source,
      'library/data/connections.json': JSON.stringify(snapshot.connections),
      'library/data/ratings.json': JSON.stringify(await readRatingsSnapshot(root, { local: true })),
    },
    tracking: { personal: await readTracking(root, 'personal') },
  };
}

// ---------- the file
export function sealCopy(payload, passphrase = '') {
  const packed = gzipSync(Buffer.from(JSON.stringify(payload)));
  const head = { format: COPY_FORMAT, version: COPY_VERSION, createdAt: payload.createdAt };
  if (!passphrase) return JSON.stringify({ ...head, encrypted: false, data: packed.toString('base64') });
  const salt = randomBytes(16), iv = randomBytes(12), key = pbkdf2Sync(passphrase, salt, ITERATIONS, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv), sealed = Buffer.concat([cipher.update(packed), cipher.final(), cipher.getAuthTag()]);
  return JSON.stringify({ ...head, encrypted: true, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: salt.toString('base64') }, iv: iv.toString('base64'), data: sealed.toString('base64') });
}
// The same in Node (tests; the phone does this with Web Crypto in library/copy.js).
export function openCopy(text, passphrase = '') {
  const file = JSON.parse(text);
  if (file.format !== COPY_FORMAT || file.version !== COPY_VERSION) throw new Error('This isn’t a Level Select copy.');
  let packed = Buffer.from(file.data, 'base64');
  if (file.encrypted) {
    const key = pbkdf2Sync(passphrase, Buffer.from(file.kdf.salt, 'base64'), file.kdf.iterations, 32, 'sha256');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
    decipher.setAuthTag(packed.subarray(-16));
    try { packed = Buffer.concat([decipher.update(packed.subarray(0, -16)), decipher.final()]); }
    catch { throw new Error('Wrong passphrase.'); }
  }
  return JSON.parse(gunzipSync(packed).toString('utf8'));
}

// ---------- cloud folders on this computer
// The folders your cloud apps keep in sync, where they are by default. Only ones that exist.
export async function cloudFolders({ home = os.homedir(), platform = process.platform, env = process.env, exists = async target => (await stat(target).catch(() => null))?.isDirectory() ?? false } = {}) {
  const found = [], add = async (id, name, target) => { if (target && !found.some(item => item.path === target) && await exists(target)) found.push({ id, name, path: target }); };
  const inside = async (dir, pattern) => (await readdir(dir).catch(() => [])).filter(name => pattern.test(name)).map(name => path.join(dir, name));
  if (platform === 'darwin') {
    const storage = path.join(home, 'Library', 'CloudStorage');
    await add('icloud', 'iCloud Drive', path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
    for (const dir of await inside(storage, /^GoogleDrive-/)) await add('google', 'Google Drive', path.join(dir, 'My Drive'));
    await add('dropbox', 'Dropbox', path.join(storage, 'Dropbox')); await add('dropbox', 'Dropbox', path.join(home, 'Dropbox'));
    for (const dir of await inside(storage, /^OneDrive/)) await add('onedrive', 'OneDrive', dir);
  } else {
    await add('icloud', 'iCloud Drive', path.join(home, 'iCloudDrive'));
    await add('onedrive', 'OneDrive', env.OneDrive); await add('onedrive', 'OneDrive', path.join(home, 'OneDrive'));
    await add('dropbox', 'Dropbox', path.join(home, 'Dropbox'));
    await add('google', 'Google Drive', path.join(home, 'Google Drive'));
    if (platform === 'win32') for (const letter of 'GHIJKLMNOPQRSTUVWXYZ') await add('google', 'Google Drive', `${letter}:\\My Drive`);
  }
  return found;
}

// ---------- settings (phone.json's "copy"), the passphrase (secrets.json) and writing
async function readSettings(root) { return JSON.parse(await readFile(path.join(root, SETTINGS), 'utf8').catch(() => '{}')); }
async function saveCopySettings(root, change) {
  const settings = await readSettings(root), copy = { ...(settings.copy ?? {}) };
  change(copy);
  const file = path.join(root, SETTINGS);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify({ ...settings, copy }, null, 1)); await rename(`${file}.tmp`, file);
  return copy;
}
export async function copyStatus(root, { clouds = cloudFolders } = {}) {
  const copy = (await readSettings(root)).copy ?? {}, secrets = await readSecrets(root);
  return { folder: copy.folder ?? null, file: copy.folder ? path.join(copy.folder, COPY_FOLDER, COPY_NAME) : null, lastWritten: copy.lastWritten ?? null, size: copy.size ?? null,
    error: copy.error ?? null, passphrase: Boolean(secrets.phoneCopyPassphrase), clouds: await clouds(),
    app: { url: PHONE_APP_URL, svg: qrSvg(PHONE_APP_URL, { label: 'Code to open the Level Select phone app' }) } };
}
export async function setCopyFolder(root, folder) {
  if (folder !== null && (typeof folder !== 'string' || !path.isAbsolute(folder))) throw Object.assign(new Error('Choose a folder by its full path.'), { status: 400 });
  if (folder && !(await stat(folder).catch(() => null))?.isDirectory()) throw Object.assign(new Error('That folder doesn’t exist on this computer.'), { status: 400 });
  return saveCopySettings(root, copy => { copy.folder = folder; delete copy.error; });
}
export async function setPassphrase(root, passphrase) {
  if (passphrase !== null && (typeof passphrase !== 'string' || passphrase.length < 8 || passphrase.length > 200)) throw Object.assign(new Error('Use at least 8 characters, or a few words.'), { status: 400 });
  await updateSecrets(root, secrets => { if (passphrase) secrets.phoneCopyPassphrase = passphrase; else delete secrets.phoneCopyPassphrase; });
}
// The file, sealed with your passphrase if you set one.
export async function copyFile(root) { return sealCopy(await buildPayload(root), (await readSecrets(root)).phoneCopyPassphrase ?? ''); }
// Writes the copy into your chosen folder (in a "Level Select" folder there).
export async function writeCopy(root) {
  const { folder } = (await readSettings(root)).copy ?? {};
  if (!folder) return null;
  try {
    const text = await copyFile(root), dir = path.join(folder, COPY_FOLDER), file = path.join(dir, COPY_NAME);
    await mkdir(dir, { recursive: true });
    await writeFile(`${file}.tmp`, text); await rename(`${file}.tmp`, file);
    return saveCopySettings(root, copy => { copy.lastWritten = new Date().toISOString(); copy.size = Buffer.byteLength(text); delete copy.error; });
  } catch (error) { return saveCopySettings(root, copy => { copy.error = error.message; }); }
}
// Kept up to date: after an update, and a minute after your plan last changed.
export function copyKeeper(root) {
  let timer = null;
  return { soon(delay = 60_000) { clearTimeout(timer); timer = setTimeout(() => { writeCopy(root).catch(() => {}); }, delay); timer.unref?.(); } };
}

// GET/POST /__retro_library/phone-copy (this computer only), and …/download for the file.
export async function handleCopy(req, res, { root, canWrite, keeper }) {
  const route = new URL(req.url, 'http://x').pathname;
  if (!['/__retro_library/phone-copy', '/__retro_library/phone-copy/download'].includes(route)) return false;
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  try {
    if (route.endsWith('/download')) {
      // A plain link can't carry the app's header: it's still this computer's own page asking.
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') { send(403, { error: 'Forbidden' }); return true; }
      const text = await copyFile(root);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${COPY_NAME}"`, 'Cache-Control': 'no-store' });
      res.end(text); return true;
    }
    if (req.method === 'GET') { send(200, await copyStatus(root)); return true; }
    if (!canWrite(req)) { send(403, { error: 'Forbidden' }); return true; }
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) { send(413, { error: 'Too large.' }); return true; } }
    const { action, folder = null, passphrase = null } = JSON.parse(body || '{}');
    if (action === 'folder') { await setCopyFolder(root, folder); if (folder) await writeCopy(root); }
    else if (action === 'passphrase') { await setPassphrase(root, passphrase); await writeCopy(root); }
    else if (action === 'write') await writeCopy(root);
    else { send(400, { error: 'Unknown action.' }); return true; }
    send(200, await copyStatus(root));
  } catch (error) { send(error.status ?? 500, { error: error.message }); }
  return true;
}

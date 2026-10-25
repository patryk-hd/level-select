import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { webcrypto } from 'node:crypto';
import { sealCopy, openCopy, publicCovers, cloudFolders, handleCopy, setCopyFolder, setPassphrase, COPY_FORMAT } from '../scripts/phone-copy.mjs';

const payload = { createdAt: '2026-10-20T10:00:00.000Z', files: { 'library/data/library-data.js': 'window.PLAYNITE_LIBRARY = [];\n' }, tracking: { personal: null } };

test('a copy opens as it was sealed: plainly, or only with its passphrase', () => {
  assert.deepEqual(openCopy(sealCopy(payload)), payload);
  const sealed = sealCopy(payload, 'correct horse battery');
  const file = JSON.parse(sealed);
  assert.equal(file.format, COPY_FORMAT); assert.equal(file.encrypted, true); assert.equal(file.kdf.iterations, 600000);
  assert.doesNotMatch(sealed, /PLAYNITE_LIBRARY/);
  assert.deepEqual(openCopy(sealed, 'correct horse battery'), payload);
  assert.throws(() => openCopy(sealed, 'wrong horse'), /Wrong passphrase/);
  assert.throws(() => openCopy('{"format":"something-else"}'), /isn’t a Level Select copy/);
});

test('the phone decrypts it with Web Crypto as the browser does (PBKDF2, AES-GCM, gzip)', async () => {
  const file = JSON.parse(sealCopy(payload, 'correct horse battery')), bytes = base64 => Uint8Array.from(Buffer.from(base64, 'base64'));
  const material = await webcrypto.subtle.importKey('raw', new TextEncoder().encode('correct horse battery'), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: file.kdf.hash, iterations: file.kdf.iterations, salt: bytes(file.kdf.salt) }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const packed = new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(file.iv) }, key, bytes(file.data)));
  const text = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  assert.deepEqual(JSON.parse(text), payload);
});

test('artwork on this computer becomes the game’s public cover (IGDB, then Steam, then the Atlas)', () => {
  const games = [
    { id: 'a', cover: 'assets/covers/a.jpg', background: 'assets/bg/a.jpg', copies: [{ igdb: { id: 7 } }] },
    { id: 'b', cover: 'assets/covers/b.jpg', steamAppId: '620', copies: [{}] },
    { id: 'c', cover: '/__retro_library/cover/manual-x.png', copies: [{}] },
    { id: 'd', cover: 'assets/covers/d.jpg', copies: [{}] },
    { id: 'e', cover: 'https://images.gog.com/e.jpg', copies: [{}] },
  ];
  publicCovers(games, { igdb: { games: { 7: { cover: 'co1abc' } } }, connections: { byOwned: { c: [{ id: 'atlas-c', status: 'accepted' }] } }, catalog: { games: [{ id: 'atlas-c', cover: { url: 'https://raw.githubusercontent.com/c.png' } }] } });
  assert.deepEqual(games.map(game => game.cover), ['https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg', 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/library_600x900.jpg', 'https://raw.githubusercontent.com/c.png', '', 'https://images.gog.com/e.jpg']);
  assert.equal(games[0].background, '');
});

test('cloud folders: only the ones that exist, as each app keeps them', async () => {
  const home = '/Users/me', there = new Set([`${home}/Library/Mobile Documents/com~apple~CloudDocs`, `${home}/Library/CloudStorage/OneDrive-Personal`]);
  const mac = await cloudFolders({ home, platform: 'darwin', exists: async target => there.has(target) });
  assert.deepEqual(mac.map(cloud => cloud.name), ['iCloud Drive']);
  const windows = await cloudFolders({ home: 'C:\\Users\\me', platform: 'win32', env: { OneDrive: 'C:\\Users\\me\\OneDrive' }, exists: async target => ['C:\\Users\\me\\OneDrive', 'G:\\My Drive'].includes(target) });
  assert.deepEqual(windows.map(cloud => cloud.name), ['OneDrive', 'Google Drive']);
});

test('copy settings: a real folder, a passphrase of 8+ characters, saved apart from the copy', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'level-select-copy-')); t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(setCopyFolder(root, 'relative/path'), /full path/);
  await assert.rejects(setCopyFolder(root, path.join(root, 'missing')), /doesn’t exist/);
  await mkdir(path.join(root, 'Cloud')); await setCopyFolder(root, path.join(root, 'Cloud'));
  assert.equal(JSON.parse(await readFile(path.join(root, 'library/data/phone.json'), 'utf8')).copy.folder, path.join(root, 'Cloud'));
  await assert.rejects(setPassphrase(root, 'short'), /8 characters/);
  await setPassphrase(root, 'a long passphrase');
  assert.equal(JSON.parse(await readFile(path.join(root, 'library/data/secrets.json'), 'utf8')).phoneCopyPassphrase, 'a long passphrase');
  assert.doesNotMatch(await readFile(path.join(root, 'library/data/phone.json'), 'utf8'), /long passphrase/);
});

test('the copy’s settings answer this computer’s own page only', async () => {
  const response = () => ({ headers: {}, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = body; } });
  const request = (method, url, headers = {}, body = null) => Object.assign((async function* () { if (body) yield Buffer.from(JSON.stringify(body)); })(), { method, url, headers });
  let res = response();
  assert.equal(await handleCopy(request('GET', '/elsewhere'), res, { root: '/nowhere', canWrite: () => true }), false);
  await handleCopy(request('POST', '/__retro_library/phone-copy', {}, { action: 'write' }), res, { root: '/nowhere', canWrite: () => false });
  assert.equal(res.status, 403);
  res = response(); await handleCopy(request('GET', '/__retro_library/phone-copy/download', { 'sec-fetch-site': 'cross-site' }), res, { root: '/nowhere', canWrite: () => true });
  assert.equal(res.status, 403);
});

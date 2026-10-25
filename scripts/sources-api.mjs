// The local server's "Import games" endpoints: what's on this computer, connecting and
// disconnecting sources, uploading export files, choosing folders, and ES-DE box art.
// Only requests from the app's own pages are accepted (same origin, custom header).
import { createWriteStream } from 'node:fs';
import { readFile, rename, rm, open, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { detectSources, resolveSteamAccount, importSteamWishlist, importSteamOwned, importSteamInstalled, importGalaxy, importEsde, readConfig, updateConfig, readSecrets, updateSecrets, checkIgdbKeys, checkVgcKey,
  readEsdeImport, SOURCE_FILES, UPLOADED_GALAXY } from './sources.mjs';
import { checkLibraryCsv, checkWishlistJson, INPUTS } from './update-all.mjs';
import { romScan } from './rom-scan.mjs';
import { findPython } from './platform.mjs';
import { readManual } from './manual-games.mjs';

const MEDIA_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
// Largest accepted upload per kind (a big GOG Galaxy database is a few hundred MB).
const UPLOADS = { playnite: { file: INPUTS.library, limit: 100e6 }, wishlist: { file: INPUTS.wishlist, limit: 50e6 }, galaxy: { file: UPLOADED_GALAXY, limit: 1e9 } };

export function localRequestAllowed({ method, headers }, port, { json = true } = {}) {
  return method === 'POST' && [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(headers.origin) && headers['x-retro-library'] === '1' &&
    (!json || String(headers['content-type'] ?? '').startsWith('application/json'));
}
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
async function readBody(req, limit = 4096) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > limit) throw new Error('Request too large.'); }
  return body ? JSON.parse(body) : {};
}

// The system "Choose folder" window, so nobody has to type a path: macOS asks through
// AppleScript, Windows through PowerShell's folder browser (both ship with the system).
const WINDOWS_PICKER = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$dialog.Description = $env:LEVEL_SELECT_PROMPT',
  '$dialog.ShowNewFolderButton = $false',
  // An invisible owner window keeps the dialog in front of the browser.
  '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }',
  'if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) } else { exit 3 }',
].join('; ');
export function chooseFolder(prompt, platform = process.platform) {
  const text = String(prompt || 'Choose a folder').slice(0, 120);
  if (platform === 'win32') return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_PICKER],
    { timeout: 300000, env: { ...process.env, LEVEL_SELECT_PROMPT: text } }, (error, stdout) => {
      if (error) reject(new Error(error.code === 3 ? 'No folder chosen.' : 'The folder window couldn’t open. Paste the folder’s full path instead.'));
      else resolve(String(stdout).trim());
    }));
  if (platform !== 'darwin') return Promise.reject(new Error('Folder picking works on macOS and Windows. Paste the folder’s full path instead.'));
  const script = `POSIX path of (choose folder with prompt ${JSON.stringify(text)})`;
  return new Promise((resolve, reject) => execFile('/usr/bin/osascript', ['-e', script], { timeout: 300000 }, (error, stdout) => {
    if (error) reject(new Error(/-128/.test(String(error.message)) ? 'No folder chosen.' : 'The folder window couldn’t open. Paste the folder’s full path instead.'));
    else resolve(stdout.trim().replace(/\/$/, '') || '/');
  }));
}

export async function handleSources(req, res, { root, port, startUpdate }) {
  const url = new URL(req.url, 'http://localhost'), route = decodeURIComponent(url.pathname);

  if (route === '/__retro_library/sources' && req.method === 'GET') {
    const body = await detectSources(root);
    const roms = await romScan(root, ['--list']).catch(() => ({ folders: [] }));
    const esde = await readEsdeImport(root);
    const romDirectory = esde?.romDirectory ?? null;
    send(res, 200, { ...body, python: Boolean(findPython()), romFolders: roms.folders, manualGames: (await readManual(root)).games.length, esdeRomDirectory: romDirectory, esdeRomsAvailable: Boolean(romDirectory && await stat(romDirectory).then(found => found.isDirectory(), () => false)) });
    return true;
  }

  // ES-DE's downloaded box art, only from the media folder of the imported ES-DE setup.
  if (route.startsWith('/__retro_library/esde-media/') && req.method === 'GET') {
    const esde = await readEsdeImport(root), media = esde?.mediaDirectory;
    const file = media && path.resolve(media, route.slice('/__retro_library/esde-media/'.length));
    if (!file || !file.startsWith(path.resolve(media) + path.sep) || !MEDIA_TYPES[path.extname(file).toLowerCase()]) { res.writeHead(404); res.end(); return true; }
    try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': MEDIA_TYPES[path.extname(file).toLowerCase()], 'Cache-Control': 'private, max-age=86400' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
    return true;
  }

  if (route === '/__retro_library/upload') {
    const kind = url.searchParams.get('kind'), upload = UPLOADS[kind];
    if (!localRequestAllowed(req, port, { json: false }) || !upload) { send(res, 403, { error: 'Forbidden' }); return true; }
    const target = path.join(root, upload.file), temporary = `${target}.upload`;
    try {
      if (Number(req.headers['content-length']) > upload.limit) throw new Error('That file is too large.');
      let size = 0;
      await pipeline(req, async function* (source) { for await (const chunk of source) { size += chunk.length; if (size > upload.limit) throw new Error('That file is too large.'); yield chunk; } }, createWriteStream(temporary));
      if (!size) throw new Error('The file was empty.');
      if (kind === 'galaxy') {
        const handle = await open(temporary); const header = Buffer.alloc(16); await handle.read(header, 0, 16, 0); await handle.close();
        if (header.toString('latin1') !== 'SQLite format 3\0') throw new Error('That isn’t a GOG Galaxy database. Choose the file called galaxy-2.0.db.');
      } else {
        const content = await readFile(temporary);
        (kind === 'playnite' ? checkLibraryCsv : checkWishlistJson)(content);
      }
      await rename(temporary, target);
      let result = { saved: true };
      if (kind === 'galaxy') {
        result = await importGalaxy(root, target);
        await updateConfig(root, config => { config.galaxy = { path: target, uploaded: true, syncedAt: result.importedAt, count: result.count, stores: result.stores }; });
      }
      if (kind === 'playnite') await updateConfig(root, config => { config.playnite = { uploadedAt: new Date().toISOString() }; });
      if (kind === 'wishlist') await updateConfig(root, config => { config.wishlistFile = { uploadedAt: new Date().toISOString() }; });
      send(res, 200, { ...result, update: startUpdate({ skipSync: true }) });
    } catch (error) { await rm(temporary, { force: true }); send(res, 400, { error: error.message }); }
    return true;
  }

  if (route !== '/__retro_library/sources') return false;
  if (!localRequestAllowed(req, port)) { send(res, 403, { error: 'Forbidden' }); return true; }
  try {
    const body = await readBody(req), action = body.action;
    const config = await readConfig(root), steamId = config.steam?.account?.steamId;
    const needAccount = () => { if (!steamId) throw new Error('Choose your Steam account first (step 1).'); return steamId; };
    let result = {}, update = false;
    switch (action) {
      case 'steam-account': {
        const account = await resolveSteamAccount(body.input);
        await updateConfig(root, current => { current.steam = { ...(current.steam?.account?.steamId === account.steamId ? current.steam : {}), account }; });
        result = { account };
        break;
      }
      case 'steam-wishlist': {
        result = await importSteamWishlist(root, needAccount());
        await updateConfig(root, current => { current.steam.wishlist = { syncedAt: result.fetchedAt, count: result.count }; });
        update = true; break;
      }
      case 'steam-key': {
        const key = String(body.key ?? '').trim() || (await readSecrets(root)).steamApiKey;
        result = await importSteamOwned(root, needAccount(), key);
        await updateSecrets(root, secrets => { secrets.steamApiKey = key; });
        await updateConfig(root, current => { current.steam.owned = { syncedAt: result.importedAt, count: result.count }; });
        update = true; break;
      }
      case 'steam-disconnect': {
        const part = body.part;
        if (part === 'owned' || part === 'account') { await updateSecrets(root, secrets => { delete secrets.steamApiKey; }); await rm(path.join(root, SOURCE_FILES.steamOwned), { force: true }); update = true; }
        await updateConfig(root, current => { if (!current.steam) return; if (part === 'account') delete current.steam; else delete current.steam[part]; });
        break;
      }
      case 'steam-installed': {
        result = await importSteamInstalled(root);
        await updateConfig(root, current => { current.steamInstalled = { syncedAt: result.importedAt, count: result.count, shared: result.shared, folders: result.folders }; });
        update = true; break;
      }
      case 'steam-installed-disconnect': {
        await rm(path.join(root, SOURCE_FILES.steamInstalled), { force: true });
        await updateConfig(root, current => { delete current.steamInstalled; });
        update = true; break;
      }
      case 'galaxy': {
        const dbPath = body.path || config.galaxy?.path || (await detectSources(root)).galaxy.found[0];
        result = await importGalaxy(root, dbPath);
        await updateConfig(root, current => { current.galaxy = { path: dbPath, syncedAt: result.importedAt, count: result.count, stores: result.stores }; });
        update = true; break;
      }
      case 'galaxy-disconnect': {
        await rm(path.join(root, SOURCE_FILES.galaxy), { force: true });
        if (config.galaxy?.uploaded) await rm(path.join(root, UPLOADED_GALAXY), { force: true });
        await updateConfig(root, current => { delete current.galaxy; });
        update = true; break;
      }
      case 'playnite-disconnect': {
        await rm(path.join(root, INPUTS.library), { force: true });
        await updateConfig(root, current => { delete current.playnite; });
        update = true; break;
      }
      case 'esde': {
        const folder = body.path || config.esde?.root || (await detectSources(root)).esde.found[0];
        result = await importEsde(root, folder);
        await updateConfig(root, current => { current.esde = { root: folder, syncedAt: result.importedAt, count: result.count, files: result.files, systems: result.systems }; });
        update = true; break;
      }
      case 'esde-disconnect': {
        await rm(path.join(root, SOURCE_FILES.esde), { force: true });
        await updateConfig(root, current => { delete current.esde; });
        break;
      }
      // Your own score keys: checked with the service first, then saved only on this computer.
      case 'igdb-keys': {
        const keys = await checkIgdbKeys(body.clientId, body.clientSecret);
        await updateSecrets(root, secrets => { secrets.igdbClientId = keys.clientId; secrets.igdbClientSecret = keys.clientSecret; });
        update = true; break;
      }
      case 'igdb-forget': { await updateSecrets(root, secrets => { delete secrets.igdbClientId; delete secrets.igdbClientSecret; }); break; }
      case 'vgc-key': {
        const key = await checkVgcKey(body.key);
        await updateSecrets(root, secrets => { secrets.vgcApiKey = key; });
        update = true; break;
      }
      case 'vgc-forget': { await updateSecrets(root, secrets => { delete secrets.vgcApiKey; }); break; }
      case 'pick-folder': { result = { path: await chooseFolder(body.prompt) }; break; }
      case 'rom-folder': {
        const folder = String(body.folder ?? '').trim();
        if (!['add', 'remove', 'scan'].includes(body.mode)) throw new Error('Unknown ROM folder action.');
        if (body.mode !== 'scan' && !path.isAbsolute(folder)) throw new Error(`Choose a folder, or paste its full path (for example ${process.platform === 'win32' ? 'D:\\Games\\ROMs' : '/Users/you/ROMs'}).`);
        const scanned = await romScan(root, body.mode === 'scan' ? [] : [`--${body.mode}`, folder]);
        result = { folders: scanned.folders, games: scanned.games?.length ?? 0, unrecognised: scanned.unrecognised?.length ?? 0, missing: scanned.missing ?? [], message: scanned.message ?? null };
        update = body.mode !== 'remove' && result.games > 0; break;
      }
      default: throw new Error('Unknown action.');
    }
    send(res, 200, { ...result, update: update ? startUpdate({ skipSync: true }) : false });
  } catch (error) { send(res, 400, { error: error.message }); }
  return true;
}


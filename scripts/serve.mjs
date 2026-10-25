import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readSnapshot, readCatalog } from './snapshot.mjs';
import { readRatingsSnapshot } from './ratings-snapshot.mjs';
import { saveOverride, correctionRequestAllowed } from './igdb-overrides.mjs';
import { spawn } from 'node:child_process';
import { INPUTS, STOP_FILE } from './update-all.mjs';
import { readFolders, readRoms } from './roms.mjs';
import { romScan } from './rom-scan.mjs';
import { handleSources } from './sources-api.mjs';
import { handleGames } from './games-api.mjs';
import { responseCache, entity, sendEntity, matches, fileTag } from './serve-cache.mjs';
import { commandLine, isProjectCommand } from './platform.mjs';
import { handleTracking } from './tracking-store.mjs';
import { createPhoneAccess, handlePhone, iconVersion } from './phone-access.mjs';
import { handleCopy, copyKeeper } from './phone-copy.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const projectId = createHash('sha256').update(root).digest('hex');
const port = Number(process.env.RETRO_LIBRARY_PORT || 8765);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid library port');
const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.avif':'image/avif', '.ico':'image/x-icon', '.woff2':'font/woff2' };
let updateChild = null, updateQueued = null;
// Your phone copy (phone-copy.mjs), when you keep one in a folder: rewritten after changes.
const keeper = copyKeeper(root);
const cached = responseCache(root);
// Is this process one of the update's own commands (a script in this project)? Guards
// against a reused process id before anything is stopped.
const isOurCommand = async pid => isProjectCommand(await commandLine(pid));
// Run npm run update in the background. After an import it skips re-syncing what was just
// fetched. One more run is queued when an import lands while an update is already going.
function startUpdate({ skipSync = false } = {}) {
  if (updateChild) { updateQueued = { skipSync: Boolean(updateQueued?.skipSync ?? true) && skipSync }; return 'queued'; }
  updateChild = spawn(process.execPath, [path.join(root, 'scripts/update-all.mjs')], { cwd: root, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...(skipSync ? { LEVEL_SELECT_SKIP_SYNC: '1' } : {}) } });
  updateChild.on('close', () => { updateChild = null; keeper.soon(2000); if (updateQueued) { const next = updateQueued; updateQueued = null; startUpdate(next); } });
  return 'started';
}
// Only requests addressed to this computer's own name are answered. Another website pointed
// at 127.0.0.1 by its own domain name (DNS rebinding) would otherwise read your library.
const HOSTS = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
// This computer's own address. A paired phone reaches the same app through phone-access.mjs,
// with its own address, its own write check and a mark on every page (phone: true).
const LOCAL = { hosts: HOSTS, canWrite: req => correctionRequestAllowed(req, port), phone: false };
// Phones reach the app over plain http on your home network, where browsers leave out
// crypto.randomUUID (tracking uses it for every change): a standard version 4 UUID instead.
const ICONS = await iconVersion(root);
const PHONE_MARK = '<meta name="level-select-phone" content="1">' +
  // Added to a home screen, it's Level Select with its icon (not the page title's first letter).
  `<link rel="apple-touch-icon" href="/assets/app-icon-180.png?v=${ICONS}"><meta name="apple-mobile-web-app-title" content="Level Select"><link rel="manifest" href="/__phone/manifest.webmanifest?v=${ICONS}">` +
  '<script>if(self.crypto&&!crypto.randomUUID)crypto.randomUUID=()=>"10000000-1000-4000-8000-100000000000".replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));</script>';
let phone = null;
async function handle(req, res, context = LOCAL) {
  if (!context.hosts.has(String(req.headers.host ?? '').toLowerCase())) { res.writeHead(403, {'Content-Type':'text/plain'}); res.end('Forbidden'); return; }
  // Nor may another website load Level Select's files into its own page: a <script src> there
  // would run your library file and hand it your games. Browsers say where a request comes
  // from; following a link to Level Select is still fine.
  if (req.headers['sec-fetch-site'] === 'cross-site' && req.headers['sec-fetch-mode'] !== 'navigate') { res.writeHead(403, {'Content-Type':'text/plain'}); res.end('Forbidden'); return; }
  // The same for browsers that don't say: only this site may use these files, nobody may show
  // Level Select inside their own page, and links out don't say where you came from.
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if (pathname === '/__retro_library_health') {
      res.writeHead(200, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
      res.end(JSON.stringify({app:'retro-library', projectId, pid:process.pid}));
      return;
    }
    // Your tracking, shared by this computer's browsers and paired phones.
    if (await handleTracking(req, res, { root, canWrite: context.canWrite, onSaved: () => keeper.soon() })) return;
    if (!context.phone && phone && await handlePhone(req, res, { phone, canWrite: context.canWrite })) return;
    if (!context.phone && await handleCopy(req, res, { root, canWrite: context.canWrite, keeper })) return;
    if (await handleSources(req, res, { root, port, startUpdate })) return;
    if (await handleGames(req, res, { root, port, startUpdate })) return;
    // Data updates: status (read-only), start an update, add or remove a ROM folder.
    if (pathname === '/__retro_library/update-status') {
      const info = async file => { const found = await stat(path.join(root, file)).catch(() => null); return found ? { path: path.join(root, file), modified: found.mtime.toISOString(), size: found.size } : { path: path.join(root, file), missing: true }; };
      const saved = JSON.parse(await readFile(path.join(root, '.runtime/update.json'), 'utf8').catch(() => 'null'));
      const roms = await readRoms(root);
      // An update started from the terminal is running too, as long as its process is alive.
      const alive = pid => { try { return Boolean(pid) && process.kill(pid, 0); } catch { return false; } };
      const running = Boolean(updateChild) || saved?.state === 'running' && alive(saved.pid);
      // An update whose process is gone was interrupted (the app quit mid-update): its last
      // step isn't running any more, though a command it started may still be finishing.
      const leftover = saved?.state === 'running' && !running && alive(saved.childPid) && await isOurCommand(saved.childPid);
      const interrupted = saved?.state === 'running' && !running ? { ...saved, state: 'interrupted', leftover,
        steps: saved.steps.map(step => step.state === 'running' ? { ...step, state: 'interrupted', note: leftover ? 'The app closed during this step; it is still finishing in the background. Choose Stop to end it.' : 'The app closed during this step. Choose Update data to finish.' } : step) } : null;
      const body = { status: interrupted ?? saved, running, queued: Boolean(updateQueued), now: new Date().toISOString(),
        inputs: { library: await info(INPUTS.library), wishlist: await info(INPUTS.wishlist) }, romFolders: await readFolders(root), roms: roms ? { games: roms.games.length, scannedAt: roms.scannedAt } : null };
      res.writeHead(200, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(body)); return;
    }
    // Stop the running update (started here or from a terminal). It finishes the current
    // command cleanly, keeps finished steps and marks itself stopped.
    if (pathname === '/__retro_library/update-stop') {
      if (!correctionRequestAllowed(req, port)) { res.writeHead(403, {'Content-Type':'text/plain'}); res.end('Forbidden'); return; }
      const saved = JSON.parse(await readFile(path.join(root, '.runtime/update.json'), 'utf8').catch(() => 'null'));
      const pid = updateChild?.pid ?? (saved?.state === 'running' ? saved.pid : null);
      updateQueued = null;
      let stopped = false;
      // The update watches for a stop file (all systems) and also stops on SIGTERM (macOS and
      // Linux; on Windows that signal would end it outright and leave its current step running).
      try {
        if (pid && process.kill(pid, 0)) {
          await mkdir(path.join(root, '.runtime'), { recursive: true }); await writeFile(path.join(root, STOP_FILE), new Date().toISOString());
          if (process.platform !== 'win32') process.kill(pid, 'SIGTERM');
          stopped = true;
        }
      } catch {}
      // The update is gone but the command it started is still going: interrupt it (it saves first).
      if (!stopped && saved?.childPid && await isOurCommand(saved.childPid)) { try { process.kill(saved.childPid, 'SIGINT'); stopped = true; } catch {} }
      res.writeHead(stopped ? 202 : 409, {'Content-Type':'application/json'}); res.end(JSON.stringify(stopped ? { stopping: true } : { error: 'No update is running.' })); return;
    }
    if (['/__retro_library/update', '/__retro_library/rom-folder'].includes(pathname)) {
      if (!correctionRequestAllowed(req, port)) { res.writeHead(403, {'Content-Type':'text/plain'}); res.end('Forbidden'); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) { res.writeHead(413); res.end(); return; } }
      try {
        if (pathname === '/__retro_library/update') {
          if (updateChild) throw new Error('An update is already running.');
          startUpdate();
          res.writeHead(202, {'Content-Type':'application/json'}); res.end('{"started":true}'); return;
        }
        const { folder, action } = JSON.parse(body);
        if (typeof folder !== 'string' || !path.isAbsolute(folder) || !['add', 'remove'].includes(action)) throw new Error('Paste the full path of a folder, e.g. /Users/you/ROMs.');
        const result = await romScan(root, [`--${action}`, folder]);
        res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ folders: result.folders, games: result.games?.length ?? null, unrecognised: result.unrecognised?.length ?? 0 })); return;
      } catch (error) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error: error.message })); return; }
    }
    if (pathname === '/__retro_library/igdb-match') {
      // The one write endpoint: your IGDB match corrections.
      if (!correctionRequestAllowed(req, port)) {
        res.writeHead(403, {'Content-Type':'text/plain'}); res.end('Forbidden'); return;
      }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2048) { res.writeHead(413); res.end(); return; } }
      try { await saveOverride(root, JSON.parse(body)); res.writeHead(200, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end('{"saved":true}'); }
      catch (error) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error: error.message })); }
      return;
    }
    if (pathname.split('/').some(part => part.startsWith('.')) || pathname.includes('..')) throw new Error('Invalid path');
    if (pathname === '/library/data/ratings.json') {
      const local = new URL(req.url, 'http://localhost').searchParams.get('workspace') !== 'sample';
      sendEntity(req, res, await cached(`ratings:${local}`, async () => entity(JSON.stringify(await readRatingsSnapshot(root, { local })))), 'application/json; charset=utf-8');
      return;
    }
    if (pathname === '/data/catalog.json') {
      sendEntity(req, res, await cached('catalog', async () => entity(JSON.stringify(await readCatalog(root, { local: true })))), 'application/json; charset=utf-8');
      return;
    }
    const snapshotFiles = ['/library/data/library-data.js', '/library/data/wishlist-data.js', '/library/data/connections.json'];
    if (snapshotFiles.includes(pathname)) {
      // One snapshot serves all three files.
      const snapshot = await cached('snapshot', async () => {
        const { owned, wishlist, connections } = await readSnapshot(root, { local: true });
        return { 'library-data.js': entity(owned.source), 'wishlist-data.js': entity(wishlist.source), 'connections.json': entity(JSON.stringify(connections)) };
      });
      sendEntity(req, res, snapshot[path.basename(pathname)], `${types[path.extname(pathname)]}; charset=utf-8`);
      return;
    }
    // Only serve the app, not exports, backup databases, source tools or local builds.
    const allowed = /^\/(?:index\.html|(?:styles|controls)\.css|app\.js|lib\.js|navigation\.(?:css|js)|theme\.(?:css|js)|welcome\.(?:css|js)|assets\/[^/].*|pages\/[^/]+\.html|data\/(?:catalog|atlas-details|system-facts|mods)\.json|ranking\/(?:(?:evidence|ui|snapshot|panels|modes|mode-ui|mods)\.js|styles\.css|methodology\.html)|tracking\/(?:awards|gameplay|group-notes|products|products-ui|atlas|domain|legacy|backup|persistence|browser|compat|client|suggestions|score|triage|home|plan|owned|badges|anchors|wishlist|history|history-ui|rewards|identity|matches|matches-ui|challenges|goals|families|lists|ui)\.js|tracking\/styles\.css|library\/(?:backlog\.(?:html|js|css)|sources\.(?:html|js|css)|add-game\.(?:js|css)|mods\.(?:html|js|css)|phone\.(?:html|js|css)|copy(?:-app)?\.js|(?:suggestions|history|score-ui|triage|home|progress|update-ui|update-progress|motion|browse-ui|goals|hovercard)\.js|(?:rewards|challenges)\.(?:js|css)|wishlist-planning\.(?:js|css)|index\.html|wishlist\.html|styles\.css|app\.js|wishlist\.js|core\.js|search-ui\.js|runtime\.js|icons\.js|README\.md|assets\/[^/].*))$/;
    if (pathname !== '/' && pathname !== '/library/' && !allowed.test(pathname)) throw new Error('Private path');
    let file = path.join(root, pathname), info = await stat(file);
    if (info.isDirectory()) { file = path.join(file,'index.html'); info = await stat(file); }
    const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // Artwork is reused for a day. App code and data are kept by the browser but checked on
    // every use, so a change is always picked up and an unchanged file costs a 304.
    // A page shown on a paired phone says so (lib.js onPhone), so it can leave out what only
    // this computer can do; its cache tag differs from this computer's copy of the page.
    const marked = context.phone && type === 'text/html';
    const etag = marked ? fileTag(info).replace(/"$/, '-phone"') : fileTag(info);
    const headers = { 'Content-Type': type, 'Cache-Control': type.startsWith('image/') ? 'private, max-age=86400' : 'no-cache', ETag: etag };
    if (matches(req, etag)) { res.writeHead(304, headers); res.end(); return; }
    res.writeHead(200, headers);
    const body = await readFile(file);
    res.end(marked ? body.toString('utf8').replace('<head>', `<head>\n${PHONE_MARK}`) : body);
  } catch { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); }
}
const server = http.createServer((req, res) => handle(req, res)).listen(port, '127.0.0.1', async () => {
  console.log(`Local: http://127.0.0.1:${port}`);
  // Phone access starts with the app when you've turned it on.
  try { phone = await createPhoneAccess({ root, port, handle }).init(); if (phone.status().running) console.log(`Phone access: port ${phone.status().port}`); }
  catch (error) { console.error(`Phone access is unavailable: ${error.message}`); }
});
process.on('SIGTERM', () => {
  phone?.stop();
  server.close(() => process.exit(0));
  server.closeAllConnections();
});

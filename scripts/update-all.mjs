// One step to bring the app up to date: npm run update (or "Update data" in the app).
//
// Connected sources (Steam, GOG Galaxy, ES-DE; see "Import games" in the app) are synced
// first. A Playnite export at library/playnite_library.csv and a wishlist file at
// library/steam-wishlist.json are picked up too. Reload the app afterwards.
//
// Previous exports are archived in library/data/imports/<date>/ automatically. Only what
// changed is rebuilt; ROM folders are rescanned; new games get IGDB and Steam scores.
// Progress is written to .runtime/update.json so the app can show it.
import { readFile, writeFile, mkdir, copyFile, rename, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseData, readOwnedGroups } from './snapshot.mjs';
import { readFolders } from './roms.mjs';
import { readManual } from './manual-games.mjs';
import { readAwards } from './awards.mjs';
import { syncSources, readConfig, scoreKeys, SOURCE_FILES } from './sources.mjs';
import { findPython, MISSING_PYTHON, PYTHON_ENV } from './platform.mjs';

export const INPUTS = { library: 'library/playnite_library.csv', wishlist: 'library/steam-wishlist.json' };
const STATUS_FILE = '.runtime/update.json', LAST_FILE = 'library/data/imports/last.json';
// Stop asks through this file too: Windows ends a process outright instead of signalling it,
// which would leave the running step behind.
export const STOP_FILE = '.runtime/update.stop';

const sha = buffer => createHash('sha256').update(buffer).digest('hex');
async function readOptional(file) { try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function writeAtomic(file, value) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(`${file}.tmp`, JSON.stringify(value, null, 1)); await rename(`${file}.tmp`, file); }

// Friendly checks: the right file in the right place, in the format the builders read.
export function checkLibraryCsv(buffer) {
  const header = buffer.toString('utf8', 0, 4096).replace(/^﻿/, '').split(/\r?\n/)[0] ?? '';
  const columns = header.split(',').map(column => column.replace(/^"|"$/g, '').trim());
  const missing = ['Id', 'Name', 'Platforms', 'Sources'].filter(column => !columns.includes(column));
  if (missing.length) throw new Error(`playnite_library.csv is missing the ${missing.join(', ')} column(s). Export it from Playnite with those fields.`);
}
export function checkWishlistJson(buffer) {
  let data; try { data = JSON.parse(buffer.toString('utf8').replace(/^﻿/, '')); } catch { throw new Error('steam-wishlist.json is not valid JSON.'); }
  const items = Array.isArray(data) ? data : data?.data;
  // Steam exports write the id as ["steam", "app/1700"]; older tools used a plain number.
  const appid = item => Array.isArray(item?.gameid) ? (item.gameid[0] === 'steam' && /\d+/.test(item.gameid[1] ?? '')) : /^\d+$/.test(String(item?.gameid ?? item?.appid ?? ''));
  if (!Array.isArray(items) || !items.length || !items.every(appid)) throw new Error('steam-wishlist.json should contain a "data" list of Steam games. Export it again from Steam.');
  return items.length;
}

// Keys usually live in ~/.zshrc, which apps started from the Dock don't load. Returns the
// ones found: { NAME: value }.
function shellEnv(names) {
  const found = Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]]));
  if (Object.keys(found).length === names.length || process.platform !== 'darwin') return Promise.resolve(found);
  return new Promise(resolve => execFile('/bin/zsh', ['-ic', names.map(name => `print -r -- "$${name}"`).join('; ')], { timeout: 8000 }, (error, stdout) => {
    const lines = String(stdout ?? '').split('\n').map(line => line.trim());
    resolve(error ? found : { ...Object.fromEntries(names.map((name, index) => [name, lines[index]]).filter(([, value]) => value)), ...found });
  }));
}
const DAY = 86400000;
// Every step, in order, so the app can show what's ahead and how far along the update is.
export const PLAN = [['sources', 'Sync your connected sources'], ['library', 'Rebuild your library'], ['wishlist', 'Rebuild your Steam wishlist'], ['prices', 'Refresh wishlist prices'],
  ['roms', 'Rescan your ROM folders'], ['igdb', 'Fetch IGDB scores and time to beat for new games'], ['steam', 'Refresh Steam reviews'], ['awards', 'Refresh game awards (Wikidata)'], ['vgc', 'Fetch VideoGamesCritic scores']];
// A step that prints nothing for this long is treated as stuck (a dropped connection, say).
export const IDLE_LIMIT = 10 * 60 * 1000;

// "owned: 25/191 searched · ~2 min left", "[12/40] cached …" or the ratings job's
// {"total":…,"processed":…} → { done, total, detail } for the latest line, else null.
export function parseProgress(text) {
  const line = String(text).split(/[\r\n]+/).map(part => part.trim()).filter(Boolean).at(-1) ?? '';
  const json = line.match(/"total":(\d+).*?"processed":(\d+)|"processed":(\d+).*?"total":(\d+)/);
  if (json) { const total = Number(json[1] ?? json[4]), done = Number(json[2] ?? json[3]); return total ? { done: Math.min(done, total), total, detail: `${done.toLocaleString('en')} of ${total.toLocaleString('en')}` } : null; }
  const count = line.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
  if (!count) return null;
  const done = Number(count[1].replace(/,/g, '')), total = Number(count[2].replace(/,/g, ''));
  return total ? { done: Math.min(done, total), total, detail: line.replace(/^\[|\]/g, '').slice(0, 120) } : null;
}

export async function updateAll(root, { log = () => {}, run = runCommand, signal } = {}) {
  // The library and wishlist builders are Python; a Mac without it is told how to get it.
  const python = () => findPython() ?? (() => { throw new Error(MISSING_PYTHON); })();
  const status = { startedAt: new Date().toISOString(), updatedAt: null, finishedAt: null, state: 'running', pid: process.pid, steps: [], summary: null, error: null };
  let saving = Promise.resolve(), lastSave = 0;
  const save = () => { status.updatedAt = new Date().toISOString(); lastSave = Date.now(); return (saving = saving.then(() => writeAtomic(path.join(root, STATUS_FILE), status))); };
  // A heartbeat, so the app can tell a quiet step from an update that has died.
  const heartbeat = setInterval(() => { if (Date.now() - lastSave > 9000) save(); }, 10000); heartbeat.unref?.();
  const stopped = () => Boolean(signal?.aborted);
  const step = async (id, label, work) => {
    let entry = status.steps.find(item => item.id === id);
    if (!entry) { entry = { id, label, state: 'pending', note: '' }; status.steps.push(entry); }
    if (stopped()) { entry.state = 'skipped'; entry.note = 'Not run — you stopped the update.'; await save(); return entry.state; }
    Object.assign(entry, { state: 'running', note: '', startedAt: new Date().toISOString() }); await save(); log(`▸ ${label}`);
    // Each command's output reports its progress; saved at most once a second.
    const onOutput = text => { const progress = parseProgress(text); if (!progress) return; entry.progress = progress; if (Date.now() - lastSave > 1000) save(); };
    current = { onOutput };
    try { entry.note = (await work()) ?? ''; entry.state = entry.note.startsWith('Skipped') ? 'skipped' : 'done'; }
    catch (error) {
      if (stopped()) { entry.state = 'stopped'; entry.note = 'Stopped by you. Anything this step saved is kept; the next update picks up from there.'; }
      else { entry.state = 'failed'; entry.note = error.message; log(`  ✗ ${error.message}`); }
    }
    delete entry.progress; entry.finishedAt = new Date().toISOString();
    if (entry.note) log(`  ${entry.note}`); await save(); return entry.state;
  };
  // Steps run one at a time: commands report progress to the current one, stop with the
  // update, and give up when silent for too long.
  let current = null;
  // The running command's process id is saved too: if this update dies, Stop can still end it.
  const onSpawn = pid => { status.childPid = pid; save(); };
  const exec = (command, args, cwd, env) => run(command, args, cwd, env, { onOutput: current?.onOutput, onSpawn, signal, idleMs: IDLE_LIMIT }).finally(() => { delete status.childPid; });
  const counts = async () => {
    const owned = await readOwnedGroups(root).catch(() => []);
    const wish = await readOptional(path.join(root, 'library/data/wishlist-data.js'));
    const wishlist = wish ? parseData(wish.toString('utf8'), 'STEAM_WISHLIST').STEAM_WISHLIST : [];
    // Compare copies (Playnite's stable per-copy ids), not browsing groups: regrouping can
    // change group ids without adding or removing anything you own.
    return { owned: new Map(owned.flatMap(group => group.copies.map(copy => [copy.id, copy.name ?? group.name]))), wishlist: new Map(wishlist.map(item => [String(item.appid), item.title])) };
  };
  try {
    const before = await counts(), last = JSON.parse((await readOptional(path.join(root, LAST_FILE)))?.toString() ?? '{}');
    const config = await readConfig(root), connected = Boolean(config.steam?.wishlist || config.steam?.owned || config.steamInstalled || config.galaxy?.path || config.esde?.root);
    // Files you saved yourself are checked before anything changes.
    for (const [kind, check] of [['library', checkLibraryCsv], ['wishlist', checkWishlistJson]]) { const file = await readOptional(path.join(root, INPUTS[kind])); if (file) check(file); }
    status.steps = PLAN.map(([id, label]) => ({ id, label, state: 'pending', note: '' }));
    // Connected sources next: they may bring a new wishlist or new games.
    await step('sources', 'Sync your connected sources', async () => !connected ? 'Skipped — no connected sources (see Import games).'
      : process.env.LEVEL_SELECT_SKIP_SYNC ? 'Skipped — just imported.' : (await syncSources(root)).join(' · '));
    const inputs = {};
    for (const [kind, file] of Object.entries(INPUTS)) inputs[kind] = await readOptional(path.join(root, file));
    // Games from sources count as library input; only their games matter, not the sync time.
    const owned = [];
    for (const file of [SOURCE_FILES.galaxy, SOURCE_FILES.steamOwned, SOURCE_FILES.steamInstalled]) { const data = await readOptional(path.join(root, file)); if (data) owned.push(JSON.stringify(JSON.parse(data).games)); }
    if (owned.length) inputs.library = Buffer.concat([inputs.library ?? Buffer.alloc(0), Buffer.from(owned.join('\n'))]);
    // Games you added by hand need no rebuild, but their scores are fetched like any other.
    if (!inputs.library && !inputs.wishlist && !(await readFolders(root)).length && !connected && !(await readManual(root)).games.length) throw new Error('Nothing to update yet. Open Import games to connect Steam, GOG Galaxy, Playnite or your ROMs, or add a game by hand.');
    const playnite = await readOptional(path.join(root, INPUTS.library));
    if (playnite) checkLibraryCsv(playnite);
    if (inputs.wishlist) checkWishlistJson(inputs.wishlist);
    const changed = kind => inputs[kind] && sha(inputs[kind]) !== last[kind];

    // Keep a dated copy of each new export; the previous ones stay in earlier folders.
    const stamp = status.startedAt.replace(/[:.]/g, '-');
    for (const kind of Object.keys(INPUTS)) if (changed(kind) && await readOptional(path.join(root, INPUTS[kind]))) {
      const folder = path.join(root, 'library/data/imports', stamp); await mkdir(folder, { recursive: true });
      await copyFile(path.join(root, INPUTS[kind]), path.join(folder, path.basename(INPUTS[kind])));
    }

    await step('library', 'Rebuild your library', async () => {
      if (!changed('library')) return inputs.library ? 'Skipped — your games are unchanged.' : 'Skipped — no Playnite export or connected library yet.';
      await exec(python(), ['library/tools/build_site.py', '--csv', INPUTS.library], root);
      await exec(process.execPath, ['scripts/connect-library.mjs'], root);
      last.library = sha(inputs.library);
    });
    await step('wishlist', 'Rebuild your Steam wishlist', async () => {
      if (!changed('wishlist')) return inputs.wishlist ? 'Skipped — the wishlist is unchanged.' : 'Skipped — no wishlist yet.';
      await exec(python(), ['library/tools/steam_enrich.py', '--wishlist'], root);
      await exec(python(), ['library/tools/build_wishlist.py', '--wishlist', INPUTS.wishlist], root);
      last.wishlist = sha(inputs.wishlist);
    });
    // Prices change with every sale, so they're checked on each update (a few requests).
    await step('prices', 'Refresh wishlist prices', async () => {
      if (!inputs.wishlist) return 'Skipped — no wishlist yet.';
      const out = String(await exec(python(), ['library/tools/steam_enrich.py', '--wishlist', '--prices'], root) ?? '');
      await exec(python(), ['library/tools/build_wishlist.py', '--wishlist', INPUTS.wishlist], root);
      return out.trim().split('\n').at(-1) ?? '';
    });
    await writeAtomic(path.join(root, LAST_FILE), last);
    await step('roms', 'Rescan your ROM folders', async () => {
      if (!(await readFolders(root)).length) return 'Skipped — no ROM folders yet (Import games → ROM folders).';
      await exec(process.execPath, ['scripts/rom-scan.mjs'], root);
    });
    // Your own keys, from Import games → Scores, or the environment (IGDB_CLIENT_ID…).
    const env = await shellEnv(['IGDB_CLIENT_ID', 'IGDB_CLIENT_SECRET', 'VGC_API_KEY']);
    const { igdb: keys, vgc: vgcKey } = await scoreKeys(root, env);
    await step('igdb', 'Fetch IGDB scores and time to beat for new games', async () => {
      if (!keys) return 'Skipped — no IGDB keys yet. Import games → Scores shows how to get your own (free, about five minutes).';
      // An installed copy has the Game Atlas's IGDB scores built in: only your games are looked up.
      if (existsSync(path.join(root, '.payload-version'))) for (const only of ['owned', 'wishlist']) await exec(process.execPath, ['scripts/igdb-enrich.mjs', '--only', only], root, keys);
      else await exec(process.execPath, ['scripts/igdb-enrich.mjs'], root, keys);
    });
    // New games always; wishlist and recent releases weekly, the rest monthly; 100 a request.
    await step('steam', 'Refresh Steam reviews', async () => {
      const out = String(await exec(process.execPath, ['scripts/enrich-ratings.mjs', '--wishlist', '--owned-igdb', '--provider', 'steam', '--batch', '--max-requests', '50', '--drain'], root) ?? '');
      // The script's closing summary says how many were new, due or still fresh.
      const plan = [...out.matchAll(/"plan":\s*(\{[^{}]*\})/g)].at(-1)?.[1];
      try { const { new: added, due, fresh } = JSON.parse(plan); return `${added.toLocaleString()} new, ${due.toLocaleString()} due for a check · ${fresh.toLocaleString()} still fresh`; }
      catch { return ''; }
    });
    await step('awards', 'Refresh game awards (Wikidata)', async () => {
      const awards = await readAwards(root, { local: true });
      if (awards?.fetchedAt && Date.now() - Date.parse(awards.fetchedAt) < 7 * DAY) return 'Skipped — refreshed this week.';
      await exec(process.execPath, ['scripts/awards.mjs'], root);
    });
    await step('vgc', 'Fetch VideoGamesCritic scores', async () => String(await exec(process.execPath, ['scripts/vgc-refresh.mjs'], root, vgcKey ? { VGC_API_KEY: vgcKey } : {}) ?? '').trim().split('\n').at(-1) ?? '');

    const after = await counts();
    const added = [...after.owned].filter(([id]) => !before.owned.has(id)).map(([, name]) => name);
    const removed = [...before.owned].filter(([id]) => !after.owned.has(id)).map(([, name]) => name);
    const newWishes = [...after.wishlist].filter(([id]) => !before.wishlist.has(id)).map(([, title]) => title);
    const goneWishes = [...before.wishlist].filter(([id]) => !after.wishlist.has(id)).map(([, title]) => title);
    status.summary = { owned: after.owned.size, ownedBefore: before.owned.size, added: added.slice(0, 12), addedCount: added.length, removedCount: removed.length,
      wishlist: after.wishlist.size, wishlistBefore: before.wishlist.size, newWishes: newWishes.slice(0, 12), newWishCount: newWishes.length, goneWishCount: goneWishes.length };
    status.state = stopped() ? 'stopped' : status.steps.some(entry => entry.state === 'failed') ? 'partial' : 'done';
  } catch (error) { status.state = stopped() ? 'stopped' : 'failed'; status.error = stopped() ? null : error.message; if (!stopped()) log(`✗ ${error.message}`); }
  clearInterval(heartbeat);
  status.finishedAt = new Date().toISOString(); await save();
  return status;
}

// Run one command. Its output feeds onOutput (progress); a stop asks it to save and exit
// (SIGINT, then SIGKILL after 10 s); a command silent for idleMs is stopped as stuck.
let activeChild = null;
// If this update exits for any reason, the command it was running goes with it.
process.on('exit', () => { try { activeChild?.kill('SIGINT'); } catch {} });
function runCommand(command, args, cwd, env = {}, { onOutput, onSpawn, signal, idleMs } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Stopped.')); return; }
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env, ...PYTHON_ENV }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    activeChild = child; if (child.pid) onSpawn?.(child.pid);
    let tail = '', idle = null, stuck = false, force = null;
    const stop = () => { child.kill('SIGINT'); force = setTimeout(() => child.kill('SIGKILL'), 10000); };
    const watch = () => { if (!idleMs) return; clearTimeout(idle); idle = setTimeout(() => { stuck = true; stop(); }, idleMs); };
    const keep = chunk => { tail = (tail + chunk).slice(-2000); watch(); onOutput?.(tail); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    signal?.addEventListener('abort', stop, { once: true });
    watch();
    const done = () => { clearTimeout(idle); clearTimeout(force); signal?.removeEventListener('abort', stop); if (activeChild === child) activeChild = null; };
    // A missing program (usually Python on a computer without it) says what to install.
    child.on('error', error => { done(); reject(error.code === 'ENOENT' && /python/i.test(path.basename(command)) ? new Error('Python 3 is needed to rebuild your library and wishlist. Install it from python.org (or reinstall Level Select), then choose Update data again.') : error); });
    child.on('close', code => {
      done();
      if (stuck) reject(new Error(`No progress for ${Math.round(idleMs / 60000)} minutes, so this step was stopped. Check your internet connection and choose Update data again; finished steps are kept.`));
      else if (code === 0) resolve(tail);
      else reject(new Error(`${path.basename(args[0] ?? command)} stopped (exit ${code}): ${tail.trim().split('\n').at(-1) ?? ''}`));
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  // "Stop" in the app (or Ctrl+C): finish cleanly, keeping whatever was already saved.
  const controller = new AbortController();
  for (const name of ['SIGTERM', 'SIGINT']) process.on(name, () => controller.abort());
  const stopFile = path.join(root, STOP_FILE);
  await rm(stopFile, { force: true });
  const watchStop = setInterval(() => { if (existsSync(stopFile)) { controller.abort(); rm(stopFile, { force: true }).catch(() => {}); } }, 500);
  watchStop.unref();
  const status = await updateAll(root, { log: line => console.log(line), signal: controller.signal });
  const s = status.summary;
  if (s) {
    console.log(`\nLibrary: ${s.ownedBefore} → ${s.owned} games${s.addedCount ? ` (+${s.addedCount} new${s.added.length ? `: ${s.added.slice(0, 5).join(', ')}${s.addedCount > 5 ? '…' : ''}` : ''})` : ''}${s.removedCount ? `, −${s.removedCount} gone` : ''}`);
    console.log(`Wishlist: ${s.wishlistBefore} → ${s.wishlist} games${s.goneWishCount ? ` (${s.goneWishCount} removed on Steam)` : ''}${s.newWishCount ? `, +${s.newWishCount} new` : ''}`);
    console.log(status.state === 'done' ? 'Done. Reload the app.' : status.state === 'stopped' ? 'Stopped. Finished steps are kept; run the update again to continue.' : 'Finished with problems above. Your previous data is still in use where a step failed.');
  }
  process.exitCode = status.state === 'failed' ? 1 : 0;
}

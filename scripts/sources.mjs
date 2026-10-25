// Where your games come from, besides a Playnite export: your Steam account (wishlist by
// link, owned games with a Web API key), GOG Galaxy's local library and ES-DE's gamelists.
// Each importer writes private files under library/data (never committed):
//   sources.json            which sources are connected, and when they last synced
//   secrets.json            your Steam Web API key (readable only by you)
//   sources/<name>.json     the games each source found, in the shape the library builder reads
// The Steam wishlist link writes library/steam-wishlist.json, the same file a browser
// export would, so the wishlist builder doesn't change.
import { readFile, writeFile, rename, mkdir, copyFile, stat, readdir, rm, chmod, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { parseRomName } from './roms.mjs';
import { titleKey } from '../library/core.js';
import { pythonCommand, PYTHON_ENV, registryValue } from './platform.mjs';

export const SOURCES_FILE = 'library/data/sources.json';
export const SECRETS_FILE = 'library/data/secrets.json';
export const SOURCE_FILES = { steamOwned: 'library/data/sources/steam-owned.json', steamInstalled: 'library/data/sources/steam-installed.json', galaxy: 'library/data/sources/galaxy.json', esde: 'library/data/sources/esde.json' };
export const UPLOADED_GALAXY = 'library/data/sources/galaxy-2.0.db';
export const WISHLIST_FILE = 'library/steam-wishlist.json';
const UA = { 'User-Agent': 'LevelSelect/1.0 (personal game library)' };

// ---------- small file helpers ----------
async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }
async function writeJson(file, value, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(value, null, 1), mode ? { mode } : undefined); await rename(`${file}.tmp`, file);
  if (mode) await chmod(file, mode);
}
export const readConfig = root => readJson(path.join(root, SOURCES_FILE), {});
export async function updateConfig(root, change) { const config = await readConfig(root); change(config); await writeJson(path.join(root, SOURCES_FILE), config); return config; }
export const readSecrets = root => readJson(path.join(root, SECRETS_FILE), {});
export async function updateSecrets(root, change) { const secrets = await readSecrets(root); change(secrets); await writeJson(path.join(root, SECRETS_FILE), secrets, 0o600); }
const exists = async file => Boolean(await stat(file).catch(() => null));

async function getJson(url, { fetchImpl = fetch, what = 'Steam' } = {}) {
  let response;
  try { response = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(30000) }); }
  catch { throw new Error(`${what} could not be reached. Check your internet connection and try again.`); }
  if (response.status === 401 || response.status === 403) { const error = new Error(`${what} refused the request (${response.status}).`); error.status = response.status; throw error; }
  if (!response.ok) throw new Error(`${what} answered with an error (${response.status}). Try again in a minute.`);
  return response.json();
}

// ---------- Steam: who you are ----------
const STEAM_ID = /^7656119\d{10}$/;
// A profile link, wishlist link, 17-digit id or custom profile name → { steamId } or { vanity }.
export function parseSteamInput(input) {
  const text = String(input ?? '').trim();
  if (STEAM_ID.test(text)) return { steamId: text };
  const id = text.match(/(?:steamcommunity\.com|store\.steampowered\.com\/wishlist)\/profiles\/(7656119\d{10})/i)?.[1];
  if (id) return { steamId: id };
  const vanity = text.match(/(?:steamcommunity\.com|store\.steampowered\.com\/wishlist)\/id\/([A-Za-z0-9_-]{2,64})/i)?.[1];
  if (vanity) return { vanity };
  if (/^[A-Za-z0-9_-]{2,32}$/.test(text)) return { vanity: text };
  return null;
}
const xmlValue = (xml, tag) => xml.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`))?.slice(1).find(value => value != null)?.trim() ?? null;
// Steam's public profile XML resolves custom names and gives the display name; no key needed.
export async function resolveSteamAccount(input, { fetchImpl = fetch } = {}) {
  const parsed = parseSteamInput(input);
  if (!parsed) throw new Error('Paste your Steam profile link (steamcommunity.com/id/… or /profiles/…), your wishlist link, or your 17-digit Steam ID.');
  const url = parsed.steamId ? `https://steamcommunity.com/profiles/${parsed.steamId}/?xml=1` : `https://steamcommunity.com/id/${encodeURIComponent(parsed.vanity)}/?xml=1`;
  let xml;
  try { const response = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(20000) }); xml = await response.text(); }
  catch { throw new Error('Steam could not be reached. Check your internet connection and try again.'); }
  const steamId = xmlValue(xml, 'steamID64');
  if (!steamId || !STEAM_ID.test(steamId)) throw new Error(parsed.vanity ? `No Steam profile is called “${parsed.vanity}”. Copy the link from your profile page instead.` : 'Steam has no profile with that ID.');
  return { steamId, persona: xmlValue(xml, 'steamID') ?? steamId, public: xmlValue(xml, 'privacyState') === 'public' };
}

// Accounts that have signed in to Steam on this computer (Steam's own loginusers.vdf).
// Windows paths are built with Windows rules wherever this runs, so tests can check them.
const pathsFor = platform => platform === 'win32' ? path.win32 : path.posix;
export function steamDirs(home = os.homedir(), platform = process.platform, { env = process.env, roots = [] } = {}) {
  if (platform === 'darwin') return [path.posix.join(home, 'Library/Application Support/Steam')];
  if (platform === 'win32') {
    // Steam can live on any drive; the registry says where (see steamRoots), then the defaults.
    const defaults = [env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', env.ProgramFiles ?? 'C:\\Program Files'].map(folder => path.win32.join(folder, 'Steam'));
    return [...new Set([...roots, ...defaults, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].map(root => path.win32.normalize(root)))];
  }
  return [path.posix.join(home, '.steam/steam'), path.posix.join(home, '.local/share/Steam')];
}
export const steamConfigPaths = (home, platform = process.platform, options) => steamDirs(home, platform, options).map(dir => pathsFor(platform).join(dir, 'config', 'loginusers.vdf'));
// Where Steam is installed, according to Windows' registry (Steam writes it there).
export async function steamRoots({ platform = process.platform, registry = registryValue } = {}) {
  if (platform !== 'win32') return [];
  const found = await Promise.all([['HKCU\\Software\\Valve\\Steam', 'SteamPath'], ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'], ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath']]
    .map(([key, name]) => registry(key, name, { platform })));
  return found.filter(Boolean);
}
const steamFiles = async options => steamConfigPaths(options?.home, options?.platform, { env: options?.env, roots: await steamRoots(options) });
export function parseLoginUsers(vdf) {
  const users = [];
  for (const match of String(vdf).matchAll(/"(7656119\d{10})"\s*\{([^{}]*)\}/g)) {
    const field = name => match[2].match(new RegExp(`"${name}"\\s*"([^"]*)"`, 'i'))?.[1] ?? null;
    users.push({ steamId: match[1], persona: field('PersonaName') ?? field('AccountName') ?? match[1], mostRecent: field('MostRecent') === '1', lastLogin: Number(field('Timestamp')) || 0 });
  }
  return users.sort((a, b) => Number(b.mostRecent) - Number(a.mostRecent) || b.lastLogin - a.lastLogin);
}
export async function steamAccountsOnDisk(options) {
  for (const file of await steamFiles(options)) {
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text) return parseLoginUsers(text);
  }
  return [];
}

// ---------- Steam: games installed on this computer (no key needed) ----------
// Steam lists its library folders (one per drive) in steamapps/libraryfolders.vdf, and each
// installed game has a steamapps/appmanifest_<appid>.acf. That includes Family Sharing games
// someone shares with you, which your account's list of owned games never has.
export function parseLibraryFolders(vdf) {
  // "path" entries, or the older "1" "D:\\SteamLibrary" form; app sizes have no slashes.
  return [...String(vdf).matchAll(/"(?:path|\d+)"\s+"([^"]*[\\/][^"]*)"/gi)].map(match => match[1].replace(/\\\\/g, '\\'));
}
export function parseAppManifest(acf) {
  // Top-level fields come before the nested blocks, so the first match is the app's own.
  const field = name => String(acf).match(new RegExp(`^\\s*"${name}"\\s+"((?:[^"\\\\]|\\\\.)*)"`, 'mi'))?.[1]?.replace(/\\(.)/g, '$1') ?? null;
  const appid = field('appid');
  if (!/^\d+$/.test(appid ?? '')) return null;
  // StateFlags 4: fully installed (an update may still be pending).
  return { appid, name: field('name') ?? '', installed: (Number(field('StateFlags')) & 4) === 4, lastPlayed: Number(field('LastPlayed')) || 0, owner: field('LastOwner') };
}
export async function steamLibraryFolders(options = {}) {
  const pathFor = pathsFor(options.platform ?? process.platform), folders = new Map();
  for (const dir of steamDirs(options.home, options.platform, { env: options.env, roots: await steamRoots(options) })) {
    if (!(await exists(pathFor.join(dir, 'steamapps')))) continue;
    const listed = await readFile(pathFor.join(dir, 'steamapps', 'libraryfolders.vdf'), 'utf8').then(parseLibraryFolders, () => []);
    for (const folder of [dir, ...listed]) {
      const normal = pathFor.normalize(folder).replace(/[\\/]+$/, '');
      folders.set((options.platform ?? process.platform) === 'win32' ? normal.toLowerCase() : normal, normal);
    }
  }
  return [...folders.values()];
}
export async function installedSteamApps(folders, { platform = process.platform } = {}) {
  const pathFor = pathsFor(platform), apps = new Map();
  for (const folder of folders) {
    const files = await readdir(pathFor.join(folder, 'steamapps')).catch(() => []);
    for (const file of files.filter(name => /^appmanifest_\d+\.acf$/.test(name)).sort()) {
      const app = parseAppManifest(await readFile(pathFor.join(folder, 'steamapps', file), 'utf8').catch(() => ''));
      if (app?.installed && !apps.has(app.appid)) apps.set(app.appid, app);
    }
  }
  return [...apps.values()];
}
// Steam installs its own tools and soundtracks as apps too. The store says what each app is
// (0 game, 2 mod; soundtracks, software and DLC are left out); for apps it no longer lists,
// and offline, they're known by name.
const NOT_GAMES = /^(?:Proton\b|Steam Linux Runtime|Steamworks Common Redistributables|SteamVR|Steam Audio)|Dedicated Server$|\b(?:Soundtrack|OST)\b/i;
const isGame = (app, info) => info?.type == null ? !NOT_GAMES.test(app.name) : [0, 2].includes(info.type);
// A game is shared with you when Steam's file says another account's licence installed it
// (LastOwner); without that, when the owned games list (Web API key) doesn't have it.
export function steamInstalledRows(apps, details, { you = null, owned = null } = {}) {
  return apps.filter(app => isGame(app, details.get(app.appid))).map(app => {
    const info = details.get(app.appid) ?? {}, owner = /^7656119\d{10}$/.test(app.owner ?? '') ? app.owner : null;
    const shared = owner && you ? owner !== you : Boolean(owned && !owned.has(app.appid));
    return { id: `steam-${app.appid}`, name: info.name ?? (app.name || `Steam app ${app.appid}`), platforms: ['PC (Windows)'], sources: shared ? ['Steam', 'Family Sharing'] : ['Steam'], steamAppId: app.appid, storeKey: `steam:${app.appid}`,
      releaseDate: isoDate(info.released), timePlayed: 0, playCount: app.lastPlayed ? 1 : 0, lastPlayed: app.lastPlayed ? new Date(app.lastPlayed * 1000).toISOString() : null,
      developers: info.developers ?? [], publishers: info.publishers ?? [], genres: [], summary: info.summary ?? '', cover: info.cover ?? '', background: info.background ?? '', hidden: false, importSource: 'steam-installed', familySharing: Boolean(shared) };
  });
}
export async function importSteamInstalled(root, { fetchImpl = fetch, ...options } = {}) {
  const folders = await steamLibraryFolders(options), apps = await installedSteamApps(folders, options);
  if (!folders.length) throw new Error('Steam isn’t installed on this computer.');
  if (!apps.length) throw new Error('Steam has no games installed on this computer yet. Install one in Steam, then try again.');
  const config = await readConfig(root), store = await readJson(path.join(root, 'library/data/store.json'), {});
  // Covers, release dates and what each app is; offline, Steam's own names are enough.
  const details = await storeItems(apps.map(app => app.appid), { country: store.country ?? 'gb', fetchImpl }).catch(() => new Map());
  const ownedFile = await readJson(path.join(root, SOURCE_FILES.steamOwned), null);
  const you = config.steam?.account?.steamId ?? (await steamAccountsOnDisk(options))[0]?.steamId ?? null;
  const games = steamInstalledRows(apps, details, { you, owned: ownedFile ? new Set(ownedFile.games.map(game => String(game.steamAppId))) : null });
  const importedAt = new Date().toISOString();
  await writeJson(path.join(root, SOURCE_FILES.steamInstalled), { schemaVersion: 1, kind: 'owned', source: 'steam-installed', importedAt, games });
  return { count: games.length, shared: games.filter(game => game.familySharing).length, folders: folders.length, importedAt };
}

// ---------- Steam: store details for many apps at once (no key needed) ----------
const ASSETS = 'https://shared.akamai.steamstatic.com/store_item_assets/';
export async function storeItems(appids, { country = 'gb', fetchImpl = fetch } = {}) {
  const found = new Map();
  for (let index = 0; index < appids.length; index += 100) {
    const input = { ids: appids.slice(index, index + 100).map(appid => ({ appid: Number(appid) })), context: { language: 'english', country_code: country.toUpperCase() },
      data_request: { include_basic_info: true, include_release: true, include_reviews: true, include_assets: true } };
    const data = await getJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`, { fetchImpl });
    for (const item of data.response?.store_items ?? []) {
      if (!item.appid || item.success === 2) continue;
      const assets = item.assets ?? {}, art = file => file && assets.asset_url_format ? ASSETS + assets.asset_url_format.replace('${FILENAME}', file) : null;
      const reviews = item.reviews?.summary_filtered;
      found.set(String(item.appid), { name: item.name ?? null, type: item.type ?? null, released: item.release?.steam_release_date ?? item.release?.original_release_date ?? null, comingSoon: Boolean(item.release?.is_coming_soon),
        reviews: reviews?.review_count ? { count: reviews.review_count, percPositive: reviews.percent_positive } : null,
        price: item.is_free ? 'Free' : item.best_purchase_option?.formatted_final_price ?? null, discount: item.best_purchase_option?.discount_pct ?? 0,
        developers: (item.basic_info?.developers ?? []).map(developer => developer.name).filter(Boolean), publishers: (item.basic_info?.publishers ?? []).map(publisher => publisher.name).filter(Boolean),
        summary: item.basic_info?.short_description ?? '', cover: art(assets.library_capsule_2x ?? assets.library_capsule), background: art(assets.library_hero ?? assets.page_background) });
    }
  }
  return found;
}
const usDate = unix => { if (!unix) return ''; const date = new Date(unix * 1000); return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`; };
const isoDate = unix => unix ? new Date(unix * 1000).toISOString().slice(0, 10) : '';

// ---------- Steam: wishlist by link ----------
// The file a wishlist export would contain, so the wishlist builder reads it unchanged.
export function wishlistExport(items, details, { steamId, fetchedAt }) {
  return { version: '05', generator: 'Level Select · Steam wishlist link', steamId, fetchedAt,
    data: [...items].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)).map(item => {
      const appid = String(item.appid), info = details.get(appid) ?? {};
      return { gameid: ['steam', `app/${appid}`], title: info.name ?? `Steam app ${appid}`, url: `https://store.steampowered.com/app/${appid}/`,
        added_date: usDate(item.date_added), release_date: usDate(info.released), note: null, price: info.price ?? null, discount: info.discount ?? 0,
        reviews: info.reviews ?? null, priority: item.priority ?? null };
    }) };
}
export async function importSteamWishlist(root, steamId, { fetchImpl = fetch } = {}) {
  const data = await getJson(`https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId}`, { fetchImpl });
  const items = data.response?.items ?? [];
  if (!items.length) throw new Error('Steam returned no wishlist games. Either the wishlist is empty or it’s private: in Steam, open your profile → Edit Profile → Privacy Settings and set “Game details” to Public.');
  const store = await readJson(path.join(root, 'library/data/store.json'), {});
  const details = await storeItems(items.map(item => item.appid), { country: store.country ?? 'gb', fetchImpl });
  const fetchedAt = new Date().toISOString();
  await writeJson(path.join(root, WISHLIST_FILE), wishlistExport(items, details, { steamId, fetchedAt }));
  return { count: items.length, fetchedAt };
}

// ---------- Steam: owned games with your Web API key ----------
// Rows in the shape library/tools/build_site.py reads from library/data/sources.
export function steamOwnedRows(games, details) {
  return games.map(game => {
    const appid = String(game.appid), info = details.get(appid) ?? {};
    return { id: `steam-${appid}`, name: game.name ?? info.name ?? `Steam app ${appid}`, platforms: ['PC (Windows)'], sources: ['Steam'], steamAppId: appid, storeKey: `steam:${appid}`,
      releaseDate: isoDate(info.released), timePlayed: (game.playtime_forever ?? 0) * 60, playCount: game.playtime_forever ? 1 : 0,
      lastPlayed: game.rtime_last_played ? new Date(game.rtime_last_played * 1000).toISOString() : null,
      developers: info.developers ?? [], publishers: info.publishers ?? [], genres: [], summary: info.summary ?? '', cover: info.cover ?? '', background: info.background ?? '', hidden: false, importSource: 'steam' };
  });
}
export async function importSteamOwned(root, steamId, key, { fetchImpl = fetch } = {}) {
  if (!/^[A-F0-9]{32}$/i.test(key ?? '')) throw new Error('A Steam Web API key is 32 letters and numbers. Copy it again from steamcommunity.com/dev/apikey.');
  let data;
  try { data = await getJson(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&skip_unvetted_apps=0`, { fetchImpl, what: 'Steam' }); }
  catch (error) { if (error.status) throw new Error('Steam didn’t accept that key. Check you copied all 32 characters, or create a new key at steamcommunity.com/dev/apikey.'); throw error; }
  const games = data.response?.games ?? [];
  if (!games.length) throw new Error('Steam returned no games. Your game details are probably private: in Steam, open your profile → Edit Profile → Privacy Settings and set “Game details” to Public.');
  const store = await readJson(path.join(root, 'library/data/store.json'), {});
  const details = await storeItems(games.map(game => game.appid), { country: store.country ?? 'gb', fetchImpl });
  const importedAt = new Date().toISOString();
  await writeJson(path.join(root, SOURCE_FILES.steamOwned), { schemaVersion: 1, kind: 'owned', source: 'steam', importedAt, steamId, games: steamOwnedRows(games, details) });
  return { count: games.length, importedAt };
}

// ---------- GOG Galaxy ----------
export function galaxyPaths(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return ['/Users/Shared/GOG.com/Galaxy/Storage/galaxy-2.0.db'];
  if (platform === 'win32') return [...new Set([env.ProgramData ?? 'C:\\ProgramData', 'C:\\ProgramData'].map(folder => path.win32.join(folder, 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db')))];
  return [];
}
// Galaxy's store prefixes → the source and platform names Playnite uses, so filters and
// shelves line up whichever app a game came from.
const GALAXY_STORES = {
  steam: ['Steam', 'PC (Windows)'], epic: ['Epic', 'PC (Windows)'], gog: ['GOG', 'PC (Windows)'], origin: ['EA app', 'PC (Windows)'], ea: ['EA app', 'PC (Windows)'],
  uplay: ['Ubisoft Connect', 'PC (Windows)'], battlenet: ['Battle.net', 'PC (Windows)'], amazon: ['Amazon', 'PC (Windows)'], humble: ['Humble', 'PC (Windows)'],
  itch: ['itch.io', 'PC (Windows)'], bethesda: ['Bethesda', 'PC (Windows)'], rockstar: ['Rockstar', 'PC (Windows)'], xboxone: ['Xbox', 'Xbox One'], xbox: ['Xbox', 'Xbox One'],
  // Galaxy doesn't say which PlayStation; PS4 is the most likely for a linked library.
  psn: ['PlayStation', 'Sony PlayStation 4'], nswitch: ['Nintendo', 'Nintendo Switch'],
};
const safeId = value => String(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
// One Galaxy release → one library row. `pieces` maps piece type names to parsed values.
export function galaxyRow(release, pieces) {
  const split = release.releaseKey.indexOf('_'), prefix = release.releaseKey.slice(0, split), key = release.releaseKey.slice(split + 1);
  const [source, platform] = GALAXY_STORES[prefix] ?? [prefix.charAt(0).toUpperCase() + prefix.slice(1), 'PC (Windows)'];
  const meta = pieces.originalMeta ?? pieces.meta ?? {}, images = pieces.originalImages ?? {};
  return { id: `${safeId(prefix)}-${safeId(key)}`, name: pieces.title?.title ?? pieces.originalTitle?.title ?? key, platforms: [platform], sources: [source],
    steamAppId: prefix === 'steam' && /^\d+$/.test(key) ? key : '', storeKey: `${prefix}:${key}`, releaseDate: isoDate(meta.releaseDate),
    timePlayed: (release.minutes ?? 0) * 60, playCount: release.minutes ? 1 : 0, lastPlayed: release.lastPlayed ? new Date(`${release.lastPlayed.replace(' ', 'T')}Z`).toISOString() : null,
    developers: meta.developers ?? [], publishers: meta.publishers ?? [], genres: meta.genres ?? [], summary: pieces.summary?.summary ?? '',
    cover: images.verticalCover ?? '', background: images.background ?? '', hidden: Boolean(release.hidden), importSource: 'galaxy' };
}
// Read-only SQL on a copy of the database (Galaxy keeps the original open). Node 22+ has
// SQLite built in; on Node 20 the same queries run through Python's sqlite3, which the
// rebuild steps already need. Each query returns rows as plain objects.
const PY_SQL = 'import json, sqlite3, sys\nwith sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True) as db:\n  db.row_factory = sqlite3.Row\n  print(json.dumps([[dict(row) for row in db.execute(sql)] for sql in json.load(sys.stdin)]))';
async function sqlQueries(file, queries) {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    try { return queries.map(sql => db.prepare(sql).all()); } finally { db.close(); }
  } catch (error) {
    if (!/node:sqlite|No such built-in module/i.test(String(error?.message))) throw error;
  }
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(pythonCommand(), ['-c', PY_SQL, file], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...PYTHON_ENV }, windowsHide: true });
    const out = [], err = [];
    child.stdout.on('data', chunk => out.push(chunk)); child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', () => reject(new Error('Reading GOG Galaxy needs Node.js 22 or newer, or Python 3.')));
    child.on('close', code => {
      if (code !== 0) { reject(new Error(/database|not a database|file is/i.test(Buffer.concat(err).toString()) ? 'This isn’t a GOG Galaxy 2.0 database (galaxy-2.0.db).' : `GOG Galaxy’s library couldn’t be read: ${Buffer.concat(err).toString().trim().split('\n').at(-1)}`)); return; }
      try { resolve(JSON.parse(Buffer.concat(out).toString())); } catch { reject(new Error('GOG Galaxy’s library couldn’t be read.')); }
    });
    child.stdin.end(JSON.stringify(queries));
  });
}
async function withCopy(dbPath, read) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'level-select-galaxy-')), copy = path.join(folder, 'galaxy.db');
  try {
    await copyFile(dbPath, copy);
    for (const suffix of ['-wal', '-shm']) if (await exists(dbPath + suffix)) await copyFile(dbPath + suffix, copy + suffix);
    return await read(copy);
  } finally { await rm(folder, { recursive: true, force: true }); }
}
// The pieces of Galaxy's metadata a library row uses.
const GALAXY_PIECES = ['title', 'originalTitle', 'meta', 'originalMeta', 'summary', 'originalImages'];
export async function readGalaxy(dbPath) {
  return withCopy(dbPath, async file => {
    let tables;
    try { [tables] = await sqlQueries(file, ["SELECT name FROM sqlite_master WHERE type='table'"]); }
    catch { throw new Error('This isn’t a GOG Galaxy 2.0 database (galaxy-2.0.db).'); }
    const has = new Set(tables.map(row => row.name));
    if (!['LibraryReleases', 'GamePieces', 'GamePieceTypes'].every(name => has.has(name))) throw new Error('This isn’t a GOG Galaxy 2.0 database (galaxy-2.0.db).');
    // User ids are 64-bit: read as text, which JavaScript numbers can't hold exactly.
    const optional = (table, sql) => has.has(table) ? sql : 'SELECT 1 WHERE 0';
    const [releases, pieceRows, props, hiddenRows, times, played] = await sqlQueries(file, [
      'SELECT CAST(userId AS TEXT) AS userId, releaseKey FROM LibraryReleases',
      `SELECT gp.releaseKey, t.type, gp.value FROM GamePieces gp JOIN GamePieceTypes t ON t.id = gp.gamePieceTypeId
        WHERE t.type IN (${GALAXY_PIECES.map(type => `'${type}'`).join(', ')}) AND gp.releaseKey IN (SELECT releaseKey FROM LibraryReleases)`,
      optional('ReleaseProperties', 'SELECT releaseKey, isDlc, isVisibleInLibrary FROM ReleaseProperties'),
      optional('UserReleaseProperties', 'SELECT CAST(userId AS TEXT) AS userId, releaseKey FROM UserReleaseProperties WHERE isHidden = 1'),
      optional('GameTimes', 'SELECT CAST(userId AS TEXT) AS userId, releaseKey, minutesInGame FROM GameTimes'),
      optional('LastPlayedDates', 'SELECT CAST(userId AS TEXT) AS userId, gameReleaseKey, lastPlayedDate FROM LastPlayedDates'),
    ]);
    // The account with the most games (Galaxy can remember more than one).
    const counts = new Map();
    for (const row of releases) counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
    const user = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (user == null) return [];
    const mine = new Set(releases.filter(row => row.userId === user).map(row => row.releaseKey));
    const properties = new Map(props.map(row => [row.releaseKey, row]));
    const hidden = new Set(hiddenRows.filter(row => row.userId === user).map(row => row.releaseKey));
    const minutes = new Map(times.filter(row => row.userId === user).map(row => [row.releaseKey, row.minutesInGame]));
    const lastPlayed = new Map(played.filter(row => row.userId === user).map(row => [row.gameReleaseKey, row.lastPlayedDate]));
    const pieces = new Map();
    for (const row of pieceRows) {
      if (!mine.has(row.releaseKey)) continue;
      if (!pieces.has(row.releaseKey)) pieces.set(row.releaseKey, {});
      pieces.get(row.releaseKey)[row.type] = parse(row.value);
    }
    return [...mine]
      // DLC and the extra releases Galaxy folds into one game stay out.
      .filter(releaseKey => releaseKey.includes('_') && properties.get(releaseKey)?.isDlc !== 1 && properties.get(releaseKey)?.isVisibleInLibrary !== 0)
      .map(releaseKey => galaxyRow({ releaseKey, minutes: minutes.get(releaseKey), lastPlayed: lastPlayed.get(releaseKey), hidden: hidden.has(releaseKey) }, pieces.get(releaseKey) ?? {}));
  });
}
export async function importGalaxy(root, dbPath) {
  if (!dbPath || !(await exists(dbPath))) throw new Error('GOG Galaxy’s library wasn’t found. Install GOG Galaxy 2.0 and sign in, or upload galaxy-2.0.db from the computer that has it.');
  const games = await readGalaxy(dbPath), stores = {};
  for (const game of games) stores[game.sources[0]] = (stores[game.sources[0]] ?? 0) + 1;
  const importedAt = new Date().toISOString();
  await writeJson(path.join(root, SOURCE_FILES.galaxy), { schemaVersion: 1, kind: 'owned', source: 'galaxy', importedAt, games });
  return { count: games.length, stores, importedAt };
}

// ---------- ES-DE (EmulationStation Desktop Edition) ----------
// ES-DE keeps its game lists in an ES-DE folder: in your home folder for an installed copy,
// or next to ES-DE.exe for the portable Windows release (ES-DE\\ES-DE on the drive it was
// unpacked to). EmuDeck's Windows setup keeps a portable copy in AppData.
export function esdePaths(home = os.homedir(), platform = process.platform, env = process.env) {
  if (platform !== 'win32') return [path.posix.join(home, 'ES-DE'), path.posix.join(home, '.emulationstation')];
  const drives = 'CDEFG'.split('').map(letter => `${letter}:\\`);
  return [path.win32.join(home, 'ES-DE'), ...(env.APPDATA ? [path.win32.join(env.APPDATA, 'EmuDeck', 'Emulators', 'ES-DE', 'ES-DE')] : []),
    ...drives.flatMap(drive => ['ES-DE', 'Emulation\\ES-DE', 'Games\\ES-DE'].map(folder => path.win32.join(drive, folder, 'ES-DE')))];
}
// Playnite (Windows only) keeps its library in AppData; the portable release keeps it next
// to Playnite.exe, which only you know. Its library database can't be read directly, so
// finding it just tells you it's there; the export (Import games → Playnite) brings the games.
export function playnitePaths(platform = process.platform, env = process.env) {
  if (platform !== 'win32') return [];
  return [env.APPDATA && path.win32.join(env.APPDATA, 'Playnite'), env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Playnite')].filter(Boolean);
}
// ES-DE system folders → catalog systems.
export const ESDE_SYSTEMS = {
  nes: 'nes', famicom: 'nes', fds: 'nes', snes: 'snes', sfc: 'snes', snesna: 'snes', n64: 'n64', gc: 'gc', wii: 'wii', wiiu: 'wiiu', gb: 'gb', gbc: 'gbc', gba: 'gba',
  nds: 'ds', n3ds: '3ds', switch: 'switch', psx: 'ps1', ps2: 'ps2', ps3: 'ps3', psp: 'psp', psvita: 'vita', sg1000: 'sg1000', 'sg-1000': 'sg1000', mastersystem: 'ms',
  genesis: 'md', megadrive: 'md', megadrivejp: 'md', gamegear: 'gg', segacd: 'scd', megacd: 'scd', sega32x: '32x', saturn: 'saturn', dreamcast: 'dc',
  atari2600: 'atari2600', atari5200: 'atari5200', atari7800: 'atari7800', atarilynx: 'lynx', atarijaguar: 'jaguar', tg16: 'tg16', pcengine: 'tg16',
  'tg-cd': 'pcecd', pcenginecd: 'pcecd', neogeo: 'neogeo', ngp: 'ngpc', ngpc: 'ngpc', arcade: 'mame', mame: 'mame', fbneo: 'mame', cps: 'cps', cps1: 'cps', cps2: 'cps', cps3: 'cps',
  naomi: 'naomi', c64: 'c64', amiga: 'amiga', amigacd32: 'amiga', zxspectrum: 'spectrum', msx: 'msx', msx1: 'msx', msx2: 'msx', dos: 'dos', xbox: 'xbox', xbox360: 'x360',
};
const xmlText = value => value?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code)).replace(/&amp;/g, '&').trim() ?? null;
// ES-DE writes dates as 19910101T000000.
const esdeDate = value => /^\d{8}T/.test(value ?? '') ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;
export function parseGamelist(xml, system) {
  const games = [];
  for (const [, body] of String(xml).matchAll(/<game(?:\s[^>]*)?>([\s\S]*?)<\/game>/g)) {
    const field = name => xmlText(body.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]);
    const file = field('path'); if (!file) continue;
    const base = path.posix.basename(file.replace(/\\/g, '/')), fileTitle = parseRomName(base).title;
    const released = esdeDate(field('releasedate')), rating = Number(field('rating'));
    games.push({ system, file: file.replace(/^\.\//, ''), title: field('name') || fileTitle, fileTitle, summary: field('desc') ?? '', developer: field('developer') ?? '', publisher: field('publisher') ?? '',
      genre: field('genre') ?? '', year: released ? Number(released.slice(0, 4)) || null : null, rating: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 100) : null,
      playCount: Number(field('playcount')) || 0, lastPlayed: esdeDate(field('lastplayed')), favorite: field('favorite') === 'true', hidden: field('hidden') === 'true' });
  }
  return games;
}
// A ROM's id is the same whether ES-DE or a folder scan found it, so tracking carries over.
export const romId = (system, title) => `rom-${createHash('sha1').update(`${system}|${titleKey(title)}`).digest('hex').slice(0, 16)}`;
// Where ES-DE's ROMs and downloaded box art are. Its settings may start with ~ (your home
// folder) or %ESPATH% (the folder with ES-DE.exe); left empty, the ROMs are in ~/ROMs, or
// next to ES-DE.exe for the portable release.
export function esdeFolders(esdeRoot, { rom, media, portable = false, home = os.homedir() } = {}) {
  const espath = path.dirname(esdeRoot);
  const expand = value => value ? value.replace(/^~(?=$|[\\/])/, home).replace(/%ESPATH%/gi, espath) : null;
  return { romDirectory: expand(rom) ?? path.join(portable ? espath : home, 'ROMs'), mediaDirectory: expand(media) || path.join(esdeRoot, 'downloaded_media') };
}
export async function readEsde(esdeRoot) {
  const settings = await readFile(path.join(esdeRoot, 'settings/es_settings.xml'), 'utf8').catch(() => '');
  const setting = name => settings.match(new RegExp(`<string name="${name}" value="([^"]*)"`))?.[1] || null;
  const { romDirectory, mediaDirectory } = esdeFolders(esdeRoot, { rom: setting('ROMDirectory'), media: setting('MediaDirectory'), portable: await exists(path.join(path.dirname(esdeRoot), 'portable.txt')) });
  const folders = await readdir(path.join(esdeRoot, 'gamelists'), { withFileTypes: true }).catch(() => null);
  if (!folders) throw new Error(`No gamelists in ${esdeRoot}. Open ES-DE and scrape your games first (Main menu → Scraper), then try again.`);
  const games = [], skipped = [];
  for (const folder of folders.filter(entry => entry.isDirectory())) {
    const system = ESDE_SYSTEMS[folder.name.toLowerCase()];
    if (!system) { skipped.push(folder.name); continue; }
    const xml = await readFile(path.join(esdeRoot, 'gamelists', folder.name, 'gamelist.xml'), 'utf8').catch(() => null);
    if (!xml) continue;
    for (const game of parseGamelist(xml, system)) {
      // Box art ES-DE downloaded, if any: covers/<file name>.png|jpg.
      const stem = path.posix.basename(game.file).replace(/\.[^.]+$/, '');
      let cover = null;
      for (const ext of ['png', 'jpg', 'jpeg', 'webp']) { const candidate = path.join(folder.name, 'covers', `${stem}.${ext}`); if (await exists(path.join(mediaDirectory, candidate))) { cover = candidate; break; } }
      games.push({ ...game, esdeSystem: folder.name, id: romId(system, game.fileTitle), cover });
    }
  }
  return { romDirectory, mediaDirectory, games, skipped };
}
export async function importEsde(root, esdeRoot) {
  if (!esdeRoot || !(await exists(esdeRoot))) throw new Error('ES-DE’s folder wasn’t found. It’s usually the ES-DE folder in your home folder; choose it with “Choose folder”.');
  const { romDirectory, mediaDirectory, games, skipped } = await readEsde(esdeRoot), systems = {}, seen = new Set();
  // Count games, not files: regions and discs of one game share its id.
  for (const game of games) if (!seen.has(game.id)) { seen.add(game.id); systems[game.system] = (systems[game.system] ?? 0) + 1; }
  const importedAt = new Date().toISOString();
  await writeJson(path.join(root, SOURCE_FILES.esde), { schemaVersion: 1, kind: 'roms', source: 'esde', importedAt, root: esdeRoot, romDirectory, mediaDirectory, games });
  return { count: seen.size, files: games.length, systems, skipped, romDirectory, romsAvailable: await exists(romDirectory), importedAt };
}
export const readEsdeImport = root => readJson(path.join(root, SOURCE_FILES.esde), null);

// ---------- your own keys for score services ----------
// IGDB (through Twitch) and VideoGamesCritic keys belong to whoever uses Level Select: each
// person makes their own (Import games → Scores walks through it). They're saved only in
// library/data/secrets.json, readable by you alone, never shown again or put in backups.
// Keys in the environment (IGDB_CLIENT_ID / IGDB_CLIENT_SECRET, VGC_API_KEY) work too.
export async function scoreKeys(root, env = process.env) {
  const secrets = await readSecrets(root);
  const saved = secrets.igdbClientId && secrets.igdbClientSecret, fromEnv = env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET;
  return {
    igdb: saved ? { IGDB_CLIENT_ID: secrets.igdbClientId, IGDB_CLIENT_SECRET: secrets.igdbClientSecret } : fromEnv ? { IGDB_CLIENT_ID: env.IGDB_CLIENT_ID, IGDB_CLIENT_SECRET: env.IGDB_CLIENT_SECRET } : null,
    igdbSource: saved ? 'saved' : fromEnv ? 'environment' : null,
    vgc: secrets.vgcApiKey || env.VGC_API_KEY || null,
    vgcSource: secrets.vgcApiKey ? 'saved' : env.VGC_API_KEY ? 'environment' : null,
  };
}
// Twitch hands out IGDB access for a Client ID and Client Secret; one test query shows they work.
export async function checkIgdbKeys(clientId, clientSecret, { fetchImpl = fetch } = {}) {
  const id = String(clientId ?? '').trim(), secret = String(clientSecret ?? '').trim();
  if (!/^[a-z0-9]{20,40}$/i.test(id) || !/^[a-z0-9]{20,40}$/i.test(secret)) throw new Error('Paste the Client ID and the Client Secret from your application’s page on dev.twitch.tv (about 30 letters and numbers each).');
  let response;
  try { response = await fetchImpl('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }), signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('Twitch could not be reached. Check your internet connection and try again.'); }
  if (!response.ok) throw new Error('Twitch didn’t accept these keys. Copy the Client ID again, and make a new secret (Manage → New Secret): Twitch shows each secret only once.');
  const { access_token: token } = await response.json();
  try { response = await fetchImpl('https://api.igdb.com/v4/games', { method: 'POST', body: 'fields name; limit 1;', headers: { 'Client-ID': id, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('IGDB could not be reached. Check your internet connection and try again.'); }
  if (!response.ok) throw new Error(`IGDB refused the keys (${response.status}). Make sure the application on dev.twitch.tv is set to Confidential.`);
  return { clientId: id, clientSecret: secret };
}
export async function checkVgcKey(key, { fetchImpl = fetch } = {}) {
  const value = String(key ?? '').trim();
  if (!/^\S{12,200}$/.test(value)) throw new Error('Paste the whole key from videogamescritic.com/developers (it starts with vgc_).');
  let response;
  try { response = await fetchImpl('https://videogamescritic.com/api/v1/game/570', { headers: { Accept: 'application/json', Authorization: `Bearer ${value}`, ...UA }, signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('VideoGamesCritic could not be reached. Check your internet connection and try again.'); }
  if (response.status === 401 || response.status === 403) throw new Error('VideoGamesCritic didn’t accept this key. Copy it again from videogamescritic.com/developers.');
  if (!response.ok && response.status !== 404) throw new Error(`VideoGamesCritic answered with an error (${response.status}). Try again in a minute.`);
  return value;
}

// ---------- what's on this computer, and what's connected ----------
export async function detectSources(root) {
  const config = await readConfig(root), secrets = await readSecrets(root);
  const fileInfo = async file => { const found = await stat(path.join(root, file)).catch(() => null); return found ? { modified: found.mtime.toISOString(), size: found.size } : null; };
  const count = async file => (await readJson(path.join(root, file), null))?.games?.length ?? null;
  const galaxy = [...galaxyPaths(), path.join(root, UPLOADED_GALAXY)];
  const esde = esdePaths();
  return {
    steam: { accounts: await steamAccountsOnDisk(), file: (await Promise.all((await steamFiles()).map(async file => (await exists(file)) ? file : null))).find(Boolean) ?? null, account: config.steam?.account ?? null, wishlist: config.steam?.wishlist ?? null, owned: config.steam?.owned ?? null,
      hasKey: Boolean(secrets.steamApiKey), ownedGames: await count(SOURCE_FILES.steamOwned),
      installed: { folders: await steamLibraryFolders(), connected: config.steamInstalled ?? null } },
    galaxy: { found: (await Promise.all(galaxy.map(async file => (await exists(file)) ? file : null))).filter(Boolean), connected: config.galaxy ?? null, games: await count(SOURCE_FILES.galaxy) },
    playnite: { file: await fileInfo('library/playnite_library.csv'), connected: config.playnite ?? null,
      found: (await Promise.all(playnitePaths().map(async folder => (await exists(path.join(folder, 'library'))) ? folder : null))).filter(Boolean) },
    wishlistFile: await fileInfo(WISHLIST_FILE),
    esde: { found: (await Promise.all(esde.map(async folder => (await exists(path.join(folder, 'gamelists'))) ? folder : null))).filter(Boolean), connected: config.esde ?? null, games: await count(SOURCE_FILES.esde) },
    scores: await scoresState(root),
    platform: process.platform,
  };
}
// Which score keys are set (never the keys themselves) and how VideoGamesCritic's last run went.
async function scoresState(root) {
  const keys = await scoreKeys(root), vgc = await readJson(path.join(root, 'library/data/vgc.json'), null);
  return { igdb: keys.igdbSource, vgc: keys.vgcSource, vgcLastRun: vgc?.lastRun ?? null, vgcGames: Object.values(vgc?.games ?? {}).filter(game => game.status === 'scored').length };
}

// Re-pull every connected source; used by "Update data". Each source reports on its own.
export async function syncSources(root, { fetchImpl = fetch } = {}) {
  const config = await readConfig(root), secrets = await readSecrets(root), notes = [];
  const run = async (label, work, record) => {
    try { const result = await work(); await updateConfig(root, current => record(current, result)); notes.push(`${label}: ${result.count.toLocaleString('en')}`); }
    catch (error) { notes.push(`${label}: ${error.message}`); }
  };
  const steamId = config.steam?.account?.steamId;
  if (steamId && config.steam?.wishlist) await run('Steam wishlist', () => importSteamWishlist(root, steamId, { fetchImpl }), (current, result) => { current.steam.wishlist = { syncedAt: result.fetchedAt, count: result.count }; });
  if (steamId && config.steam?.owned && secrets.steamApiKey) await run('Steam games', () => importSteamOwned(root, steamId, secrets.steamApiKey, { fetchImpl }), (current, result) => { current.steam.owned = { syncedAt: result.importedAt, count: result.count }; });
  if (config.steamInstalled) await run('Steam installed', () => importSteamInstalled(root, { fetchImpl }), (current, result) => { current.steamInstalled = { syncedAt: result.importedAt, count: result.count, shared: result.shared, folders: result.folders }; });
  if (config.galaxy?.path) await run('GOG Galaxy', () => importGalaxy(root, config.galaxy.path), (current, result) => { current.galaxy = { ...current.galaxy, syncedAt: result.importedAt, count: result.count, stores: result.stores }; });
  if (config.esde?.root) await run('ES-DE', () => importEsde(root, config.esde.root), (current, result) => { current.esde = { ...current.esde, syncedAt: result.importedAt, count: result.count, files: result.files, systems: result.systems }; });
  return notes;
}

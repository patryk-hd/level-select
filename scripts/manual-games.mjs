// Games you add by hand: physical copies, consoles no import reaches, anything else. They're
// kept in private library/data/manual-games.json (covers in library/data/covers) and merged
// into the library as the server serves it, so they appear at once, with no rebuild.
// Search covers the Game Atlas (it ships with the app), IGDB with your own keys, and Steam's
// store when there are no IGDB keys.
import { readFile, writeFile, rename, mkdir, rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { titleKey, platformKey, ownedMatches } from '../library/core.js';
import { SYSTEM_PLATFORMS } from '../ranking/igdb-match.mjs';
import { saveOverride, removeOverride } from './igdb-overrides.mjs';

export const MANUAL_FILE = 'library/data/manual-games.json';
export const COVERS_DIR = 'library/data/covers';
export const COVER_ROUTE = '/__retro_library/cover/';
export const COVER_LIMIT = 8e6;
const UA = { 'User-Agent': 'LevelSelect/1.0 (personal game library)' };

// ---------- the file ----------
export async function readManual(root) {
  try {
    const data = JSON.parse(await readFile(path.join(root, MANUAL_FILE), 'utf8'));
    return data?.schemaVersion === 1 && Array.isArray(data.games) ? data : { schemaVersion: 1, games: [] };
  } catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, games: [] }; throw error; }
}
async function writeManual(root, data) {
  const file = path.join(root, MANUAL_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(data, null, 1)); await rename(`${file}.tmp`, file);
}

// ---------- what a game may contain ----------
const text = (value, max, label) => {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length > max) throw new Error(`${label} is too long.`);
  return clean;
};
const list = value => (Array.isArray(value) ? value : []).map(item => text(item, 80, 'A name')).filter(Boolean).slice(0, 10);
// Covers a search result may bring: IGDB's and Steam's image servers, the Atlas's box art.
const COVER_HOSTS = new Set(['images.igdb.com', 'shared.akamai.steamstatic.com', 'cdn.akamai.steamstatic.com', 'steamcdn-a.akamaihd.net', 'raw.githubusercontent.com']);
export function remoteCover(value) {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && COVER_HOSTS.has(url.hostname) ? url.href : null; } catch { return null; }
}
export const atlasCover = value => /^\.\.\/assets\/covers\/[\w.-]+\.(?:png|jpe?g|webp)$/i.test(String(value ?? '')) ? value : null;

export function validateGame(input, now = new Date()) {
  const name = text(input?.name, 200, 'The title');
  if (!name) throw new Error('Give the game a title.');
  const platform = text(input?.platform, 60, 'The platform');
  if (!platform) throw new Error('Choose the platform you own it on.');
  const ownedOn = text(input?.ownedOn, 40, 'Where you own it') || 'Physical';
  let year = input?.year === '' || input?.year == null ? null : Number(input.year);
  if (year !== null && !(Number.isInteger(year) && year >= 1950 && year <= now.getFullYear() + 5)) throw new Error(`The year should be between 1950 and ${now.getFullYear() + 5}.`);
  const igdbId = input?.igdbId == null || input.igdbId === '' ? null : Number(input.igdbId);
  if (igdbId !== null && !(Number.isSafeInteger(igdbId) && igdbId > 0)) throw new Error('Invalid IGDB game.');
  const steamAppId = input?.steamAppId == null || input.steamAppId === '' ? null : String(input.steamAppId);
  if (steamAppId !== null && !/^[1-9]\d{0,9}$/.test(steamAppId)) throw new Error('Invalid Steam app.');
  const atlasId = input?.atlasId ? String(input.atlasId) : null;
  if (atlasId !== null && !/^[a-z0-9-]{1,80}$/.test(atlasId)) throw new Error('Invalid Game Atlas entry.');
  return { name, platform, year, ownedOn, igdbId, steamAppId, atlasId, genres: list(input?.genres), developers: list(input?.developers), publishers: list(input?.publishers),
    summary: text(input?.summary, 2000, 'The description') };
}

// ---------- covers ----------
// The picture's own first bytes say what it is; nothing else is accepted.
export function imageType(buffer) {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}
// Pictures for games you added (manual-…) and for fixes to imported games (fix-…).
export const coverFileName = name => /^(?:manual|fix)-[a-f0-9]{12}-[a-f0-9]{6}\.(?:png|jpg|webp)$/.test(String(name)) ? name : null;
export async function saveCoverFile(root, id, buffer) {
  const type = imageType(buffer);
  if (!type) throw new Error('Choose a PNG, JPEG or WebP picture.');
  if (buffer.length > COVER_LIMIT) throw new Error('That picture is too large (8 MB at most).');
  const file = `${id}-${randomBytes(3).toString('hex')}.${type}`;
  await mkdir(path.join(root, COVERS_DIR), { recursive: true });
  await writeFile(path.join(root, COVERS_DIR, file), buffer);
  return file;
}
export const removeCoverFile = (root, file) => coverFileName(file) ? rm(path.join(root, COVERS_DIR, file), { force: true }) : null;
// A search result's cover is saved with the game, so it shows offline and your browser
// doesn't ask IGDB or Steam for it each time. If it can't be fetched, the link is kept.
export async function fetchCover(root, id, url, fetchImpl) {
  try {
    // No redirects: the picture must come from the host it was found on.
    const response = await fetchImpl(url, { headers: UA, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok || Number(response.headers?.get?.('content-length')) > COVER_LIMIT) return null;
    return await saveCoverFile(root, id, Buffer.from(await response.arrayBuffer()));
  } catch { return null; }
}
export async function readCover(root, file) {
  const name = coverFileName(file);
  if (!name) return null;
  const body = await readFile(path.join(root, COVERS_DIR, name)).catch(() => null);
  return body && { body, type: { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[name.split('.').pop()] };
}

// ---------- add, change, remove ----------
const newId = () => `manual-${randomBytes(6).toString('hex')}`;
// Picked from IGDB: that IGDB game is the match, so scores and time to beat need no guessing.
const linkIgdb = (root, game) => game.igdbId ? saveOverride(root, { collection: 'owned', key: game.id, decision: 'replaced', igdbId: game.igdbId }) : removeOverride(root, 'owned', game.id);

// The same game on the same platform, from the same store (or both physical), is already in
// your library: adding it again would be a mistake. `owned` is your library's games.
export function checkNotOwned(owned, game, except = null) {
  const match = ownedMatches(owned ?? [], game, { except }).find(item => item.level === 'same');
  if (match) throw new Error(`${match.copy.name ?? match.group.name} is already in your library on ${game.platform} (${game.ownedOn}).`);
}

export async function addGame(root, input, { fetchImpl = fetch, now = new Date(), owned = [] } = {}) {
  const game = { id: newId(), ...validateGame(input, now), cover: '', coverFile: null, addedAt: now.toISOString() };
  checkNotOwned(owned, game);
  const remote = remoteCover(input?.coverUrl), local = atlasCover(input?.coverUrl);
  if (remote) { game.coverFile = await fetchCover(root, game.id, remote, fetchImpl); if (!game.coverFile) game.cover = remote; }
  else if (local) game.cover = local;
  const data = await readManual(root);
  data.games.push(game);
  await writeManual(root, data);
  await linkIgdb(root, game);
  return game;
}
async function find(root, id) {
  const data = await readManual(root), game = data.games.find(entry => entry.id === id);
  if (!game) throw new Error('That game isn’t in your library any more.');
  return { data, game };
}
export const getGame = async (root, id) => (await find(root, id)).game;
// The cover isn't part of an edit: it changes through setCover.
export async function editGame(root, id, input, { now = new Date(), owned = [] } = {}) {
  const { data, game } = await find(root, id), changed = validateGame({ ...game, ...input }, now);
  checkNotOwned(owned, changed, id);
  Object.assign(game, changed, { updatedAt: now.toISOString() });
  await writeManual(root, data);
  await linkIgdb(root, game);
  return game;
}
export async function removeGame(root, id) {
  const { data, game } = await find(root, id);
  data.games = data.games.filter(entry => entry.id !== id);
  await writeManual(root, data);
  await removeCoverFile(root, game.coverFile);
  await removeOverride(root, 'owned', id);
  return game;
}
// Your own picture (bytes), or none (null).
export async function setCover(root, id, buffer) {
  const { data, game } = await find(root, id), old = game.coverFile;
  game.coverFile = buffer ? await saveCoverFile(root, id, buffer) : null;
  game.cover = '';
  await writeManual(root, data);
  await removeCoverFile(root, old);
  return game;
}

// ---------- in the library ----------
export const coverOf = game => game.coverFile ? COVER_ROUTE + game.coverFile : game.cover || '';
export function manualGroups(data) {
  return (data?.games ?? []).map(game => {
    const year = game.year ?? null, sources = [game.ownedOn || 'Physical'];
    const copy = { id: game.id, name: game.name, manual: true, platforms: [game.platform], sources, year, releaseDate: year ? String(year) : '', playCount: 0, timePlayed: 0, played: false, hidden: false,
      ...(game.steamAppId ? { steamAppId: game.steamAppId, steamAppIdProvenance: { schemaVersion: 1, origin: 'manual', trust: 'store' } } : {}) };
    return { id: game.id, name: game.name, manual: true, atlasId: game.atlasId ?? null, platforms: [game.platform], sources, year, releaseDate: year ? String(year) : '', dateSort: year ? `${year}-01-01` : '',
      genres: game.genres ?? [], mainGenre: game.genres?.[0] ?? '', developers: game.developers ?? [], publishers: game.publishers ?? [], categories: [], tags: [],
      played: false, timePlayed: 0, playCount: 0, hidden: false, favorite: false, notes: '', cover: coverOf(game), background: '', summary: game.summary ?? '',
      search: [game.name, game.platform, ...sources, ...(game.genres ?? []), ...(game.developers ?? [])].join(' ').toLowerCase(), legacyGroups: [], copies: [copy] };
  });
}
// A game you already have under the same title (on another platform or store, released within
// a year of it) gets the new copy; anything else becomes its own entry.
export function mergeManual(games, groups) {
  const byTitle = new Map();
  for (const game of games) for (const name of new Set([game.name, ...game.copies.map(copy => copy.name)].filter(Boolean))) {
    const key = titleKey(name);
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(game);
  }
  for (const group of groups) {
    const target = (byTitle.get(titleKey(group.name)) ?? []).find(game => game.year == null || group.year == null || Math.abs(game.year - group.year) <= 1);
    if (!target) { games.push(group); continue; }
    const copy = group.copies[0];
    target.copies.push(copy);
    target.platforms = [...new Set([...(target.platforms ?? []), ...copy.platforms])];
    target.sources = [...new Set([...(target.sources ?? []), ...copy.sources])];
    target.duplicate = true;
    if (!target.cover && group.cover) target.cover = group.cover;
    target.search = `${target.search ?? ''} ${group.search}`;
  }
  return games;
}

// ---------- search ----------
// IGDB platform ids → the app's systems → a platform name the library already uses.
const PLATFORM_SYSTEMS = { ...Object.fromEntries(Object.entries(SYSTEM_PLATFORMS).flatMap(([system, ids]) => ids.map(id => [id, system])).reverse()), 6: 'pc', 13: 'dos', 52: 'mame', 86: 'tg16' };
const SYSTEM_NAMES = { pc: 'PC (Windows)', dos: 'PC (DOS)', mame: 'Arcade', cps: 'Arcade', naomi: 'Arcade', cave: 'Arcade' };
export function systemName(systemId, catalog) {
  if (SYSTEM_NAMES[systemId]) return SYSTEM_NAMES[systemId];
  const system = catalog?.systems?.find(entry => entry.id === systemId);
  if (!system) return null;
  // The full name ("Nintendo Switch") when it means the same platform, else the short one.
  return platformKey(system.fullName) === platformKey(system.name) ? system.fullName : system.name;
}
const IGDB_NAMES = { 3: 'Linux', 14: 'macOS', 34: 'Android', 39: 'iOS' };
export const igdbPlatformName = (platform, catalog) => (PLATFORM_SYSTEMS[platform.id] && systemName(PLATFORM_SYSTEMS[platform.id], catalog)) || IGDB_NAMES[platform.id] || platform.name || null;

export function searchAtlas(catalog, query, limit = 8) {
  const want = titleKey(query);
  if (want.length < 2) return [];
  const words = want.split(' ');
  const scored = [];
  for (const game of catalog.games) {
    let best = 0;
    for (const name of [game.title, ...(game.aliases ?? [])]) {
      const key = titleKey(name);
      best = Math.max(best, key === want ? 3 : key.startsWith(want) ? 2 : words.every(word => key.includes(word)) ? 1 : 0);
    }
    if (best) scored.push({ game, best });
  }
  scored.sort((a, b) => b.best - a.best || (a.game.rank ?? 999) - (b.game.rank ?? 999) || a.game.title.localeCompare(b.game.title));
  return scored.slice(0, limit).map(({ game }) => {
    const platform = systemName(game.systemId, catalog);
    return { source: 'atlas', key: `atlas:${game.id}`, title: game.title, year: game.year ?? null, platforms: platform ? [platform] : [], years: platform && game.year ? { [platform]: game.year } : {},
      cover: game.cover?.local ? `.${game.cover.local}` : game.cover?.url ?? '', atlasId: game.id, igdbId: null, steamAppId: null, genres: game.genres ?? [], developers: [], publishers: [], summary: '' };
  });
}

const IGDB_FIELDS = 'name,game_type,first_release_date,total_rating_count,version_parent,cover.image_id,platforms.name,release_dates.platform,release_dates.y,genres.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,summary,external_games.uid,external_games.external_game_source';
const quoted = value => `"${String(value).replace(/["\\]/g, ' ')}"`;
const yearOf = unix => unix ? new Date(unix * 1000).getUTCFullYear() : null;
// DLC, mods, episodes, seasons, packs and updates aren't games you'd add. IGDB's own order
// puts bundles and side releases first, so the title you typed comes first, then games before
// their editions, then the best known (most rated).
export async function searchIgdb(query, run, catalog) {
  const games = await run('games', `fields ${IGDB_FIELDS}; search ${quoted(query)}; where game_type != (1,5,6,7,13,14); limit 20;`);
  const want = titleKey(query), rank = game => [titleKey(game.name) === want ? 0 : 1, game.version_parent ? 1 : 0, -(game.total_rating_count ?? 0)];
  const order = (a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  return games.sort(order).slice(0, 10).map(game => {
    const names = new Map((game.platforms ?? []).map(platform => [platform.id, igdbPlatformName(platform, catalog)]).filter(([, name]) => name));
    const years = {};
    for (const release of game.release_dates ?? []) {
      const name = names.get(release.platform);
      if (name && release.y && !(years[name] <= release.y)) years[name] = release.y;
    }
    const companies = role => [...new Set((game.involved_companies ?? []).filter(item => item[role] && item.company?.name).map(item => item.company.name))];
    return { source: 'igdb', key: `igdb:${game.id}`, title: game.name, year: yearOf(game.first_release_date), platforms: [...new Set(names.values())], years,
      cover: game.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${game.cover.image_id}.jpg` : '', atlasId: null, igdbId: game.id,
      steamAppId: (game.external_games ?? []).find(item => item.external_game_source === 1 && /^\d+$/.test(item.uid ?? ''))?.uid ?? null,
      genres: (game.genres ?? []).map(genre => genre.name).filter(Boolean), developers: companies('developer'), publishers: companies('publisher'), summary: String(game.summary ?? '').slice(0, 1200) };
  });
}

// Steam's store search needs no key; its details call adds release dates and covers.
export async function searchSteam(query, { fetchImpl = fetch, details = async () => new Map() } = {}) {
  const response = await fetchImpl(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=GB`, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Steam answered with an error (${response.status}).`);
  const items = ((await response.json()).items ?? []).filter(item => item.type === 'app' && item.id).slice(0, 8);
  const info = await details(items.map(item => String(item.id))).catch(() => new Map());
  return items.filter(item => { const type = info.get(String(item.id))?.type; return type == null || type === 0; }).map(item => {
    const more = info.get(String(item.id)) ?? {}, year = more.released ? new Date(more.released * 1000).getUTCFullYear() : null;
    return { source: 'steam', key: `steam:${item.id}`, title: more.name ?? item.name, year, platforms: ['PC (Windows)'], years: year ? { 'PC (Windows)': year } : {},
      cover: more.cover ?? remoteCover(item.tiny_image) ?? '', atlasId: null, igdbId: null, steamAppId: String(item.id), genres: [], developers: more.developers ?? [], publishers: more.publishers ?? [], summary: more.summary ?? '' };
  });
}

// IGDB (or Steam) first, then Game Atlas entries they don't already show.
export function combineResults(primary, atlas) {
  const seen = primary.map(result => [titleKey(result.title), result.year]);
  return [...primary, ...atlas.filter(result => !seen.some(([title, year]) => title === titleKey(result.title) && (year == null || result.year == null || Math.abs(year - result.year) <= 1)))];
}

// The Atlas as the app ships it, read once and again only when it changes.
let atlas = null;
export async function readAtlas(root) {
  const file = path.join(root, 'data/catalog.json'), info = await stat(file);
  if (atlas?.mtime !== info.mtimeMs) atlas = { mtime: info.mtimeMs, catalog: JSON.parse(await readFile(file, 'utf8')) };
  return atlas.catalog;
}

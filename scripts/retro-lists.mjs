// Review-backed lists for Game Atlas. For each console, handheld and computer, the best games
// by critic reviews of that system's version (the "Video game reviews" box on the game's
// English Wikipedia page: EGM, Famitsu, GamePro, Mean Machines, AllGame, IGN…) and player
// ratings (IGDB), ranked with the app's score rule. They replace the legacy editorial
// lists, which had no sources per game and no reproducible order.
//
//   npm run retro:lists               fetch what's missing, rebuild data/retro-lists.json and the catalog
//   npm run retro:lists -- --offline  rebuild from the cache only
//   npm run retro:lists -- --refresh  fetch IGDB and Wikipedia again
//
// IGDB needs IGDB_CLIENT_ID / IGDB_CLIENT_SECRET. The cache holds public data only and
// stays out of Git: library/data/cache/retro-lists/.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReviews, reviewBoxes, reviewsFor, outletName } from '../ranking/critic-reviews.mjs';
import { normalizeTitle, baseTitle } from '../ranking/igdb-match.mjs';
import { reviewRating } from '../tracking/score.js';
import { storeItems } from './sources.mjs';

export const LISTS_FILE = 'data/retro-lists.json';
const CACHE = 'library/data/cache/retro-lists';
// Every Game Atlas system (catalog ids, so tracking carries over) and its IGDB platforms;
// a system switches to its review-backed list once reviews support 20 games
// (scripts/build-catalog.mjs). Classic PC keeps the old list's span (DOS and Windows, to
// 1999) and PC takes over from 2000, by the year a game came out on PC; arcades stop with
// the PS2 generation.
// The Capcom CPS, NAOMI and Cave collections are themed picks, not systems: they stay.
// Reviews boxes rarely review an arcade original, so arcade games count only reviews
// that say "arcade" (Tekken 3's unlabelled scores are the PlayStation version's).
export const LIST_SYSTEMS = [
  { id: 'nes', platforms: [18, 99, 51] }, { id: 'snes', platforms: [19, 58] }, { id: 'n64', platforms: [4] }, { id: 'gc', platforms: [21] },
  { id: 'gb', platforms: [33], handheld: true }, { id: 'gbc', platforms: [22], handheld: true }, { id: 'gba', platforms: [24], handheld: true }, { id: 'ds', platforms: [20], handheld: true },
  { id: 'ms', platforms: [64] }, { id: 'md', platforms: [29] }, { id: 'gg', platforms: [35], handheld: true }, { id: 'scd', platforms: [78] },
  { id: 'saturn', platforms: [32] }, { id: 'dc', platforms: [23] }, { id: 'ps1', platforms: [7] }, { id: 'ps2', platforms: [8] },
  { id: 'psp', platforms: [38], handheld: true }, { id: 'xbox', platforms: [11] }, { id: 'atari2600', platforms: [59] }, { id: 'tg16', platforms: [86] },
  { id: 'pcecd', platforms: [150] }, { id: 'neogeo', platforms: [80, 79, 136] }, { id: 'mame', platforms: [52], until: 2004, labelledOnly: true },
  { id: 'dos', platforms: [13, 6], until: 1999 }, { id: 'amiga', platforms: [16], computer: true, siblings: [63, 114] }, { id: 'c64', platforms: [15], computer: true },
  { id: 'spectrum', platforms: [26], computer: true }, { id: 'msx', platforms: [27, 53], computer: true },
  { id: 'sg1000', platforms: [84] }, { id: '32x', platforms: [30] }, { id: 'atari5200', platforms: [66] }, { id: 'atari7800', platforms: [60] },
  { id: 'lynx', platforms: [61], handheld: true }, { id: 'jaguar', platforms: [62] }, { id: 'ngpc', platforms: [120, 119], handheld: true },
  { id: 'wii', platforms: [5] }, { id: 'wiiu', platforms: [41] }, { id: '3ds', platforms: [37, 137], handheld: true }, { id: 'switch', platforms: [130] },
  { id: 'switch2', platforms: [508] }, { id: 'ps3', platforms: [9] }, { id: 'ps4', platforms: [48] }, { id: 'ps5', platforms: [167] },
  { id: 'vita', platforms: [46] }, { id: 'x360', platforms: [12] }, { id: 'xone', platforms: [49] }, { id: 'xsx', platforms: [169] },
  { id: 'pc', platforms: [6], since: 2000 },
];
// At most 100 games a system, each with enough reviews (three critics or 15 players) and a
// score above the neutral 70: the evidence says it's better than an average game.
export const LIST_SIZE = 100, MIN_EVIDENCE = 15, MIN_SCORE = 70;
// A release more than 90 days after the game first came out is a port: its players'
// ratings and the reviews that don't say which version they played are about the
// original, so only reviews of this version count (and IGDB's ratings of the port).
const FIRST_LAG = 90 * 86400;
// Game types that can be on a list: main games, bundles, standalone expansions, remakes,
// remasters, expanded games and ports. Expansions that need the base game (The Witcher 3:
// Blood and Wine) aren't games to pick from a list.
const TYPES = [0, 3, 4, 8, 9, 10, 11], BUNDLE = 3, EXPANDED = 10, PORT = 11, ARCADE = 52;
// Versions that differ: a handheld version released alongside a home or PC version, or a
// home computer version released alongside other machines' (IGDB often knows only the
// year, so SimCity "came out" on the C64, Spectrum and Amiga together), is usually a
// different game; players' ratings and reviews that don't name the machine don't count.
const HANDHELDS = new Set([33, 22, 24, 20, 37, 137, 38, 46, 35, 61, 119, 120, 57, 123, 34, 39, 55, 74]);
// Words that don't tell two titles apart.
const FILLER = new Set(['the', 'a', 'an', 'of', 'and', 'version', 'edition', 'game', 'video']);
// Player ratings count from 25 of them (24 ratings averaging 97 put a licensed NES game in
// the top ten). A game rated only by players needs 100 (50 averaging 98 put American
// Chopper in the Xbox top ten); arcade games, which reviewers rarely scored, need 30.
const MIN_PLAYERS = 25, MIN_PLAYERS_ALONE = 100, MIN_PLAYERS_ARCADE = 30;
const GENRES = { 2: ['Adventure'], 4: ['Fighting'], 5: ['Shooter'], 7: ['Rhythm'], 8: ['Platformer'], 9: ['Puzzle'], 10: ['Racing'], 11: ['Strategy'], 12: ['RPG'],
  13: ['Simulation'], 14: ['Sports'], 15: ['Strategy'], 16: ['Strategy'], 24: ['Strategy'], 25: ['Action'], 26: ['Party'], 30: ['Arcade'], 31: ['Adventure'],
  33: ['Arcade'], 34: ['Visual novel'], 35: ['Card & board'], 36: ['Strategy'] };
const THEMES = { 1: ['Action'], 19: ['Horror'], 23: ['Stealth'], 21: ['Survival'] };

const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const catalogKey = text => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const yearOf = seconds => seconds ? new Date(seconds * 1000).getUTCFullYear() : null;
const round = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
const decode = text => { try { return decodeURIComponent(text); } catch { return text; } };
const wikiTitle = url => { const match = /^https?:\/\/en\.(?:m\.)?wikipedia\.org\/wiki\/([^#?]+)/.exec(url ?? ''); return match ? decode(match[1]).replace(/_/g, ' ').trim() || null : null; };

// The parts of an IGDB game the lists use.
// Each platform's first release. Early access, alpha and beta count only where there's no
// full release yet: Hades came out on PC and Switch the same day in 2020, after two years
// of PC early access, so the Switch version isn't a port. Cancelled releases never count.
// { any: true } keeps early access too: the platform a game was born on (Subnautica on PC)
// stays its original, even where IGDB doesn't mark another platform's early access.
const PREVIEW = new Set([1, 2, 3]), CANCELLED = 5;
export const datesOf = (releases, { any = false } = {}) => {
  const full = {}, preview = {};
  for (const release of releases ?? []) {
    if (!release.platform || !release.date || release.status === CANCELLED) continue;
    const into = !any && PREVIEW.has(release.status) ? preview : full;
    into[release.platform] = Math.min(into[release.platform] ?? Infinity, release.date);
  }
  return { ...preview, ...full };
};
export function compactPoolGame(game) {
  const dates = datesOf(game.release_dates), parent = game.parent_game ?? game.version_parent ?? null;
  // Regional versions, editions and ports share their parent's release; a remake or remaster is its own.
  const sameRelease = Boolean(game.version_parent) || [EXPANDED, PORT].includes(game.game_type);
  const dated = Object.values(dates), anyDates = datesOf(game.release_dates, { any: true });
  // Only kept where early access changes a date, to keep the cache small.
  const early = Object.keys(anyDates).some(id => anyDates[id] !== dates[id]) ? anyDates : null;
  return { id: game.id, name: game.name, slug: game.slug ?? null, type: game.game_type ?? 0, first: dated.length ? Math.min(...dated) : game.first_release_date ?? null, url: game.url ?? null,
    players: round(game.rating), playersCount: game.rating_count ?? 0, critic: round(game.aggregated_rating), criticCount: game.aggregated_rating_count ?? 0,
    parent: game.parent_game?.id ?? game.version_parent?.id ?? null,
    parentFirst: sameRelease ? parent?.first_release_date ?? null : null, parentDates: sameRelease ? datesOf(parent?.release_dates) : {}, genres: game.genres ?? [], themes: game.themes ?? [], dates,
    cover: game.cover?.image_id ?? null, alt: (game.alternative_names ?? []).map(item => item.name).filter(Boolean),
    wiki: (game.websites ?? []).map(site => wikiTitle(site.url)).find(Boolean) ?? null,
    shots: (game.screenshots ?? []).map(shot => shot.image_id).filter(Boolean).slice(0, 4), ...(early ? { early } : {}) };
}

// When the game reached this system and whether that was the game's first release
// (`original`). IGDB's version and port pages count from their parent game: Streets of
// Rage 3 (a "port" of Bare Knuckle III) came out first; the US Final Fantasy VII is a
// version of the Japanese release on the same console, so it isn't a port either.
// `portPage`: IGDB's own page for a port or an enhanced version (Persona 4 Golden, Link's
// Awakening DX), whose players rated that version. `alongside`: launched together with a
// version that differs (see HANDHELDS; a Vita version is usually the PS3/PS4 game, so the
// Vita counts as a home system here).
export function release(game, platforms, { handheld = false, computer = false, siblings = [] } = {}) {
  const own = platforms.map(id => game.dates?.[id]).filter(Boolean), parents = platforms.map(id => game.parentDates?.[id]).filter(Boolean);
  const here = own.length || parents.length ? Math.min(...own, ...parents) : null;
  // Reviewers and most players knew an arcade game from its home versions (EGM reviewed
  // Tekken 3 on the PlayStation), so its first home release counts as the first release.
  // (A parent whose platforms IGDB doesn't list counts from its first release.)
  const parentUndated = !Object.keys(game.parentDates ?? {}).length && game.parentFirst ? [game.parentFirst] : [];
  const home = [...Object.entries(game.dates ?? {}), ...Object.entries(game.parentDates ?? {})].filter(([id]) => Number(id) !== ARCADE).map(([, date]) => date).concat(parentUndated);
  const origin = home.length && !platforms.includes(ARCADE) ? Math.min(...home) : Math.min(...[game.first, game.parentFirst].filter(Boolean));
  const lag = here && Number.isFinite(origin) ? here - origin : 0;
  // Born here: this platform had the game first, early access included.
  const early = game.early ? Object.entries(game.early).filter(([id]) => Number(id) !== ARCADE || platforms.includes(ARCADE)) : [];
  const bornHere = early.length > 0 && Math.min(...platforms.map(id => game.early[id]).filter(Boolean)) <= Math.min(...early.map(([, date]) => date));
  // IGDB sometimes lists a platform without a release there (Tomb Raider on the N64): then
  // only reviews that name this system count.
  const undated = !here && Object.keys(game.dates ?? {}).length > 0;
  const differs = id => handheld ? !HANDHELDS.has(id) : computer ? !platforms.includes(id) && !siblings.includes(id) : false;
  const alongside = Boolean(here) && Object.entries(game.dates ?? {}).some(([id, date]) => differs(Number(id)) && Math.abs(date - here) <= FIRST_LAG);
  return { year: yearOf(here ?? game.first), original: !undated && (lag <= FIRST_LAG || bornHere), portPage: game.type === PORT || game.type === EXPANDED, alongside };
}

// Whether the game's Wikipedia page is about this game: its name (or another IGDB name)
// matches, the page covers it ("Pokémon Red, Blue, and Yellow"), or the page drops a
// subtitle ("Landstalker", "QuackShot") that no other game is called. A version of
// another game (Master Quest, Substance, a medal-game spin-off) only fits a page with its
// own name. `named`: normalized names of every game in the pools.
const words = text => normalizeTitle(String(text ?? '').replace(/\s*\([^)]*\)\s*$/, '')).split(' ').filter(word => word && !FILLER.has(word));
const within = (part, whole) => part.length > 0 && part.every(word => whole.includes(word));
export function pageFits(game, named = new Set()) {
  if (!game.wiki) return false;
  const page = words(game.wiki), names = [game.name, ...(game.alt ?? [])].filter(Boolean);
  const same = (one, other) => within(one, other) && within(other, one);
  if (names.some(name => same(words(name), page))) return true;
  if (game.parent) return false;
  const leads = name => { const own = words(name); return page.length < own.length && page.every((word, index) => own[index] === word); };
  return names.some(name => within(words(name), page) || same(words(name.split(/\s*(?::|\s[-–—]\s)\s*/)[0]), page))
    || !named.has(page.join(' ')) && names.some(leads);
}

// Critics: this version's reviews on Wikipedia (IGDB's critic score when there are none).
// Players: IGDB ratings, for original releases only.
// Steam's reviews are by players of the PC version, so a PC port (Red Dead Redemption 2,
// God of War) takes its players' score from them. Steam's share of positive reviews runs
// about 6 points above IGDB's player scores for the same top games (median 6.4 across 68
// PC list games with 1,000+ Steam reviews, 2026-10-06), so it's shifted down by that much.
// It weighs as much as the game's IGDB ratings, not Steam's hundreds of thousands of
// reviews, so every list game's evidence is on one scale and a niche game's 98% doesn't
// outweigh critics.
export const STEAM_LIST_OFFSET = 6;
const STEAM_TYPES = [0, 8, 9];
const steamPlayers = (steam, game) => steam?.count >= MIN_PLAYERS && Number.isFinite(steam.percent) && game.playersCount >= MIN_PLAYERS
  ? { value: Math.max(0, steam.percent - STEAM_LIST_OFFSET), count: Math.min(steam.count, game.playersCount), source: 'steam', percent: steam.percent, reviews: steam.count } : null;

export function evidenceFor(game, reviews, system, named = new Set(), { steam = null } = {}) {
  const { original, portPage, alongside } = release(game, system.platforms, system);
  // Reviews that don't name a version (and IGDB's critic score, which doesn't either).
  const general = original && !alongside && !system.labelledOnly && (!game.wiki || pageFits(game, named));
  const found = reviewsFor(reviews ?? [], system.id, { original: general });
  let critics = null;
  if (found.length) critics = { value: round(found.reduce((sum, review) => sum + review.value, 0) / found.length), count: found.length, outlets: found.map(review => outletName(review.outlet)), source: 'wikipedia' };
  else if (general && game.criticCount > 0 && Number.isFinite(game.critic)) critics = { value: game.critic, count: game.criticCount, outlets: [], source: 'igdb' };
  // A port page's players rated that port; a game's players rated its first release. IGDB's
  // players rate a game across versions, so a later port (KOTOR on Switch) counts only
  // reviews of that port: the PC original's fans don't rank the Switch version.
  const igdbPlayers = (portPage || original && !alongside) && game.playersCount >= MIN_PLAYERS && Number.isFinite(game.players) ? { value: game.players, count: game.playersCount } : null;
  // Editions and bundles share the game's Steam app; only the game itself (or a remake or
  // remaster) takes Steam's players, so an edition doesn't outweigh the game it belongs to.
  const players = igdbPlayers ?? (system.id === 'pc' && !original && STEAM_TYPES.includes(game.type) ? steamPlayers(steam, game) : null);
  return { original, critics, players };
}

// A display name people know: the legacy list's, else Wikipedia's when IGDB knows it by
// that name too ("Final Fantasy VI", not the US "Final Fantasy III"), else IGDB's.
// IGDB's name stays when it says more ("TMNT II: The Arcade Game", not the arcade page's
// "Teenage Mutant Ninja Turtles").
function displayTitle(game) {
  const wiki = game.wiki?.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (!wiki || within(words(wiki), words(game.name))) return game.name;
  return [game.name, ...game.alt].some(name => normalizeTitle(name) === normalizeTitle(wiki)) ? wiki : game.name;
}
function genresOf(game) {
  const tags = [...game.genres.flatMap(id => GENRES[id] ?? []), ...game.themes.flatMap(id => THEMES[id] ?? [])];
  return tags.length ? [...new Set(tags)] : ['Other'];
}

// The old lists wrote some titles with the system ("Sonic the Hedgehog GG") or a second
// name in brackets ("Thunder Force IV (Lightening Force)").
const SUFFIX = /\s+(?:GG|SMS|MD|GEN|NES|SNES|N64|GB|GBC|GBA|PCE|TG16|PS1|PSX|PS2|DC|C64|ZX|CPC|AMI|MSX|CD|ARC)$/;
export const cleanTitle = title => title.replace(SUFFIX, '').trim();
const titleVariants = title => { const bracket = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(title); return [title, cleanTitle(title), ...(bracket ? [bracket[1], bracket[2]] : [])]; };

// Legacy entries this game replaces: by the catalog's IGDB link, else by title. Never by
// a parent game: Ultimate Mortal Kombat 3 doesn't replace Mortal Kombat 3.
function legacyMatcher(catalog, links) {
  const bySystem = new Map();
  // Only entries from the original lists (the catalog also holds earlier list games).
  for (const game of (catalog?.games ?? []).filter(game => game.sourceRank != null)) {
    const entry = bySystem.get(game.systemId) ?? { byIgdb: new Map(), byTitle: new Map(), byId: new Map(), ids: new Set() };
    const igdbId = links?.[game.id]?.igdbId;
    if (igdbId && ['high', 'medium'].includes(links[game.id].confidence)) entry.byIgdb.set(igdbId, game);
    for (const title of [game.originalTitle ?? game.title, ...(game.aliases ?? [])].flatMap(titleVariants)) if (!entry.byTitle.has(normalizeTitle(title))) entry.byTitle.set(normalizeTitle(title), game);
    entry.ids.add(game.id); entry.byId.set(game.id, game);
    bySystem.set(game.systemId, entry);
    // Taken out of the original list (not a released game there): never matched.
    if (game.correction?.removed) { for (const map of [entry.byIgdb, entry.byTitle]) for (const [key, value] of map) if (value === game) map.delete(key); }
  }
  // prior: the original-list entry this game had last time, which it keeps (two entries
  // with similar titles, "International Karate" and "IK+", don't take turns).
  const match = (systemId, game, prior = null) => {
    const entry = bySystem.get(systemId); if (!entry) return null;
    if (prior && entry.byId.has(prior) && !entry.byId.get(prior).correction?.removed) return { game: entry.byId.get(prior), exact: true };
    const exact = entry.byIgdb.get(game.id);
    if (exact) return { game: exact, exact: true };
    const titled = [game.name, game.wiki?.replace(/\s*\([^)]*\)\s*$/, ''), ...game.alt].filter(Boolean).map(name => entry.byTitle.get(normalizeTitle(name))).find(Boolean);
    return titled ? { game: titled, exact: false } : null;
  };
  match.ids = systemId => bySystem.get(systemId)?.ids ?? new Set();
  return match;
}

// The year each original-list entry came out on its system, where IGDB has the game there
// (by the catalog's IGDB link, else by title); scripts/build-catalog.mjs corrects years with
// it. The arcade collections (CPS, NAOMI, Cave) use the arcade pool.
const COLLECTIONS = [['cps', 'mame'], ['naomi', 'mame'], ['cave', 'mame']];
export function legacyYears({ pools, catalog, links = null }) {
  const years = {};
  const systems = [...LIST_SYSTEMS.map(system => [system, system.id]), ...COLLECTIONS.map(([id, pool]) => [{ id, platforms: [ARCADE] }, pool])];
  for (const [system, poolId] of systems) {
    const pool = pools[poolId] ?? [], byId = new Map(pool.map(game => [game.id, game])), byTitle = new Map();
    for (const game of pool) for (const name of [game.name, ...game.alt]) if (!byTitle.has(normalizeTitle(name))) byTitle.set(normalizeTitle(name), game);
    for (const entry of (catalog?.games ?? []).filter(game => game.systemId === system.id && game.sourceRank != null && !game.correction?.removed)) {
      const link = links?.[entry.id], linked = link && ['high', 'medium'].includes(link.confidence) && byId.get(link.igdbId);
      const game = linked || [entry.originalTitle ?? entry.title, ...(entry.aliases ?? [])].flatMap(titleVariants).map(title => byTitle.get(normalizeTitle(title))).find(Boolean);
      const dates = game ? system.platforms.map(id => game.dates?.[id]).filter(Boolean) : [];
      if (dates.length) years[entry.id] = { igdbId: game.id, year: yearOf(Math.min(...dates)), via: linked ? 'link' : 'title', pool: poolId };
    }
  }
  return years;
}

// What Game Atlas's spotlight shows beside a game, keyed by catalog id: the opening of its
// Wikipedia page (only a page about this game) and IGDB screenshots. Covers list games and
// the original-list entries IGDB confirms.
export const DETAILS_FILE = 'data/atlas-details.json';
export function atlasDetails({ lists, pools, extracts = {} }) {
  const named = new Set(Object.values(pools).flat().map(game => words(game.name).join(' ')));
  const byPool = new Map(Object.entries(pools).map(([id, pool]) => [id, new Map(pool.map(game => [game.id, game]))]));
  const details = {};
  const add = (id, game) => {
    if (!game || details[id]) return;
    const page = game.wiki && pageFits(game, named) ? game.wiki : null, text = page ? extracts[page] : null;
    if (text || game.shots?.length) details[id] = { ...(text ? { text, page } : {}), ...(game.shots?.length ? { shots: game.shots } : {}) };
  };
  for (const entry of lists.games) add(entry.id, byPool.get(entry.systemId)?.get(entry.igdb.id));
  for (const [id, match] of Object.entries(lists.legacy ?? {})) add(id, byPool.get(match.pool)?.get(match.igdbId));
  return details;
}
// The first sentences of each page, without pronunciation and native-script asides.
export const cleanExtract = text => String(text ?? '').replace(/\s*\((?:[^()]*[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af][^()]*|Japanese:[^()]*|lit\.[^()]*)\)/g, '')
  // What's left of a removed pronunciation: "DOS (, ) is…".
  .replace(/\s*\(\s*[,;]?\s*\)/g, '').replace(/\s+([,.;])/g, '$1').replace(/\s+/g, ' ').trim();
async function fetchExtracts(titles, log) {
  const extracts = {};
  for (const [index, batch] of chunks(titles, 20).entries()) {
    const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exsentences: '3', exlimit: '20', format: 'json', formatversion: '2', maxlag: '5', titles: batch.join('|') })}`;
    let body;
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, { headers: UA });
      body = response.ok ? await response.json() : null;
      if (body && !body.error) break;
      if (attempt >= 4) throw new Error(`Wikipedia returned ${response.status} ${body?.error?.code ?? ''}`.trim());
      await new Promise(resolve => setTimeout(resolve, 5000 * 2 ** attempt));
    }
    for (const page of body.query.pages ?? []) extracts[page.title] = page.missing ? '' : cleanExtract(page.extract);
    for (const title of batch) extracts[title] ??= '';
    if ((index + 1) % 50 === 0) log(`  Wikipedia: ${Math.min(titles.length, (index + 1) * 20)} of ${titles.length} descriptions`);
  }
  return extracts;
}

// pools: { systemId: [compact IGDB games] }; pages: { wikipedia title: reviews[] }.
// previous: the last lists, so a game keeps its id when IGDB or Wikipedia renames it.
// explain (optional): a Map filled with why each pool game is or isn't listed, for audits
// (scripts/list-audit.mjs): `${systemId}|${igdbId}` → { reason, score, weight, rank }.
// rate (optional): another scoring rule, to compare weightings (scripts/list-audit.mjs).
// steam (optional): { igdbId: { count, percent } }, Steam reviews of PC ports.
export function buildLists({ pools, pages, catalog = null, links = null, previous = null, explain = null, rate = reviewRating, steam = null, generatedAt = new Date().toISOString() }) {
  const legacy = legacyMatcher(catalog, links), games = [], systems = [], now = Date.parse(generatedAt) / 1000;
  const before = new Map((previous?.games ?? []).filter(game => game.igdb?.id).map(game => [`${game.systemId}|${game.igdb.id}`, game.id]));
  const named = new Set(Object.values(pools).flat().map(game => words(game.name).join(' ')));
  for (const system of LIST_SYSTEMS) {
    const pool = pools[system.id] ?? [], candidates = [];
    const why = (game, reason, extra = {}) => explain?.set(`${system.id}|${game.id}`, { reason, ...extra });
    for (const game of pool) {
      if (!TYPES.includes(game.type)) { why(game, 'type'); continue; }
      const { year, original } = release(game, system.platforms, system);
      // No release date anywhere: a cancelled version (Perfect Dark Zero on the GameCube).
      if (!year || system.until && year > system.until || system.since && year < system.since) { why(game, 'year', { year }); continue; }
      // Not out yet on this system.
      const dated = system.platforms.map(id => game.dates?.[id]).filter(Boolean);
      if (dated.length && Math.min(...dated) > now) { why(game, 'unreleased'); continue; }
      const evidence = evidenceFor(game, game.wiki ? pages[game.wiki] : null, system, named, { steam: steam?.[game.id] });
      const rating = rate(evidence);
      if (!rating) { why(game, 'no-reviews', { evidence }); continue; }
      // A bundle needs reviews of its own; a game rated only by players needs plenty.
      if (!evidence.critics && (game.type === BUNDLE || (evidence.players?.count ?? 0) < (system.labelledOnly ? MIN_PLAYERS_ARCADE : MIN_PLAYERS_ALONE))) { why(game, 'players-only', { evidence, score: rating.value }); continue; }
      candidates.push({ game, year, original, evidence, rating });
    }
    // One entry per game: a port's own IGDB page and the game's page share a Wikipedia
    // article and reviews, and so do an edition named after its game ("Control: Ultimate
    // Edition", "… - Definitive Edition") and the game; keep the one with more evidence.
    // Revisions with their own name (Pokémon Emerald, Super Street Fighter II) stay apart.
    const byId = new Map(pool.map(game => [game.id, game]));
    const keyOf = game => game.wiki ?? `igdb:${game.type === PORT && game.parent || game.id}`;
    const best = new Map();
    for (const candidate of candidates) {
      const { game } = candidate, parent = [BUNDLE, EXPANDED].includes(game.type) && byId.get(game.parent);
      const edition = parent && baseTitle(game.name) !== game.name && normalizeTitle(baseTitle(game.name)) === normalizeTitle(parent.name);
      const key = keyOf(edition ? parent : game);
      const other = best.get(key);
      if (!other || candidate.rating.weight > other.rating.weight) best.set(key, candidate);
    }
    const kept = new Set([...best.values()]);
    for (const candidate of candidates) if (!kept.has(candidate)) why(candidate.game, 'merged', { score: candidate.rating.value, weight: candidate.rating.weight, evidence: candidate.evidence });
    const sorted = [...best.values()].filter(candidate => {
      const ok = candidate.rating.weight >= MIN_EVIDENCE && candidate.rating.exact > MIN_SCORE;
      if (!ok) why(candidate.game, candidate.rating.weight < MIN_EVIDENCE ? 'thin' : 'score', { score: candidate.rating.value, weight: candidate.rating.weight, evidence: candidate.evidence });
      return ok;
    }).sort((a, b) => b.rating.exact - a.rating.exact || b.rating.weight - a.rating.weight || a.game.name.localeCompare(b.game.name));
    sorted.forEach((candidate, index) => why(candidate.game, index < LIST_SIZE ? 'listed' : 'cut', { rank: index + 1, score: candidate.rating.value, weight: candidate.rating.weight, evidence: candidate.evidence, year: candidate.year }));
    const ranked = sorted.slice(0, LIST_SIZE);
    // Each legacy entry goes to one list game: its exact IGDB match first, else the best-ranked.
    const matches = ranked.map(candidate => legacy(system.id, candidate.game, before.get(`${system.id}|${candidate.game.id}`))), claimed = new Map();
    for (const exact of [true, false]) matches.forEach((match, index) => { if (match && match.exact === exact && !claimed.has(match.game.id)) claimed.set(match.game.id, index); });
    const taken = new Set(legacy.ids(system.id)), titles = new Set();
    ranked.forEach((candidate, index) => {
      const { game, evidence, rating } = candidate, match = matches[index];
      const old = match && claimed.get(match.game.id) === index ? match.game : null;
      // Two games on one list never share a name: the second keeps IGDB's, or adds its year.
      // The old list's title when IGDB knows the game by it ("Final Fantasy VI"); otherwise
      // IGDB's ("Super Smash Bros. for" lost its "Wii U" to the old lists' cleanup).
      const known = [game.name, displayTitle(game), ...game.alt].map(normalizeTitle);
      const oldTitle = old ? cleanTitle(old.originalTitle ?? old.title) : null;
      let title = old && known.includes(normalizeTitle(oldTitle)) ? oldTitle : displayTitle(game);
      if (titles.has(catalogKey(title))) title = titles.has(catalogKey(game.name)) ? `${title} (${candidate.year})` : game.name;
      titles.add(catalogKey(title));
      // A new game's id comes from its title, like the catalog's; a same-named one adds its IGDB id.
      let id = old?.id ?? before.get(`${system.id}|${game.id}`) ?? `${system.id}-${hash(catalogKey(title))}`;
      if (!old && taken.has(id)) id = `${system.id}-${hash(`${catalogKey(title)} ${game.id}`)}`;
      taken.add(id);
      games.push({ id, systemId: system.id, rank: index + 1, title, year: candidate.year,
        genres: old?.genres ?? genresOf(game), score: rating.value, critics: evidence.critics, players: evidence.players, port: !candidate.original,
        igdb: entryIgdb(game), wikipedia: game.wiki, legacyRank: old ? old.legacyRank ?? old.rank : null,
        cover: old?.cover ?? (game.cover ? { url: `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover}.jpg`, sourceUrl: game.url } : null) });
    });
    const median = values => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[sorted.length >> 1] : null; };
    systems.push({ id: system.id, candidates: best.size, listed: ranked.length,
      criticReviews: median(ranked.map(candidate => candidate.evidence.critics?.count ?? 0)), playerRatings: median(ranked.map(candidate => candidate.evidence.players?.count ?? 0)),
      fromLegacy: games.filter(game => game.systemId === system.id && game.legacyRank).length });
  }
  return { schemaVersion: 1, generatedAt, method: 'reviews-v1', rule: { listSize: LIST_SIZE, minEvidence: MIN_EVIDENCE, minScore: MIN_SCORE }, systems, games };
}

// ---------- fetching ----------
// Wikimedia asks for a way to reach whoever runs a script: set LEVEL_SELECT_CONTACT (an
// email or web page) when rebuilding the catalog. Nothing personal is built in.
const UA = { 'User-Agent': `RetroLibrary/0.1 (personal game library${process.env.LEVEL_SELECT_CONTACT ? `; ${process.env.LEVEL_SELECT_CONTACT}` : ''})` };
const FIELDS = 'name,slug,game_type,first_release_date,url,rating,rating_count,aggregated_rating,aggregated_rating_count,version_parent.first_release_date,version_parent.release_dates.platform,version_parent.release_dates.date,version_parent.release_dates.status,parent_game.first_release_date,parent_game.release_dates.platform,parent_game.release_dates.date,parent_game.release_dates.status,genres,themes,release_dates.platform,release_dates.date,release_dates.status,cover.image_id,screenshots.image_id,alternative_names.name,websites.url';
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
// Bump when compactPoolGame changes, so cached pools are fetched again.
const DAY = 86400000, STALE_DAYS = 30, POOL_VERSION = 6;

async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }
async function saveJson(file, value) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(`${file}.tmp`, JSON.stringify(value)); await rename(`${file}.tmp`, file); }

async function fetchPool(client, system) {
  // A list from a year on (PC from 2000) skips games out years before: a later port of one
  // counts only its own reviews, and it keeps the pool to the era.
  const until = (system.until ? ` & first_release_date < ${Date.UTC(system.until + 1, 0, 1) / 1000}` : '')
    + (system.since ? ` & first_release_date >= ${Date.UTC(system.since - 2, 0, 1) / 1000}` : '');
  const games = [];
  for (let offset = 0; ; offset += 500) {
    const page = await client.query('games', `fields ${FIELDS}; where platforms = (${system.platforms.join(',')}) & game_type = (${TYPES.join(',')})${until} & (rating_count > 0 | aggregated_rating_count > 0 | websites.type = 3); sort id asc; limit 500; offset ${offset};`);
    games.push(...page.map(compactPoolGame));
    if (page.length < 500) return games;
  }
}

// The Steam app of each PC list game (IGDB's external games), so the Atlas can show its
// Steam reviews and VGC Score. Several apps (a later edition): the original, the lowest id.
export const STEAM_SYSTEMS = new Set(['pc']);
async function steamApps(client, ids) {
  const found = {};
  for (const batch of chunks(ids, 400)) {
    const rows = await client.query('external_games', `fields game,uid; where game = (${batch.join(',')}) & external_game_source = 1; limit 500;`);
    for (const row of rows) if (/^[1-9]\d{0,14}$/.test(row.uid ?? '')) (found[row.game] ??= []).push(row.uid);
  }
  for (const id of ids) found[id] = (found[id] ?? []).sort((a, b) => Number(a) - Number(b));
  return found;
}

// Sub-genres IGDB keeps as keywords, for genre lists: tag → keyword pattern.
const TAGS = [['roguelike', /^rogue-?(?:like|lite)s?$/i], ['metroidvania', /^metroidvania$/i], ['soulslike', /^souls-?like$/i], ['open-world', /^open world$/i], ['survival-horror', /^survival horror$/i], ['immersive-sim', /^immersive sim$/i]];
// What lists, goals and challenges need beyond the pools, for list games only: the camera
// (first-person shooters), the series ("The Legend of Zelda") and the remakes and remasters
// of an original, so one game's versions count as one game.
export async function listExtras(client, ids) {
  const found = {};
  for (const batch of chunks(ids, 400)) {
    const rows = await client.query('games', `fields player_perspectives,collections.name,franchises.name,franchise.name,remakes,remasters,keywords.name; where id = (${batch.join(',')}); limit 500;`);
    for (const row of rows) found[row.id] = {
      perspectives: row.player_perspectives ?? [],
      series: [...new Set([...(row.collections ?? []), ...(row.franchises ?? []), row.franchise].filter(item => item?.name).map(item => item.name))],
      versions: [...new Set([...(row.remakes ?? []), ...(row.remasters ?? [])])],
      tags: [...new Set((row.keywords ?? []).map(keyword => TAGS.find(([, pattern]) => pattern.test(keyword.name ?? ''))?.[0]).filter(Boolean))],
    };
  }
  for (const id of ids) found[id] ??= null;
  return found;
}
// Parent links of games outside the pools (a port's parent can itself be a port), so each
// list game can be traced to its original: { id: { type, parent } }.
export async function igdbParents(client, ids) {
  const found = {};
  for (const batch of chunks(ids, 400)) {
    const rows = await client.query('games', `fields game_type,parent_game,version_parent; where id = (${batch.join(',')}); limit 500;`);
    for (const row of rows) found[row.id] = { type: row.game_type ?? null, parent: row.version_parent ?? row.parent_game ?? null };
  }
  for (const id of ids) found[id] ??= null;
  return found;
}
// The original a game is an edition, bundle, remaster, expanded edition or port of, through
// any number of such steps. Remakes and standalone expansions are their own originals.
const SAME_GAME_TYPES = new Set([0, 3, 9, 10, 11]);
export function originOf(game, lookup) {
  let id = game.id, link = { type: game.type, parent: game.parent };
  for (let steps = 0; link?.parent && SAME_GAME_TYPES.has(link.type) && steps < 6; steps++) { id = link.parent; link = lookup(id); }
  return id;
}
// A list entry's IGDB facts: its type (0 main game, 4 standalone expansion, 8 remake, 9
// remaster, 10 expanded edition, 11 port…), its parent (the game an edition, port or
// remaster belongs to) and the extras above, only what is known.
export function entryIgdb(game, extra, origin = game.id) {
  return { id: game.id, url: game.url, ...(Number.isInteger(game.type) ? { type: game.type } : {}), ...(game.parent ? { parent: game.parent } : {}), ...(origin !== game.id ? { origin } : {}),
    ...(extra?.perspectives?.length ? { perspectives: extra.perspectives } : {}), ...(extra?.series?.length ? { series: extra.series } : {}), ...(extra?.versions?.length ? { versions: extra.versions } : {}), ...(extra?.tags?.length ? { tags: extra.tags } : {}) };
}

// The PC list's ports (by IGDB id), and their Steam reviews: { igdbId: { count, percent } }.
export const pcPorts = pools => { const pc = LIST_SYSTEMS.find(system => system.id === 'pc'); return (pools.pc ?? []).filter(game => TYPES.includes(game.type) && !release(game, pc.platforms, pc).original).map(game => game.id); };
export const steamForPorts = (ports, apps, reviews) => Object.fromEntries(ports.map(id => [id, reviews?.apps?.[apps?.apps?.[id]?.[0]]]).filter(([, found]) => found));

// Wikipedia pages IGDB doesn't link, from Wikidata's IGDB ids (P5794).
async function wikidataPages(slugs) {
  const found = {};
  for (const batch of chunks(slugs, 200)) {
    const query = `SELECT ?slug ?article WHERE { VALUES ?slug { ${batch.map(slug => JSON.stringify(slug)).join(' ')} } ?item wdt:P5794 ?slug . ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }`;
    const response = await fetch('https://query.wikidata.org/sparql', { method: 'POST', body: new URLSearchParams({ query }), headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded', ...UA } });
    if (!response.ok) throw new Error(`Wikidata returned HTTP ${response.status}. Try again in a minute.`);
    for (const row of (await response.json()).results.bindings) found[row.slug.value] = wikiTitle(row.article.value);
    for (const slug of batch) found[slug] ??= null;
  }
  return found;
}

// Each page's review boxes, 50 pages a request (only the boxes are kept), and where each
// title leads: a redirect ("Star Fox: Super Weekend" → "Star Fox (video game)") is that page.
async function fetchReviews(wanted, log, save = async () => {}) {
  const pages = {}, titles = {};
  for (const [index, batch] of chunks(wanted, 50).entries()) {
    const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', format: 'json', formatversion: '2', redirects: '1', maxlag: '5', titles: batch.join('|') })}`;
    let body;
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, { headers: UA });
      body = response.ok ? await response.json() : null;
      if (body && !body.error) break;
      if (attempt >= 4) throw new Error(`Wikipedia returned ${response.status} ${body?.error?.code ?? ''}`.trim());
      await new Promise(resolve => setTimeout(resolve, 5000 * 2 ** attempt));
    }
    const back = new Map();
    for (const step of [...(body.query.normalized ?? []), ...(body.query.redirects ?? [])]) back.set(step.to, [...(back.get(step.to) ?? []), step.from]);
    const original = title => { const out = [title]; for (const from of back.get(title) ?? []) out.push(...original(from)); return out; };
    for (const page of body.query.pages ?? []) {
      pages[page.title] = page.missing ? '' : reviewBoxes(page.revisions?.[0]?.slots?.main?.content ?? '');
      for (const title of original(page.title)) titles[title] = page.title;
    }
    for (const title of batch) { titles[title] ??= title; pages[titles[title]] ??= ''; }
    // Every 1,000 pages: report and save, so an interrupted run picks up where it stopped.
    if ((index + 1) % 20 === 0) { log(`  Wikipedia: ${Math.min(wanted.length, (index + 1) * 50)} of ${wanted.length} pages`); await save({ pages, titles }); }
  }
  return { pages, titles };
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url)), cache = path.join(root, CACHE);
  const args = process.argv.slice(2), offline = args.includes('--offline'), refresh = args.includes('--refresh');
  const fresh = entry => entry?.fetchedAt && Date.now() - Date.parse(entry.fetchedAt) < STALE_DAYS * DAY;
  const pools = {};
  let client = null;
  for (const system of LIST_SYSTEMS) {
    const file = path.join(cache, `igdb-${system.id}.json`), saved = await readJson(file, null);
    if (offline || (!refresh && fresh(saved) && saved.version === POOL_VERSION)) { pools[system.id] = saved?.games ?? []; continue; }
    client ??= await (await import('../ranking/igdb-client.mjs')).igdbClient();
    pools[system.id] = await fetchPool(client, system);
    await saveJson(file, { version: POOL_VERSION, fetchedAt: new Date().toISOString(), games: pools[system.id] });
    console.log(`IGDB ${system.id}: ${pools[system.id].length} games`);
  }
  // Pages for games IGDB doesn't link to Wikipedia.
  const wikidataFile = path.join(cache, 'wikidata-pages.json'), wikidata = await readJson(wikidataFile, { fetchedAt: null, pages: {} });
  const all = Object.values(pools).flat();
  const unlinked = [...new Set(all.filter(game => !game.wiki && game.slug && (game.playersCount || game.criticCount)).map(game => game.slug))].filter(slug => refresh || !(slug in wikidata.pages));
  if (!offline && unlinked.length) {
    Object.assign(wikidata.pages, await wikidataPages(unlinked)); wikidata.fetchedAt = new Date().toISOString(); await saveJson(wikidataFile, wikidata);
    console.log(`Wikidata: ${unlinked.length} games checked for a Wikipedia page`);
  }
  for (const game of all) game.wiki ??= wikidata.pages[game.slug] ?? null;
  const pagesFile = path.join(cache, 'wikipedia-boxes.json'), saved = await readJson(pagesFile, { pages: {}, titles: {} });
  const wanted = [...new Set(all.map(game => game.wiki).filter(Boolean))];
  const missing = wanted.filter(title => refresh || !(title in saved.titles));
  if (!offline && missing.length) {
    console.log(`Wikipedia: reading ${missing.length} pages…`);
    const keep = async fetched => { Object.assign(saved.pages, fetched.pages); Object.assign(saved.titles, fetched.titles); saved.fetchedAt = new Date().toISOString(); await saveJson(pagesFile, saved); };
    await keep(await fetchReviews(missing, console.log, keep));
  }
  for (const game of all) if (game.wiki) game.wiki = saved.titles[game.wiki] ?? game.wiki;
  const catalog = await readJson(path.join(root, 'data/catalog.json'), null);
  const igdb = await readJson(path.join(root, 'library/data/igdb.json'), null);
  const pages = Object.fromEntries(Object.entries(saved.pages).map(([title, boxes]) => [title, parseReviews(boxes)]));
  // Steam reviews of PC ports: their Steam apps (IGDB), then one Steam request per 100.
  const appsFile = path.join(cache, 'steam-apps.json'), apps = await readJson(appsFile, { apps: {} });
  const ports = pcPorts(pools);
  const wantApps = ports.filter(id => refresh || !(id in apps.apps));
  if (!offline && wantApps.length) {
    client ??= await (await import('../ranking/igdb-client.mjs')).igdbClient();
    Object.assign(apps.apps, await steamApps(client, wantApps)); apps.fetchedAt = new Date().toISOString(); await saveJson(appsFile, apps);
    console.log(`IGDB: Steam apps for ${wantApps.length} PC ports`);
  }
  const reviewsFile = path.join(cache, 'steam-reviews.json'), steamReviews = await readJson(reviewsFile, { apps: {} });
  const portApps = [...new Set(ports.map(id => apps.apps[id]?.[0]).filter(Boolean))];
  if (!offline && portApps.length && (refresh || !fresh(steamReviews) || portApps.some(appid => !(appid in steamReviews.apps)))) {
    const items = await storeItems(portApps);
    for (const appid of portApps) { const found = items.get(appid)?.reviews; steamReviews.apps[appid] = found ? { count: found.count, percent: found.percPositive } : null; }
    steamReviews.fetchedAt = new Date().toISOString(); await saveJson(reviewsFile, steamReviews);
    console.log(`Steam: reviews for ${portApps.length} PC ports`);
  }
  const steam = steamForPorts(ports, apps, steamReviews);
  const lists = buildLists({ pools, pages, catalog, links: igdb?.links?.catalog ?? null, steam, previous: await readJson(path.join(root, LISTS_FILE), null) });
  lists.legacy = legacyYears({ pools, catalog, links: igdb?.links?.catalog ?? null });
  const wantListApps = [...new Set(lists.games.filter(game => STEAM_SYSTEMS.has(game.systemId)).map(game => game.igdb.id))].filter(id => refresh || !(id in apps.apps));
  if (!offline && wantListApps.length) {
    client ??= await (await import('../ranking/igdb-client.mjs')).igdbClient();
    Object.assign(apps.apps, await steamApps(client, wantListApps)); apps.fetchedAt = new Date().toISOString(); await saveJson(appsFile, apps);
    console.log(`IGDB: Steam apps for ${wantListApps.length} list games`);
  }
  for (const game of lists.games) if (STEAM_SYSTEMS.has(game.systemId) && apps.apps[game.igdb.id]?.length) game.steam = apps.apps[game.igdb.id][0];
  // Camera, series and versions of list games, then the lists again with them.
  const extrasFile = path.join(cache, 'igdb-extras.json'), extras = await readJson(extrasFile, { games: {} });
  const wantExtras = [...new Set(lists.games.map(game => game.igdb.id))].filter(id => refresh || !(id in extras.games) || extras.games[id] && !('tags' in extras.games[id]));
  if (!offline && wantExtras.length) {
    client ??= await (await import('../ranking/igdb-client.mjs')).igdbClient();
    Object.assign(extras.games, await listExtras(client, wantExtras)); extras.fetchedAt = new Date().toISOString(); await saveJson(extrasFile, extras);
    console.log(`IGDB: series, camera and versions for ${wantExtras.length} list games`);
  }
  const byId = new Map(Object.values(pools).flat().map(game => [game.id, game]));
  extras.parents ??= {};
  const lookup = id => byId.get(id) ?? extras.parents[id] ?? null;
  // Ancestors outside the pools, a level at a time.
  for (let level = 0; level < 4; level++) {
    const wanted = new Set();
    for (const entry of lists.games) { let link = byId.get(entry.igdb.id), steps = 0; while (link?.parent && SAME_GAME_TYPES.has(link.type) && steps++ < 6) { if (!lookup(link.parent) && !(link.parent in extras.parents)) wanted.add(link.parent); link = lookup(link.parent); } }
    if (offline || !wanted.size) break;
    client ??= await (await import('../ranking/igdb-client.mjs')).igdbClient();
    Object.assign(extras.parents, await igdbParents(client, [...wanted])); await saveJson(extrasFile, extras);
    console.log(`IGDB: parents of ${wanted.size} versions`);
  }
  for (const game of lists.games) { const pool = byId.get(game.igdb.id) ?? game.igdb; game.igdb = entryIgdb(pool, extras.games[game.igdb.id], originOf(pool, lookup)); }
  // Descriptions for the spotlight view: fetched once per page, then cached.
  const extractsFile = path.join(cache, 'wikipedia-extracts.json'), extracts = await readJson(extractsFile, { pages: {} });
  const wantedPages = [...new Set(Object.values(atlasDetails({ lists, pools, extracts: new Proxy({}, { get: (_, page) => typeof page === 'string' ? page : undefined }) })).map(detail => detail.page).filter(Boolean))];
  const missingPages = wantedPages.filter(page => refresh || !(page in extracts.pages));
  if (!offline && missingPages.length) {
    console.log(`Wikipedia: reading ${missingPages.length} descriptions…`);
    Object.assign(extracts.pages, await fetchExtracts(missingPages, console.log)); extracts.fetchedAt = new Date().toISOString(); await saveJson(extractsFile, extracts);
  }
  const details = atlasDetails({ lists, pools, extracts: extracts.pages });
  await writeFile(path.join(root, DETAILS_FILE), `${JSON.stringify({ schemaVersion: 1, source: 'Descriptions: English Wikipedia (CC BY-SA 4.0). Screenshots: IGDB.', games: details })}\n`);
  const file = path.join(root, LISTS_FILE);
  await writeFile(`${file}.tmp`, `${JSON.stringify(lists, null, 1)}\n`); await rename(`${file}.tmp`, file);
  console.table(lists.systems);
  console.log(`${lists.games.length} games on ${lists.systems.filter(system => system.listed).length} review-backed lists.`);
  // Game Atlas reads the catalog: rebuild it with the new lists.
  execFileSync(process.execPath, [path.join(root, 'scripts/build-catalog.mjs')], { stdio: 'inherit' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

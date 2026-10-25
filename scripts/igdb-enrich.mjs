// Match the owned library, Steam wishlist and retro catalog to IGDB and save
// ratings (with counts), Steam app ids and time-to-beat in library/data/igdb.json.
//
//   npm run igdb:refresh                     all collections, resumes where it stopped
//   npm run igdb:refresh -- --only catalog   one of owned | wishlist | catalog
//   npm run igdb:refresh -- --limit 20       at most 20 new matches per collection (trial)
//   npm run igdb:refresh -- --retry-unmatched   search again for games without a usable match
//   npm run igdb:refresh -- --recheck           redo medium/low matches after rule changes
//   npm run igdb:refresh -- --details        refresh details (scores, series, similar games) of matched games
//   npm run igdb:refresh -- --status         offline summary
//
// Credentials: IGDB_CLIENT_ID and IGDB_CLIENT_SECRET in the environment. The access
// token is cached outside the project, shared with library/tools/igdb_genres.py.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseData, readOwnedGroups } from './snapshot.mjs';
import { readOverrides, saveOverride } from './igdb-overrides.mjs';
import { igdbClient } from '../ranking/igdb-client.mjs';
import { SYSTEM_PLATFORMS, playnitePlatforms, pickCandidate, compactGame, baseTitle, normalizeTitle } from '../ranking/igdb-match.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(root, 'library/data/igdb.json');
const FIELDS = 'name,game_type,first_release_date,platforms,url,rating,rating_count,aggregated_rating,aggregated_rating_count,version_parent,alternative_names.name,external_games.uid,external_games.external_game_source,collections,franchise,franchises,similar_games,genres,themes,player_perspectives,cover.image_id,summary';
const USABLE = new Set(['high', 'medium']);

const args = process.argv.slice(2), flag = name => args.includes(`--${name}`);
const option = name => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : null; };
const only = option('only'), limit = Number(option('limit') ?? Infinity);
if (only && !['owned', 'wishlist', 'catalog'].includes(only)) throw new Error('--only must be owned, wishlist or catalog');

// ---------- state ----------
async function loadState() {
  if (!existsSync(OUT)) return { schemaVersion: 1, updatedAt: null, games: {}, ttb: {}, links: { owned: {}, wishlist: {}, catalog: {} } };
  const state = JSON.parse(await readFile(OUT, 'utf8'));
  if (state.schemaVersion !== 1) throw new Error('Unsupported igdb.json version');
  return state;
}
async function save(state) {
  state.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(`${OUT}.tmp`, JSON.stringify(state)); await rename(`${OUT}.tmp`, OUT);
}
function summary(state) {
  const rows = {};
  for (const [collection, links] of Object.entries(state.links)) {
    const counts = { total: 0, high: 0, medium: 0, low: 0, none: 0, rated: 0, timed: 0 };
    for (const link of Object.values(links)) {
      counts.total++; counts[link.confidence]++;
      const game = USABLE.has(link.confidence) && state.games[link.igdbId];
      if (game && (game.playersCount || game.criticCount)) counts.rated++;
      if (game && state.ttb[game.id]) counts.timed++;
    }
    rows[collection] = counts;
  }
  return rows;
}

// ---------- IGDB client ----------
let client;
const igdb = (endpoint, body) => client.query(endpoint, body);
const quoted = value => `"${String(value).replace(/["\\]/g, ' ')}"`;
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

async function fetchGames(state, ids) {
  const missing = [...new Set(ids)].filter(id => id && !state.games[id]);
  const found = [];
  for (const batch of chunks(missing, 500)) {
    for (const game of await igdb('games', `fields ${FIELDS}; where id = (${batch.join(',')}); limit 500;`)) {
      state.games[game.id] = compactGame(game); found.push(game);
    }
  }
  return found;
}

// Search IGDB for one wanted game; platform-scoped first, then wider, then the base title.
async function search(state, want) {
  const attempts = [[want.title, want.platforms], [want.title, []]];
  if (baseTitle(want.title) !== want.title) attempts.push([baseTitle(want.title), want.platforms]);
  let best = null;
  for (const [title, platforms] of attempts) {
    if (!normalizeTitle(title)) continue;
    const where = platforms.length ? ` where platforms = (${platforms.join(',')});` : '';
    const games = await igdb('games', `fields ${FIELDS}; search ${quoted(title)};${where} limit 15;`);
    const pick = pickCandidate(want, games);
    if (pick && (!best || pick.score > best.score)) {
      best = pick; state.games[pick.id] = compactGame(games.find(game => game.id === pick.id));
    }
    if (best?.confidence === 'high') break;
  }
  return best;
}

// ---------- collections ----------
async function readWindowData(name, key) {
  return parseData(await readFile(path.join(root, 'library/data', name), 'utf8'), key)[key];
}
async function wants() {
  const owned = await readOwnedGroups(root);
  const wishlist = await readWindowData('wishlist-data.js', 'STEAM_WISHLIST');
  const catalog = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
  return {
    // Playnite's Game Id gives Steam copies their app id: matched by it first, and it vetoes a same-named other game.
    owned: owned.flatMap(group => group.copies.map(copy => ({ key: copy.id, title: copy.name ?? group.name, year: copy.year ?? group.year ?? null, platforms: playnitePlatforms(copy.platforms), steam: copy.steamAppId ? String(copy.steamAppId) : null }))),
    wishlist: wishlist.map(item => ({ key: String(item.appid), steam: String(item.appid), title: item.title, year: item.year ?? null, platforms: [6] })),
    catalog: catalog.games.map(game => ({ key: game.id, title: game.title, aliases: game.aliases ?? [], year: game.year ?? null, platforms: SYSTEM_PLATFORMS[game.systemId] ?? [] })),
  };
}
// A link is redone when the game's title/year/platforms (or Steam app) change in a new import.
const fingerprint = want => JSON.stringify(want.steam ? [want.title, want.year, want.platforms, want.steam] : [want.title, want.year, want.platforms]);
let overrides = { overrides: {} };
const needsWork = (state, collection, want) => {
  // Games you corrected by hand are never re-matched automatically.
  if (overrides.overrides[`${collection}:${want.key}`]) return false;
  const link = state.links[collection][want.key];
  return !link || link.fingerprint !== fingerprint(want) || (flag('retry-unmatched') && !USABLE.has(link.confidence)) ||
    (flag('recheck') && ['medium', 'low'].includes(link.confidence));
};
const link = (want, pick, method) => ({ igdbId: pick?.id ?? null, confidence: pick?.confidence ?? 'none', method, fingerprint: fingerprint(want) });

// Games with a Steam app id: IGDB's own Steam links, no title search needed.
async function matchBySteam(state, collection, all) {
  const byUid = new Map(), items = all.filter(item => item.steam);
  for (const batch of chunks([...new Set(items.map(item => item.steam))], 400)) {
    for (const row of await igdb('external_games', `fields game,uid; where external_game_source = 1 & uid = (${batch.map(quoted).join(',')}); limit 500;`)) byUid.set(row.uid, row.game);
  }
  await fetchGames(state, [...byUid.values()]);
  for (const item of items) {
    const id = byUid.get(item.steam);
    if (id && state.games[id]) state.links[collection][item.key] = { igdbId: id, confidence: 'high', method: 'steam-id', fingerprint: fingerprint(item) };
  }
}

// Earlier genre runs matched owned titles by name; re-check those ids with today's rules.
async function seedOwnedFromGenreCache(state, items) {
  const file = path.join(root, 'library/data/cache/igdb-genres.jsonl');
  if (!existsSync(file)) return;
  const byName = new Map((await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(row => row.igdbId).map(row => [row.name, row.igdbId]));
  const seeded = items.filter(item => byName.has(item.title));
  const games = new Map((await fetchGamesRaw(seeded.map(item => byName.get(item.title)))).map(game => [game.id, game]));
  for (const item of seeded) {
    const game = games.get(byName.get(item.title)), pick = game && pickCandidate(item, [game]);
    // Only confident exact matches are reused; anything else gets a fresh search.
    if (pick?.confidence === 'high') { state.games[game.id] = compactGame(game); state.links.owned[item.key] = link(item, pick, 'genre-cache'); }
  }
}
async function fetchGamesRaw(ids) {
  const out = [];
  for (const batch of chunks([...new Set(ids)], 500)) out.push(...await igdb('games', `fields ${FIELDS}; where id = (${batch.join(',')}); limit 500;`));
  return out;
}

async function searchAll(state, collection, items) {
  // Identical wants (same title/year/platforms, e.g. one game in two stores) share one search.
  const groups = new Map();
  for (const item of items) { const key = fingerprint(item); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
  let done = 0; const total = groups.size, started = Date.now();
  for (const members of groups.values()) {
    const want = members[0];
    let pick = await search(state, want);
    for (const alias of want.aliases ?? []) {
      if (pick?.confidence === 'high') break;
      const other = await search(state, { ...want, title: alias });
      if (other && (!pick || other.score > pick.score)) pick = other;
    }
    for (const member of members) state.links[collection][member.key] = link(member, pick, 'search');
    if (++done % 25 === 0 || done === total) {
      await save(state);
      const rate = done / ((Date.now() - started) / 1000);
      process.stdout.write(`\r  ${collection}: ${done}/${total} searched · ~${Math.ceil((total - done) / Math.max(rate, 0.1) / 60)} min left   `);
    }
  }
  if (total) process.stdout.write('\n');
}

async function fetchTimes(state, extra = []) {
  const ids = [...new Set([...Object.values(state.links).flatMap(links => Object.values(links)).filter(item => USABLE.has(item.confidence)).map(item => item.igdbId), ...extra])]
    .filter(id => !(id in state.ttb));
  for (const batch of chunks(ids, 500)) {
    const rows = await igdb('game_time_to_beats', `fields game_id,hastily,normally,completely,count; where game_id = (${batch.join(',')}); limit 500;`);
    const byGame = new Map(rows.map(row => [row.game_id, row]));
    for (const id of batch) {
      const row = byGame.get(id);
      state.ttb[id] = row ? { main: row.hastily ?? null, extra: row.normally ?? null, complete: row.completely ?? null, count: row.count ?? 0 } : null;
    }
  }
}

// ---------- main ----------
const state = await loadState();
overrides = await readOverrides(root);
if (flag('status')) { console.log(JSON.stringify({ updatedAt: state.updatedAt, ...summary(state) }, null, 2)); process.exit(0); }
client = await igdbClient();
process.on('SIGINT', async () => { await save(state); console.log('\nStopped; progress saved. Run the same command to resume.'); process.exit(130); });

// Refresh the details of every stored game (scores, series, similar games) in large batches.
if (flag('details')) {
  const ids = Object.keys(state.games).map(Number);
  let done = 0;
  for (const batch of chunks(ids, 500)) {
    for (const game of await igdb('games', `fields ${FIELDS}; where id = (${batch.join(',')}); limit 500;`)) state.games[game.id] = compactGame(game);
    done += batch.length; process.stdout.write(`\r  details: ${done}/${ids.length}   `);
  }
  process.stdout.write('\n'); await save(state);
}
const all = await wants();
for (const collection of ['wishlist', 'owned', 'catalog']) {
  if (only && only !== collection) continue;
  let pending = all[collection].filter(want => needsWork(state, collection, want));
  console.log(`${collection}: ${all[collection].length} games, ${pending.length} to match`);
  if (collection !== 'catalog' && pending.length) {
    await matchBySteam(state, collection, pending.slice(0, limit));
    pending = pending.filter(want => needsWork(state, collection, want));
  }
  if (collection === 'owned' && pending.length) {
    await seedOwnedFromGenreCache(state, pending);
    pending = pending.filter(want => needsWork(state, collection, want));
  }
  await save(state);
  await searchAll(state, collection, pending.slice(0, limit));
}
// Games you picked by hand: resolve pasted page links (slugs) to ids, then fetch their data.
const pendingSlugs = Object.entries(overrides.overrides).filter(([, item]) => item.decision === 'replaced' && !item.igdbId && item.slug);
if (pendingSlugs.length) {
  const bySlug = new Map((await igdb('games', `fields id,slug; where slug = (${pendingSlugs.map(([, item]) => quoted(item.slug)).join(',')}); limit 500;`)).map(game => [game.slug, game.id]));
  for (const [id, item] of pendingSlugs) {
    const split = id.indexOf(':');
    if (bySlug.has(item.slug)) await saveOverride(root, { collection: id.slice(0, split), key: id.slice(split + 1), decision: 'replaced', igdbId: bySlug.get(item.slug), slug: item.slug });
    else console.log(`No IGDB game found for “${item.slug}” — check the link you pasted.`);
  }
  overrides = await readOverrides(root);
}
const manualIds = Object.values(overrides.overrides).filter(item => item.decision === 'replaced' && item.igdbId).map(item => item.igdbId);
await fetchGames(state, manualIds);
await fetchGames(state, Object.values(state.games).map(game => game.versionParent).filter(Boolean));
await fetchTimes(state, manualIds);
await save(state);
console.log(`Done after ${client.requests} IGDB requests.`);
console.table(summary(state));

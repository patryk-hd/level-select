// The Mods section's data (data/mods.json): the best mods and ROM hacks of all time, ranked by
// how many respected sources pick them (data/mods-research.json, recorded by hand), with IGDB
// details (cover, year, base game, links, description), Wikipedia coverage from Wikidata, and
// each popular game's essential mods (most endorsed on Nexus Mods; Minecraft's most followed
// on Modrinth).
//
//   npm run mods:lists               fetch what's missing, rebuild data/mods.json
//   npm run mods:lists -- --offline  rebuild from the cache only
//   npm run mods:lists -- --refresh  fetch everything again
//
// IGDB needs your keys (Import games → Scores, or IGDB_CLIENT_ID / IGDB_CLIENT_SECRET). The
// cache holds public data only and stays out of Git: library/data/cache/mods/.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { igdbClient } from '../ranking/igdb-client.mjs';
import { consensus, rankMods, pickIgdbMod, modLinks } from '../ranking/mods.js';
import { titleKey } from '../library/core.js';
import { scoreKeys } from './sources.mjs';
import { systemName } from './manual-games.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const MODS_FILE = 'data/mods.json';
const RESEARCH = 'data/mods-research.json', CACHE = 'library/data/cache/mods';
const UA = { 'User-Agent': 'LevelSelect/1.0 (personal game library; mods list)' };
const args = process.argv.slice(2), offline = args.includes('--offline'), refresh = args.includes('--refresh');

const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(path.join(root, file), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };
async function writeJson(file, value, pretty = false) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(`${target}.tmp`, `${JSON.stringify(value, null, pretty ? 1 : 0)}\n`); await rename(`${target}.tmp`, target);
}
const modKey = mod => `${titleKey(mod.name)}|${mod.system}`;
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

// ---------- IGDB: which entry is each mod ----------
const FIELDS = 'name,slug,url,game_type,first_release_date,summary,total_rating,total_rating_count,cover.image_id,parent_game.id,parent_game.name,alternative_names.name,websites.url,websites.type';
const quoted = value => `"${String(value).replace(/["\\]/g, ' ')}"`;
async function matchIgdb(mods, cache) {
  const missing = mods.filter(mod => refresh || !(modKey(mod) in cache.igdb));
  if (!missing.length) return;
  if (offline) { console.log(`IGDB: ${missing.length} mods not cached (offline).`); return; }
  const keys = (await scoreKeys(root)).igdb;
  if (!keys) throw new Error('IGDB keys are needed (Import games → Scores, or IGDB_CLIENT_ID and IGDB_CLIENT_SECRET).');
  const client = await igdbClient(keys);
  let done = 0;
  for (const mod of missing) {
    let pick = null;
    if (mod.igdb) pick = (await client.query('games', `fields ${FIELDS}; where slug = ${quoted(mod.igdb)}; limit 1;`))[0] ?? null;
    if (!pick) pick = pickIgdbMod(mod, await client.query('games', `fields ${FIELDS}; search ${quoted(mod.name)}; limit 15;`));
    cache.igdb[modKey(mod)] = pick;
    if (++done % 20 === 0) { process.stdout.write(`\r  IGDB: ${done}/${missing.length}   `); await writeJson(`${CACHE}/igdb.json`, cache.igdb); }
  }
  process.stdout.write('\n'); await writeJson(`${CACHE}/igdb.json`, cache.igdb);
}

// ---------- Wikidata: how many Wikipedias cover each mod ----------
async function sparql(query) {
  const response = await fetch('https://query.wikidata.org/sparql', { method: 'POST', body: new URLSearchParams({ query }),
    headers: { ...UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!response.ok) throw new Error(`Wikidata returned HTTP ${response.status}. Try again in a minute.`);
  return (await response.json()).results.bindings;
}
async function matchWikidata(slugs, cache) {
  const missing = slugs.filter(slug => refresh || !(slug in cache.wikidata));
  if (!missing.length || offline) return;
  for (const batch of chunks(missing, 100)) {
    for (const slug of batch) cache.wikidata[slug] = null;
    const rows = await sparql(`SELECT ?slug ?links ?article WHERE { VALUES ?slug { ${batch.map(quoted).join(' ')} } ?item wdt:P5794 ?slug; wikibase:sitelinks ?links.
      OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/> } }`);
    for (const row of rows) cache.wikidata[row.slug.value] = { languages: Number(row.links.value), article: row.article?.value ?? null };
  }
  await writeJson(`${CACHE}/wikidata.json`, cache.wikidata);
}

// ---------- Essentials: each popular game's most endorsed mods ----------
// Nexus Mods' most downloaded games (its own site tools left out), with titles as your library
// names them where Nexus shortens them.
const NEXUS_GAMES = 24, PER_GAME = 10;
const LIBRARY_NAMES = { skyrimspecialedition: 'The Elder Scrolls V: Skyrim Special Edition', skyrim: 'The Elder Scrolls V: Skyrim', oblivion: 'The Elder Scrolls IV: Oblivion',
  morrowind: 'The Elder Scrolls III: Morrowind', oblivionremastered: 'The Elder Scrolls IV: Oblivion Remastered', newvegas: 'Fallout: New Vegas' };
async function nexus(query) {
  const response = await fetch('https://api.nexusmods.com/v2/graphql', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors) throw new Error(`Nexus Mods: ${body.errors?.[0]?.message ?? `HTTP ${response.status}`}`);
  return body.data;
}
async function fetchEssentials(cache) {
  if (offline || (!refresh && cache.essentials)) return cache.essentials;
  const games = (await nexus(`{ games(count: ${NEXUS_GAMES + 4}, sort: [{ downloads: { direction: DESC } }]) { nodes { name domainName } } }`)).games.nodes
    .filter(game => game.domainName !== 'site').slice(0, NEXUS_GAMES);
  const result = [];
  for (const game of games) {
    const mods = (await nexus(`{ mods(filter: { gameDomainName: [{ value: ${JSON.stringify(game.domainName)} }] }, sort: [{ endorsements: { direction: DESC } }], count: ${PER_GAME + 5}) {
      nodes { name modId endorsements downloads createdAt adultContent modCategory { name } } } }`)).mods.nodes;
    result.push({ id: game.domainName, name: game.name, libraryName: LIBRARY_NAMES[game.domainName] ?? game.name, source: 'nexus', url: `https://www.nexusmods.com/${game.domainName}`,
      mods: mods.filter(mod => !mod.adultContent).slice(0, PER_GAME).map(mod => ({ name: mod.name, url: `https://www.nexusmods.com/${game.domainName}/mods/${mod.modId}`,
        votes: mod.endorsements, downloads: mod.downloads, category: mod.modCategory?.name ?? null, year: mod.createdAt ? Number(mod.createdAt.slice(0, 4)) : null })) });
  }
  // Minecraft's mods live on Modrinth. Followers, not downloads: libraries other mods need
  // are downloaded with them.
  const facets = encodeURIComponent(JSON.stringify([['project_type:mod']]));
  const response = await fetch(`https://api.modrinth.com/v2/search?index=follows&limit=25&facets=${facets}`, { headers: UA });
  if (!response.ok) throw new Error(`Modrinth returned HTTP ${response.status}.`);
  const hits = (await response.json()).hits.filter(hit => !hit.categories.includes('library')).slice(0, PER_GAME);
  const LOADERS = new Set(['fabric', 'forge', 'neoforge', 'quilt', 'babric', 'liteloader', 'rift', 'modloader']);
  result.splice(Math.min(3, result.length), 0, { id: 'minecraft', name: 'Minecraft', libraryName: 'Minecraft', source: 'modrinth', url: 'https://modrinth.com/mods',
    mods: hits.map(hit => ({ name: hit.title, url: `https://modrinth.com/mod/${hit.slug}`, votes: hit.follows, downloads: hit.downloads,
      category: hit.categories.find(category => !LOADERS.has(category)) ?? null, year: hit.date_created ? Number(hit.date_created.slice(0, 4)) : null })) });
  cache.essentials = { fetchedAt: new Date().toISOString(), games: result };
  await writeJson(`${CACHE}/essentials.json`, cache.essentials);
  return cache.essentials;
}

// ---------- the list ----------
const COVER = id => `https://images.igdb.com/igdb/image/upload/t_cover_big/${id}.jpg`;
const yearOf = unix => unix ? new Date(unix * 1000).getUTCFullYear() : null;
export function buildMods(research, { igdb = {}, wikidata = {}, catalog = null, essentials = null, generatedAt = new Date().toISOString() } = {}) {
  const mods = research.mods.map(mod => {
    const found = igdb[modKey(mod)] ?? null, wiki = found?.slug ? wikidata[found.slug] ?? null : null;
    const links = found ? modLinks(found.websites) : [];
    if (wiki?.article && !links.some(link => link.label === 'Wikipedia')) links.push({ label: 'Wikipedia', url: wiki.article });
    return {
      id: titleKey(mod.name).replace(/\s+/g, '-').slice(0, 80) + (mod.system === 'pc' ? '' : `-${mod.system}`), name: mod.name, game: mod.game ?? found?.parent_game?.name ?? null,
      gameIgdbId: found?.parent_game?.id ?? null, system: mod.system, year: mod.year ?? yearOf(found?.first_release_date), kinds: mod.kinds, became: mod.became ?? null,
      picks: mod.picks, consensus: consensus(mod.picks, research.sources), notability: wiki?.languages ?? 0,
      igdb: found ? { id: found.id, url: found.url, rating: found.total_rating ? Math.round(found.total_rating) : null, ratingCount: found.total_rating_count ?? 0 } : null,
      cover: found?.cover?.image_id ? COVER(found.cover.image_id) : null, summary: found?.summary ? String(found.summary).slice(0, 700) : '', links,
    };
  });
  const ranked = rankMods(mods);
  const counts = new Map();
  for (const mod of ranked) counts.set(mod.system, (counts.get(mod.system) ?? 0) + 1);
  // PC first, then consoles in the Game Atlas's order.
  const order = ['pc', ...(catalog?.systems ?? []).map(system => system.id)];
  const systems = [...counts.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 999) - (order.indexOf(b[0]) + 1 || 999))
    .map(([id, count]) => ({ id, name: id === 'pc' ? 'PC' : systemName(id, catalog) ?? id.toUpperCase(), short: id === 'pc' ? 'PC' : catalog?.systems?.find(system => system.id === id)?.name ?? id.toUpperCase(), count }));
  const used = new Set(mods.flatMap(mod => Object.keys(mod.picks)));
  return {
    schemaVersion: 1, generatedAt, checked: research.checked,
    method: 'Ranked by how many respected sources pick each mod (a supporting source counts half), then by how many Wikipedias cover it, how many IGDB players rated it, and its position in ranked lists.',
    kinds: research.kinds, systems, sources: research.sources.filter(source => used.has(source.id)).map(source => ({ ...source, count: mods.filter(mod => source.id in mod.picks).length })),
    // A game whose most endorsed mods are mostly adult ones has too few left to show.
    mods: ranked, essentials: essentials && { ...essentials, games: essentials.games.filter(game => game.mods.length >= 8) },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const research = await readJson(RESEARCH);
  const cache = { igdb: await readJson(`${CACHE}/igdb.json`, {}), wikidata: await readJson(`${CACHE}/wikidata.json`, {}), essentials: await readJson(`${CACHE}/essentials.json`, null) };
  await matchIgdb(research.mods, cache);
  await matchWikidata([...new Set(research.mods.map(mod => cache.igdb[modKey(mod)]?.slug).filter(Boolean))], cache);
  const essentials = await fetchEssentials(cache);
  const data = buildMods(research, { ...cache, essentials, catalog: await readJson('data/catalog.json') });
  await writeJson(MODS_FILE, data);
  const matched = data.mods.filter(mod => mod.igdb).length;
  console.log(`${data.mods.length} mods from ${data.sources.length} sources · ${matched} matched on IGDB · ${data.systems.map(system => `${system.name} ${system.count}`).join(', ')} · essentials for ${data.essentials?.games.length ?? 0} games`);
}

// Game awards from Wikidata (CC0): Game of the Year and category wins at the major
// ceremonies, plus Game of the Year nominations, attached to your library, wishlist and Game
// Atlas by Steam app, IGDB game or exact title and year.
// data/awards.json ships with the project. Update data's weekly refresh saves yours in
// library/data/awards.json (private, never committed), so it doesn't change the project's
// files; your library uses whichever is newer, while public builds use the shipped one.
//
//   npm run awards:refresh                 your refresh (library/data/awards.json)
//   npm run awards:refresh -- --shared     the shipped file (data/awards.json), to commit
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { titleKey } from '../library/core.js';

export const AWARDS_FILE = 'data/awards.json', LOCAL_AWARDS_FILE = 'library/data/awards.json';
// The ceremonies whose awards count. Spike VGAs ran before The Game Awards (2003–2013).
export const CEREMONIES = {
  Q18642757: 'The Game Awards', Q546692: 'BAFTA Games Awards', Q1665849: 'D.I.C.E. Awards', Q1493055: 'Game Developers Choice Awards',
  Q2627776: 'Golden Joystick Awards', Q609310: 'Spike Video Game Awards', Q6156638: 'Japan Game Awards',
};
// Games and things that are games (expansions, compilations, reboots); not people or studios.
const GAME_TYPES = ['Q7889', 'Q209163', 'Q16070115', 'Q111223304', 'Q116774927', 'Q1066707', 'Q64170203', 'Q65963104'];
// Overall best-game awards; every other win is a category win.
const TOP_AWARD = /^(?:game of the year|best game|ultimate game of the year|grand award|game of the year grand award)$/i;
// Hype, people and business awards say nothing about how good a game is.
const NOT_ABOUT_QUALITY = /anticipated|most wanted|content creator|studio of the year|developer of the year|publisher of the year|esports|streamer|hardware|adaptation|trailer|global gaming citizen|coach|athlete|host\b|\bevent\b|personality|creator of the year/i;
const PREFIX = /^(?:the game awards|british academy games awards?|bafta games awards?|d\.i\.c\.e\.? awards?|game developers choice awards?|golden joystick awards?|spike video game awards?|japan game awards?)\s*(?:[-−–:]|for)?\s*/i;

const yearOf = value => { const match = /^(\d{4})/.exec(value ?? ''); return match ? Number(match[1]) : null; };
const idOf = uri => String(uri ?? '').split('/').pop();

// SPARQL rows → { games: [{ id, title, year, steam, igdb, awards }] }, one entry per game.
export function parseAwards(rows) {
  const games = new Map();
  for (const row of rows) {
    const value = key => row[key]?.value ?? '';
    const ceremony = CEREMONIES[idOf(value('ceremony'))], name = value('awardLabel').replace(PREFIX, '').trim();
    if (!ceremony || !name || NOT_ABOUT_QUALITY.test(name) || !value('gameLabel') || /^Q\d+$/.test(value('gameLabel'))) continue;
    const won = value('kind') === 'won', top = TOP_AWARD.test(name);
    // A nomination only means something for the top award.
    if (!won && !top) continue;
    const id = idOf(value('game'));
    if (!games.has(id)) games.set(id, { id, title: value('gameLabel'), year: yearOf(value('released')), steam: [], igdb: [], awards: [] });
    const game = games.get(id);
    game.steam = [...new Set([...game.steam, ...value('steams').split(',').filter(uid => /^\d+$/.test(uid))])];
    game.igdb = [...new Set([...game.igdb, ...value('igdbs').split(',').filter(Boolean)])];
    const award = { ceremony, name, year: yearOf(value('time')), won, goty: top };
    if (!game.awards.some(other => other.ceremony === award.ceremony && other.name === award.name && other.year === award.year && other.won === award.won)) game.awards.push(award);
  }
  // A win replaces the nomination for the same award.
  for (const game of games.values()) {
    game.awards = game.awards.filter(award => award.won || !game.awards.some(other => other.won && other.ceremony === award.ceremony && other.name === award.name && other.year === award.year))
      .sort((a, b) => Number(b.won) - Number(a.won) || Number(b.goty) - Number(a.goty) || (b.year ?? 0) - (a.year ?? 0) || a.ceremony.localeCompare(b.ceremony) || a.name.localeCompare(b.name));
  }
  return [...games.values()].filter(game => game.awards.length).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

// Three small queries rather than one big one, which the public endpoint times out on or
// answers incompletely: the award categories, who won or was nominated, then the games.
const sparql = async (fetch, query) => {
  const response = await fetch('https://query.wikidata.org/sparql', {
    method: 'POST', body: new URLSearchParams({ query }),
    headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'RetroLibrary/0.1 (personal game library; awards refresh)' },
  });
  if (!response.ok) throw new Error(`Wikidata returned HTTP ${response.status}. Try again in a minute.`);
  return (await response.json()).results.bindings;
};
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
const values = ids => ids.map(id => `wd:${id}`).join(' ');

export async function fetchAwards({ fetch = globalThis.fetch } = {}) {
  const awards = new Map((await sparql(fetch, `SELECT ?award ?awardLabel ?ceremony WHERE {
    VALUES ?ceremony { ${values(Object.keys(CEREMONIES))} } ?award wdt:P361 ?ceremony .
    ?award rdfs:label ?awardLabel . FILTER(LANG(?awardLabel) IN ("en", "mul")) }`)).sort((a, b) => a.awardLabel['xml:lang'].localeCompare(b.awardLabel['xml:lang']))
    .map(row => [idOf(row.award.value), { label: row.awardLabel.value, ceremony: idOf(row.ceremony.value) }]).reverse());
  const statements = [];
  for (const batch of chunks([...awards.keys()], 40)) {
    statements.push(...await sparql(fetch, `SELECT ?game ?award ?kind ?time WHERE { VALUES ?award { ${values(batch)} }
      { ?game p:P166 ?st . ?st ps:P166 ?award . BIND("won" AS ?kind) } UNION { ?game p:P1411 ?st . ?st ps:P1411 ?award . BIND("nominated" AS ?kind) }
      OPTIONAL { ?st pq:P585 ?time } }`));
  }
  const games = new Map();
  for (const batch of chunks([...new Set(statements.map(row => idOf(row.game.value)))], 150)) {
    for (const row of await sparql(fetch, `SELECT ?game ?gameLabel ?type ?steam ?igdb ?date WHERE { VALUES ?game { ${values(batch)} }
      OPTIONAL { ?game rdfs:label ?gameLabel . FILTER(LANG(?gameLabel) IN ("en", "mul")) } OPTIONAL { ?game wdt:P31 ?type }
      OPTIONAL { ?game wdt:P1733 ?steam } OPTIONAL { ?game wdt:P5794 ?igdb } OPTIONAL { ?game wdt:P577 ?date } }`)) {
      const id = idOf(row.game.value), game = games.get(id) ?? { label: '', types: new Set(), steam: new Set(), igdb: new Set(), dates: new Set() };
      // Many items now carry their name only as a language-neutral ("mul") label; English wins.
      if (row.gameLabel && (!game.label || row.gameLabel['xml:lang'] === 'en')) game.label = row.gameLabel.value;
      if (row.type) game.types.add(idOf(row.type.value));
      if (row.steam) game.steam.add(row.steam.value);
      if (row.igdb) game.igdb.add(row.igdb.value);
      if (row.date) game.dates.add(row.date.value);
      games.set(id, game);
    }
  }
  // Rows in the shape parseAwards reads; people, studios and teams are left out here.
  const rows = statements.flatMap(row => {
    const game = games.get(idOf(row.game.value)), award = awards.get(idOf(row.award.value));
    if (!game || !award || !GAME_TYPES.some(type => game.types.has(type))) return [];
    const text = value => ({ value });
    return [{ game: row.game, gameLabel: text(game.label), awardLabel: text(award.label), ceremony: text(award.ceremony), kind: row.kind, time: row.time,
      steams: text([...game.steam].join(',')), igdbs: text([...game.igdb].join(',')), released: text([...game.dates].sort()[0] ?? '') }];
  });
  return { schemaVersion: 1, source: 'Wikidata', licence: 'CC0 1.0', fetchedAt: new Date().toISOString(), games: parseAwards(rows) };
}

async function readFileAwards(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
// The shipped awards, or (local) the newer of them and your own refresh.
export async function readAwards(root, { local = false } = {}) {
  const shipped = await readFileAwards(path.join(root, AWARDS_FILE));
  if (!local) return shipped;
  const yours = await readFileAwards(path.join(root, LOCAL_AWARDS_FILE));
  const time = data => Date.parse(data?.fetchedAt ?? '') || 0;
  return yours && time(yours) > time(shipped) ? yours : shipped ?? yours;
}

// Lookup by Steam app, IGDB slug, or exact title (a leading "The" kept) within a year.
export function awardIndex(data) {
  const bySteam = new Map(), bySlug = new Map(), byTitle = new Map();
  const add = (map, key, game) => { if (key) map.set(key, [...(map.get(key) ?? []), game]); };
  for (const game of data?.games ?? []) {
    game.steam.forEach(uid => add(bySteam, uid, game)); game.igdb.forEach(slug => add(bySlug, slug, game)); add(byTitle, titleKey(game.title), game);
  }
  return { bySteam, bySlug, byTitle };
}
export const igdbSlug = url => /igdb\.com\/games\/([a-z0-9-]+)/i.exec(url ?? '')?.[1]?.toLowerCase() ?? null;
export function awardsFor(index, { steam = [], slugs = [], title = '', year = null }) {
  const found = [...steam.filter(Boolean).flatMap(uid => index.bySteam.get(String(uid)) ?? []), ...slugs.filter(Boolean).flatMap(slug => index.bySlug.get(slug) ?? [])][0]
    // Same-named games are different games unless they came out within a year of each other.
    ?? (year ? (index.byTitle.get(titleKey(title)) ?? []).find(game => game.year && Math.abs(game.year - year) <= 1) : null);
  return found?.awards ?? [];
}

// Attach awards to owned copies (and their groups), wishlist games and Atlas games.
// `slugsOf(record)` adds an edition's parent game, so a GOTY edition inherits its awards.
export function attachAwards(data, { groups = [], wishlist = [], catalog = null, slugsOf = record => [igdbSlug(record?.url)] } = {}) {
  if (!data?.games?.length) return;
  const index = awardIndex(data);
  for (const group of groups) {
    const all = [];
    for (const copy of group.copies) {
      const awards = awardsFor(index, { steam: [copy.steamAppId, ...(copy.igdb?.steam ?? [])], slugs: slugsOf(copy.igdb), title: copy.name ?? group.name, year: copy.igdb?.year ?? copy.year ?? group.year });
      if (awards.length) { copy.awards = awards; all.push(...awards); } else delete copy.awards;
    }
    const unique = [...new Map(all.map(award => [`${award.ceremony}|${award.name}|${award.year}|${award.won}`, award])).values()];
    if (unique.length) group.awards = unique; else delete group.awards;
  }
  for (const item of wishlist) {
    const awards = awardsFor(index, { steam: [item.appid, ...(item.igdb?.steam ?? [])], slugs: slugsOf(item.igdb), title: item.title, year: item.igdb?.year ?? item.year });
    if (awards.length) item.awards = awards; else delete item.awards;
  }
  for (const game of catalog?.games ?? []) {
    const awards = awardsFor(index, { slugs: slugsOf(game.igdb), title: game.title, year: game.igdb?.year ?? game.year });
    if (awards.length) game.awards = awards; else delete game.awards;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const data = await fetchAwards();
  const file = path.join(root, process.argv.includes('--shared') ? AWARDS_FILE : LOCAL_AWARDS_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(data, null, 1)}\n`); await rename(`${file}.tmp`, file);
  const wins = data.games.flatMap(game => game.awards).filter(award => award.won);
  console.log(`${data.games.length} games with awards: ${wins.filter(award => award.goty).length} Game of the Year wins, ${wins.length - wins.filter(award => award.goty).length} category wins, ${data.games.flatMap(game => game.awards).filter(award => !award.won).length} GOTY nominations.`);
}

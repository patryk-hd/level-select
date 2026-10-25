// Coverage check for Game Atlas lists: which games of a respected reference list (PC Gamer's
// Top 100, Metacritic's best of all time…) are missing from ours, and why. It reads only the
// list cache (run npm run retro:lists first) and sends nothing anywhere.
//
//   node scripts/list-audit.mjs --systems pc,dos --reference my-reference.txt [--json]
//
// The reference file has one game per line: "Title" or "Title|Year". Reference lists belong
// to their publishers: keep them local; only the comparison is printed.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLists, LIST_SYSTEMS, pcPorts, steamForPorts } from './retro-lists.mjs';
import { parseReviews } from '../ranking/critic-reviews.mjs';
import { normalizeTitle, baseTitle } from '../ranking/igdb-match.mjs';

const CACHE = 'library/data/cache/retro-lists';
const REASONS = {
  listed: 'on our list', cut: 'qualifies, but ranks below the top 100', score: 'score at or below 70 (average)',
  thin: 'too few reviews (under 3 critics or 15 players)', 'players-only': 'no critic reviews found, and under 100 player ratings',
  'no-reviews': 'no critic reviews or player ratings found', merged: 'merged with another entry for the same game (port, edition)',
  year: 'released on this system outside the list’s years', unreleased: 'not released yet', type: 'an expansion, DLC or mod, not a game',
  missing: 'not found among this system’s games on IGDB',
};

const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
// Reference lists write numbers either way ("Morrowind 3", "Pillars of Eternity 2"): both count.
const ROMAN = { 2: 'ii', 3: 'iii', 4: 'iv', 5: 'v', 6: 'vi', 7: 'vii', 8: 'viii', 9: 'ix' };
const ARABIC = Object.fromEntries(Object.entries(ROMAN).map(([number, roman]) => [roman, number]));
const numerals = key => [key, key.replace(/\b([2-9])\b/g, (_, n) => ROMAN[n]), key.replace(/\b(ii|iii|iv|vi|vii|viii|ix)\b/g, (_, r) => ARABIC[r])];
const keys = name => [...new Set([name, baseTitle(name)].map(normalizeTitle).flatMap(numerals))];

// Pools, Wikipedia review boxes and the lists, rebuilt offline with reasons recorded.
export async function auditData(root, { rate } = {}) {
  const cache = path.join(root, CACHE), pools = {};
  for (const system of LIST_SYSTEMS) pools[system.id] = (await readJson(path.join(cache, `igdb-${system.id}.json`)).catch(() => ({ games: [] }))).games;
  const wikidata = await readJson(path.join(cache, 'wikidata-pages.json')).catch(() => ({ pages: {} }));
  const boxes = await readJson(path.join(cache, 'wikipedia-boxes.json')).catch(() => ({ pages: {}, titles: {} }));
  for (const game of Object.values(pools).flat()) { game.wiki ??= wikidata.pages[game.slug] ?? null; if (game.wiki) game.wiki = boxes.titles[game.wiki] ?? game.wiki; }
  const pages = Object.fromEntries(Object.entries(boxes.pages).map(([title, box]) => [title, parseReviews(box)]));
  const catalog = await readJson(path.join(root, 'data/catalog.json')).catch(() => null);
  const igdb = await readJson(path.join(root, 'library/data/igdb.json')).catch(() => null);
  const explain = new Map();
  const steam = steamForPorts(pcPorts(pools), await readJson(path.join(cache, 'steam-apps.json')).catch(() => null), await readJson(path.join(cache, 'steam-reviews.json')).catch(() => null));
  const lists = buildLists({ pools, pages, catalog, links: igdb?.links?.catalog ?? null, previous: await readJson(path.join(root, 'data/retro-lists.json')).catch(() => null), explain, steam, ...(rate ? { rate } : {}) });
  return { pools, explain, lists };
}

// Each reference game: the pool game it names (by title, edition suffix dropped, closest
// year), and why it is or isn't on our list.
export function audit({ pools, explain }, systems, reference) {
  return reference.map(({ title, year }) => {
    const want = keys(title), found = [];
    for (const system of systems) for (const game of pools[system] ?? []) {
      const names = [game.name, ...(game.alt ?? [])].flatMap(keys);
      if (want.some(key => names.includes(key))) found.push({ system, game, info: explain.get(`${system}|${game.id}`) ?? { reason: 'type' } });
    }
    const order = ['listed', 'cut', 'merged', 'score', 'thin', 'players-only', 'no-reviews', 'year', 'unreleased', 'type'];
    const gameYear = game => game.first ? new Date(game.first * 1000).getUTCFullYear() : null;
    found.sort((a, b) => (year ? Math.abs((gameYear(a.game) ?? 0) - year) - Math.abs((gameYear(b.game) ?? 0) - year) : 0) || order.indexOf(a.info.reason) - order.indexOf(b.info.reason));
    const best = found[0];
    return best ? { title, year, system: best.system, igdb: best.game.name, ...best.info } : { title, year, reason: 'missing' };
  });
}

async function main() {
  const args = process.argv.slice(2), arg = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
  if (!arg('--systems') || !arg('--reference')) throw new Error('Usage: node scripts/list-audit.mjs --systems pc,dos --reference file.txt [--json]');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const reference = (await readFile(path.resolve(arg('--reference')), 'utf8')).split('\n').map(line => line.trim()).filter(Boolean)
    .map(line => {
      const [raw, year] = line.split('|'), dated = /^(.*?)\s*\((\d{4})\)$/.exec(raw.trim());
      return { title: (dated ? dated[1] : raw).trim(), year: Number(year) || Number(dated?.[2]) || null };
    });
  const results = audit(await auditData(root), arg('--systems').split(','), reference);
  if (args.includes('--json')) { console.log(JSON.stringify(results, null, 1)); return; }
  const counts = {};
  for (const result of results) counts[result.reason] = (counts[result.reason] ?? 0) + 1;
  for (const result of results) if (result.reason !== 'listed') {
    const evidence = result.evidence ? ` · critics ${result.evidence.critics?.count ?? 0}, players ${result.evidence.players?.count ?? 0}` : '';
    console.log(`${result.title}${result.year ? ` (${result.year})` : ''} → ${result.system ?? '—'}: ${REASONS[result.reason]}${result.score != null ? ` · score ${result.score}` : ''}${result.rank ? ` · #${result.rank}` : ''}${evidence}`);
  }
  console.log(`\n${results.length} reference games: ${Object.entries(counts).map(([reason, count]) => `${count} ${REASONS[reason]}`).join('; ')}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

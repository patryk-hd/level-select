// Facts about each Game Atlas system, from public sources only: the opening of its English
// Wikipedia article (CC BY-SA, credited where shown), its Wikidata facts (CC0: maker,
// release and end dates, units sold, CPU, the systems before and after it) and a photo
// from Wikimedia Commons. Saved as data/system-facts.json.
//
//   npm run systems:refresh
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanExtract } from './retro-lists.mjs';

export const FACTS_FILE = 'data/system-facts.json';
// Catalog system → Wikidata item (checked by label and description, 2026-10-02). The arcade
// collections point at their hardware or maker; Classic PC at DOS, PC at "PC game".
export const SYSTEM_ITEMS = {
  nes: 'Q172742', snes: 'Q183259', n64: 'Q184839', gc: 'Q182172', wii: 'Q8079', wiiu: 'Q56942', gb: 'Q186437', gbc: 'Q203992', gba: 'Q188642',
  ds: 'Q170323', '3ds': 'Q203597', switch: 'Q19610114', switch2: 'Q122761124', ps1: 'Q10677', ps2: 'Q10680', ps3: 'Q10683', ps4: 'Q5014725',
  ps5: 'Q63184502', psp: 'Q170325', vita: 'Q188808', sg1000: 'Q1136956', ms: 'Q209868', md: 'Q10676', gg: 'Q751719', scd: 'Q1047516',
  '32x': 'Q1063978', saturn: 'Q200912', dc: 'Q184198', atari2600: 'Q206261', atari5200: 'Q743222', atari7800: 'Q753600', lynx: 'Q753657',
  jaguar: 'Q650601', tg16: 'Q1057377', pcecd: 'Q10854461', neogeo: 'Q1054350', ngpc: 'Q1977455', mame: 'Q192851', cps: 'Q1034233',
  naomi: 'Q1369174', cave: 'Q2495040', c64: 'Q99775', amiga: 'Q100047', spectrum: 'Q23882', msx: 'Q853547', dos: 'Q170434',
  xbox: 'Q132020', x360: 'Q48263', xone: 'Q13361286', xsx: 'Q98973368', pc: 'Q4485157',
};
// Wikimedia asks for a way to reach whoever runs a script: set LEVEL_SELECT_CONTACT (an
// email or web page) when rebuilding the catalog. Nothing personal is built in.
const UA = { 'User-Agent': `RetroLibrary/0.1 (personal game library${process.env.LEVEL_SELECT_CONTACT ? `; ${process.env.LEVEL_SELECT_CONTACT}` : ''})` };
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: UA });
    if (response.ok) return response.json();
    if (attempt >= 3) throw new Error(`${new URL(url).host} returned HTTP ${response.status}`);
    await new Promise(resolve => setTimeout(resolve, 3000 * 2 ** attempt));
  }
}
async function entities(ids, props) {
  const found = {};
  for (const batch of chunks([...new Set(ids)], 50)) Object.assign(found, (await getJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: batch.join('|'), props, languages: 'en|mul', sitefilter: 'enwiki', format: 'json' })}`)).entities);
  return found;
}

// Wikidata time → "15 July 1983", "July 1983" or "1983", as precise as the source.
export function formatTime(value) {
  const match = /^\+?(\d{4})-(\d{2})-(\d{2})/.exec(value?.time ?? ''); if (!match) return null;
  const [, year, month, day] = match.map(Number);
  return value.precision >= 11 && day ? `${day} ${MONTHS[month - 1]} ${year}` : value.precision >= 10 && month ? `${MONTHS[month - 1]} ${year}` : String(year);
}
const timeOf = claim => claim.mainsnak?.datavalue?.value;
const itemOf = claim => claim.mainsnak?.datavalue?.value?.id;
// Statements worth reading: preferred ones when any, else all normal ones.
const best = claims => { const usable = (claims ?? []).filter(claim => claim.rank !== 'deprecated' && claim.mainsnak?.datavalue); const preferred = usable.filter(claim => claim.rank === 'preferred'); return preferred.length ? preferred : usable; };
// Units sold: the newest figure (by its "point in time"), else the largest.
export function unitsSold(claims) {
  const figures = best(claims).map(claim => ({ amount: Number(claim.mainsnak.datavalue.value.amount), asOf: claim.qualifiers?.P585?.[0]?.datavalue?.value ?? null })).filter(figure => figure.amount > 0);
  if (!figures.length) return null;
  const pick = figures.sort((a, b) => String(b.asOf?.time ?? '').localeCompare(String(a.asOf?.time ?? '')) || b.amount - a.amount)[0];
  return { amount: pick.amount, asOf: pick.asOf ? formatTime({ ...pick.asOf, precision: Math.min(pick.asOf.precision, 10) }) : null };
}

export function systemFacts(entity, labels, overview) {
  // Lists (makers, processors, systems before and after) keep every valid statement: the
  // Mega Drive has a Motorola 68000 and a Zilog Z80. Dates and sales take the best one.
  const valid = property => (claims[property] ?? []).filter(claim => claim.rank !== 'deprecated' && claim.mainsnak?.datavalue);
  const claims = entity?.claims ?? {}, names = property => [...new Set(valid(property).map(itemOf).map(id => labels[id]).filter(Boolean))];
  const times = property => best(claims[property]).map(timeOf).filter(value => value?.time).sort((a, b) => a.time.localeCompare(b.time));
  const released = times('P577')[0], ended = times('P2669').at(-1), image = best(claims.P18)[0]?.mainsnak.datavalue.value;
  const page = entity?.sitelinks?.enwiki?.title ?? null;
  const description = entity?.descriptions?.en?.value ?? '';
  return {
    item: entity?.id ?? null, tagline: description ? description[0].toUpperCase() + description.slice(1) : null, page, overview: overview || null,
    manufacturer: names('P176'), released: formatTime(released), discontinued: formatTime(ended), unitsSold: unitsSold(claims.P2664),
    cpu: names('P880'), predecessor: names('P155'), successor: names('P156'),
    image: image ? { url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image)}?width=640`, page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(image.replace(/ /g, '_'))}` } : null,
  };
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const items = await entities(Object.values(SYSTEM_ITEMS), 'claims|descriptions|sitelinks');
  const linked = Object.values(items).flatMap(entity => ['P176', 'P880', 'P155', 'P156'].flatMap(property => (entity.claims?.[property] ?? []).map(itemOf))).filter(Boolean);
  // Many items now carry their name only as a language-neutral ("mul") label; English wins.
  const labels = Object.fromEntries(Object.entries(await entities(linked, 'labels')).map(([id, entity]) => [id, entity.labels?.en?.value ?? entity.labels?.mul?.value]).filter(([, label]) => label));
  const pages = Object.values(items).map(entity => entity.sitelinks?.enwiki?.title).filter(Boolean), extracts = {};
  for (const batch of chunks(pages, 20)) {
    const body = await getJson(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exsentences: '4', exlimit: '20', format: 'json', formatversion: '2', titles: batch.join('|') })}`);
    for (const page of body.query.pages ?? []) extracts[page.title] = cleanExtract(page.extract);
  }
  const systems = Object.fromEntries(Object.entries(SYSTEM_ITEMS).map(([id, item]) => [id, systemFacts(items[item], labels, extracts[items[item]?.sitelinks?.enwiki?.title])]));
  const file = path.join(root, FACTS_FILE);
  await writeFile(`${file}.tmp`, `${JSON.stringify({ schemaVersion: 1, fetchedAt: new Date().toISOString(), source: 'Wikidata (CC0), English Wikipedia (CC BY-SA 4.0), Wikimedia Commons photos', systems }, null, 1)}\n`);
  await rename(`${file}.tmp`, file);
  const filled = Object.values(systems);
  console.log(`${filled.length} systems: ${filled.filter(system => system.overview).length} overviews, ${filled.filter(system => system.unitsSold).length} sales figures, ${filled.filter(system => system.image).length} photos.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

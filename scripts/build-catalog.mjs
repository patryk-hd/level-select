import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const original = JSON.parse(await readFile(new URL('../data/source-catalog.json', import.meta.url)));
const artwork = await readFile(new URL('../data/artwork.json', import.meta.url)).then(JSON.parse).catch(error => { if(error.code==='ENOENT')return {};throw error; });
const normalize = text => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const colors = { nintendo: '#ed807d', sega: '#78bde1', sony: '#97a7ec', xbox: '#a3ce80', atari: '#e9b576', 'nec-snk': '#8bcebd', arcade: '#c39ee6', 'home-computers': '#aab5c1' };
const shortNames = { nes:'NES', snes:'SNES', n64:'Nintendo 64', gc:'GameCube', wii:'Wii', wiiu:'Wii U', gb:'Game Boy', gbc:'Game Boy Color', gba:'Game Boy Advance', ds:'Nintendo DS', '3ds':'Nintendo 3DS', switch:'Switch', switch2:'Switch 2', ps1:'PlayStation', ps2:'PlayStation 2', ps3:'PlayStation 3', ps4:'PlayStation 4', ps5:'PlayStation 5', psp:'PSP', vita:'PS Vita', sg1000:'SG-1000', ms:'Master System', md:'Mega Drive / Genesis', gg:'Game Gear', scd:'Sega CD', '32x':'32X', saturn:'Saturn', dc:'Dreamcast', atari2600:'Atari 2600', atari5200:'Atari 5200', atari7800:'Atari 7800', lynx:'Atari Lynx', jaguar:'Atari Jaguar', tg16:'TurboGrafx-16', pcecd:'PC Engine CD', neogeo:'Neo Geo', ngpc:'Neo Geo Pocket Color', mame:'Arcade classics', cps:'Capcom CPS', naomi:'Sega NAOMI', cave:'Cave & arcade shooters', c64:'Commodore 64', amiga:'Amiga', spectrum:'ZX Spectrum', msx:'MSX', dos:'Classic PC', xbox:'Xbox', x360:'Xbox 360', xone:'Xbox One', xsx:'Xbox Series X/S' };
const handheld = new Set(['gb','gbc','gba','ds','3ds','gg','lynx','ngpc','psp','vita']);
const hybrid = new Set(['switch','switch2']);
const aliases = {
  nes: { 'Chip n Dale Rescue Rangers 2': 'Chip ’n Dale Rescue Rangers 2', 'Rescue Rangers 2': 'Chip ’n Dale Rescue Rangers 2', 'Mega Man (Original)': 'Mega Man' },
  snes: { "Yoshi's Island": "Super Mario World 2: Yoshi's Island" },
  msx: { 'Nemesis MSX':'Gradius MSX', 'Nemesis 2 MSX':'Gradius 2 MSX', 'Castlevania MSX':'Vampire Killer MSX', 'Knightmare II: The Maze of Galious MSX':'Maze of Galious MSX' }
};
const platformSuffix = {nes:'NES',snes:'SNES',n64:'N64',gc:'GameCube|GC',wii:'Wii',wiiu:'Wii U',gb:'GB|Game Boy',gbc:'GBC',gba:'GBA',ds:'DS', '3ds':'3DS',switch:'Switch',switch2:'Switch 2',ps1:'PS1',ps2:'PS2',ps3:'PS3',ps4:'PS4',ps5:'PS5',psp:'PSP',vita:'Vita|PS Vita',sg1000:'SG-1000',ms:'Master System|SMS',md:'Genesis|Mega Drive|MD',gg:'Game Gear',scd:'Sega CD', '32x':'32X',saturn:'Saturn',dc:'DC|Dreamcast',atari2600:'Atari 2600|2600',atari5200:'Atari 5200|5200',atari7800:'Atari 7800|7800',lynx:'Lynx',jaguar:'Jaguar',tg16:'TG16',pcecd:'PCECD',ngpc:'NGPC',c64:'C64',amiga:'Amiga',spectrum:'ZX Spectrum',msx:'MSX',dos:'DOS',naomi:'NAOMI',cps:'CPS[123]',xbox:'Xbox',x360:'Xbox 360',xone:'Xbox One',xsx:'Xbox Series X/S'};

function genresFor(label) {
  const g = normalize(label), tags = [];
  const add = (tag, expression) => { if (expression.test(g)) tags.push(tag); };
  add('RPG', /rpg\b|role playing|dungeon crawler/); add('Platformer', /platform/); add('Adventure', /adventure|metroidvania|point.*click|interactive movie|interactive drama|exploration/);
  add('Action', /action|beat.*em.*up|run.*gun|hack.*slash|vehicular combat/); add('Fighting', /fighting|brawler/);
  add('Shooter', /shoot|\bfps\b|\btps\b|run.*gun/); add('Shoot ’em up', /shoot.*em.*up|shmup/);
  add('Racing', /racing|driving|kart/); add('Sports', /sport|boxing|wrestling|soccer|football|golf|tennis|baseball|basketball|hockey|skating|snowboard/);
  add('Puzzle', /puzzle|breakout/); add('Strategy', /strategy|\brts\b|tactical|tower defense/); add('Simulation', /sim|city builder|management|sandbox|flight|space combat|trading/);
  add('Horror', /horror/); add('Stealth', /stealth/); add('Rhythm', /rhythm|music/); add('Party', /party|mini.*game|quiz/); add('Survival', /survival/); add('Battle royale', /battle royale/);
  add('Arcade', /arcade|pinball/); add('Roguelike', /rogue/); add('Visual novel', /visual novel/); add('Card & board', /card|board|mahjong|chess/);
  add('Educational', /educational|edutainment|learning|brain training/); add('Compilation', /compilation|collection/); add('Creative', /creative|drawing|toy/);
  return tags.length ? [...new Set(tags)] : ['Other'];
}

const systems = [], games = [], review = [], families = [];
for (const source of original) {
  if (!families.some(f => f.id === source.family)) families.push({ id: source.family, name: source.familyLabel, color: colors[source.family] });
  const launchYear = Number(source.tagline.match(/\d{4}/)?.[0]);
  const kind = source.family === 'arcade' ? 'Arcade collection' : source.family === 'home-computers' ? 'Computer' : handheld.has(source.id) ? 'Handheld' : hybrid.has(source.id) ? 'Hybrid' : 'Console';
  const system = { id: source.id, name: shortNames[source.id] || source.title, fullName: source.id === 'dos' ? 'Classic PC (DOS & Windows)' : source.title, family: source.family, abbreviation: source.badge || source.id.toUpperCase(), launchYear, kind, count: 0 };
  if (source.id === 'cave') system.fullName = 'Cave & other arcade shooters';
  systems.push(system);
  const seen = new Map();
  for (const [i, record] of source.games.entries()) {
    const [rawTitle, genreLabel, year] = record;
    let reason = /\balt\b/i.test(rawTitle) ? 'Unspecified alternate edition' : /\bTBA\b|selection \(/i.test(rawTitle) ? 'Unconfirmed release or placeholder' : '';
    if (source.id === 'nes' && rawTitle === 'Super Mario All-Stars') reason = 'SNES release incorrectly assigned to NES';
    if (source.id === 'snes' && rawTitle === 'Warcraft: Orcs and Humans') reason = 'PC release incorrectly assigned to SNES';
    if (reason) { review.push({ system: source.id, sourceRank: i + 1, record, reason }); continue; }
    const alias = aliases[source.id]?.[rawTitle];
    const suffix = platformSuffix[source.id] ? new RegExp(`\\s+(?:${platformSuffix[source.id]})$`, 'i') : null;
    let title = (alias || rawTitle);
    if (suffix && title !== 'Double Switch') title = title.replace(suffix, '').trim();
    if (source.id === 'cave') title = title.replace(/\s+Cave$/i, '');
    const key = normalize(title);
    if (seen.has(key)) {
      const existing = seen.get(key); existing.aliases = [...new Set([...existing.aliases, rawTitle])];
      review.push({ system: source.id, sourceRank: i + 1, record, reason: 'Duplicate or regional title alias', mergedInto: existing.id }); continue;
    }
    const game = { id: `${source.id}-${hash(key)}`, gameId: `game-${hash(key)}`, systemId: source.id, title, aliases: [...new Set([rawTitle, alias].filter(t => t && t !== title))], genres: genresFor(genreLabel), genreLabel, year, rank: ++system.count, sourceRank: i + 1 };
    game.legacyRank = game.rank;
    game.rankingMethod = "editorial-system-rank-v1";
    if (artwork[game.id]) game.cover = artwork[game.id];
    seen.set(key, game); games.push(game);
  }
}
// PC from 2000 on has no original list, only its review-backed one (scripts/retro-lists.mjs);
// Classic PC covers DOS and Windows to 1999.
systems.splice(systems.findIndex(system => system.id === 'dos') + 1, 0, { id: 'pc', name: 'PC', fullName: 'PC (Windows, 2000 onwards)', family: 'home-computers', abbreviation: 'PC', launchYear: 2000, kind: 'Computer', count: 0 });
const lists = await readFile(new URL('../data/retro-lists.json', import.meta.url)).then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });

// Corrections to the original lists (data/legacy-corrections.json): released titles, and
// entries that aren't a released game on that system taken out, each with its reason.
// Ids never change, and taken-out entries stay in the catalog, so tracking carries over.
const corrections = await readFile(new URL('../data/legacy-corrections.json', import.meta.url)).then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return { corrections: [] }; throw error; });
const byId = new Map(games.map(game => [game.id, game]));
const rename = (game, title) => { game.aliases = [...new Set([...game.aliases, game.title])].filter(alias => alias !== title); game.title = title; };
for (const fix of corrections.corrections) {
  const game = byId.get(fix.id);
  if (!game) throw new Error(`data/legacy-corrections.json: no catalog entry ${fix.id} (${fix.title})`);
  if (fix.rename) { rename(game, fix.rename); game.correction = { renamed: true }; }
  if (fix.remove) game.correction = { removed: fix.remove };
}
// Platform tags some old titles kept ("Sonic the Hedgehog GG").
const TAGS = { gg: 'GG', xsx: 'XSX', naomi: 'Atomiswave', x360: 'X360', gc: 'GCN', mame: 'Arcade' };
for (const game of games) {
  const clean = TAGS[game.systemId] && !game.correction ? game.title.replace(new RegExp(`\\s+${TAGS[game.systemId]}$`), '') : game.title;
  if (clean !== game.title) rename(game, clean);
}
// The original list's own (corrected) title, which scripts/retro-lists.mjs matches on: a
// review-backed list may show another name for the same game.
for (const game of games) game.originalTitle = game.title;
// The year it came out on that system, where IGDB confirms the game there (scripts/retro-lists.mjs).
for (const game of games) { const year = lists?.legacy?.[game.id]?.year; if (year && year !== game.year) game.year = year; }
// The corrected original lists, numbered again without the entries taken out.
for (const system of systems) {
  let rank = 0;
  for (const game of games.filter(game => game.systemId === system.id)) {
    if (game.correction?.removed) Object.assign(game, { rank: null, legacyRank: null, unlisted: true });
    else game.rank = game.legacyRank = ++rank;
  }
  system.count = system.originalCount = rank;
}

// Review-backed lists (scripts/retro-lists.mjs) replace the original order on their systems.
// Original entries a list leaves out stay in the catalog without a rank, so tracking and
// owned copies that point at them keep working; Game Atlas shows them in the original
// list, when you search, or when you track them.
// A system switches once the reviews support a list of 20 games; thinner ones (Atari 2600,
// Lynx, MSX…) keep the legacy list for now.
const MIN_LIST = 20;
for (const system of systems) {
  const entries = (lists?.games ?? []).filter(entry => entry.systemId === system.id);
  if (entries.length < MIN_LIST) { system.method = 'legacy'; continue; }
  const legacy = new Map(games.filter(game => game.systemId === system.id).map(game => [game.id, game])), listed = new Set();
  for (const entry of entries) {
    if (listed.has(entry.id)) continue;
    let game = legacy.get(entry.id);
    if (!game) {
      game = { id: entry.id, gameId: `game-${hash(normalize(entry.title))}`, systemId: system.id, title: entry.title, aliases: [], genres: entry.genres, genreLabel: entry.genres.join(' / '), year: entry.year, sourceRank: null, legacyRank: null };
      games.push(game);
    }
    // The list's title drops the old lists' system suffixes ("Sonic the Hedgehog GG"); the old one stays searchable.
    if (entry.title !== game.title) { game.aliases = [...new Set([...game.aliases, game.title])].filter(alias => alias !== entry.title); game.title = entry.title; }
    if (entry.steam) game.steamAppId = entry.steam;
    Object.assign(game, { rank: entry.rank, year: entry.year ?? game.year, rankingMethod: 'reviews-v1',
      reviews: { score: entry.score, critics: entry.critics, players: entry.players, port: entry.port, igdb: entry.igdb, wikipedia: entry.wikipedia } });
    if (!game.cover && entry.cover) game.cover = entry.cover;
    listed.add(game.id);
  }
  for (const game of legacy.values()) if (!listed.has(game.id)) { game.rank = null; game.unlisted = true; } else delete game.unlisted;
  system.count = listed.size; system.method = 'reviews';
  // One arcade list for every board, to 2004; the PC list keeps the old span, to 1999.
  if (system.id === 'mame') Object.assign(system, { name: 'Arcade', fullName: 'Arcade games (to 2004)' });
  if (system.id === 'dos') system.fullName = 'Classic PC (DOS & Windows, to 1999)';
}
const order = new Map(systems.map((system, index) => [system.id, index]));
games.sort((a, b) => order.get(a.systemId) - order.get(b.systemId) || (a.rank ?? Infinity) - (b.rank ?? Infinity) || (a.legacyRank ?? Infinity) - (b.legacyRank ?? Infinity));
const reviewed = systems.filter(system => system.method === 'reviews').length;
const catalog = { schemaVersion: 1, updatedAt: lists ? lists.generatedAt.slice(0, 10) : '2026-09-09', provenance: {
  label: reviewed ? 'Lists ranked by reviews; the original project lists where reviews are too few' : 'Curated from the original project lists',
  ranking: `${reviewed ? `On ${reviewed} systems, games are ranked by critic reviews of that system's version (the review boxes on English Wikipedia: magazines such as EGM, Famitsu, GamePro and Mean Machines, and sites such as IGN) and IGDB player ratings, combined by how much evidence each has. A list keeps up to ${lists.rule.listSize} games with enough reviews and an above-average score; later ports count only their own reviews. ` : ''}The other systems keep the original editorial order, after removing duplicate and unverified alternate entries. Ranks apply within each system or collection, not across the entire library.`,
  verification: `Review-backed lists are rebuilt from public data by npm run retro:lists; each game links to its sources. The original lists keep their order, which can't be traced to sources, but their facts were checked: ${corrections.corrections.filter(fix => fix.remove).length} entries that aren't a released game on that system were taken out and ${corrections.corrections.filter(fix => fix.rename).length} titles corrected (data/legacy-corrections.json), and release years follow IGDB where it confirms the game on that system.`,
  sourceEntries: original.reduce((n, s) => n + s.games.length, 0), reviewEntries: review.length,
  ...(lists ? { lists: { generatedAt: lists.generatedAt, method: lists.method, rule: lists.rule } } : {}) }, families, systems, games };
await writeFile(new URL('../data/catalog.json', import.meta.url), JSON.stringify(catalog) + '\n');
await writeFile(new URL('../data/review-queue.json', import.meta.url), JSON.stringify(review, null, 2) + '\n');
console.log(`Catalog: ${games.length} releases across ${systems.length} systems/collections; ${review.length} source entries set aside for review.`);

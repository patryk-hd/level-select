import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { consensus, bestPosition, rankMods, pickIgdbMod, modLinks } from '../ranking/mods.js';
import { buildMods } from '../scripts/mods-lists.mjs';

const sources = [{ id: 'modhof', kind: 'hall-of-fame' }, { id: 'pcgamesn', kind: 'editorial' }, { id: 'okimpala', kind: 'community', supporting: true }];

test('consensus: every source that picks a mod counts once; a supporting catalogue counts half', () => {
  assert.deepEqual(consensus({ modhof: '', pcgamesn: '5' }, sources), { count: 2, points: 2 });
  assert.deepEqual(consensus({ pcgamesn: '5', okimpala: '' }, sources), { count: 1, points: 1.5 });
  assert.throws(() => consensus({ nobody: '' }, sources), /Unknown source/);
  assert.equal(bestPosition({ pcgamesn: '18', retrododo: 'All-time #8 · SNES #2 · Metroid #10' }), 2);
  assert.equal(bestPosition({ modhof: '', moty: '2012' }), Infinity);
});

test('ranking: agreement first, then Wikipedia coverage, IGDB ratings and list position; systems rank on their own', () => {
  const mod = (name, system, points, extra = {}) => ({ name, system, picks: extra.picks ?? {}, consensus: { points }, notability: extra.notability ?? 0, igdb: extra.igdb ?? null });
  const ranked = rankMods([mod('B', 'pc', 2, { notability: 3 }), mod('A', 'pc', 2, { notability: 10 }), mod('Hack', 'snes', 1, { picks: { r: 'SNES #2' } }), mod('Other hack', 'snes', 1, { picks: { r: 'SNES #1' } }), mod('Top', 'pc', 4)]);
  assert.deepEqual(ranked.map(entry => [entry.name, entry.rank, entry.systemRank]), [['Top', 1, 1], ['A', 2, 2], ['B', 3, 3], ['Other hack', 4, 1], ['Hack', 5, 2]]);
});

test('IGDB matching needs the title, then the base game, the year or IGDB calling it a mod', () => {
  const game = (name, parent, extra = {}) => ({ name, parent_game: parent ? { name: parent } : undefined, game_type: 5, ...extra });
  // "Crusader Kings III" isn't "Crusader Kings II": the other game's mod is refused.
  assert.equal(pickIgdbMod({ name: 'A Game of Thrones', game: 'Crusader Kings II' }, [game('A Game of Thrones', 'Crusader Kings III')]), null);
  assert.equal(pickIgdbMod({ name: 'A Game of Thrones', game: 'Crusader Kings II' }, [game('A Game of Thrones', 'Crusader Kings III'), game('A Game of Thrones', 'Crusader Kings II')]).parent_game.name, 'Crusader Kings II');
  // An expansion's name as the base game still counts ("Medieval II: Total War" for "…: Kingdoms").
  assert.ok(pickIgdbMod({ name: 'Third Age: Total War', game: 'Medieval II: Total War: Kingdoms' }, [game('Third Age: Total War', 'Medieval II: Total War')]));
  // Short, generic names need their base game.
  assert.equal(pickIgdbMod({ name: 'Complex', game: 'Homeworld 2' }, [game('Complex', null)]), null);
  // A mod that became a game has no base game on IGDB: its year confirms it.
  assert.equal(pickIgdbMod({ name: 'Counter-Strike', game: 'Half-Life', year: 1999 }, [{ name: 'Counter-Strike', game_type: 0, first_release_date: 946684800 }, { name: 'Counter-Strike: Source', game_type: 0 }]).name, 'Counter-Strike');
  assert.equal(pickIgdbMod({ name: 'Brutal Doom', game: 'Doom' }, [game('Doom Eternal', null)]), null);
});

test('links: the useful ones, named for where they go', () => {
  assert.deepEqual(modLinks([{ type: 1, url: 'https://www.moddb.com/mods/brutal-doom' }, { type: 3, url: 'https://en.wikipedia.org/wiki/Brutal_Doom' }, { type: 5, url: 'https://twitter.com/x' }, { type: 13, url: 'https://store.steampowered.com/app/1' }, { type: 1, url: 'javascript:alert(1)' }]),
    [{ label: 'ModDB', url: 'https://www.moddb.com/mods/brutal-doom' }, { label: 'Steam', url: 'https://store.steampowered.com/app/1' }, { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Brutal_Doom' }]);
});

test('the built list: IGDB details, systems in order, sources with their counts, thin essentials left out', () => {
  const research = { checked: '2026-10-12', kinds: { conversion: 'Total conversions & overhauls', romhack: 'ROM hacks' }, sources: [...sources, { id: 'unused', kind: 'editorial' }],
    mods: [{ name: 'Brutal Doom', game: 'Doom', system: 'pc', kinds: ['conversion'], picks: { modhof: '', pcgamesn: '18' } }, { name: 'Hyper Metroid', game: 'Super Metroid', system: 'snes', year: 2015, kinds: ['romhack'], picks: { okimpala: '' } }] };
  const igdb = { 'brutal doom|pc': { id: 1, slug: 'brutal-doom', url: 'https://www.igdb.com/games/brutal-doom', first_release_date: 1330992000, total_rating: 89.9, total_rating_count: 13, cover: { image_id: 'co4m90' }, parent_game: { id: 673, name: 'Doom' }, websites: [{ type: 1, url: 'https://www.moddb.com/mods/brutal-doom' }] } };
  const catalog = { systems: [{ id: 'nes', name: 'NES', fullName: 'Nintendo Entertainment System' }, { id: 'snes', name: 'SNES', fullName: 'Super Nintendo Entertainment System' }] };
  const essentials = { fetchedAt: 'x', games: [{ id: 'a', mods: Array(10).fill({}) }, { id: 'b', mods: Array(5).fill({}) }] };
  const data = buildMods(research, { igdb, wikidata: { 'brutal-doom': { languages: 6, article: 'https://en.wikipedia.org/wiki/Brutal_Doom' } }, catalog, essentials, generatedAt: 'now' });
  const [doom, hack] = data.mods;
  assert.deepEqual([doom.id, doom.rank, doom.year, doom.gameIgdbId, doom.notability, doom.cover, doom.igdb.rating], ['brutal-doom', 1, 2012, 673, 6, 'https://images.igdb.com/igdb/image/upload/t_cover_big/co4m90.jpg', 90]);
  assert.deepEqual(doom.links.map(link => link.label), ['ModDB', 'Wikipedia']);
  assert.deepEqual([hack.id, hack.igdb, hack.cover, hack.systemRank], ['hyper-metroid-snes', null, null, 1]);
  assert.deepEqual(data.systems, [{ id: 'pc', name: 'PC', short: 'PC', count: 1 }, { id: 'snes', name: 'Super Nintendo Entertainment System', short: 'SNES', count: 1 }]);
  assert.deepEqual(data.sources.map(source => [source.id, source.count]), [['modhof', 1], ['pcgamesn', 1], ['okimpala', 1]]);
  assert.deepEqual(data.essentials.games.map(game => game.id), ['a']);
});

test('the research record is consistent: known sources and kinds, systems and no duplicates', async () => {
  const research = JSON.parse(await readFile(new URL('../data/mods-research.json', import.meta.url), 'utf8'));
  const sourceIds = new Set(research.sources.map(source => source.id)), seen = new Set();
  for (const mod of research.mods) {
    assert.ok(mod.name && mod.system && mod.kinds.length, JSON.stringify(mod));
    for (const kind of mod.kinds) assert.ok(kind in research.kinds, `${mod.name}: ${kind}`);
    for (const id of Object.keys(mod.picks)) assert.ok(sourceIds.has(id), `${mod.name}: ${id}`);
    assert.ok(Object.keys(mod.picks).some(id => !research.sources.find(source => source.id === id).supporting), `${mod.name} needs a source that isn't only supporting`);
    assert.equal(mod.system === 'pc', !mod.kinds.includes('romhack'), `${mod.name}: ROM hacks are for consoles`);
    const key = `${mod.name.toLowerCase()}|${mod.system}`;
    assert.ok(!seen.has(key), `duplicate ${mod.name}`); seen.add(key);
  }
});

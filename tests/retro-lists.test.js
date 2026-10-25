import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLists, release, evidenceFor, compactPoolGame, pageFits, MIN_SCORE, datesOf, STEAM_LIST_OFFSET } from '../scripts/retro-lists.mjs';
import { parseReviews } from '../ranking/critic-reviews.mjs';

const at = year => Date.UTC(year, 5, 1) / 1000;
const game = (id, name, extra = {}) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, '-'), type: 0, first: at(1994), url: `https://www.igdb.com/games/${id}`,
  players: null, playersCount: 0, critic: null, criticCount: 0, parent: null, genres: [8], themes: [], dates: { 19: at(1994) }, cover: null, alt: [], wiki: null, ...extra });
const box = (...fields) => parseReviews(`{{Video game reviews\n${fields.map(field => `| ${field}`).join('\n')}\n}}`);

test('a release more than 90 days after the first is a port; IGDB port pages say so themselves', () => {
  assert.deepEqual(release(game(1, 'Doom', { first: at(1993), dates: { 13: at(1993), 19: at(1995) } }), [19]), { year: 1995, original: false, portPage: false, alongside: false });
  assert.deepEqual(release(game(2, 'Dune II', { first: at(1992), dates: { 13: at(1992), 29: at(1992) + 240 * 86400 } }), [29]), { year: 1993, original: false, portPage: false, alongside: false });
  assert.deepEqual(release(game(3, 'Doom (SNES)', { type: 11, first: at(1995), parentFirst: at(1993), dates: { 19: at(1995) } }), [19]), { year: 1995, original: false, portPage: true, alongside: false });
  // A regional version of a release on the same console isn't a port (US Final Fantasy VII).
  assert.equal(release(game(6, 'Final Fantasy VII', { type: 10, first: at(1997) + 200 * 86400, parentFirst: at(1997), dates: { 7: at(1997) + 200 * 86400 }, parentDates: { 7: at(1997) } }), [7]).original, true);
  // A handheld version launched with the home versions; a computer game launched on several machines.
  assert.equal(release(game(7, 'Battlefront II', { first: at(2005), dates: { 8: at(2005), 38: at(2005) } }), [38], { handheld: true }).alongside, true);
  assert.equal(release(game(8, 'SimCity', { first: at(1989), dates: { 16: at(1989), 15: at(1989), 63: at(1989) } }), [16], { computer: true, siblings: [63] }).alongside, true);
  assert.equal(release(game(9, 'Knight Lore', { first: at(1984), dates: { 26: at(1984) } }), [26], { computer: true }).alongside, false);
  // Listed on a system with no release there: not the first release.
  assert.equal(release(game(5, 'Tomb Raider', { first: at(1996), dates: { 7: at(1996), 13: at(1996) } }), [4]).original, false);
  // The Super Famicom and Super NES are one system: the earlier date counts.
  assert.deepEqual(release(game(4, 'Super Metroid', { first: at(1994), dates: { 58: at(1994), 19: at(1994) + 60 * 86400 } }), [19, 58]), { year: 1994, original: true, portPage: false, alongside: false });
});

test('reviews that name no platform belong to the first release and the page about the game', () => {
  const reviews = box('EGM = 9/10', 'Fam_SNES = 8/10');
  const snes = { id: 'snes', platforms: [19] };
  assert.deepEqual(evidenceFor(game(1, 'Late version', { first: at(1993), dates: { 29: at(1993), 19: at(1994) + 200 * 86400 } }), reviews, snes).critics.outlets, ['Famitsu']);
  // A later port's own IGDB page: its players rated that port; the page's general reviews are the original's.
  const port = game(2, 'Port page', { type: 11, parentFirst: at(1992), players: 80, playersCount: 40 });
  assert.deepEqual(evidenceFor(port, reviews, snes).critics.outlets, ['Famitsu']);
  assert.equal(evidenceFor(port, reviews, snes).players.count, 40);
  // So did the players of IGDB's own page for an enhanced version (Persona 4 Golden).
  const golden = game(9, 'Persona 4 Golden', { type: 10, first: at(2012), parentFirst: at(2008), dates: { 46: at(2012) }, players: 94, playersCount: 543 });
  assert.equal(evidenceFor(golden, [], { id: 'vita', platforms: [46] }).players.count, 543);
  // A spin-off IGDB links to the main game's page (a medal game, a bonus disc) only gets reviews naming it.
  // A page whose title starts a game's name fits, unless another game is called that.
  assert.equal(pageFits(game(3, 'New Super Mario Bros. Wii Coin World', { wiki: 'New Super Mario Bros. Wii' }), new Set(['new super mario bros wii'])), false);
  assert.equal(pageFits(game(8, 'QuackShot Starring Donald Duck', { wiki: 'QuackShot' }), new Set(['quackshot starring donald duck'])), true);
  assert.equal(pageFits(game(4, 'The Legend of Zelda: Ocarina of Time - Master Quest', { wiki: 'The Legend of Zelda: Ocarina of Time', parent: 1 })), false);
  assert.equal(pageFits(game(5, 'Landstalker: The Treasures of King Nole', { wiki: 'Landstalker' })), true);
  assert.equal(pageFits(game(6, 'Pokémon Red and Blue', { wiki: 'Pokémon Red, Blue, and Yellow' })), true);
  assert.equal(pageFits(game(7, 'Final Fantasy III', { wiki: 'Final Fantasy VI', alt: ['Final Fantasy VI'] })), true);
});

test('a port counts only reviews of its own version; players rate the original', () => {
  const doom = game(1, 'Doom', { first: at(1993), dates: { 13: at(1993), 19: at(1995) }, players: 90, playersCount: 2000 });
  // (Players of a port page rate that port, so they stay.)
  const reviews = box('GR = PC: 93%<br>SNES: 70%', 'EGM_SNES = 7/10', 'Edge = 9/10');
  const evidence = evidenceFor(doom, reviews, { id: 'snes', platforms: [19] });
  assert.equal(evidence.original, false);
  assert.equal(evidence.players, null);
  assert.deepEqual(evidence.critics.outlets.sort(), ['Electronic Gaming Monthly', 'GameRankings']);
  assert.equal(evidence.critics.value, 70);
});

test('lists rank by critics and players, need enough evidence, and keep one entry per game', () => {
  const pools = { snes: [
    game(10, 'Super Metroid', { players: 92, playersCount: 1000, wiki: 'Super Metroid' }),
    game(11, 'Super Metroid', { type: 11, parent: 10, players: 80, playersCount: 5, wiki: 'Super Metroid' }),
    game(12, 'Hidden Gem', { players: 95, playersCount: 4 }),
    game(13, 'Final Fantasy III', { players: 90, playersCount: 700, wiki: 'Final Fantasy VI', alt: ['Final Fantasy VI'] }),
    game(14, 'Average Game', { players: 66, playersCount: 400 }),
    game(15, 'DLC', { type: 1, players: 99, playersCount: 900 }),
  ] };
  const pages = { 'Super Metroid': box('EGM = 9/10', 'Fam = 32/40', 'MM = 94%'), 'Final Fantasy VI': box('EGM = 9/10', 'Fam = 37/40') };
  // An entry from the original lists (sourceRank), and a game an earlier run added (none).
  const catalog = { games: [{ id: 'snes-legacy-metroid', systemId: 'snes', title: 'Super Metroid', aliases: [], genres: ['Platformer'], rank: 1, legacyRank: 7, sourceRank: 7, cover: { url: 'cover.png' } },
    { id: 'snes-earlier-run', systemId: 'snes', title: 'Final Fantasy VI', aliases: [], genres: ['RPG'], rank: 2, legacyRank: null, sourceRank: null }] };
  const lists = buildLists({ pools, pages, catalog, generatedAt: '2026-10-01T00:00:00.000Z' });
  const snes = lists.games.filter(entry => entry.systemId === 'snes');
  assert.deepEqual(snes.map(entry => entry.title), ['Super Metroid', 'Final Fantasy VI']);
  // The legacy entry keeps its id (tracking carries over), cover and old rank.
  assert.equal(snes[0].id, 'snes-legacy-metroid'); assert.equal(snes[0].legacyRank, 7); assert.deepEqual(snes[0].cover, { url: 'cover.png' });
  assert.equal(snes[0].critics.count, 3); assert.equal(snes[0].players.count, 1000);
  // New games get a catalog-style id and the name people know.
  assert.match(snes[1].id, /^snes-[0-9a-f]{16}$/); assert.equal(snes[1].legacyRank, null);
  // Old lists' system suffixes don't stop a match, and the list shows the clean title.
  const gg = buildLists({ pools: { gg: [game(20, 'Sonic the Hedgehog', { players: 80, playersCount: 300, dates: { 35: at(1991) }, first: at(1991) })] }, pages: {},
    catalog: { games: [{ id: 'gg-legacy-sonic', systemId: 'gg', title: 'Sonic the Hedgehog GG', aliases: [], genres: ['Platformer'], rank: 1, legacyRank: 1, sourceRank: 1 }] } });
  assert.deepEqual(gg.games.map(entry => [entry.id, entry.title, entry.legacyRank]), [['gg-legacy-sonic', 'Sonic the Hedgehog', 1]]);
  assert.ok(snes.every(entry => entry.score >= MIN_SCORE));
  assert.equal(lists.systems.find(system => system.id === 'snes').listed, 2);
});

test('IGDB games are compacted with their per-platform dates and Wikipedia page', () => {
  const compact = compactPoolGame({ id: 1, name: 'Chrono Trigger', game_type: 0, first_release_date: at(1995), rating: 92.71, rating_count: 1392,
    release_dates: [{ platform: 19, date: at(1995) }, { platform: 7, date: at(1999) }, { platform: 19, date: at(1996) }],
    websites: [{ url: 'https://www.chronowiki.org/' }, { url: 'https://en.wikipedia.org/wiki/Chrono_Trigger' }], alternative_names: [{ name: 'Kurono Torigā' }] });
  assert.equal(compact.wiki, 'Chrono Trigger'); assert.equal(compact.players, 92.7); assert.equal(compact.dates[19], at(1995));
  assert.deepEqual(compact.alt, ['Kurono Torigā']);
});

test('a later port counts only reviews of that port, never the original’s players', () => {
  const late = game(9, 'Late port', { first: at(2018), playersCount: 900, players: 90, dates: { 6: at(2018), 130: at(2020) }, wiki: 'Late port' });
  const evidence = evidenceFor(late, box('IGN = NS: 8/10', 'GSpot = PC: 10/10'), { id: 'switch', platforms: [130] });
  assert.equal(evidence.players, null);
  assert.deepEqual(evidence.critics.outlets.length, 1);
  assert.equal(evidence.critics.value, 80);
});

test('early access counts only until the full release; cancelled releases never count', () => {
  // Hades: PC early access in 2018, then PC and Switch the same day in 2020.
  const dates = datesOf([{ platform: 6, date: at(2018), status: 3 }, { platform: 6, date: at(2020), status: 6 }, { platform: 130, date: at(2020), status: 6 }, { platform: 48, date: at(2019), status: 5 }]);
  assert.deepEqual(dates, { 6: at(2020), 130: at(2020) });
  assert.equal(release(game(1, 'Hades', { first: at(2018), dates }), [130]).original, true);
  // Still in early access: that's its date.
  assert.deepEqual(datesOf([{ platform: 6, date: at(2024), status: 3 }]), { 6: at(2024) });
  // compactPoolGame's first release follows the same rule.
  assert.equal(compactPoolGame({ id: 1, name: 'Hades', first_release_date: at(2018), release_dates: [{ platform: 6, date: at(2018), status: 3 }, { platform: 6, date: at(2020), status: 6 }] }).first, at(2020));
});

test('a PC port counts Steam reviews of the PC version as its players, shifted onto the IGDB scale', () => {
  const port = game(7, 'Console first', { first: at(2018), playersCount: 4000, players: 93, dates: { 48: at(2018), 6: at(2019) }, wiki: 'Console first' });
  const pc = { id: 'pc', platforms: [6] };
  const evidence = evidenceFor(port, box('PCGUS = 88%'), pc, new Set(), { steam: { count: 850000, percent: 92 } });
  // Weighed like the game's 4,000 IGDB ratings, not Steam's 850,000 reviews.
  assert.deepEqual(evidence.players, { value: 92 - STEAM_LIST_OFFSET, count: 4000, source: 'steam', percent: 92, reviews: 850000 });
  // The original release keeps IGDB's players; consoles have no Steam.
  assert.equal(evidenceFor(port, box('IGN = PS4: 10/10'), { id: 'ps4', platforms: [48] }, new Set(), { steam: { count: 850000, percent: 92 } }).players.count, 4000);
});

test('the platform a game was born on stays its original, even with unmarked early access elsewhere', () => {
  // Subnautica: PC early access 2014, an unmarked Xbox preview in 2016, full releases in 2018.
  const pool = compactPoolGame({ id: 2, name: 'Subnautica', release_dates: [{ platform: 6, date: at(2014), status: 3 }, { platform: 6, date: at(2018), status: 6 }, { platform: 49, date: at(2016) }] });
  assert.equal(release(pool, [6]).original, true);
  assert.equal(release(pool, [6]).year, 2018);
  assert.equal(release(pool, [49]).original, true);
});

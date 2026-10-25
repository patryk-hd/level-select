import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, baseTitle, pickCandidate, compactGame, playnitePlatforms } from '../ranking/igdb-match.mjs';

const at = year => Date.UTC(year, 5, 1) / 1000;
const game = (id, name, year, extra = {}) => ({ id, name, first_release_date: at(year), game_type: 0, platforms: [19], ...extra });

test('titles normalise punctuation, accents and a leading article; editions strip to the base game', () => {
  assert.equal(normalizeTitle('The Legend of Zelda: A Link to the Past™'), 'legend of zelda a link to the past');
  assert.equal(normalizeTitle('Pokémon Snap'), 'pokemon snap');
  assert.equal(normalizeTitle("Assassin's Creed"), 'assassins creed');
  assert.equal(baseTitle('The Witcher 3: Wild Hunt - Complete Edition'), 'The Witcher 3: Wild Hunt');
  assert.equal(baseTitle('Fallout: New Vegas Ultimate Edition'), 'Fallout: New Vegas');
  assert.equal(baseTitle('Final Fantasy VII'), 'Final Fantasy VII');
  // "Digital", "Gold" etc. only mark an edition when Edition/Version/Cut follows.
  assert.equal(baseTitle('God of War Digital Comic Books'), 'God of War Digital Comic Books');
  assert.equal(baseTitle('Gothic II: Gold Classic'), 'Gothic II: Gold Classic');
  assert.equal(baseTitle('Borderlands GOTY'), 'Borderlands');
  assert.equal(baseTitle('Deathloop Deluxe Edition'), 'Deathloop');
});

test('ROM hacks and mods lose to the original even when search ranks them first', () => {
  const games = [
    game(330214, 'Super Metroid Arcade', 2017, { game_type: 5 }),
    game(42524, 'Super Metroid: Phazon', 2011, { game_type: 5 }),
    game(1103, 'Super Metroid', 1994, { rating_count: 1081 }),
  ];
  const pick = pickCandidate({ title: 'Super Metroid', year: 1994, platforms: [19] }, games);
  assert.equal(pick.id, 1103); assert.equal(pick.confidence, 'high');
});

test('among same-title entries the one with real rating volume wins', () => {
  const games = [
    game(393025, 'Final Fantasy VII', 1997, { platforms: [7], rating_count: 9 }),
    game(427, 'Final Fantasy VII', 1997, { platforms: [7], game_type: 10, rating_count: 1600, aggregated_rating_count: 34 }),
  ];
  assert.equal(pickCandidate({ title: 'Final Fantasy VII', year: 1997, platforms: [7] }, games).id, 427);
});

test('a same-name game from another era or platform is not a confident match', () => {
  const reboot = [game(7351, 'Doom', 2016, { platforms: [6, 48], rating_count: 900 })];
  const pick = pickCandidate({ title: 'Doom', year: 1993, platforms: [13] }, reboot);
  assert.equal(pick.confidence, 'low');
  const both = [...reboot, game(673, 'Doom', 1993, { platforms: [13, 6], rating_count: 1000 })];
  assert.equal(pickCandidate({ title: 'Doom', year: 1993, platforms: [13] }, both).id, 673);
});

test('editions match their base game with medium confidence; unrelated titles never match', () => {
  const games = [game(1942, 'The Witcher 3: Wild Hunt', 2015, { platforms: [6], rating_count: 5000 })];
  const pick = pickCandidate({ title: 'The Witcher 3: Wild Hunt - Complete Edition', year: 2015, platforms: [6] }, games);
  assert.equal(pick.id, 1942); assert.equal(pick.confidence, 'medium');
  assert.equal(pickCandidate({ title: 'Witcher Adventure Game', year: 2014, platforms: [6] }, games), null);
});

test('alternative names count as exact titles', () => {
  const games = [game(4438, 'Sonic the Hedgehog 2', 1992, { platforms: [29], alternative_names: [{ name: 'Sonic 2' }] })];
  assert.equal(pickCandidate({ title: 'Sonic 2', year: 1992, platforms: [29] }, games).confidence, 'high');
});

test('compact records keep counts and only numeric Steam ids', () => {
  const record = compactGame(game(1942, 'The Witcher 3: Wild Hunt', 2015, { rating: 93.775, rating_count: 5473, aggregated_rating: 91.73, aggregated_rating_count: 26,
    external_games: [{ uid: '292030', external_game_source: 1 }, { uid: 'abc', external_game_source: 1 }, { uid: '41484', external_game_source: 3 }] }));
  assert.deepEqual([record.players, record.playersCount, record.critic, record.criticCount, record.year], [93.8, 5473, 91.7, 26, 2015]);
  assert.deepEqual(record.steam, ['292030']);
  assert.deepEqual(playnitePlatforms(['PC (Windows)', 'Sony PlayStation 4', 'Unknown']).sort((a, b) => a - b), [6, 13, 48]);
});

test('bundles never count as a confident match and lose to the game itself', () => {
  const bundle = game(90, 'Mario Kart 8 Deluxe', 2020, { platforms: [130], game_type: 3 });
  assert.equal(pickCandidate({ title: 'Mario Kart 8 Deluxe', year: 2017, platforms: [130] }, [bundle]).confidence, 'medium');
  const real = game(91, 'Mario Kart 8 Deluxe', 2017, { platforms: [130], rating_count: 800 });
  assert.equal(pickCandidate({ title: 'Mario Kart 8 Deluxe', year: 2017, platforms: [130] }, [bundle, real]).id, 91);
});

test('a later store re-release date still finds the original when nothing closer exists', () => {
  const original = game(7, 'Alien: Isolation', 2014, { platforms: [6, 48], rating_count: 2000 });
  const pick = pickCandidate({ title: 'Alien: Isolation', year: 2021, platforms: [6] }, [original]);
  assert.equal(pick.id, 7); assert.equal(pick.confidence, 'medium');
  const reboot = game(8, 'Doom', 2016, { platforms: [6], rating_count: 900 }), classic = game(9, 'Doom', 1993, { platforms: [13, 6] });
  assert.equal(pickCandidate({ title: 'Doom', year: 2016, platforms: [6] }, [reboot, classic]).id, 8);
});

test('Playnite retro platform names map to catalog systems and IGDB platforms', async () => {
  const { platformKey } = await import('../library/core.js');
  const cases = { 'Nintendo Entertainment System': 'nes', 'Sega Genesis': 'md', 'Sega CD': 'scd', 'NEC TurboGrafx 16': 'tg16', 'SNK Neo Geo AES': 'neogeo',
    'Arcade': 'mame', 'Commodore 64': 'c64', 'Nintendo 64': 'n64', 'Commodore Amiga': 'amiga', 'Atari 2600': 'atari2600', 'PC (Windows)': 'dos', 'Sony PlayStation 4': 'ps4' };
  for (const [name, system] of Object.entries(cases)) assert.equal(platformKey(name), system, name);
  assert.deepEqual(playnitePlatforms(['Commodore 64']), [15]);
  assert.deepEqual(playnitePlatforms(['Super Nintendo Entertainment System']), [19, 58]);
});

// Your Steam "Call of Duty" (app 1938090, 2022) was matched to the 2003 game by title.
test('a known Steam app vetoes a same-named game from another year and confirms the right one', () => {
  const steam = (...uids) => ({ platforms: [6], external_games: uids.map(uid => ({ uid, external_game_source: 1 })) });
  const cod2003 = game(621, 'Call of Duty', 2003, steam('2620'));
  const want = { title: 'Call of Duty', year: 2022, platforms: [6], steam: '1938090' };
  assert.equal(pickCandidate(want, [cod2003]), null, 'no re-release rescue against the Steam app');
  assert.equal(pickCandidate({ ...want, steam: null }, [cod2003])?.id, 621, 'without the app id the old rescue still applies');
  // Same year, other Steam app (a GOTY edition's own app): still usable, never "high" on the name alone.
  const batman = game(5, 'Batman: Arkham Asylum', 2009, steam('35010'));
  assert.equal(pickCandidate({ title: 'Batman: Arkham Asylum GOTY Edition', year: 2010, platforms: [6], steam: '35140' }, [batman])?.confidence, 'medium');
  // The app listed on the candidate makes it certain, whatever year Playnite shows.
  const grid2008 = game(7, 'Race Driver: GRID', 2008, { ...steam('12750'), alternative_names: [{ name: 'GRID' }] });
  const grid2019 = game(8, 'Grid', 2019, steam('703860'));
  assert.deepEqual([pickCandidate({ title: 'GRID', year: 2019, platforms: [6], steam: '12750' }, [grid2019, grid2008])].map(pick => [pick.id, pick.confidence]), [[7, 'high']]);
});

test('the same title on your platform beats a later port to another platform', () => {
  // Playnite dated the PS4 copy 2021, the year of the mobile port.
  const want = { title: 'Alien: Isolation', year: 2021, platforms: [48] };
  const pick = pickCandidate(want, [
    game(197779, 'Alien: Isolation', 2021, { game_type: 11, platforms: [34, 39], rating_count: 9 }),
    game(4754, 'Alien: Isolation', 2014, { platforms: [9, 48, 6], rating_count: 717, aggregated_rating_count: 19 }),
  ]);
  assert.equal(pick.id, 4754);
  assert.equal(pick.confidence, 'medium');
});

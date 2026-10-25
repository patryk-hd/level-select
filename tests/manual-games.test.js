import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateGame, imageType, addGame, editGame, removeGame, setCover, readCover, readManual, manualGroups, mergeManual, searchAtlas, searchIgdb, searchSteam, combineResults, systemName, igdbPlatformName, remoteCover } from '../scripts/manual-games.mjs';
import { readOverrides } from '../scripts/igdb-overrides.mjs';
import { applyCorrections, correctionOf, saveCorrection, setCorrectionCover, resetCorrection, readCorrections, validateCorrection } from '../scripts/corrections.mjs';
import { ownedCopyMatch, ownedMatches } from '../library/core.js';
import { readSnapshot, parseData } from '../scripts/snapshot.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const catalog = { systems: [{ id: 'snes', name: 'SNES', fullName: 'Super Nintendo Entertainment System' }, { id: 'switch', name: 'Switch', fullName: 'Nintendo Switch' }, { id: 'tg16', name: 'TurboGrafx-16', fullName: 'TurboGrafx-16 / PC Engine' }],
  games: [{ id: 'snes-1', systemId: 'snes', title: 'Chrono Trigger', aliases: [], year: 1995, rank: 1, genres: ['RPG'], cover: { local: './assets/covers/chrono-trigger.png' } },
    { id: 'snes-2', systemId: 'snes', title: 'Super Mario World', aliases: ['Super Mario Bros. 4'], year: 1990, rank: 2, genres: ['Platformer'], cover: { url: 'https://raw.githubusercontent.com/x/smw.png' } }] };
const tempRoot = () => mkdtemp(path.join(tmpdir(), 'manual-'));
const response = (body, { status = 200, type = 'application/json' } = {}) => ({ ok: status < 400, status, headers: new Headers({ 'content-type': type }), json: async () => body, arrayBuffer: async () => body });

test('a game you add needs a title and a platform; years, ids and names are checked', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  assert.deepEqual(validateGame({ name: '  Chrono   Trigger ', platform: 'SNES', year: '1995', igdbId: 1234, genres: ['RPG', ''] }, now),
    { name: 'Chrono Trigger', platform: 'SNES', year: 1995, ownedOn: 'Physical', igdbId: 1234, steamAppId: null, atlasId: null, genres: ['RPG'], developers: [], publishers: [], summary: '' });
  assert.throws(() => validateGame({ platform: 'SNES' }, now), /title/);
  assert.throws(() => validateGame({ name: 'X' }, now), /platform/);
  assert.throws(() => validateGame({ name: 'X', platform: 'SNES', year: 1800 }, now), /between 1950 and 2031/);
  assert.throws(() => validateGame({ name: 'X', platform: 'SNES', steamAppId: '12a' }, now), /Steam/);
  assert.throws(() => validateGame({ name: 'X'.repeat(201), platform: 'SNES' }, now), /too long/);
  assert.equal(validateGame({ name: 'X', platform: 'PC', year: '' }, now).year, null);
});

test('covers: only real pictures, only from IGDB, Steam or the Atlas', () => {
  assert.equal(imageType(PNG), 'png');
  assert.equal(imageType(JPEG), 'jpg');
  assert.equal(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
  assert.equal(imageType(Buffer.from('<svg onload=alert(1)>')), null);
  assert.equal(remoteCover('https://images.igdb.com/igdb/image/upload/t_cover_big_2x/abc.jpg'), 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/abc.jpg');
  assert.equal(remoteCover('http://images.igdb.com/a.jpg'), null);
  assert.equal(remoteCover('https://evil.example/a.jpg'), null);
});

test('adding, editing and removing: the cover is saved locally and an IGDB pick becomes the match', async () => {
  const root = await tempRoot();
  try {
    const fetchImpl = async url => { assert.match(url, /^https:\/\/images\.igdb\.com\//); return response(PNG, { type: 'image/png' }); };
    const game = await addGame(root, { name: 'Chrono Trigger', platform: 'Super Nintendo Entertainment System', year: 1995, igdbId: 1802, coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1.jpg' }, { fetchImpl });
    assert.match(game.id, /^manual-[a-f0-9]{12}$/);
    assert.match(game.coverFile, /^manual-[a-f0-9]{12}-[a-f0-9]{6}\.png$/);
    assert.deepEqual((await readCover(root, game.coverFile)).type, 'image/png');
    assert.equal(await readCover(root, '../manual-games.json'), null);
    assert.deepEqual((await readOverrides(root)).overrides[`owned:${game.id}`].igdbId, 1802);
    // A cover that can't be fetched keeps its link; an Atlas cover is used as it is.
    assert.equal((await addGame(root, { name: 'A', platform: 'SNES', coverUrl: 'https://images.igdb.com/x.jpg' }, { fetchImpl: async () => { throw new Error('offline'); } })).cover, 'https://images.igdb.com/x.jpg');
    assert.equal((await addGame(root, { name: 'B', platform: 'SNES', coverUrl: '../assets/covers/b.png' })).cover, '../assets/covers/b.png');
    assert.equal((await addGame(root, { name: 'C', platform: 'SNES', coverUrl: 'javascript:alert(1)' })).cover, '');

    const edited = await editGame(root, game.id, { name: 'Chrono Trigger (SNES)', year: 1996, ownedOn: 'Nintendo' });
    assert.deepEqual([edited.name, edited.year, edited.ownedOn, edited.platform, edited.igdbId, edited.coverFile], ['Chrono Trigger (SNES)', 1996, 'Nintendo', 'Super Nintendo Entertainment System', 1802, game.coverFile]);
    // Your own picture replaces the old one; none clears it.
    const own = await setCover(root, game.id, JPEG);
    assert.match(own.coverFile, /\.jpg$/);
    assert.deepEqual(await readdir(path.join(root, 'library/data/covers')), [own.coverFile]);
    await assert.rejects(setCover(root, game.id, Buffer.from('not a picture')), /PNG, JPEG or WebP/);
    assert.equal((await setCover(root, game.id, null)).coverFile, null);
    assert.deepEqual(await readdir(path.join(root, 'library/data/covers')), []);

    await removeGame(root, game.id);
    assert.equal((await readManual(root)).games.length, 3);
    assert.equal((await readOverrides(root)).overrides[`owned:${game.id}`], undefined);
    await assert.rejects(editGame(root, game.id, {}), /isn’t in your library/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('in the library: a game you already have gets the new copy; anything else is its own entry', () => {
  const games = [{ id: 'g1', name: 'Hades', year: 2020, platforms: ['PC (Windows)'], sources: ['Steam'], cover: '', search: 'hades', copies: [{ id: 'steam-1145360', name: 'Hades', platforms: ['PC (Windows)'], sources: ['Steam'] }] },
    { id: 'g2', name: 'Doom', year: 1993, platforms: ['PC (DOS)'], sources: ['GOG'], copies: [{ id: 'gog-1', name: 'Doom' }] }];
  const groups = manualGroups({ games: [
    { id: 'manual-aaaaaaaaaaaa', name: 'Hades', platform: 'Nintendo Switch', year: 2020, ownedOn: 'Physical', coverFile: 'manual-aaaaaaaaaaaa-abcdef.png', genres: ['Roguelike'] },
    { id: 'manual-bbbbbbbbbbbb', name: 'DOOM', platform: 'PlayStation 4', year: 2016, ownedOn: 'PlayStation', steamAppId: null, cover: '' }] });
  assert.equal(groups[0].cover, '/__retro_library/cover/manual-aaaaaaaaaaaa-abcdef.png');
  assert.deepEqual(groups[0].copies[0], { id: 'manual-aaaaaaaaaaaa', name: 'Hades', manual: true, platforms: ['Nintendo Switch'], sources: ['Physical'], year: 2020, releaseDate: '2020', playCount: 0, timePlayed: 0, played: false, hidden: false });
  mergeManual(games, groups);
  assert.deepEqual(games.map(game => [game.id, game.copies.length]), [['g1', 2], ['g2', 1], ['manual-bbbbbbbbbbbb', 1]]);
  assert.deepEqual([games[0].platforms, games[0].sources, games[0].duplicate, games[0].cover], [['PC (Windows)', 'Nintendo Switch'], ['Steam', 'Physical'], true, '/__retro_library/cover/manual-aaaaaaaaaaaa-abcdef.png']);
});

test('platform names follow the library’s, from the Atlas’s systems and IGDB’s platforms', () => {
  assert.equal(systemName('switch', catalog), 'Nintendo Switch');
  assert.equal(systemName('tg16', catalog), 'TurboGrafx-16');
  assert.equal(systemName('pc', catalog), 'PC (Windows)');
  assert.equal(igdbPlatformName({ id: 19, name: 'Super Nintendo Entertainment System' }, catalog), 'Super Nintendo Entertainment System');
  assert.equal(igdbPlatformName({ id: 6, name: 'PC (Microsoft Windows)' }, catalog), 'PC (Windows)');
  assert.equal(igdbPlatformName({ id: 14, name: 'Mac' }, catalog), 'macOS');
  assert.equal(igdbPlatformName({ id: 471, name: 'Meta Quest 3' }, catalog), 'Meta Quest 3');
});

test('search: the Atlas by title or alias, IGDB with the typed title first, Steam games only', async () => {
  assert.deepEqual(searchAtlas(catalog, 'chrono').map(result => [result.title, result.platforms, result.cover, result.atlasId]), [['Chrono Trigger', ['Super Nintendo Entertainment System'], '../assets/covers/chrono-trigger.png', 'snes-1']]);
  assert.equal(searchAtlas(catalog, 'mario bros 4')[0].title, 'Super Mario World');
  assert.deepEqual(searchAtlas(catalog, 'x'), []);

  let asked;
  const igdb = await searchIgdb('Chrono Trigger', async (endpoint, body) => { asked = body; return [
    { id: 2, name: 'Chrono Trigger: Jet Bike Special', game_type: 4, total_rating_count: 0, platforms: [{ id: 58, name: 'Super Famicom' }] },
    { id: 1, name: 'Chrono Trigger', game_type: 0, total_rating_count: 1394, first_release_date: 795225600, cover: { image_id: 'co1' }, platforms: [{ id: 19, name: 'SNES' }, { id: 20, name: 'DS' }],
      release_dates: [{ platform: 19, y: 1995 }, { platform: 20, y: 2008 }, { platform: 20, y: 2009 }], genres: [{ name: 'RPG' }], external_games: [{ external_game_source: 1, uid: '613830' }],
      involved_companies: [{ developer: true, company: { name: 'Square' } }, { publisher: true, company: { name: 'Square' } }] },
    { id: 3, name: 'Chrono Trigger', game_type: 10, version_parent: 1, total_rating_count: 56 }]; }, catalog);
  assert.match(asked, /search "Chrono Trigger"; where game_type != \(1,5,6,7,13,14\)/);
  assert.deepEqual(igdb.map(result => result.igdbId), [1, 3, 2]);
  assert.deepEqual([igdb[0].year, igdb[0].platforms, igdb[0].years, igdb[0].steamAppId, igdb[0].developers, igdb[0].cover],
    [1995, ['Super Nintendo Entertainment System', 'DS'], { 'Super Nintendo Entertainment System': 1995, DS: 2008 }, '613830', ['Square'], 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1.jpg']);

  const fetchImpl = async url => { assert.match(url, /storesearch\/\?term=hollow%20knight/); return response({ items: [{ type: 'app', id: 367520, name: 'Hollow Knight' }, { type: 'app', id: 598190, name: 'Hollow Knight OST' }] }); };
  const steam = await searchSteam('hollow knight', { fetchImpl, details: async () => new Map([['367520', { type: 0, released: 1488326400, cover: 'https://shared.akamai.steamstatic.com/c.jpg' }], ['598190', { type: 11 }]]) });
  assert.deepEqual(steam.map(result => [result.title, result.year, result.steamAppId, result.platforms]), [['Hollow Knight', 2017, '367520', ['PC (Windows)']]]);

  // IGDB's results first, then Atlas games they don't already show.
  assert.deepEqual(combineResults(igdb.slice(0, 1), searchAtlas(catalog, 'chrono')).map(result => result.source), ['igdb']);
  assert.deepEqual(combineResults(steam, searchAtlas(catalog, 'chrono')).map(result => result.source), ['steam', 'atlas']);
});

test('games you add are your library even before any import, and never join the sample', async () => {
  const root = await tempRoot();
  try {
    await mkdir(path.join(root, 'library/sample'), { recursive: true });
    await mkdir(path.join(root, 'data'), { recursive: true });
    await writeFile(path.join(root, 'data/catalog.json'), JSON.stringify(catalog));
    await writeFile(path.join(root, 'library/sample/library-data.js'), 'window.PLAYNITE_LIBRARY = [{"id":"sample","name":"Sample","platforms":[],"sources":[],"copies":[{"id":"s1","name":"Sample"}]}];');
    await writeFile(path.join(root, 'library/sample/wishlist-data.js'), 'window.STEAM_WISHLIST = [];');
    const before = await readSnapshot(root, { local: true });
    assert.equal(before.connections.sample, true);
    await addGame(root, { name: 'Chrono Trigger', platform: 'SNES', year: 1995 });
    const after = await readSnapshot(root, { local: true });
    assert.equal(after.connections.sample, false);
    assert.deepEqual(JSON.parse(JSON.stringify(parseData(after.owned.source, 'PLAYNITE_LIBRARY').PLAYNITE_LIBRARY.map(game => [game.name, game.manual]))), [['Chrono Trigger', true]]);
    // A shareable build never includes them.
    assert.doesNotMatch((await readSnapshot(root, { local: false })).owned.source, /Chrono/);
    assert.match(await readFile(path.join(root, 'library/data/manual-games.json'), 'utf8'), /Chrono Trigger/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a game you already own on that platform and store can’t be added twice by mistake', async () => {
  const steam = { id: 's1', name: 'Hollow Knight', year: 2017, platforms: ['PC (Windows)'], sources: ['Steam'], steamAppId: '367520' };
  const ps = { id: 'p1', name: 'Hades', year: 2021, platforms: ['Sony PlayStation 4'], sources: ['PlayStation'], igdb: { id: 113112 } };
  const owned = [{ id: 'g1', name: 'Hollow Knight', year: 2017, copies: [steam] }, { id: 'g2', name: 'Hades', year: 2020, copies: [ps] }];
  // Editions count as the game; stores are compared without case.
  assert.equal(ownedCopyMatch({ name: 'Hollow Knight: Game of the Year Edition', platform: 'PC (Windows)', ownedOn: 'steam' }, steam), 'same');
  assert.equal(ownedCopyMatch({ name: 'Hollow Knight', platform: 'PC (Windows)', ownedOn: 'Steam' }, steam), 'same');
  assert.equal(ownedCopyMatch({ name: 'Anything', platform: 'PC (Windows)', ownedOn: 'Steam', steamAppId: 367520 }, steam), 'same');
  assert.equal(ownedCopyMatch({ name: 'Hollow Knight', platform: 'PC (Windows)', ownedOn: 'GOG' }, steam), 'platform');
  assert.equal(ownedCopyMatch({ name: 'Hollow Knight', platform: 'Nintendo Switch', ownedOn: 'Physical' }, steam), 'other');
  assert.equal(ownedCopyMatch({ name: 'Hollow Knight', year: 2030, platform: 'PC (Windows)', ownedOn: 'Steam' }, steam), null);
  // The same IGDB game counts whatever the title; "PlayStation 4" is Playnite's "Sony PlayStation 4".
  assert.equal(ownedCopyMatch({ name: 'HADES', platform: 'PlayStation 4', ownedOn: 'PlayStation', igdbId: 113112 }, ps), 'same');
  assert.deepEqual(ownedMatches(owned, { name: 'Hades', platform: 'Nintendo Switch', ownedOn: 'Physical' }).map(match => [match.copy.id, match.level]), [['p1', 'other']]);

  const root = await tempRoot();
  try {
    await assert.rejects(addGame(root, { name: 'Hades', platform: 'PlayStation 4', ownedOn: 'PlayStation' }, { owned }), /already in your library on PlayStation 4 \(PlayStation\)/);
    const physical = await addGame(root, { name: 'Hades', platform: 'PlayStation 4', ownedOn: 'Physical' }, { owned });
    const mine = mergeManual(structuredClone(owned), manualGroups(await readManual(root)));
    await assert.rejects(addGame(root, { name: 'Hades', platform: 'PlayStation 4', ownedOn: 'Physical' }, { owned: mine }), /already in your library/);
    // Editing it is fine, as long as it doesn't become a duplicate of another copy.
    assert.equal((await editGame(root, physical.id, { year: 2021 }, { owned: mine })).year, 2021);
    await assert.rejects(editGame(root, physical.id, { ownedOn: 'PlayStation' }, { owned: mine }), /already in your library/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('fixing an imported game: only what differs is kept, it applies on top of every import, and can be undone', async () => {
  const imported = () => [{ id: 'g1', name: 'Halo MCC', year: 2019, releaseDate: '2019-12-03', platforms: ['PC (Windows)'], sources: ['Steam'], cover: 'old.jpg', search: 'halo mcc',
    copies: [{ id: 'steam-976730', name: 'Halo MCC', year: 2019, platforms: ['PC (Windows)'], sources: ['Steam'] }] },
    { id: 'g2', name: 'Doom', year: 1993, platforms: ['PC (DOS)'], sources: ['GOG', 'Steam'], copies: [{ id: 'gog-1', name: 'Doom', platforms: ['PC (DOS)'], sources: ['GOG'] }, { id: 'steam-2280', name: 'Doom', platforms: ['PC (DOS)'], sources: ['Steam'] }] },
    { id: 'manual-aaaaaaaaaaaa', name: 'Mine', copies: [{ id: 'manual-aaaaaaaaaaaa', manual: true, name: 'Mine' }] }];
  const now = new Date('2026-10-10T00:00:00Z');
  assert.deepEqual(validateCorrection({ name: 'Halo MCC', year: '2014', platform: '' }, { name: 'Halo MCC', year: 2019, platform: 'PC (Windows)' }, now), { year: 2014 });
  assert.throws(() => validateCorrection({ year: 1900 }, { name: 'x' }, now), /between 1950/);
  const root = await tempRoot();
  try {
    const owned = imported();
    await assert.rejects(saveCorrection(root, 'manual-aaaaaaaaaaaa', { name: 'x' }, { owned }), /isn’t in your imported library/);
    await assert.rejects(saveCorrection(root, 'nope', { name: 'x' }, { owned }), /isn’t in your imported library/);
    const fetchImpl = async () => response(PNG, { type: 'image/png' });
    await saveCorrection(root, 'steam-976730', { name: 'Halo: The Master Chief Collection', year: 2019, platform: 'PC (Windows)', coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/halo.jpg' }, { owned, fetchImpl, now });
    await saveCorrection(root, 'steam-2280', { name: 'Doom', year: '1993', platform: 'PC (Windows)' }, { owned, now });
    const saved = await readCorrections(root);
    assert.deepEqual(Object.keys(saved.copies).sort(), ['steam-2280', 'steam-976730']);
    assert.equal(saved.copies['steam-976730'].year, undefined);
    assert.match(saved.copies['steam-976730'].coverFile, /^fix-[a-f0-9]{12}-[a-f0-9]{6}\.png$/);
    assert.deepEqual((await correctionOf(root, 'steam-976730', owned)).imported, { name: 'Halo MCC', year: 2019, platform: 'PC (Windows)', cover: 'old.jpg', sources: ['Steam'] });

    // On top of a fresh import: the title and cover are the game's, a second copy's fix stays its own.
    const games = applyCorrections(imported(), saved);
    assert.deepEqual([games[0].name, games[0].copies[0].name, games[0].cover, games[0].copies[0].corrected], ['Halo: The Master Chief Collection', 'Halo: The Master Chief Collection', `/__retro_library/cover/${saved.copies['steam-976730'].coverFile}`, true]);
    assert.deepEqual([games[1].name, games[1].platforms, games[1].copies[1].platforms], ['Doom', ['PC (DOS)', 'PC (Windows)'], ['PC (Windows)']]);
    assert.match(games[0].search, /master chief/);

    // Your own picture, then back to the imported one; undo removes everything.
    const own = await setCorrectionCover(root, 'steam-2280', JPEG, { owned });
    assert.match(own.coverFile, /\.jpg$/);
    assert.equal((await setCorrectionCover(root, 'steam-2280', null, { owned })).coverFile, null);
    await resetCorrection(root, 'steam-976730');
    assert.deepEqual(Object.keys((await readCorrections(root)).copies), ['steam-2280']);
    assert.deepEqual(await readdir(path.join(root, 'library/data/covers')), []);
    // Saving what the import already says leaves nothing behind.
    await saveCorrection(root, 'steam-2280', { name: 'Doom', platform: 'PC (DOS)' }, { owned, now });
    assert.deepEqual((await readCorrections(root)).copies, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

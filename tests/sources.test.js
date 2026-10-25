import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseSteamInput, parseLoginUsers, wishlistExport, steamOwnedRows, galaxyRow, readGalaxy, parseGamelist, romId, importSteamWishlist, importSteamOwned, importEsde, scoreKeys, parseLibraryFolders, parseAppManifest, steamInstalledRows, importSteamInstalled, updateSecrets, checkIgdbKeys, checkVgcKey } from '../scripts/sources.mjs';
import { romGroups, withoutOwnedDuplicates, scanFolders } from '../scripts/roms.mjs';
import { checkWishlistJson } from '../scripts/update-all.mjs';

const json = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
// A small SQLite file: with Node's built-in SQLite (22+), else Python's sqlite3 (Node 20).
async function sqliteFile(file, sql) {
  try { const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(file); db.exec(sql); db.close(); return; }
  catch (error) { if (!/node:sqlite|No such built-in module/i.test(String(error?.message))) throw error; }
  execFileSync('python3', ['-c', 'import sqlite3, sys\nwith sqlite3.connect(sys.argv[1]) as db: db.executescript(sys.stdin.read())', file], { input: sql });
}
const tempRoot = () => mkdtemp(path.join(tmpdir(), 'sources-'));

test('a Steam profile link, wishlist link, id or custom name all identify the account', () => {
  assert.deepEqual(parseSteamInput('https://steamcommunity.com/profiles/76561197960287930/'), { steamId: '76561197960287930' });
  assert.deepEqual(parseSteamInput('https://store.steampowered.com/wishlist/profiles/76561197960287930/#sort=order'), { steamId: '76561197960287930' });
  assert.deepEqual(parseSteamInput('https://steamcommunity.com/id/gabelogannewell'), { vanity: 'gabelogannewell' });
  assert.deepEqual(parseSteamInput('https://store.steampowered.com/wishlist/id/someone/'), { vanity: 'someone' });
  assert.deepEqual(parseSteamInput(' 76561197960287930 '), { steamId: '76561197960287930' });
  assert.equal(parseSteamInput('https://example.com/not steam'), null);
});

test('accounts signed in on this computer come from Steam’s loginusers.vdf, most recent first', () => {
  const vdf = `"users"\n{\n\t"76561190000000001"\n\t{\n\t\t"AccountName"\t\t"old"\n\t\t"PersonaName"\t\t"Old Me"\n\t\t"MostRecent"\t\t"0"\n\t\t"Timestamp"\t\t"100"\n\t}\n\t"76561190000000002"\n\t{\n\t\t"AccountName"\t\t"me"\n\t\t"PersonaName"\t\t"Player"\n\t\t"MostRecent"\t\t"1"\n\t\t"Timestamp"\t\t"200"\n\t}\n}`;
  assert.deepEqual(parseLoginUsers(vdf).map(user => [user.steamId, user.persona, user.mostRecent]), [['76561190000000002', 'Player', true], ['76561190000000001', 'Old Me', false]]);
});

test('a wishlist from a link is written like a browser export, so the wishlist builder reads it unchanged', async () => {
  const details = new Map([['1700', { name: 'Arx Fatalis', released: Date.UTC(2007, 3, 3) / 1000, price: '£1.31', discount: 67, reviews: { count: 2447, percPositive: 87 } }]]);
  const file = wishlistExport([{ appid: 1700, priority: 0, date_added: Date.UTC(2026, 2, 26) / 1000 }, { appid: 99, priority: 1, date_added: 0 }], details, { steamId: '1', fetchedAt: 'now' });
  assert.deepEqual(file.data[0], { gameid: ['steam', 'app/1700'], title: 'Arx Fatalis', url: 'https://store.steampowered.com/app/1700/', added_date: '3/26/2026', release_date: '4/3/2007', note: null, price: '£1.31', discount: 67, reviews: { count: 2447, percPositive: 87 }, priority: 0 });
  assert.equal(file.data[1].title, 'Steam app 99');
  assert.equal(checkWishlistJson(Buffer.from(JSON.stringify(file))), 2);
});

test('importing a wishlist explains a private or empty one; a good one lands where Update data reads it', async () => {
  const root = await tempRoot();
  try {
    await assert.rejects(importSteamWishlist(root, '76561190000000002', { fetchImpl: async () => json({ response: {} }) }), /private/);
    const fetchImpl = async url => String(url).includes('GetWishlist') ? json({ response: { items: [{ appid: 1700, priority: 0, date_added: 1 }] } })
      : json({ response: { store_items: [{ appid: 1700, name: 'Arx Fatalis', release: { steam_release_date: 1175583600 }, reviews: { summary_filtered: { review_count: 10, percent_positive: 90 } } }] } });
    assert.equal((await importSteamWishlist(root, '76561190000000002', { fetchImpl })).count, 1);
    const saved = JSON.parse(await readFile(path.join(root, 'library/steam-wishlist.json'), 'utf8'));
    assert.equal(saved.data[0].title, 'Arx Fatalis'); assert.deepEqual(saved.data[0].reviews, { count: 10, percPositive: 90 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('owned Steam games need a valid key and public game details; they become library rows with play time', async () => {
  const root = await tempRoot();
  try {
    await assert.rejects(importSteamOwned(root, '76561190000000002', 'short'), /32 letters/);
    await assert.rejects(importSteamOwned(root, '76561190000000002', 'A'.repeat(32), { fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) }), /didn’t accept that key/);
    await assert.rejects(importSteamOwned(root, '76561190000000002', 'A'.repeat(32), { fetchImpl: async () => json({ response: {} }) }), /private/);
  } finally { await rm(root, { recursive: true, force: true }); }
  const rows = steamOwnedRows([{ appid: 620, name: 'Portal 2', playtime_forever: 90, rtime_last_played: 1700000000 }], new Map([['620', { released: 1303171200, developers: ['Valve'], cover: 'c.jpg' }]]));
  assert.deepEqual({ ...rows[0], lastPlayed: Boolean(rows[0].lastPlayed) }, { id: 'steam-620', name: 'Portal 2', platforms: ['PC (Windows)'], sources: ['Steam'], steamAppId: '620', storeKey: 'steam:620',
    releaseDate: '2011-04-19', timePlayed: 5400, playCount: 1, lastPlayed: true, developers: ['Valve'], publishers: [], genres: [], summary: '', cover: 'c.jpg', background: '', hidden: false, importSource: 'steam' });
});

test('Steam’s library folders and app files: every drive, installed apps only', () => {
  const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t\t"apps"\n\t\t{\n\t\t\t"620"\t\t"123"\n\t\t}\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}';
  assert.deepEqual(parseLibraryFolders(vdf), ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  // The older format lists folders by number.
  assert.deepEqual(parseLibraryFolders('"LibraryFolders"\n{\n\t"TimeNextStatsReport"\t\t"1"\n\t"1"\t\t"E:\\\\Games\\\\Steam"\n}'), ['E:\\Games\\Steam']);
  const acf = '"AppState"\n{\n\t"appid"\t\t"620"\n\t"name"\t\t"Portal 2 \\"Deluxe\\""\n\t"StateFlags"\t\t"6"\n\t"LastPlayed"\t\t"1700000000"\n\t"LastOwner"\t\t"76561190000000003"\n\t"UserConfig"\n\t{\n\t\t"name"\t\t"other"\n\t}\n}';
  assert.deepEqual(parseAppManifest(acf), { appid: '620', name: 'Portal 2 "Deluxe"', installed: true, lastPlayed: 1700000000, owner: '76561190000000003' });
  assert.equal(parseAppManifest(acf.replace('"6"', '"1026"')).installed, false);
  assert.equal(parseAppManifest('not a manifest'), null);
});

test('installed Steam games: only games, and the ones another account’s licence installed are Family Sharing', () => {
  const me = '76561190000000002', sibling = '76561190000000003';
  const apps = [{ appid: '400', name: 'Portal', lastPlayed: 1700000000, owner: me }, { appid: '620', name: 'Portal 2', lastPlayed: 0, owner: sibling },
    { appid: '219152', name: 'Hotline Miami Soundtrack', owner: me }, { appid: '204075', name: 'Sword & Sworcery EP - Soundtrack', owner: me }, { appid: '1493710', name: 'Proton Experimental', owner: me }, { appid: '70', name: 'Half-Life', owner: '0' }];
  const details = new Map([['400', { type: 0, name: 'Portal', released: 1191974400 }], ['620', { type: 0 }], ['219152', { type: 11 }]]);
  const rows = steamInstalledRows(apps, details, { you: me });
  assert.deepEqual(rows.map(row => [row.id, row.name, row.sources, row.familySharing]), [['steam-400', 'Portal', ['Steam'], false], ['steam-620', 'Portal 2', ['Steam', 'Family Sharing'], true], ['steam-70', 'Half-Life', ['Steam'], false]]);
  assert.deepEqual([rows[0].storeKey, rows[0].releaseDate, rows[0].playCount, rows[0].importSource], ['steam:400', '2007-10-10', 1, 'steam-installed']);
  // No licence owner in Steam's file: the owned games list (Web API key) decides.
  assert.deepEqual(steamInstalledRows(apps.slice(4), new Map(), { you: me, owned: new Set(['400']) })[0].sources, ['Steam', 'Family Sharing']);
});

test('importing installed Steam games reads every library folder Steam lists', async () => {
  const root = await tempRoot(), home = await tempRoot();
  const steam = path.join(home, 'Library/Application Support/Steam'), drive = path.join(home, 'Games/SteamLibrary');
  const manifest = (folder, appid, name, flags, owner) => writeFile(path.join(folder, 'steamapps', `appmanifest_${appid}.acf`), `"AppState"\n{\n\t"appid"\t\t"${appid}"\n\t"name"\t\t"${name}"\n\t"StateFlags"\t\t"${flags}"\n\t"LastOwner"\t\t"${owner}"\n}`);
  try {
    await assert.rejects(importSteamInstalled(root, { home, platform: 'darwin' }), /isn’t installed/);
    for (const folder of [steam, drive]) await mkdir(path.join(folder, 'steamapps'), { recursive: true });
    await mkdir(path.join(steam, 'config'));
    await writeFile(path.join(steam, 'config', 'loginusers.vdf'), '"users"\n{\n\t"76561190000000002"\n\t{\n\t\t"PersonaName"\t\t"Player"\n\t\t"MostRecent"\t\t"1"\n\t}\n}');
    await writeFile(path.join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${drive}/"\n\t}\n}`);
    await manifest(steam, 400, 'Portal', 4, '76561190000000002');
    await manifest(steam, 500, 'Left 4 Dead', 1026, '76561190000000002');
    await manifest(drive, 620, 'Portal 2', 4, '76561190000000003');
    const fetchImpl = async () => json({ response: { store_items: [{ appid: 620, success: 1, type: 0, name: 'Portal 2', basic_info: { developers: [{ name: 'Valve' }] } }] } });
    const result = await importSteamInstalled(root, { home, platform: 'darwin', fetchImpl });
    assert.deepEqual([result.count, result.shared, result.folders], [2, 1, 2]);
    const saved = JSON.parse(await readFile(path.join(root, 'library/data/sources/steam-installed.json'), 'utf8'));
    assert.deepEqual([saved.kind, saved.source], ['owned', 'steam-installed']);
    assert.deepEqual(saved.games.map(game => [game.name, game.sources, game.developers]), [['Portal', ['Steam'], []], ['Portal 2', ['Steam', 'Family Sharing'], ['Valve']]]);
    // Nobody's Steam ID is kept.
    assert.ok(!JSON.stringify(saved).includes('7656119'));
    // Offline, Steam's own names are enough.
    assert.equal((await importSteamInstalled(root, { home, platform: 'darwin', fetchImpl: async () => { throw new Error('offline'); } })).count, 2);
  } finally { await rm(root, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});

test('GOG Galaxy releases become rows named like Playnite’s stores; DLC and folded releases stay out', async () => {
  const row = galaxyRow({ releaseKey: 'epic_Flier', minutes: 30, lastPlayed: '2024-01-02 03:04:05', hidden: true },
    { title: { title: 'Gone Home' }, originalMeta: { releaseDate: 1376524800, developers: ['Fullbright'], genres: ['Adventure'] }, summary: { summary: 'A house.' }, originalImages: { verticalCover: 'v.webp' } });
  assert.deepEqual([row.id, row.name, row.sources, row.platforms, row.storeKey, row.releaseDate, row.timePlayed, row.lastPlayed, row.hidden, row.cover],
    ['epic-Flier', 'Gone Home', ['Epic'], ['PC (Windows)'], 'epic:Flier', '2013-08-15', 1800, '2024-01-02T03:04:05.000Z', true, 'v.webp']);
  assert.equal(galaxyRow({ releaseKey: 'steam_620' }, {}).steamAppId, '620');
  assert.deepEqual(galaxyRow({ releaseKey: 'psn_ABC' }, {}).platforms, ['Sony PlayStation 4']);

  const root = await tempRoot(), file = path.join(root, 'galaxy-2.0.db');
  try {
    await sqliteFile(file, `CREATE TABLE LibraryReleases (id INTEGER, userId INT64, releaseKey TEXT); CREATE TABLE GamePieceTypes (id INTEGER, type TEXT);
      CREATE TABLE GamePieces (releaseKey TEXT, gamePieceTypeId INTEGER, userId INT64, value TEXT, languageId INTEGER); CREATE TABLE ReleaseProperties (releaseKey TEXT, isDlc INTEGER, isVisibleInLibrary INTEGER, gameId TEXT);
      CREATE TABLE GameTimes (userId INT64, releaseKey TEXT, minutesInGame INTEGER); CREATE TABLE LastPlayedDates (userId INT64, gameReleaseKey TEXT, lastPlayedDate TEXT); CREATE TABLE UserReleaseProperties (userId INT64, releaseKey TEXT, isHidden BOOLEAN, hasTagsFetched BOOLEAN);
      INSERT INTO GamePieceTypes VALUES (953, 'title'), (1089, 'meta');
      INSERT INTO LibraryReleases VALUES (1, 46988566438726382, 'gog_1'), (2, 46988566438726382, 'gog_2'), (3, 46988566438726382, 'steam_3');
      INSERT INTO GamePieces VALUES ('gog_1', 953, 46988566438726382, '{"title":"Game"}', 0), ('gog_2', 953, 46988566438726382, '{"title":"Game DLC"}', 0), ('steam_3', 953, 46988566438726382, '{"title":"Other release"}', 0);
      INSERT INTO ReleaseProperties VALUES ('gog_1', 0, 1, 'a'), ('gog_2', 1, 1, 'a'), ('steam_3', 0, 0, 'a');
      INSERT INTO GameTimes VALUES (46988566438726382, 'gog_1', 42);`);
    assert.deepEqual((await readGalaxy(file)).map(game => [game.name, game.timePlayed]), [['Game', 2520]]);
    await writeFile(file, 'not a database');
    await assert.rejects(readGalaxy(file));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ES-DE gamelists give clean names and play stats, with the same ids a folder scan finds', async () => {
  const xml = `<?xml version="1.0"?><gameList><game><path>./Legend of Zelda, The - A Link to the Past (USA).sfc</path><name>The Legend of Zelda: A Link to the Past</name><desc>Hyrule &amp; more</desc><releasedate>19911121T000000</releasedate><developer>Nintendo</developer><genre>Action / Adventure</genre><rating>0.9</rating><playcount>3</playcount><lastplayed>20240105T201500</lastplayed><favorite>true</favorite></game></gameList>`;
  const [game] = parseGamelist(xml, 'snes');
  assert.deepEqual([game.title, game.fileTitle, game.summary, game.year, game.rating, game.playCount, game.lastPlayed, game.favorite],
    ['The Legend of Zelda: A Link to the Past', 'The Legend of Zelda - A Link to the Past', 'Hyrule & more', 1991, 90, 3, '2024-01-05', true]);

  const root = await tempRoot();
  try {
    const esde = path.join(root, 'ES-DE'), roms = path.join(root, 'ROMs', 'snes');
    await mkdir(path.join(esde, 'gamelists/snes'), { recursive: true }); await mkdir(path.join(esde, 'downloaded_media/snes/covers'), { recursive: true }); await mkdir(roms, { recursive: true });
    await writeFile(path.join(esde, 'gamelists/snes/gamelist.xml'), xml);
    await writeFile(path.join(esde, 'downloaded_media/snes/covers/Legend of Zelda, The - A Link to the Past (USA).png'), 'png');
    await writeFile(path.join(roms, 'Legend of Zelda, The - A Link to the Past (USA).sfc'), '');
    await writeFile(path.join(roms, 'Super Metroid (USA).sfc'), '');
    const imported = await importEsde(root, esde);
    assert.equal(imported.count, 1); assert.deepEqual(imported.systems, { snes: 1 });
    const esdeData = JSON.parse(await readFile(path.join(root, 'library/data/sources/esde.json'), 'utf8'));
    const scanned = await scanFolders([path.join(root, 'ROMs')]);
    assert.equal(esdeData.games[0].id, scanned.games.find(rom => rom.title.startsWith('The Legend')).id);
    assert.equal(esdeData.games[0].id, romId('snes', 'The Legend of Zelda - A Link to the Past'));
    // Folder scan + ES-DE: one entry per game, ES-DE's name, box art and play count.
    const catalog = { systems: [{ id: 'snes', name: 'SNES' }], games: [] };
    const groups = romGroups({ games: scanned.games }, catalog, esdeData);
    assert.equal(groups.length, 2);
    const zelda = groups.find(group => group.name.includes('Zelda'));
    assert.deepEqual([zelda.name, zelda.sources, zelda.playCount, zelda.favorite, zelda.genres, zelda.cover.startsWith('/__retro_library/esde-media/snes/covers/')],
      ['The Legend of Zelda: A Link to the Past', ['ROM folder', 'ES-DE'], 3, true, ['Action', 'Adventure'], true]);
    // A ROM you already have through Playnite (an emulated game) isn't added twice.
    const playnite = [{ name: 'Super Metroid', platforms: ['SNES'], copies: [{ name: 'Super Metroid', platforms: ['Nintendo SNES'] }] }];
    assert.deepEqual(withoutOwnedDuplicates(groups, playnite).map(group => group.name), ['The Legend of Zelda: A Link to the Past']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('score keys: your saved ones win over the environment, and only which is set is reported', async () => {
  const root = await tempRoot();
  try {
    const env = { IGDB_CLIENT_ID: 'e'.repeat(30), IGDB_CLIENT_SECRET: 'f'.repeat(30), VGC_API_KEY: 'vgc_environment' };
    assert.deepEqual(await scoreKeys(root, {}), { igdb: null, igdbSource: null, vgc: null, vgcSource: null });
    assert.equal((await scoreKeys(root, env)).igdbSource, 'environment');
    await updateSecrets(root, secrets => { secrets.igdbClientId = 'a'.repeat(30); secrets.igdbClientSecret = 'b'.repeat(30); secrets.vgcApiKey = 'vgc_saved' });
    const keys = await scoreKeys(root, env);
    assert.deepEqual([keys.igdb.IGDB_CLIENT_ID, keys.igdbSource, keys.vgc, keys.vgcSource], ['a'.repeat(30), 'saved', 'vgc_saved', 'saved']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IGDB and VideoGamesCritic keys are checked with the service before they are saved', async () => {
  const id = 'a1'.repeat(15), secret = 'b2'.repeat(15), calls = [];
  const twitch = ({ token = 200, igdb = 200 } = {}) => async (url, options) => { calls.push(url);
    return url.includes('twitch') ? { ok: token === 200, status: token, json: async () => ({ access_token: 'token' }) } : { ok: igdb === 200, status: igdb, json: async () => ([]) }; };
  await assert.rejects(checkIgdbKeys('short', secret, { fetchImpl: twitch() }), /Client ID and the Client Secret/);
  assert.equal(calls.length, 0);
  await assert.rejects(checkIgdbKeys(id, secret, { fetchImpl: twitch({ token: 400 }) }), /didn’t accept/);
  await assert.rejects(checkIgdbKeys(id, secret, { fetchImpl: twitch({ igdb: 401 }) }), /Confidential/);
  assert.deepEqual(await checkIgdbKeys(` ${id} `, secret, { fetchImpl: twitch() }), { clientId: id, clientSecret: secret });
  const vgc = status => async () => ({ ok: status === 200, status });
  await assert.rejects(checkVgcKey('vgc_', { fetchImpl: vgc(200) }), /whole key/);
  await assert.rejects(checkVgcKey('vgc_abcdefghijkl', { fetchImpl: vgc(401) }), /didn’t accept/);
  // A game VGC doesn't know still proves the key works.
  assert.equal(await checkVgcKey(' vgc_abcdefghijkl ', { fetchImpl: vgc(404) }), 'vgc_abcdefghijkl');
});

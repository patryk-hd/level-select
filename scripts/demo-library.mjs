// Builds the demo library that a fresh copy (and the public site) shows before you import
// your own games: npm run sample:build
// Real games with public data only: box art and review scores from data/catalog.json, the
// wishlist's store facts from Steam's public store API. Which store each copy is on, play
// time and what you've finished are invented. The first three games and wishlist entries are
// the original fixtures the tests and browser checks use, kept as they were.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseData } from './snapshot.mjs';
import { titleKey } from '../library/core.js';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('data/catalog.json', root), 'utf8'));
const offline = process.argv.includes('--offline');

// [system, title, stores (PC) or one store, extra copies [system, store]]
const PC = 'PC (Windows)';
const OWNED = [
  ['pc', "Baldur's Gate 3", 'Steam'], ['pc', 'The Witcher 3: Wild Hunt', 'GOG', [['ps4', 'PlayStation']]], ['pc', 'Elden Ring', 'Steam', [['ps5', 'PlayStation']]],
  ['pc', 'Disco Elysium', 'GOG'], ['pc', 'Hollow Knight', 'Steam', [['switch', 'Nintendo']]], ['pc', 'Portal 2', 'Steam'], ['pc', 'Clair Obscur: Expedition 33', 'Steam'],
  ['pc', 'Hollow Knight: Silksong', 'Steam'], ['pc', 'Mass Effect 2', 'EA app'], ['pc', 'Half-Life 2', 'Steam'], ['pc', 'NieR: Automata', 'Steam'], ['pc', 'Sekiro: Shadows Die Twice', 'Steam'],
  ['pc', 'Resident Evil 4', 'Steam'], ['pc', 'Kingdom Come: Deliverance II', 'Steam'], ['pc', 'Persona 5 Royal', 'Steam'], ['pc', 'Red Dead Redemption 2', 'Epic'],
  ['ps4', 'Cyberpunk 2077', 'PlayStation'], ['pc', 'Hades', 'Epic', [['switch', 'Nintendo']]], ['pc', 'Celeste', 'Epic'], ['pc', 'Stardew Valley', 'Steam'], ['pc', 'Outer Wilds', 'Epic'],
  ['pc', 'Yakuza 0', 'Steam'], ['switch', 'Dead Cells', 'Nintendo'], ['pc', 'Divinity: Original Sin II', 'GOG'], ['pc', 'Dishonored', 'Epic'], ['pc', 'Alan Wake 2', 'Epic'],
  ['pc', 'Death Stranding', 'Epic'], ['pc', 'Ori and the Will of the Wisps', 'Steam'], ['xone', 'Cuphead', 'Xbox'], ['pc', 'Black Myth: Wukong', 'Steam'], ['pc', 'Age of Empires II: Definitive Edition', 'Steam'], ['pc', 'Balatro', 'Steam'],
  ['pc', 'Return of the Obra Dinn', 'GOG'], ['pc', 'Dead Space', 'EA app'], ['pc', 'Fallout: New Vegas', 'GOG'], ['pc', 'The Elder Scrolls V: Skyrim', 'Steam'],
  ['pc', 'Hades II', 'Steam'], ['pc', 'Mass Effect Legendary Edition', 'EA app'], ['ps4', 'Monster Hunter World', 'PlayStation'], ['ps4', 'Final Fantasy VII Remake', 'PlayStation'],
  ['pc', 'Diablo II', 'Battle.net'], ['x360', 'Assassin\'s Creed II', 'Xbox'], ['pc', 'BioShock', 'Steam'], ['pc', 'Dark Souls III', 'Steam'], ['pc', 'Undertale', 'GOG'],
  ['ps5', 'Astro Bot', 'PlayStation'], ['ps5', 'God of War Ragnarok', 'PlayStation'], ['ps5', 'The Last of Us Part I', 'PlayStation'], ['ps5', 'Silent Hill 2', 'PlayStation'],
  ['ps5', 'It Takes Two', 'PlayStation'], ['ps5', 'Split Fiction', 'PlayStation'], ['ps5', 'Ghost of Yotei', 'PlayStation'], ['ps5', 'Spider-Man 2', 'PlayStation'],
  ['ps4', 'Bloodborne', 'PlayStation'], ['ps4', "Uncharted 4: A Thief's End", 'PlayStation'], ['ps4', 'God of War', 'PlayStation'], ['ps4', 'The Last of Us Part II', 'PlayStation'],
  ['ps4', 'Ghost of Tsushima', 'PlayStation'], ['ps4', 'Persona 5', 'PlayStation'],
  ['switch', 'The Legend of Zelda: Breath of the Wild', 'Nintendo'], ['switch', 'The Legend of Zelda: Tears of the Kingdom', 'Nintendo'], ['switch', 'Super Mario Odyssey', 'Nintendo'],
  ['switch', 'Super Smash Bros. Ultimate', 'Nintendo'], ['switch', 'Super Mario Bros. Wonder', 'Nintendo'], ['switch', 'Metroid Dread', 'Nintendo'], ['switch', 'Mario Kart 8 Deluxe', 'Nintendo'],
  ['switch', 'Animal Crossing: New Horizons', 'Nintendo'], ['switch', 'Xenoblade Chronicles 3', 'Nintendo'], ['switch', 'Fire Emblem: Three Houses', 'Nintendo'], ['switch', 'Pikmin 4', 'Nintendo'],
  ['xsx', 'Forza Horizon 5', 'Xbox'], ['xsx', 'Indiana Jones and the Great Circle', 'Xbox'], ['x360', 'Halo 3', 'Xbox'], ['x360', 'Red Dead Redemption', 'Xbox'], ['x360', 'Gears of War', 'Xbox'],
  // Retro, as your emulators know them.
  ['snes', 'Super Mario World', 'ES-DE'], ['snes', 'The Legend of Zelda: A Link to the Past', 'ES-DE'], ['snes', 'Final Fantasy VI', 'ES-DE'], ['snes', 'EarthBound', 'ES-DE'],
  ['snes', "Super Mario World 2: Yoshi's Island", 'ES-DE'], ['snes', 'Donkey Kong Country 2: Diddy\'s Kong Quest', 'ES-DE'], ['snes', 'Super Mario Kart', 'ES-DE'], ['snes', 'Secret of Mana', 'ES-DE'],
  ['nes', 'Super Mario Bros. 3', 'ES-DE'], ['nes', 'The Legend of Zelda', 'ES-DE'], ['nes', 'Mega Man 2', 'ES-DE'], ['nes', 'Castlevania', 'ES-DE'], ['nes', 'Metroid', 'ES-DE'], ['nes', "Mike Tyson's Punch-Out!!", 'ES-DE'],
  ['n64', 'Super Mario 64', 'ES-DE'], ['n64', 'The Legend of Zelda: Ocarina of Time', 'ES-DE'], ['n64', "The Legend of Zelda: Majora's Mask", 'ES-DE'], ['n64', 'GoldenEye 007', 'ES-DE'],
  ['n64', 'Banjo-Kazooie', 'ES-DE'], ['n64', 'Mario Kart 64', 'ES-DE'], ['n64', 'Paper Mario', 'ES-DE'],
  ['ps1', 'Final Fantasy VII', 'ES-DE'], ['ps1', 'Metal Gear Solid', 'ES-DE'], ['ps1', 'Castlevania: Symphony of the Night', 'ES-DE'], ['ps1', 'Crash Bandicoot', 'ES-DE'],
  ['ps1', 'Spyro the Dragon', 'ES-DE'], ['ps1', "Tony Hawk's Pro Skater 2", 'ES-DE'], ['ps1', 'Resident Evil 2', 'ES-DE'],
  ['ps2', 'Shadow of the Colossus', 'ES-DE'], ['ps2', 'Metal Gear Solid 3: Snake Eater', 'ES-DE'], ['ps2', 'Grand Theft Auto: San Andreas', 'ES-DE'], ['ps2', 'Kingdom Hearts', 'ES-DE'],
  ['ps2', 'Okami', 'ES-DE'], ['ps2', 'Persona 4', 'ES-DE'],
  ['gba', 'Metroid Fusion', 'ES-DE'], ['gba', 'Advance Wars', 'ES-DE'], ['gba', 'The Legend of Zelda: The Minish Cap', 'ES-DE'], ['gba', 'Pokemon Emerald', 'ES-DE'],
  ['gbc', "The Legend of Zelda: Link's Awakening DX", 'ES-DE'], ['gb', 'Tetris', 'ES-DE'],
  ['md', 'Streets of Rage 2', 'ES-DE'], ['md', 'Gunstar Heroes', 'ES-DE'], ['md', 'Sonic the Hedgehog 3', 'ES-DE'], ['md', 'Phantasy Star IV: The End of the Millennium', 'ES-DE'],
  ['dc', 'Jet Set Radio', 'ES-DE'], ['dc', 'Soul Calibur', 'ES-DE'], ['dc', 'Shenmue', 'ES-DE'], ['dc', 'Crazy Taxi', 'ES-DE'],
  ['mame', 'Street Fighter II: The World Warrior', 'ES-DE'], ['mame', 'Metal Slug', 'ES-DE'], ['dos', 'Doom', 'GOG'], ['dos', 'Day of the Tentacle', 'GOG'],
];
// Store facts come from Steam; none of these are in the demo library above.
const WISHLIST = [813230, 2231450, 1244090, 1627720, 1817230, 1868140, 2679460, 526870, 553420, 1794680, 2246340, 1569580, 646570, 1092790, 427520, 105600, 990080, 2344520, 1716740];

const hash = text => parseInt(createHash('sha1').update(text).digest('hex').slice(0, 8), 16) / 0xffffffff;
const slug = text => titleKey(text).replace(/\s+/g, '-');
const systems = new Map(catalog.systems.map(system => [system.id, system]));
const platformName = system => ({ pc: PC, dos: PC, ps5: 'Sony PlayStation 5', ps4: 'Sony PlayStation 4', switch: 'Nintendo Switch', xsx: 'Microsoft Xbox Series X/S', xone: 'Microsoft Xbox One', x360: 'Microsoft Xbox 360' })[system] ?? systems.get(system)?.name ?? system;
function find(system, title) {
  const key = titleKey(title);
  return catalog.games.find(game => game.systemId === system && [game.title, ...(game.aliases ?? [])].some(name => titleKey(name) === key));
}
const round = value => value == null ? null : Math.round(value);

const original = parseData(await readFile(new URL('library/sample/library-data.js', root), 'utf8'), 'PLAYNITE_LIBRARY').PLAYNITE_LIBRARY.slice(0, 3);
const missing = [], games = [...original];
for (const [system, title, store, extra = []] of OWNED) {
  const game = find(system, title);
  if (!game) { missing.push(`${system}: ${title}`); continue; }
  const id = `sample-${slug(game.title)}`;
  if (games.some(existing => existing.id === id)) continue;
  // Invented: about half finished or started, play time to match.
  const roll = hash(id), played = roll < .55, playing = roll >= .55 && roll < .68;
  const hours = played ? Math.round(4 + hash(`${id}h`) * 70) : playing ? Math.round(1 + hash(`${id}h`) * 12) : 0;
  // The catalog's IGDB game, as the app shows an IGDB match: players' rating and count, and
  // critics only when they're IGDB's own (the catalog's Wikipedia reviews stay in the Atlas).
  const reviews = game.reviews ?? {}, igdbCritics = reviews.critics?.source === 'igdb' ? reviews.critics : null;
  const igdb = reviews.igdb ? {
    id: reviews.igdb.id, name: game.title, year: game.year ?? null, url: reviews.igdb.url, confidence: 'high', method: 'demo',
    critic: igdbCritics?.value ?? null, criticCount: igdbCritics?.count ?? 0, players: reviews.players?.value ?? null, playersCount: reviews.players?.count ?? 0,
  } : null;
  const copy = (copySystem, copyStore, index) => {
    const retro = copyStore === 'ES-DE';
    return {
      id: `sample-copy-${slug(game.title)}${index ? `-${copySystem}` : ''}`, name: game.title, ...(retro ? { rom: true } : {}),
      platforms: [platformName(copySystem)], sources: [copyStore], releaseDate: String(game.year ?? ''), year: game.year ?? null,
      playCount: index ? 0 : played || playing ? 1 : 0, timePlayed: index ? 0 : hours * 3600, bestScore: null, played: index ? false : played, hidden: false,
      criticScore: null, communityScore: null, userScore: null, ...(igdb ? { igdb } : {}),
      scoreImport: { schemaVersion: 1, adapterVersion: 'authored-sample-v1', checksum: null },
    };
  };
  const copies = [copy(system, store, 0), ...extra.map(([copySystem, copyStore], index) => copy(copySystem, copyStore, index + 1))];
  const platforms = [...new Set(copies.flatMap(item => item.platforms))], sources = [...new Set(copies.flatMap(item => item.sources))];
  games.push({
    id, name: game.title, categories: [], genres: game.genres ?? [], mainGenre: game.genres?.[0] ?? '', genreSource: 'Sample', steamAppId: null,
    developers: [], publishers: [], releaseDate: String(game.year ?? ''), dateSort: game.year ? `${game.year}-01-01` : '', year: game.year ?? null,
    platforms, playCount: copies[0].playCount, timePlayed: copies[0].timePlayed, sources, tags: ['Sample'], bestScore: null, played, hidden: false,
    summary: 'Demo entry: a real game, with made-up ownership and play time.', cover: game.cover?.url ?? '', background: '',
    search: [game.title, ...platforms, ...(game.genres ?? []), 'sample'].join(' ').toLowerCase(), duplicate: copies.length > 1, copies,
    favorite: hash(`${id}f`) < .08, notes: '',
  });
}
if (missing.length) console.warn(`Not in the catalog, left out (${missing.length}):\n  ${missing.join('\n  ')}`);

const tally = values => Object.entries(values.reduce((counts, value) => (counts[value] = (counts[value] ?? 0) + 1, counts), {})).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const years = games.map(game => game.year).filter(Boolean);
const stats = {
  total: games.length, totalCopies: games.reduce((total, game) => total + game.copies.length, 0), played: games.filter(game => game.played).length, hidden: 0,
  favorites: games.filter(game => game.favorite).length, withCovers: games.filter(game => game.cover).length, withBackgrounds: 0,
  totalHours: Math.round(games.reduce((total, game) => total + game.timePlayed, 0) / 3600), duplicateTitles: games.filter(game => game.copies.length > 1).length,
  duplicateCopies: games.filter(game => game.copies.length > 1).reduce((total, game) => total + game.copies.length, 0),
  platforms: tally(games.flatMap(game => game.platforms)), sources: tally(games.flatMap(game => game.sources)), tags: tally(games.flatMap(game => game.tags)), categories: [],
  genres: tally(games.flatMap(game => game.genres)), mainGenres: tally(games.map(game => game.mainGenre).filter(Boolean)), withGenres: games.filter(game => game.genres.length).length,
  developers: [], publishers: [], yearMin: Math.min(...years), yearMax: Math.max(...years),
};
await writeFile(new URL('library/sample/library-data.js', root), `// Authored demonstration data: real games with public box art and review scores (data/catalog.json);
// which store each copy is on, play time and progress are made up. Rebuild: npm run sample:build
window.PLAYNITE_SAMPLE = true;
window.PLAYNITE_LIBRARY = ${JSON.stringify(games, null, 2)};
window.PLAYNITE_STATS = ${JSON.stringify(stats, null, 2)};
`);
console.log(`Demo library: ${stats.total} games, ${stats.totalCopies} copies, ${stats.played} played.`);

// ---------- wishlist
const wishlistFile = new URL('library/sample/wishlist-data.js', root);
const wishlistData = parseData(await readFile(wishlistFile, 'utf8'), 'STEAM_WISHLIST');
const fixtures = wishlistData.STEAM_WISHLIST.slice(0, 3);
const previous = new Map(wishlistData.STEAM_WISHLIST.slice(3).map(item => [Number(item.appid), item]));
const wishlist = [];
for (const appid of WISHLIST) {
  let item = previous.get(appid);
  if (!offline) {
    const details = (await (await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=gb&l=english`)).json())[appid];
    if (!details?.success) { console.warn(`Steam has no store page for ${appid}, left out.`); continue; }
    const app = details.data, reviews = (await (await fetch(`https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`)).json()).query_summary ?? {};
    const date = app.release_date?.date ?? '', parsed = Date.parse(date), year = Number.isFinite(parsed) ? new Date(parsed).getUTCFullYear() : null;
    const total = reviews.total_reviews ?? 0, pct = total ? Math.round(100 * reviews.total_positive / total) : null;
    const genres = (app.genres ?? []).map(genre => genre.description).filter(genre => !['Indie', 'Early Access', 'Free To Play'].includes(genre));
    item = {
      appid: String(appid), title: app.name, url: `https://store.steampowered.com/app/${appid}/`, image: app.header_image?.split('?')[0] ?? '', addedDate: '', addedSort: '',
      releaseDate: date, releaseRaw: date, releaseSort: Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '', year, comingSoon: Boolean(app.release_date?.coming_soon),
      price: app.price_overview?.final_formatted ?? '', pricePence: app.price_overview?.final ?? null, discount: app.price_overview?.discount_percent ?? 0,
      reviewCount: total, reviewPct: pct, metacritic: app.metacritic?.score ?? null, genres, mainGenre: genres[0] ?? '',
      features: (app.categories ?? []).map(category => category.description).filter(feature => ['Single-player', 'Online Co-op', 'Multi-player', 'Steam Deck Verified'].includes(feature)),
      developers: app.developers ?? [], publishers: app.publishers ?? [], summary: app.short_description ?? '', type: 'game', note: '', enriched: false,
      pickScore: pct == null ? 0 : +((pct / 100) * Math.min(1, Math.log10(total + 1) / 5)).toFixed(3),
      search: [app.name, ...genres].join(' ').toLowerCase(),
      reviewEvidence: { schemaVersion: 1, provider: 'authored-sample', percentage: pct, total, positive: reviews.total_positive ?? null, negative: reviews.total_negative ?? null, observedAt: new Date().toISOString(), queryScope: 'all', adapterVersion: 'authored-sample-v1' },
    };
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  if (item) wishlist.push(item);
}
const items = [...fixtures, ...wishlist], wishYears = items.map(item => item.year).filter(Boolean), rated = items.filter(item => item.reviewPct != null);
const wishlistStats = {
  total: items.length, enriched: 0, onSale: items.filter(item => item.discount > 0).length, comingSoon: items.filter(item => item.comingSoon).length,
  totalPence: items.reduce((total, item) => total + (item.pricePence ?? 0), 0), avgReviewPct: Math.round(rated.reduce((total, item) => total + item.reviewPct, 0) / rated.length),
  genres: tally(items.flatMap(item => item.genres)), mainGenres: tally(items.map(item => item.mainGenre).filter(Boolean)), features: tally(items.flatMap(item => item.features)),
  yearMin: Math.min(...wishYears), yearMax: Math.max(...wishYears), currency: 'GBP',
};
await writeFile(wishlistFile, `// Authored demonstration data. The first three are fictional fixtures; the rest are real games
// with facts from Steam's public store pages, prices and reviews as of the build. Rebuild: npm run sample:build
window.WISHLIST_SAMPLE = true;
window.STEAM_WISHLIST = ${JSON.stringify(items, null, 2)};
window.WISHLIST_STATS = ${JSON.stringify(wishlistStats, null, 2)};
`);
console.log(`Demo wishlist: ${items.length} games.`);

// ---------- saved Steam ratings for the wishlist (what its default order uses)
// Modelled on the fixture's row; the fixtures' own rows stay exactly as they are.
const ratingsFile = new URL('library/sample/ratings.json', root);
const ratings = JSON.parse(await readFile(ratingsFile, 'utf8'));
const template = ratings.rows.find(row => row.provider === 'steam' && row.providerId === '900000001');
const demoIds = new Set(wishlist.map(item => String(item.appid)));
ratings.rows = ratings.rows.filter(row => !(row.provider === 'steam' && !/^9000000\d\d$/.test(row.providerId)));
for (const item of wishlist) {
  const evidence = item.reviewEvidence, id = String(item.appid);
  if (evidence?.positive == null || evidence?.negative == null) continue;
  const at = evidence.observedAt ?? new Date().toISOString(), fresh = new Date(Date.parse(at) + 86400000).toISOString();
  const fingerprint = createHash('sha256').update(`steam:${id}:${evidence.positive}:${evidence.negative}`).digest('hex');
  const row = structuredClone(template), observation = row.observations[0];
  Object.assign(row, { mappingId: `steam-${id}`, mappingFingerprint: fingerprint, target: { provider: 'steam', id }, providerId: id, checkedAt: at, observedAt: at, freshUntil: fresh });
  Object.assign(observation, { id: `steam:${id}:steam-approval:${fingerprint.slice(0, 16)}:${fingerprint.slice(16, 28)}` });
  observation.source = { ...observation.source, upstreamId: id, url: item.url };
  observation.scope = { ...observation.scope, ref: { provider: 'steam', id } };
  observation.original = { ...observation.original, value: evidence.percentage, raw: evidence.percentage, positive: evidence.positive, negative: evidence.negative, count: evidence.positive + evidence.negative };
  observation.dates = { ...observation.dates, observedAt: at };
  observation.provenance = { ...observation.provenance, checksum: fingerprint };
  // Real counts from Steam's public review summary, so the app credits Steam, not "fictional".
  row.source = { ...row.source, title: item.title, url: item.url, publicData: true };
  ratings.rows.push(row);
}
ratings.snapshotId = createHash('sha256').update(JSON.stringify(ratings.rows)).digest('hex');
await writeFile(ratingsFile, `${JSON.stringify(ratings, null, 2)}\n`);
console.log(`Demo ratings: ${ratings.rows.length} rows (${[...demoIds].length} wishlist games).`);

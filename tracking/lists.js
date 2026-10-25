// The lists behind list goals. Every list counts a game once: its ports, editions, remasters
// and close remakes are one entry (tracking/families.js), and finishing any of them counts.
// - Top lists: the best-rated games, of all time or of a year or decade, optionally of one
//   genre; or one system's list in its own order.
// - Series: the best of an iconic series across every system ("Top 10 Zelda games").
// - Genre history: the games that shaped a genre, in release order (an editorial timeline).
import { catalogScore } from '../lib.js';
import { gameFamilies, titleKey } from './families.js';

// A score from a handful of IGDB ratings alone is too thin to rank across systems.
const MIN_WEIGHT = 15;
const has = (game, genre) => (game.genres ?? []).includes(genre);
const tagged = (game, tag) => (game.reviews?.igdb?.tags ?? []).includes(tag);
const firstPerson = game => (game.reviews?.igdb?.perspectives ?? []).includes(1);

// Genres for top lists: id → { name (for titles), test }.
export const GENRES = {
  rpg: { name: 'RPGs', test: game => has(game, 'RPG') },
  fps: { name: 'first-person shooters', test: game => has(game, 'Shooter') && firstPerson(game) },
  shooter: { name: 'shooters', test: game => has(game, 'Shooter') },
  platformer: { name: 'platformers', test: game => has(game, 'Platformer') },
  strategy: { name: 'strategy games', test: game => has(game, 'Strategy') },
  roguelike: { name: 'roguelikes', test: game => has(game, 'Roguelike') || tagged(game, 'roguelike') },
  metroidvania: { name: 'metroidvanias', test: game => tagged(game, 'metroidvania') },
  soulslike: { name: 'soulslikes', test: game => tagged(game, 'soulslike') },
  horror: { name: 'horror games', test: game => has(game, 'Horror') || tagged(game, 'survival-horror') },
  'open-world': { name: 'open-world games', test: game => tagged(game, 'open-world') },
  adventure: { name: 'adventure games', test: game => has(game, 'Adventure') },
  fighting: { name: 'fighting games', test: game => has(game, 'Fighting') },
  racing: { name: 'racing games', test: game => has(game, 'Racing') },
  puzzle: { name: 'puzzle games', test: game => has(game, 'Puzzle') },
  shmup: { name: "shoot 'em ups", test: game => has(game, 'Shoot ’em up') },
  sports: { name: 'sports games', test: game => has(game, 'Sports') },
};
export const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];

// Iconic series only: id → { name, series (IGDB collection or franchise names), title (for
// list entries IGDB doesn't know) }. A series is offered once it has five distinct games.
export const SERIES = {
  zelda: { name: 'Zelda', series: ['The Legend of Zelda'], title: /\bzelda\b/i },
  mario: { name: 'Super Mario', series: ['Super Mario'], title: /^super mario (?:bros|world|land|64|sunshine|galaxy|odyssey|3d)/i },
  pokemon: { name: 'Pokémon', series: ['Pokémon'], title: /^pok[eé]mon\b/i },
  doom: { name: 'Doom', series: ['Doom'], title: /^doom\b/i },
  'final-fantasy': { name: 'Final Fantasy', series: ['Final Fantasy'], title: /^final fantasy\b/i },
  metroid: { name: 'Metroid', series: ['Metroid'], title: /^(?:super )?metroid\b/i },
  sonic: { name: 'Sonic', series: ['Sonic The Hedgehog', 'Sonic the Hedgehog'], title: /^sonic\b/i },
  castlevania: { name: 'Castlevania', series: ['Castlevania'], title: /^(?:super )?castlevania\b/i },
  'resident-evil': { name: 'Resident Evil', series: ['Resident Evil'], title: /^resident evil\b/i },
  'metal-gear': { name: 'Metal Gear', series: ['Metal Gear'], title: /^metal gear\b/i },
  'mega-man': { name: 'Mega Man', series: ['Mega Man'], title: /^mega ?man\b/i },
  'street-fighter': { name: 'Street Fighter', series: ['Street Fighter'], title: /street fighter\b/i },
  gta: { name: 'Grand Theft Auto', series: ['Grand Theft Auto'], title: /^(?:grand theft auto|gta)\b/i },
  'elder-scrolls': { name: 'The Elder Scrolls', series: ['The Elder Scrolls'], title: /^the elder scrolls\b/i },
  fallout: { name: 'Fallout', series: ['Fallout'], title: /^fallout\b/i },
  'dragon-quest': { name: 'Dragon Quest', series: ['Dragon Quest'], title: /^dragon (?:quest|warrior)\b/i },
  persona: { name: 'Persona', series: ['Persona'], title: /\bpersona\b/i },
  kirby: { name: 'Kirby', series: ['Kirby'], title: /^kirby\b/i },
  'donkey-kong': { name: 'Donkey Kong', series: ['Donkey Kong'], title: /^donkey kong\b/i },
  'fire-emblem': { name: 'Fire Emblem', series: ['Fire Emblem'], title: /^fire emblem\b/i },
  'mario-kart': { name: 'Mario Kart', series: ['Mario Kart'], title: /mario kart\b/i },
  'tomb-raider': { name: 'Tomb Raider', series: ['Tomb Raider'], title: /tomb raider\b/i },
  'mortal-kombat': { name: 'Mortal Kombat', series: ['Mortal Kombat'], title: /mortal kombat\b/i },
  tekken: { name: 'Tekken', series: ['Tekken'], title: /^tekken\b/i },
  'god-of-war': { name: 'God of War', series: ['God of War'], title: /^god of war\b/i },
  'star-fox': { name: 'Star Fox', series: ['Star Fox'], title: /^star ?fox\b/i },
  'half-life': { name: 'Half-Life', series: ['Half-Life'], title: /^half-life\b/i },
};

// The games that shaped a genre: id → { name, games: [title, year, why] }, in release order.
export const SHAPED = {
  fps: { name: 'first-person shooters', games: [
    ['Wolfenstein 3D', 1992, 'Made the fast first-person shooter a genre.'],
    ['Doom', 1993, 'Level design, deathmatch and mods the genre still follows.'],
    ['Quake', 1996, 'Fully 3D worlds, mouse-look and online play.'],
    ['GoldenEye 007', 1997, 'Proved shooters work on consoles, with split-screen multiplayer.'],
    ['Half-Life', 1998, 'Told its story through play, without taking control away.'],
    ['Deus Ex', 2000, 'Let you choose how to solve every problem.'],
    ['Halo: Combat Evolved', 2001, 'Console controls, a two-weapon limit and recharging shields.'],
    ['Metroid Prime', 2002, 'Exploration and atmosphere in first person.'],
    ['Half-Life 2', 2004, 'Physics as part of the play.'],
    ['Call of Duty 4: Modern Warfare', 2007, 'Unlocks and ranks that defined online shooters.'],
    ['BioShock', 2007, 'A shooter built around its world and its ideas.'],
    ['Doom (2016)', 2016, 'Brought back fast, aggressive, push-forward combat.'],
  ] },
  rpg: { name: 'role-playing games', games: [
    ['Dragon Quest', 1986, 'The template for console RPGs: turn-based battles, levels and a quest.'],
    ['Final Fantasy VI', 1994, 'An ensemble cast and a world that changes halfway through.'],
    ['Chrono Trigger', 1995, 'Battles on the map, time travel and many endings.'],
    ['Diablo', 1996, 'Click, loot, repeat: the action RPG.'],
    ['Pokémon Red Version', 1996, 'Catch, trade and battle with friends.'],
    ['Fallout', 1997, 'Choices with consequences in an open, darkly funny world.'],
    ['Final Fantasy VII', 1997, 'Took RPGs to a mass audience with 3D worlds and cinematic scenes.'],
    ["Baldur's Gate", 1998, 'Revived party-based computer RPGs.'],
    ['The Elder Scrolls III: Morrowind', 2002, 'A vast handmade world to roam freely.'],
    ['Star Wars: Knights of the Old Republic', 2003, 'Companions and moral choices that change the story.'],
    ['Dark Souls', 2011, 'Hard, fair combat and a story told through its world.'],
    ['The Witcher 3: Wild Hunt', 2015, 'Side quests written as carefully as the main story.'],
  ] },
  strategy: { name: 'strategy games', games: [
    ['Civilization', 1991, 'Build an empire across history, one more turn at a time.'],
    ['Dune II: The Building of a Dynasty', 1992, 'The blueprint for real-time strategy: harvest, build, command.'],
    ['X-COM: UFO Defense', 1994, 'Turn-based squad tactics where losses are permanent.'],
    ['Warcraft II: Tides of Darkness', 1995, 'Real-time strategy against friends over a network.'],
    ['Command & Conquer', 1995, 'Made real-time strategy a mainstream hit.'],
    ['Final Fantasy Tactics', 1997, 'Grid tactics with deep character classes.'],
    ['StarCraft', 1998, 'Three truly different sides, balanced for competition.'],
    ['Age of Empires II: The Age of Kings', 1999, 'Historical real-time strategy that is still played today.'],
    ['Advance Wars', 2001, 'Turn-based war made approachable on a handheld.'],
    ['Fire Emblem', 2003, 'Brought permadeath tactics to players outside Japan.'],
    ['XCOM: Enemy Unknown', 2012, 'Revived turn-based tactics for a new generation.'],
  ] },
  platformer: { name: 'platformers', games: [
    ['Donkey Kong', 1981, 'Made jumping the heart of a game.'],
    ['Pitfall!', 1982, 'Running and jumping through a large world on a home console.'],
    ['Super Mario Bros.', 1985, 'Momentum, secrets and a scrolling world.'],
    ['Mega Man 2', 1988, 'Pick your stage order and earn each boss’s weapon.'],
    ['Super Mario Bros. 3', 1988, 'A world map, power-ups and endless variety.'],
    ['Sonic the Hedgehog', 1991, 'Speed, loops and attitude.'],
    ['Super Metroid', 1994, 'The model for exploring a world unlocked by new abilities.'],
    ['Super Mario 64', 1996, 'Showed how to move and explore in 3D.'],
    ['Braid', 2008, 'Time-bending puzzles that helped start the indie wave.'],
    ['Super Meat Boy', 2010, 'Brutal precision with instant retries.'],
    ['Celeste', 2018, 'Precision platforming with assist options and a personal story.'],
  ] },
  horror: { name: 'survival horror', games: [
    ['Resident Evil', 1996, 'Named the genre: scarce ammo, locked doors and dread.'],
    ['Silent Hill', 1999, 'Psychological fear in fog and darkness.'],
    ['Silent Hill 2', 2001, 'Horror as a personal story.'],
    ["Eternal Darkness: Sanity's Requiem", 2002, 'A sanity meter that turned the game against the player.'],
    ['Fatal Frame II: Crimson Butterfly', 2003, 'A camera as your only weapon.'],
    ['Resident Evil 4', 2005, 'Over-the-shoulder aiming and action horror.'],
    ['Dead Space', 2008, 'Dismemberment and an interface built into the world.'],
    ['Alien: Isolation', 2014, 'Hunted by one unpredictable enemy.'],
    ['Resident Evil 7: Biohazard', 2017, 'First-person horror that revived a series.'],
  ] },
  'open-world': { name: 'open worlds', games: [
    ['Elite', 1984, 'A galaxy to trade, fight and explore freely.'],
    ['The Legend of Zelda', 1986, 'Go anywhere from the start, with secrets everywhere.'],
    ['Grand Theft Auto III', 2001, 'A living 3D city to explore and cause trouble in.'],
    ['The Elder Scrolls III: Morrowind', 2002, 'A vast handmade world with no set path.'],
    ['Shadow of the Colossus', 2005, 'A vast, quiet land as the heart of the game.'],
    ['Red Dead Redemption', 2010, 'A frontier full of life and small stories.'],
    ['Minecraft', 2011, 'A world you shape and build yourself.'],
    ['The Elder Scrolls V: Skyrim', 2011, 'Go anywhere, be anyone, in a world built to be modded.'],
    ['Grand Theft Auto V', 2013, 'Three playable leads in a huge, detailed city.'],
    ['The Witcher 3: Wild Hunt', 2015, 'An open world full of stories worth finding.'],
    ['The Legend of Zelda: Breath of the Wild', 2017, 'Climb anything and solve problems your own way.'],
    ['Elden Ring', 2022, 'Hard, rewarding combat across a world to discover.'],
  ] },
};

// Families over the listed games, worked out once per catalog.
const cache = new WeakMap();
function prepared(catalog) {
  if (!cache.has(catalog)) {
    const listed = catalog.games.filter(game => !game.unlisted && game.rank != null);
    const families = gameFamilies(listed), members = new Map();
    for (const game of listed) { const key = families.get(game.id); if (!members.has(key)) members.set(key, []); members.get(key).push(game); }
    cache.set(catalog, { listed, families, members });
  }
  return cache.get(catalog);
}
export const scoreOf = game => { const score = catalogScore(game); return score && (score.source === 'reviews' || score.weight >= MIN_WEIGHT) ? score.exact : null; };
// The name a game goes by: its original release (not a remaster, edition or later port).
function displayGame(games) {
  const version = game => { const igdb = game.reviews?.igdb; return igdb ? Boolean(igdb.origin || igdb.parent && [3, 8, 9, 10, 11].includes(igdb.type)) : false; };
  return [...games].sort((a, b) => Number(version(a)) - Number(version(b)) || (a.year ?? 9999) - (b.year ?? 9999) || a.title.length - b.title.length)[0];
}
const decadeOf = year => Math.floor(year / 10) * 10;
// Which family members match a spec's filters (the whole family counts once one does).
const matches = (spec, game) => (!spec.system || game.systemId === spec.system) && (spec.year == null || game.year === spec.year)
  && (spec.decade == null || Number.isInteger(game.year) && decadeOf(game.year) === spec.decade) && (!spec.genre || GENRES[spec.genre]?.test(game));
// In a series by name and by IGDB: a crossover (Super Smash Bros. counts as Zelda, Pokémon
// and Final Fantasy to IGDB) doesn't carry the series name.
const inSeries = (series, game) => { const names = game.reviews?.igdb?.series; return series.title.test(game.title) && (!names?.length || names.some(name => series.series.includes(name))); };
// Compilations (The Orange Box, Final Fantasy VII Remake Intergrade) repeat the games they
// collect, so lists across systems leave them out. An edition sold as a bundle stays.
const compilation = game => game.reviews?.igdb?.type === 3 && !game.reviews.igdb.parent;
const standalone = game => game.reviews?.igdb?.type === 4 && game.reviews.igdb.parent;

// Catalog id → its family key (null for a game on no list): which Atlas entries are one game.
export const familyOf = catalog => { const { families } = prepared(catalog); return id => families.get(id) ?? null; };

// The family of every game on a list (a whole series or timeline): which owned games a
// series or genre-history challenge can use.
export function listFamilyKeys(catalog, spec) {
  const { families } = prepared(catalog);
  return new Set(listEntries(catalog, { ...spec, size: Infinity }).flatMap(entry => entry.games.map(game => families.get(game.id))));
}

// A list's entries, best first (genre history: in release order). Each entry is one game:
// { position, title, games (every listed version), score?, year?, why? }.
export function listEntries(catalog, spec) {
  const { listed, families, members } = prepared(catalog), size = spec.size ?? 10;
  if (spec.shaped) {
    const shaped = SHAPED[spec.shaped]; if (!shaped) return [];
    const entries = [];
    for (const [title, year, why] of shaped.games) {
      const key = titleKey(title), found = listed.filter(game => titleKey(game.title) === key && Number.isInteger(game.year) && Math.abs(game.year - year) <= 6)
        .sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year))[0];
      if (found) entries.push({ position: entries.length + 1, title, year, why, games: members.get(families.get(found.id)) });
    }
    return entries;
  }
  // One system's list in its own order: a game listed twice keeps its first place.
  if (spec.system && spec.year == null && spec.decade == null && !spec.genre && !spec.series) {
    const seen = new Set(), entries = [];
    for (const game of listed.filter(game => game.systemId === spec.system).sort((a, b) => a.rank - b.rank)) {
      const key = families.get(game.id); if (seen.has(key)) continue; seen.add(key);
      entries.push({ position: entries.length + 1, title: game.title, games: [game, ...members.get(key).filter(other => other !== game)] });
      if (entries.length === size) break;
    }
    return entries;
  }
  const series = spec.series ? SERIES[spec.series] : null;
  if (spec.series && !series) return [];
  const ranked = [];
  for (const [key, games] of members) {
    const fitting = games.filter(game => !compilation(game) && (series ? inSeries(series, game) : matches(spec, game)));
    if (!fitting.length) continue;
    const score = Math.max(...fitting.map(scoreOf).filter(value => value !== null));
    if (!Number.isFinite(score)) continue;
    const shown = displayGame(series ? games.filter(game => inSeries(series, game)) : games);
    const best = [...fitting].sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1));
    ranked.push({ key, title: shown.title, year: shown.year, score, fitting, games: [...best, ...games.filter(game => !fitting.includes(game))] });
  }
  // A standalone expansion (Half-Life 2: Episode Two) gives way when its game is on the list.
  const onList = new Set(ranked.map(entry => entry.key)), byIgdb = new Map();
  for (const game of listed) if (game.reviews?.igdb?.id) byIgdb.set(game.reviews.igdb.id, families.get(game.id));
  const expansionOfListed = entry => entry.fitting.every(game => standalone(game) && onList.has(byIgdb.get(game.reviews.igdb.parent)));
  const top = ranked.filter(entry => !expansionOfListed(entry)).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, size);
  // Two games of one name (Resident Evil 4 and its remake) are told apart by their year.
  const named = new Map(); for (const entry of top) named.set(titleKey(entry.title), (named.get(titleKey(entry.title)) ?? 0) + 1);
  return top.map((entry, index) => ({ position: index + 1, title: named.get(titleKey(entry.title)) > 1 && entry.year ? `${entry.title.replace(/\s*\((?:19|20)\d\d\)$/, '')} (${entry.year})` : entry.title, score: Math.round(entry.score), games: entry.games }));
}

// A list's name. `count` (the games it has now) keeps a short series honest: "Top 7 Doom games".
export function listTitle(spec, systemName = id => id, count = Infinity) {
  if (spec.shaped) return `The games that shaped ${SHAPED[spec.shaped]?.name ?? spec.shaped}`;
  if (spec.series) return `Top ${Math.min(spec.size, count)} ${SERIES[spec.series]?.name ?? spec.series} games`;
  const what = spec.genre ? ` ${GENRES[spec.genre]?.name ?? spec.genre}` : '';
  if (spec.system && spec.year == null && spec.decade == null && !spec.genre) return `${systemName(spec.system)} top ${spec.size}`;
  const when = spec.year != null ? ` of ${spec.year}` : spec.decade != null ? ` of the ${spec.decade}s` : spec.system ? '' : ' of all time';
  return `Top ${spec.size}${what}${when}${spec.system ? ` · ${systemName(spec.system)}` : ''}`;
}

// Series with at least five distinct games right now.
export function availableSeries(catalog) {
  return Object.entries(SERIES).filter(([id]) => listEntries(catalog, { series: id, size: 5 }).length >= 5).map(([id, series]) => ({ id, name: series.name }));
}

// Ready-made goals for the gallery, by group.
export function featuredLists(catalog) {
  const top = (genre, decade = null) => ({ size: 10, system: '', year: null, ...(decade != null ? { decade } : {}), ...(genre ? { genre } : {}) });
  return [
    { group: 'Genres', lists: [top(null), ...['rpg', 'fps', 'platformer', 'strategy', 'roguelike', 'metroidvania', 'soulslike', 'horror', 'fighting', 'racing', 'puzzle'].map(genre => top(genre))] },
    { group: 'Decades', lists: [1980, 1990, 2000, 2010, 2020].map(decade => top(null, decade)) },
    { group: 'Series', lists: availableSeries(catalog).map(series => ({ size: 10, system: '', year: null, series: series.id })) },
    { group: 'How genres were shaped', lists: Object.keys(SHAPED).map(shaped => ({ size: 10, system: '', year: null, shaped })) },
  ].map(group => ({ ...group, lists: group.lists.filter(spec => listEntries(catalog, { ...spec, size: 5 }).length >= 5) }));
}

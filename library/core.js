// Conservative matching: punctuation varies, but editions and sequels stay distinct.
export function titleKey(value) {
  return String(value || '').replace(/[™®©]/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Demos, betas, soundtracks and other extras that Playnite lists beside real games.
const EXTRA = /\b(?:soundtracks?|ost|artbooks?|art ?book|digital comics?|comic books?|comic: issue|demo|playtest|dedicated server|sdk|benchmark|wallpapers?|test server)\b|\(beta\)|\S\s+(?:tech\s+)?beta$/i;
export const isExtra = title => EXTRA.test(String(title ?? ''));

// Edition suffixes: "<word> Edition/Version/Cut" ("The Final Cut" too), or GOTY / Game of
// the Year anywhere. Words like "Digital" or "Gold" alone are part of a title ("Digital Comic Books").
const EDITION = /\s*[-–:(]?\s*\b(?:(?:the\s+)?(?:game of the year|goty|complete|definitive|deluxe|ultimate|gold|premium|enhanced|special|anniversary|collector'?s|digital(?: deluxe)?|standard|legendary|remastered|director'?s|final)\s+(?:edition|version|cut)|game of the year|goty|director'?s cut)\b.*$/i;
export const baseTitle = value => String(value ?? '').replace(EDITION, '').trim();

export function platformKey(value) {
  // Brand prefixes vary between Playnite, stores and the catalog ("Sega Genesis", "SNK Neo Geo AES").
  const full = titleKey(value), key = full.replace(/^(sony|nintendo|sega|microsoft|snk|nec|commodore|sinclair|atari|mattel|bandai) /, '');
  const aliases = {
    'pc': 'dos', 'pc windows': 'dos', 'windows': 'dos', 'pc dos': 'dos', 'dos': 'dos',
    'playstation': 'ps1', 'playstation 1': 'ps1', 'playstation 2': 'ps2',
    'playstation 3': 'ps3', 'playstation 4': 'ps4', 'playstation 5': 'ps5',
    'playstation vita': 'vita', 'ps vita': 'vita', 'playstation portable': 'psp',
    'switch': 'switch', 'switch 2': 'switch2', 'gamecube': 'gc',
    'entertainment system': 'nes', 'super entertainment system': 'snes',
    'super nintendo entertainment system': 'snes', 'super nintendo': 'snes',
    '64': 'n64', 'game boy': 'gb', 'game boy color': 'gbc', 'game boy advance': 'gba',
    'wii': 'wii', 'wii u': 'wiiu', 'ds': 'ds', '3ds': '3ds',
    'xbox': 'xbox', 'xbox 360': 'x360', 'xbox one': 'xone', 'xbox series x s': 'xsx',
    'mega drive': 'md', 'genesis': 'md', 'dreamcast': 'dc', 'saturn': 'saturn',
    'master system': 'ms', 'game gear': 'gg', 'commodore 64': 'c64', 'amiga': 'amiga',
    // Retro platforms as Playnite names them when it imports emulated games.
    'entertainment system nes': 'nes', 'nes': 'nes', 'snes': 'snes', 'super famicom': 'snes', 'famicom': 'nes',
    'family computer disk system': 'nes', 'gameboy': 'gb', 'gameboy color': 'gbc', 'gameboy advance': 'gba',
    'switch2': 'switch2', 'sg 1000': 'sg1000', 'mark iii': 'ms', 'cd': 'scd', 'mega cd': 'scd', 'sega cd': 'scd', '32x': '32x',
    'psx': 'ps1', 'ps1': 'ps1', 'ps2': 'ps2', 'psp': 'psp', 'playstation 2 ps2': 'ps2',
    '2600': 'atari2600', '5200': 'atari5200', '7800': 'atari7800', 'lynx': 'lynx', 'jaguar': 'jaguar',
    'turbografx 16': 'tg16', 'turbografx16': 'tg16', 'pc engine': 'tg16', 'turbografx cd': 'pcecd', 'pc engine cd': 'pcecd',
    'neo geo': 'neogeo', 'neo geo aes': 'neogeo', 'neo geo mvs': 'neogeo', 'neo geo cd': 'neogeo',
    'neo geo pocket': 'ngpc', 'neo geo pocket color': 'ngpc', 'arcade': 'mame', 'mame': 'mame',
    'amiga cd32': 'amiga', 'c64': 'c64', 'zx spectrum': 'spectrum', 'spectrum': 'spectrum', 'msx': 'msx', 'msx2': 'msx',
    'pc dos': 'dos', 'ms dos': 'dos',
    // The catalog's own system names (used for ROM folder entries).
    'mega drive genesis': 'md', 'arcade classics': 'mame', 'capcom cps': 'cps', 'cave and arcade shooters': 'cave', 'classic pc': 'dos',
  };
  // The full name first: "Commodore 64" must not become "64" (Nintendo 64).
  return aliases[full] || aliases[key] || key;
}

// Adding a game by hand: is this copy you already own the same game, and how close is it?
// 'same' (same platform and store or format: a duplicate), 'platform' (same platform, another
// store or format), 'other' (another platform), or null (a different game). The same IGDB game
// or Steam app always counts; a title only when the years (if both known) are within a year.
export function ownedCopyMatch(want, copy, group = {}) {
  const name = copy.name ?? group.name, year = copy.year ?? group.year ?? null;
  const sameIds = (want.igdbId && copy.igdb?.id && Number(copy.igdb.id) === Number(want.igdbId)) || (want.steamAppId && copy.steamAppId && String(copy.steamAppId) === String(want.steamAppId));
  const sameTitle = titleKey(baseTitle(name)) === titleKey(baseTitle(want.name)) && (!want.year || !year || Math.abs(Number(want.year) - year) <= 1);
  if (!sameIds && !sameTitle) return null;
  if (!(copy.platforms ?? group.platforms ?? []).some(platform => platformKey(platform) === platformKey(want.platform))) return 'other';
  return (copy.sources ?? []).some(source => source.toLowerCase() === String(want.ownedOn ?? '').toLowerCase()) ? 'same' : 'platform';
}
export const ownedMatches = (library, want, { except = null } = {}) => library.flatMap(group => (group.copies ?? []).filter(copy => copy.id !== except)
  .map(copy => ({ group, copy, level: ownedCopyMatch(want, copy, group) })).filter(match => match.level));

export const matchKey = (catalogId, copyId) => `${encodeURIComponent(catalogId)}|${encodeURIComponent(copyId)}`;
// Identity evidence deliberately excludes mutable playtime, ratings and artwork.
// A change to title/platform/year requires reviewing an accepted match again.
export function matchIdentity(game, copy, owned) {
  return {
    catalogIdentity: JSON.stringify([titleKey(game.title), game.systemId, game.year ?? null]),
    copyIdentity: JSON.stringify([titleKey(copy.name ?? owned.name), [...new Set((copy.platforms ?? []).map(platformKey))].sort(), copy.year ?? null]),
  };
}

export function connectLibrary(catalog, library, reviews = {}) {
  const names = new Map(), copies = new Map(), saved = new Map();
  for (const owned of library) {
    for (const copy of owned.copies ?? []) {
      // A store copy is often an edition ("… - Complete Edition", "… GOTY"): it's found by the
      // game's own title too, and the year check below keeps remasters for you to review.
      const name = copy.name ?? owned.name, item = { owned, copy };
      for (const key of new Set([titleKey(name), titleKey(baseTitle(name))])) {
        if (!names.has(key)) names.set(key, []);
        names.get(key).push(item);
      }
      copies.set(copy.id, item);
    }
  }
  for (const review of Object.values(reviews)) {
    if (!saved.has(review.catalogId)) saved.set(review.catalogId, []);
    saved.get(review.catalogId).push(review.copyId);
  }
  const byRelease = Object.create(null), byOwned = Object.create(null), candidatesByRelease = Object.create(null);
  const titleMatches = game => [game.title, ...(game.aliases || [])].flatMap(name => names.get(titleKey(name)) || []);
  // A PC copy (Steam, GOG, Epic…) counts for both PC lists: Classic PC to 1999, PC after.
  const onSystem = (copy, game) => (copy.platforms ?? []).some(platform => { const key = platformKey(platform); return key === game.systemId || key === 'dos' && game.systemId === 'pc'; });
  // A copy matches without review when it's the only Atlas game of that title on that list,
  // and (for store copies) came out the same year, give or take one: a ROM's system comes
  // from its folder. Two games sharing a title on one list (Prey 2006 and 2017) need you to
  // choose, and so does a remake whose year differs; a PC copy of Doom (1993) goes to Classic
  // PC, not to PC's Doom (2016). You can untick Owned if a match is wrong.
  const targets = new Map();
  for (const game of catalog.games) for (const { copy } of new Map(titleMatches(game).map(item => [item.copy.id, item])).values())
    if (onSystem(copy, game)) targets.set(`${copy.id}|${game.systemId}`, (targets.get(`${copy.id}|${game.systemId}`) ?? 0) + 1);
  const sameYear = (copy, game) => copy.rom || copy.year && game.year && Math.abs(copy.year - game.year) <= 1;
  for (const game of catalog.games) {
    const candidates = new Map(titleMatches(game).map(item => [item.copy.id, item]));
    for (const id of saved.get(game.id) ?? []) if (copies.has(id)) candidates.set(id, copies.get(id));
    for (const { owned, copy } of candidates.values()) {
      const id = matchKey(game.id, copy.id), review = reviews[id], identity = matchIdentity(game, copy, owned);
      const sameSystem = onSystem(copy, game);
      const unchanged = review && review.catalogIdentity === identity.catalogIdentity && review.copyIdentity === identity.copyIdentity;
      const available = copy.available !== false;
      // "Reset to unreviewed" brings an automatic match back.
      const auto = (!review || review.decision === 'unresolved') && sameSystem && targets.get(`${copy.id}|${game.systemId}`) === 1 && Boolean(sameYear(copy, game));
      const status = !available ? 'unavailable' : review?.decision === 'rejected' ? 'rejected'
        : review?.decision === 'accepted' ? (unchanged ? 'accepted' : 'changed') : auto ? 'accepted' : 'unresolved';
      const candidate = { id, catalogId: game.id, ownedId: owned.id, copyId: copy.id,
        title: copy.name ?? owned.name, platforms: copy.platforms ?? [], sources: copy.sources ?? [],
        catalogTitle: game.title, systemId: game.systemId, catalogYear: game.year ?? null,
        copyYear: copy.year ?? null, sameSystem, status, ...(copy.rom ? { rom: true } : {}), ...(auto ? { auto: true } : {}), ...identity };
      (candidatesByRelease[game.id] ||= []).push(candidate);
      (byOwned[owned.id] ||= []).push({ id: game.id, copyId: copy.id, title: game.title, systemId: game.systemId, rank: game.rank, sameSystem, status });
      if (status === 'accepted') {
        const match = { id: owned.id, copyId: copy.id, name: candidate.title, platforms: candidate.platforms, sources: candidate.sources, sameSystem, status };
        // Prefer a verified copy of this release to a verified other-platform copy.
        if (!byRelease[game.id] || sameSystem && !byRelease[game.id].sameSystem) byRelease[game.id] = match;
      }
    }
  }
  return { schemaVersion: 2, byRelease, byOwned, candidatesByRelease, totalTitles: library.length };
}

// This normalization is only for browsing, never for ownership/provider identity.
const searchWords = value => titleKey(String(value ?? '').replace(/['’]s\b/gi, '')).split(' ').filter(Boolean);
const numericWord = word => /\p{N}/u.test(word);

function oneEdit(a, b) {
  const left = [...a], right = [...b];
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  while (i < left.length && left[i] === right[i]) i++;
  if (left.length === right.length) {
    return left.slice(i + 1).join('') === right.slice(i + 1).join('') ||
      (left[i] === right[i + 1] && left[i + 1] === right[i] && left.slice(i + 2).join('') === right.slice(i + 2).join(''));
  }
  return left.length > right.length ? left.slice(i + 1).join('') === right.slice(i).join('') : left.slice(i).join('') === right.slice(i + 1).join('');
}

// Each query word consumes a different title word. Augmenting paths handle
// repeated words/prefixes without exponential permutations.
function assignWords(edges) {
  const owners = new Map();
  function visit(term, seen) {
    for (const position of edges[term]) {
      if (seen.has(position)) continue;
      seen.add(position);
      if (!owners.has(position) || visit(owners.get(position), seen)) {
        owners.set(position, term); return true;
      }
    }
    return false;
  }
  if (!edges.every((_, term) => visit(term, new Set()))) return null;
  const positions = [];
  for (const [position, term] of owners) positions[term] = position;
  return positions;
}

function matchTitle(words, terms, allowTypos) {
  if (terms.length > words.length) return null;
  const exact = terms.map(term => words.flatMap((word, i) => word === term ? [i] : []));
  const direct = exact.map((positions, i) => i === terms.length - 1 && !numericWord(terms[i])
    ? [...positions, ...words.flatMap((word, j) => word !== terms[i] && word.startsWith(terms[i]) ? [j] : [])] : positions);
  let positions = assignWords(exact), prefix = false, typo = false;
  if (!positions) { positions = assignWords(direct); prefix = true; }
  if (!positions && allowTypos) {
    // At most one edit in the entire query, never in numbers or short words.
    for (let i = 0; i < terms.length && !positions; i++) {
      if ([...terms[i]].length < 5 || numericWord(terms[i])) continue;
      const fuzzy = words.flatMap((word, j) => !numericWord(word) && word !== terms[i] && oneEdit(terms[i], word) ? [j] : []);
      positions = assignWords(direct.map((edges, j) => j === i ? fuzzy : edges));
    }
    typo = Boolean(positions);
  }
  if (!positions) return null;
  const phrase = words.some((_, start) => terms.every((term, i) => {
    const word = words[start + i];
    return word === term || (prefix && !typo && i === terms.length - 1 && !numericWord(term) && word?.startsWith(term));
  }));
  const full = !prefix && words.length === terms.length && words.every((word, i) => word === terms[i]);
  const span = Math.max(...positions) - Math.min(...positions);
  return (typo ? 1000 : 0) + (full ? 0 : phrase ? (prefix ? 300 : 100) : prefix ? 400 : 200) + Math.min(span, 50);
}

const searchCache = new Map();
export function titleSearch(query) {
  const raw = String(query ?? '').slice(0, 300), terms = searchWords(raw), key = terms.join(' ') || raw;
  if (searchCache.has(key)) return searchCache.get(key);
  const matches = new WeakMap(), fuzzyMatches = new WeakMap();
  function match(game, allowTypos = false) {
    const cache = allowTypos ? fuzzyMatches : matches;
    if (cache.has(game)) return cache.get(game);
    let best = null;
    if (!raw.trim()) best = { score: 0, title: game.name ?? game.title ?? '' };
    else if (terms.length && terms.length <= 40) {
      const titles = [...new Set([game.name, game.title, ...(game.aliases ?? []), ...(game.copies ?? []).map(copy => copy.name)].filter(Boolean))];
      for (const [index, title] of titles.entries()) {
        const score = matchTitle(searchWords(title), terms, allowTypos);
        if (score !== null && (!best || score + (index ? 5 : 0) < best.score)) best = { score: score + (index ? 5 : 0), title };
      }
    }
    cache.set(game, best); return best;
  }
  const search = {
    match,
    compare: (a, b) => (match(a)?.score ?? Infinity) - (match(b)?.score ?? Infinity) || String(a.name ?? a.title).localeCompare(String(b.name ?? b.title)),
    suggestions(games, limit = 5) {
      if (!terms.length || games.some(game => match(game))) return [];
      const suggestions = new Map();
      for (const game of games) {
        const found = match(game, true);
        if (!found) continue;
        const id = searchWords(found.title).join(' '), previous = suggestions.get(id);
        if (!previous || found.score < previous.score) suggestions.set(id, found);
      }
      return [...suggestions.values()].sort((a, b) => a.score - b.score || a.title.localeCompare(b.title)).slice(0, limit);
    },
  };
  if (searchCache.size >= 20) searchCache.delete(searchCache.keys().next().value);
  searchCache.set(key, search); return search;
}

export function matchesSearch(game, query) {
  return Boolean(titleSearch(query).match(game));
}

export function matchesCopy(game, platform, source) {
  if (!platform && !source) return true;
  return game.copies.some(copy => copyMatchesFilters(copy, {platform,source}));
}

export const PC_STORES = [{id:'steam',name:'Steam'},{id:'gog',name:'GOG'},{id:'epic',name:'Epic Games'}];
export function storeKey(value) {
  const key=titleKey(value);
  return ({steam:'steam',gog:'gog','gog com':'gog','gog galaxy':'gog',epic:'epic','epic games':'epic','epic games store':'epic'})[key] ?? key;
}
export function copyMatchesFilters(copy, {platform='',source=''}={}) {
  return (!platform || (copy.platforms??[]).some(value=>platform==='pc'?platformKey(value)==='dos':value===platform)) &&
    (!source || (copy.sources??[]).some(value=>source.startsWith('store:')?storeKey(value)===source.slice(6):value===source));
}

export function validateEdits(value) {
  const record = v => v && typeof v === 'object' && !Array.isArray(v);
  if (!record(value)) throw new Error('Choose a library backup or an overrides.json export.');
  const wrapped = value.format === 'playnite-library-backup';
  if (wrapped && value.version !== 1) throw new Error('This backup version is not supported.');
  const overrides = wrapped ? value.overrides : value;
  const removed = wrapped ? value.removed : {};
  const notes = wrapped ? value.notes : {};
  if (![overrides, removed, notes].every(record)) throw new Error('The backup has invalid sections.');
  const clean = { overrides: Object.create(null), removed: Object.create(null), notes: Object.create(null) };
  const safeId = id => id && id.length <= 300 && !['__proto__', 'constructor', 'prototype'].includes(id);
  for (const [id, edit] of Object.entries(overrides)) {
    if (!safeId(id) || !record(edit)) throw new Error('The backup contains an invalid game.');
    const out = {};
    for (const key of ['favorite', 'hidden']) if (key in edit) {
      if (typeof edit[key] !== 'boolean') throw new Error('Favorites and visibility must be true or false.');
      out[key] = edit[key];
    }
    if ('notes' in edit) {
      if (typeof edit.notes !== 'string' || edit.notes.length > 10000) throw new Error('A note is invalid or too long.');
      out.notes = edit.notes;
    }
    clean.overrides[id] = out;
  }
  for (const [id, entry] of Object.entries(removed)) {
    if (!/^\d+$/.test(id) || !record(entry) || typeof entry.title !== 'string' || typeof entry.removedAt !== 'string') throw new Error('A wishlist removal is invalid.');
    clean.removed[id] = { title: entry.title.slice(0, 500), removedAt: entry.removedAt.slice(0, 100) };
  }
  for (const [id, note] of Object.entries(notes)) {
    if (!/^\d+$/.test(id) || typeof note !== 'string' || note.length > 10000) throw new Error('A wishlist note is invalid.');
    clean.notes[id] = note;
  }
  return clean;
}

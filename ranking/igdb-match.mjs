import { platformKey, baseTitle } from '../library/core.js';
export { baseTitle };
// Pure IGDB matching rules: which IGDB entry is this game? No network access here.

// Catalog systems and Playnite platform names → IGDB platform ids.
export const SYSTEM_PLATFORMS = {
  nes: [18, 99], snes: [19, 58], n64: [4], gc: [21], wii: [5], wiiu: [41], gb: [33], gbc: [22], gba: [24],
  ds: [20], '3ds': [37, 137], switch: [130], switch2: [508], sg1000: [84], ms: [64], md: [29], gg: [35],
  scd: [78], '32x': [30], saturn: [32], dc: [23], ps1: [7], ps2: [8], psp: [38], vita: [46], ps3: [9],
  ps4: [48], ps5: [167], xbox: [11], x360: [12], xone: [49], xsx: [169], atari2600: [59], atari5200: [66],
  atari7800: [60], lynx: [61], jaguar: [62], tg16: [86], pcecd: [150, 86], neogeo: [80, 79, 136],
  ngpc: [120, 119], mame: [52], cps: [52], naomi: [52], cave: [52], c64: [15], amiga: [16], spectrum: [26],
  msx: [27, 53], dos: [13, 6], pc: [6],
};
// Playnite platform names → the app's catalog systems → IGDB platform ids, so ROMs that
// Playnite imports (SNES, Mega Drive, …) match the right IGDB release.
export const playnitePlatforms = names => [...new Set((names ?? []).flatMap(name => SYSTEM_PLATFORMS[platformKey(name)] ?? []))];

// Game types we never match: DLC, mods/ROM hacks, episodes, seasons, packs, updates.
const EXCLUDED_TYPES = new Set([1, 5, 6, 7, 13, 14]), BUNDLE = 3;

export function normalizeTitle(value) {
  return String(value ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '').replace(/&/g, ' and ').replace(/[''`]/g, '').replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '').trim();
}

const yearOf = game => game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : null;
const ratingCount = game => (game.rating_count ?? 0) + (game.aggregated_rating_count ?? 0);
const steamIdsOf = game => (game.external_games ?? []).filter(item => item.external_game_source === 1 && /^\d+$/.test(item.uid ?? '')).map(item => item.uid);

// Score one candidate against the wanted title/year/platforms. Null means "not this game".
export function scoreCandidate(want, game) {
  if (EXCLUDED_TYPES.has(game.game_type)) return null;
  const wanted = normalizeTitle(want.title), wantedBase = normalizeTitle(baseTitle(want.title));
  const names = [game.name, ...(game.alternative_names ?? []).map(item => item.name)].map(normalizeTitle);
  const title = names.includes(wanted) ? 3 : names.includes(wantedBase) || names.map(name => normalizeTitle(baseTitle(name))).includes(wantedBase) ? 2 : 0;
  if (!title) return null;
  const year = yearOf(game), gap = want.year && year ? Math.abs(want.year - year) : null;
  const platform = !want.platforms?.length || !game.platforms ? null : game.platforms.some(id => want.platforms.includes(id));
  // A known Steam app is the strongest evidence there is. IGDB listing other Steam apps
  // for a same-named game means it's another product ("Call of Duty" the 2022 launcher vs
  // the 2003 game) unless the years agree (editions often have their own Steam app).
  const steamIds = steamIdsOf(game), steam = want.steam && steamIds.length ? steamIds.includes(String(want.steam)) : null;
  if (steam === false && (gap === null || gap > 1)) return null;
  // Bundles/collections rarely carry their own reception; prefer the game itself.
  const bundle = game.game_type === BUNDLE;
  const score = title * 2 + (gap === null ? 0 : gap === 0 ? 2 : gap <= 1 ? 1 : gap <= 3 ? -1 : -3)
    + (platform === true ? 1 : platform === false ? -2 : 0) + (steam === true ? 4 : steam === false ? -3 : 0) + Math.log10(ratingCount(game) + 1) - (bundle ? 2 : 0);
  const confidence = steam === true && title >= 2 ? 'high'
    : title === 3 && !bundle && (gap === null || gap <= 1) && platform !== false && steam !== false ? 'high'
    : title >= 2 && (gap === null || gap <= 3) && platform !== false ? 'medium' : 'low';
  return { id: game.id, score, confidence, title, gap, platform, steam };
}

// The best candidate, or null when nothing plausibly matches.
export function pickCandidate(want, games) {
  const scored = games.map(game => scoreCandidate(want, game)).filter(Boolean).sort((a, b) => b.score - a.score || a.id - b.id);
  // A release on another platform never beats the same title on yours: a 2021 mobile port
  // of Alien: Isolation is not the PS4 game, even when the store's date says 2021.
  const onPlatform = scored.find(other => other.platform === true && other.title >= (scored[0]?.title ?? 0));
  const best = scored[0]?.platform === false && onPlatform ? onPlatform : scored[0];
  // Store re-releases often carry a later date. An exact title on the right platform
  // is still a usable match when no other exact-title release there is closer in year.
  if (best?.confidence === 'low' && best.title === 3 && best.platform !== false && best.steam !== false &&
      !scored.some(other => other !== best && other.title === 3 && other.platform !== false && (other.gap ?? Infinity) < best.gap)) {
    return { ...best, confidence: 'medium' };
  }
  return best ?? null;
}

// Compact record kept in igdb.json. IGDB rating scales are 0–100.
export function compactGame(game) {
  const round = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
  return {
    id: game.id, name: game.name, year: yearOf(game), type: game.game_type ?? null, url: game.url ?? null,
    platforms: game.platforms ?? [], versionParent: game.version_parent ?? null,
    critic: round(game.aggregated_rating), criticCount: game.aggregated_rating_count ?? 0,
    players: round(game.rating), playersCount: game.rating_count ?? 0,
    steam: (game.external_games ?? []).filter(item => item.external_game_source === 1 && /^\d+$/.test(item.uid ?? '')).map(item => item.uid),
    // Relations used to compare a wishlist game with games you own.
    series: game.collections ?? [], franchises: [...new Set([...(game.franchises ?? []), ...(game.franchise ? [game.franchise] : [])])],
    similar: game.similar_games ?? [],
    // How it plays: IGDB genre, theme and camera-perspective ids (see tracking/anchors.js).
    genres: game.genres ?? [], themes: game.themes ?? [], perspectives: game.player_perspectives ?? [],
    // Fallbacks for games Playnite has no metadata for (cover art id and description).
    cover: game.cover?.image_id ?? null, summary: game.summary ? String(game.summary).slice(0, 1200) : null,
  };
}

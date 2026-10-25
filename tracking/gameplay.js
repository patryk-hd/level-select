// How a game plays, from IGDB: its camera, core genres and themes. Two games are only
// compared ("similar", "same series") when they're the same kind of game — The Binding of
// Isaac (a top-down roguelike) is not like System Shock 2 (a first-person shooter), and
// Mario Kart is not like Super Mario Odyssey. Scores only matter after that.

// Camera families. First- and third-person are both 3D; the rest are their own kind.
// Auditory (6) and VR (7) say how you play, not what you see, so they don't count.
const CAMERA = { 1: 'first-person', 2: 'third-person', 3: 'top-down', 4: 'side-view', 5: 'text' };
const FAMILY = { 'first-person': '3d', 'third-person': '3d', 'top-down': 'top-down', 'side-view': 'side-view', text: 'text' };
// Adventure, Indie and Arcade are too broad to make two games alike.
const BROAD = new Set([31, 32, 33]), INDIE = 32, ACTION_THEME = 1;
// Genres that span very different games: Strategy, Simulator, Puzzle.
const LOOSE = new Set([9, 13, 15]), SIMILAR_SCORE = 5;
// Most telling first, so the description names what the games really share.
const GENRES = [[4, 'fighting game'], [2, 'point-and-click adventure'], [34, 'visual novel'], [36, 'MOBA'], [30, 'pinball game'], [26, 'quiz game'], [7, 'music game'],
  [10, 'racing game'], [14, 'sports game'], [8, 'platformer'], [5, 'shooter'], [25, 'hack-and-slash'], [11, 'real-time strategy'], [16, 'turn-based strategy'],
  [24, 'tactics game'], [15, 'strategy game'], [12, 'RPG'], [13, 'simulation'], [9, 'puzzle game'], [35, 'card game'], [31, 'adventure'], [33, 'arcade game']];
const THEMES = [[19, 'horror'], [18, 'sci-fi'], [39, 'war'], [21, 'survival'], [23, 'stealth'], [43, 'mystery'], [22, 'historical'], [27, 'comedy'], [17, 'fantasy'], [38, 'open-world'], [33, 'sandbox']];

const cameras = game => (game?.perspectives ?? []).map(id => CAMERA[id]).filter(Boolean);
const both = (a, b) => a.filter(item => b.includes(item));
const themesOf = game => (game?.themes ?? []).filter(id => id !== ACTION_THEME);

// { fits, kind } for two IGDB records; `kind` reads like "first-person war shooter".
// Unknown data never proves a difference. `strict` (for IGDB's "similar games", which are
// noisy) also needs positive evidence: a shared genre, and a shared theme when both have one.
export function gameplayFit(a, b, { strict = false } = {}) {
  const camA = cameras(a), camB = cameras(b);
  const families = both([...new Set(camA.map(camera => FAMILY[camera]))], camB.map(camera => FAMILY[camera]));
  if (camA.length && camB.length && !families.length) return { fits: false, kind: null };
  const allA = (a?.genres ?? []).filter(id => id !== INDIE), allB = (b?.genres ?? []).filter(id => id !== INDIE);
  const coreA = allA.filter(id => !BROAD.has(id)), coreB = allB.filter(id => !BROAD.has(id));
  let genres = [];
  if (allA.length && allB.length) {
    // Two action games share "Adventure"; that alone doesn't make an RPG like a walking sim.
    genres = coreA.length || coreB.length ? both(coreA, coreB) : both(allA, allB);
    if (!genres.length) return { fits: false, kind: null };
  } else if (strict) return { fits: false, kind: null };
  const themes = both(themesOf(a), themesOf(b));
  if (strict && themesOf(a).length && themesOf(b).length && !themes.length) return { fits: false, kind: null };
  const camera = both(camA, camB)[0] ?? (families[0] === '3d' ? null : families[0]) ?? null;
  const kind = [camera, THEMES.find(([id]) => themes.includes(id))?.[1], GENRES.find(([id]) => genres.includes(id))?.[1]].filter(Boolean).join(' ');
  // How much they share: specific genres count most, a broad one ("strategy", "puzzle") less.
  const score = genres.reduce((sum, id) => sum + (LOOSE.has(id) || BROAD.has(id) ? 1 : 2), 0) + themes.length + (both(camA, camB).length ? 2 : families.length ? 1 : 0);
  // Checked on a real wishlist: below 5, "similar" pairs share little more than one broad genre
  // (Resident Evil 4 and Outer Wilds, Katana ZERO and SteamWorld Heist).
  if (strict && score < SIMILAR_SCORE) return { fits: false, kind: null, score };
  return { fits: true, kind: kind || null, score };
}

// Whether a record has anything to compare (older snapshots don't).
export const knowsGameplay = game => Boolean(game?.genres?.length || game?.perspectives?.length);

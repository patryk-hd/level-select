// Which Atlas entries are the same game: ports, editions and remasters of one original
// count once in list goals and challenges (any version you finish counts), while remakes,
// sequels and standalone expansions are games of their own.
//
// The same game when any of these holds:
// - the same IGDB game (a multi-system release: The Witcher 3 on PS4, Xbox One and PC);
// - an edition, bundle, remaster, expanded edition or port of it, through IGDB's parent
//   links (Persona 5 Royal → Persona 5, The Last of Us Remastered → The Last of Us, Chrono
//   Trigger on DS → its PS1 release → the SNES original);
// - the same title (edition suffixes dropped) released within five years. God of War from
//   2005 and from 2018 are two games, and so are Resident Evil 4 and its 2023 remake.
// A remake (IGDB type 8: The Last of Us Part I, Ocarina of Time 3D, Persona 3 Reload) is
// always its own game.
import { baseTitle } from '../library/core.js';

const REMAKE = 8, NEAR_YEARS = 5;

export const titleKey = title => baseTitle(String(title ?? '').replace(/\s*\((?:19|20)\d\d\)\s*$/, '')).toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/^the /, '').trim();
const igdbOf = game => game.reviews?.igdb ?? null;
// The list builder traces editions, bundles, remasters, expanded editions and ports to their
// original (IGDB's parent links, any number of steps): `origin`, or the game itself.
const originOf = igdb => igdb.origin ?? igdb.id;

// Catalog id → family key (one member's id), over the listed games.
export function gameFamilies(games) {
  const parent = new Map(games.map(game => [game.id, game.id]));
  const find = id => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
  const join = (a, b) => { const x = find(a), y = find(b); if (x !== y) parent.set(y, x); };
  const byOrigin = new Map(), byTitle = new Map();
  for (const game of games) {
    const igdb = igdbOf(game);
    if (igdb?.id) byOrigin.set(originOf(igdb), [...(byOrigin.get(originOf(igdb)) ?? []), game]);
    const key = titleKey(game.title); if (key) byTitle.set(key, [...(byTitle.get(key) ?? []), game]);
  }
  for (const same of byOrigin.values()) for (const game of same.slice(1)) join(same[0].id, game.id);
  // An original's remasters (IGDB lists them with its remakes, which stay apart). Only the
  // version itself: a remaster of a remake belongs to the remake.
  const byId = new Map();
  for (const game of games) { const id = igdbOf(game)?.id; if (id) byId.set(id, [...(byId.get(id) ?? []), game]); }
  for (const game of games) for (const id of igdbOf(game)?.versions ?? []) for (const version of byId.get(id) ?? []) if (igdbOf(version).type !== REMAKE) join(game.id, version.id);
  // The same title within a few years: one release on several systems. When IGDB knows both
  // and calls them different games (a reboot that kept the name), it has the last word,
  // unless both come from one parent (Tetris on NES and Game Boy). A release IGDB doesn't
  // know joins only the nearest one, so it never bridges an original and its remake.
  const near = (a, b) => !Number.isInteger(a.year) || !Number.isInteger(b.year) || Math.abs(a.year - b.year) <= NEAR_YEARS;
  const gap = (a, b) => Number.isInteger(a.year) && Number.isInteger(b.year) ? Math.abs(a.year - b.year) : NEAR_YEARS;
  for (const same of byTitle.values()) {
    const known = same.filter(igdbOf), unknown = same.filter(game => !igdbOf(game));
    for (let i = 0; i < known.length; i++) for (let j = i + 1; j < known.length; j++) {
      const a = known[i], b = known[j], x = igdbOf(a), y = igdbOf(b);
      if (near(a, b) && (originOf(x) === originOf(y) || x.parent && x.parent === y.parent)) join(a.id, b.id);
    }
    for (const game of unknown) {
      const nearest = [...known, ...unknown.filter(other => other !== game)].filter(other => near(game, other)).sort((a, b) => gap(game, a) - gap(game, b) || Number(!igdbOf(a)) - Number(!igdbOf(b)))[0];
      if (nearest) join(nearest.id, game.id);
    }
  }
  const keys = new Map();
  for (const game of games) keys.set(game.id, find(game.id));
  return keys;
}

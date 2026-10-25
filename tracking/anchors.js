// "Wishlist vs what you own": judge a wished-for game against similar games you already
// own — same series first, then franchise, then IGDB's similar games — and how you felt
// about them. Scores decide between similar games; nothing is removed automatically.
import { igdbRating } from './score.js';
import { titleKey } from '../library/core.js';
import { gameplayFit } from './gameplay.js';

// Edition words ("Complete Edition", "GOTY") and later-version words ("Remastered") are
// dropped to find the game a title is a version of. A leading "The" is kept: "Operator"
// and "The Operator" are different games.
const EDITION_WORDS = /\b(?:(?:game of the year|goty|complete|definitive|deluxe|ultimate|gold|premium|special|anniversary|collectors|digital|legendary|directors)(?: edition| cut| version)?|edition)\b/g;
const LATER_WORDS = [[/\bremake\b/, 'remake'], [/\bremaster(?:ed)?\b/, 'remaster'], [/\benhanced\b/, 'enhanced version'], [/\bhd\b/, 'HD version'], [/\b(?:redux|reforged)\b/, 'remaster']];
export const sameGameKey = title => LATER_WORDS.reduce((key, [words]) => key.replace(new RegExp(words.source, 'g'), ' '), titleKey(title).replace(EDITION_WORDS, ' ')).replace(/\s+/g, ' ').trim();
// IGDB game types that are a later version of an existing game.
const LATER_TYPES = { 8: 'remake', 9: 'remaster', 10: 'expanded version', 11: 'port' };
const laterVersion = (igdb, title) => LATER_TYPES[igdb?.type] ?? LATER_WORDS.find(([words]) => words.test(titleKey(title)))?.[1] ?? null;

const RELATION_LABELS = { original: 'the original', series: 'same series', franchise: 'same franchise', similar: 'similar game' };
const RELATION_RANK = { original: -1, series: 0, franchise: 1, similar: 2 };
// Broad franchises (e.g. "Warhammer", "Star Wars") span unrelated genres; only count a
// franchise link when the games also share a series or IGDB lists them as similar,
// unless the franchise is small.
const BROAD_FRANCHISE = 25;

// Owned games (Playnite copies and games marked owned) with their IGDB relations. Every
// copy is kept (two copies can share an IGDB game), and Steam copies are also found by app.
export function ownedIndex(library) {
  const games = new Map(), franchiseSize = new Map(), byId = new Map(), byKey = new Map(), byParent = new Map(), byApp = new Map();
  const add = (map, key, value) => { if (key) map.set(key, [...(map.get(key) ?? []), value]); };
  for (const group of library) for (const copy of group.copies) {
    const igdb = copy.igdb ?? null, title = copy.name ?? group.name;
    const owned = { igdbId: igdb?.id ?? null, groupId: group.id, copyId: copy.id, title, key: sameGameKey(title), steamAppId: copy.steamAppId ? String(copy.steamAppId) : null, year: copy.year ?? group.year ?? null, platforms: copy.platforms ?? [], sources: copy.sources ?? [], igdb, hours: Math.round((copy.timePlayed ?? group.timePlayed ?? 0) / 3600), rating: igdb ? igdbRating(igdb) : null };
    add(byApp, owned.steamAppId, owned);
    if (!igdb?.id) continue;
    add(byId, igdb.id, owned); add(byKey, owned.key, owned); add(byParent, igdb.versionParent, owned);
    if (games.has(igdb.id)) continue;
    games.set(igdb.id, owned);
    for (const id of igdb.franchises ?? []) franchiseSize.set(id, (franchiseSize.get(id) ?? 0) + 1);
  }
  return { games, franchiseSize, byId, byKey, byParent, byApp };
}

// How an owned game relates to a wished-for one:
//   same     — the same game (same Steam app, same IGDB game, or the same name and era)
//   edition  — another edition of it ("Definitive Edition", "GOTY")
//   original — you own the original; the wish is its remaster, remake or expanded version
//   newer    — you own the remaster (or similar); the wish is the original
// or null when they're different games. Same-named games are the trap: "Operator" and
// "The Operator", the 1993 and 2016 DOOM, the 2003 "Call of Duty" and the 2022 one.
export function ownership(wish, owned) {
  const wishIgdb = wish.igdb ?? null, ownIgdb = owned.igdb ?? {}, title = wish.title ?? '';
  const wishApp = wish.appid ? String(wish.appid) : null, wishYear = wishIgdb?.year ?? wish.year ?? null;
  if (wishApp && wishApp === owned.steamAppId) return { owns: 'same' };
  // Distrust the copy's IGDB link when it looks like a same-name mix-up: a Steam copy of an
  // app IGDB doesn't list for that game, released in another year, or any copy years apart.
  const gap = owned.year && wishYear ? Math.abs(owned.year - wishYear) : null, listed = ownIgdb.steam ?? [];
  const unlisted = owned.steamAppId && listed.length && !listed.includes(owned.steamAppId);
  const mixedUp = unlisted ? gap === null || gap > 1 : gap !== null && gap > 3;
  if (!mixedUp && wishIgdb?.id && wishIgdb.id === owned.igdbId) return { owns: 'same' };
  if (!mixedUp && wishIgdb?.id && owned.igdbId && (wishIgdb.versionParent === owned.igdbId || ownIgdb.versionParent === wishIgdb.id || wishIgdb.versionParent && wishIgdb.versionParent === ownIgdb.versionParent)) return { owns: 'edition' };
  if (!title || sameGameKey(title) !== owned.key) return null;
  const wishLater = laterVersion(wishIgdb, title), ownLater = laterVersion(ownIgdb, owned.title);
  if (wishLater && !ownLater) return { owns: 'original', version: wishLater };
  if (ownLater && !wishLater) return { owns: 'newer', version: ownLater };
  // Same name: both the IGDB year and your copy's own year must agree.
  const apart = wishYear ? Math.max(0, ...[ownIgdb.year, owned.year].filter(Boolean).map(year => Math.abs(wishYear - year))) : 0;
  if (titleKey(title) !== titleKey(owned.title)) return apart > 2 ? null : { owns: 'edition' };
  return apart > 1 ? null : { owns: 'same' };
}

// Same series first, then franchise, then IGDB's similar games — and only between games
// of the same kind (see gameplay.js). Returns { kind, type } or null.
function relation(wish, owned, franchiseSize) {
  const similar = wish.similar?.includes(owned.id) || owned.similar?.includes(wish.id);
  const kind = wish.series?.some(id => owned.series?.includes(id)) ? 'series'
    : wish.franchises?.some(id => owned.franchises?.includes(id) && (similar || (franchiseSize.get(id) ?? 0) <= BROAD_FRANCHISE)) ? 'franchise'
    : similar ? 'similar' : null;
  if (!kind) return null;
  const fit = gameplayFit(wish, owned, { strict: kind === 'similar' });
  return fit.fits ? { kind, type: fit.kind, closeness: fit.score } : null;
}

// How you felt about an owned game: your answer, then play history, then Playnite hours.
const answerFor = (state, anchor) => Object.values(state.annotations).find(note => note.enjoyed && (note.source?.provider === 'playnite' && note.source.id === anchor.copyId || note.targetId === `target:playnite:${anchor.copyId}`))?.enjoyed ?? null;
export function enjoyment(state, anchor) {
  const answer = answerFor(state, anchor);
  if (answer) return answer === 'yes' ? 'enjoyed' : answer === 'no' ? 'disliked' : 'unplayed';
  const plays = Object.values(state.playthroughs).filter(play => play.targetId === `target:playnite:${anchor.copyId}`);
  const rated = plays.find(play => Number.isFinite(play.rating));
  if (rated) return rated.rating >= 3.5 ? 'enjoyed' : rated.rating <= 2 ? 'disliked' : 'mixed';
  if (plays.some(play => play.status === 'retired')) return 'disliked';
  if (plays.some(play => play.status === 'finished')) return 'enjoyed';
  if (plays.some(play => ['playing', 'paused'].includes(play.status))) return 'playing';
  if (anchor.hours >= 10) return 'probably-enjoyed';
  return anchor.hours > 0 ? 'tried' : 'unplayed';
}

// Owned games that are this game or a version of it, each with how (see ownership).
export function ownedCopiesOf(wish, index) {
  const ids = [wish.igdb?.id, wish.igdb?.versionParent].filter(Boolean), key = sameGameKey(wish.title ?? '');
  const candidates = new Set([...ids.flatMap(id => index.byId?.get(id) ?? [index.games.get(id)]), ...ids.flatMap(id => index.byParent?.get(id) ?? []),
    ...(key ? index.byKey?.get(key) ?? [] : []), ...(wish.appid ? index.byApp?.get(String(wish.appid)) ?? [] : [])].filter(Boolean));
  return [...candidates].map(owned => { const how = ownership(wish, owned); return how && { ...owned, ...how }; }).filter(Boolean);
}

// Up to three owned anchors for a wishlist game, strongest relation first.
export function anchorsFor(wishIgdb, index, state, wishTitle = '') {
  if (!wishIgdb?.id) return [];
  const found = [], versions = new Set(ownedCopiesOf({ igdb: wishIgdb, title: wishTitle }, index).map(owned => owned.igdbId));
  for (const owned of index.games.values()) {
    if (versions.has(owned.igdbId)) continue;
    const related = relation(wishIgdb, owned.igdb, index.franchiseSize);
    if (related) found.push({ ...owned, relation: related.kind, relationLabel: RELATION_LABELS[related.kind], gameplay: related.type, closeness: related.closeness, feeling: enjoyment(state, owned), answered: Boolean(answerFor(state, owned)) });
  }
  // Strongest relation first; among similar games the one that plays most alike, then the best rated.
  return found.sort((a, b) => RELATION_RANK[a.relation] - RELATION_RANK[b.relation] || (a.relation === 'similar' ? b.closeness - a.closeness : 0) || (b.rating?.value ?? -1) - (a.rating?.value ?? -1)).slice(0, 3);
}

// The suggestion for a wish, given its anchors. `siblings` are other wishes related to
// the same anchor, so "keep the best" can compare scores between them.
export function verdict(wishIgdb, anchors, siblings = []) {
  if (!anchors.length) return null;
  const main = anchors[0], wishScore = igdbRating(wishIgdb)?.value ?? null, ownScore = main.rating?.value ?? null;
  const better = wishScore !== null && ownScore !== null && wishScore - ownScore >= 10;
  const rank = wishScore === null ? null : 1 + siblings.filter(other => (igdbRating(other)?.value ?? -1) > wishScore).length;
  // A merely "similar" game you haven't played says little; only a series or franchise does.
  if (['unplayed', 'tried'].includes(main.feeling) && main.relation === 'similar') return null;
  if (['unplayed', 'tried'].includes(main.feeling)) return { kind: 'play-first', anchor: main, text: `You own ${main.title} (${main.relationLabel}) and ${main.feeling === 'tried' ? 'have barely played it' : "haven't played it yet"}. Play it first?`, action: 'snooze' };
  if (main.feeling === 'disliked') return better
    ? { kind: 'reconsider', anchor: main, text: `You didn't enjoy ${main.title}, but reviewers rate this ${wishScore - ownScore} points higher (${wishScore} vs ${ownScore}).`, action: null }
    : { kind: 'remove', anchor: main, text: `You didn't enjoy ${main.title} (${main.relationLabel}). This one probably isn't for you either.`, action: 'archive' };
  if (['enjoyed', 'probably-enjoyed'].includes(main.feeling)) {
    if (rank === null || rank === 1) return { kind: 'keep', anchor: main, text: `You ${main.feeling === 'enjoyed' ? 'enjoyed' : `put ${main.hours}h into`} ${main.title}.${siblings.length ? ` This is the best-rated of ${siblings.length + 1} related wishes.` : ''}`, action: 'keep' };
    return { kind: 'keep-best', anchor: main, text: `You ${main.feeling === 'enjoyed' ? 'enjoyed' : `put ${main.hours}h into`} ${main.title}, but ${rank - 1} related ${rank === 2 ? 'wish is' : 'wishes are'} better rated. Keep the best, drop this one?`, action: 'archive' };
  }
  return { kind: 'ask', anchor: main, text: `You're ${main.feeling === 'playing' ? 'playing' : 'part-way through'} ${main.title} (${main.relationLabel}). See how you like it before buying more.`, action: 'snooze' };
}

// A remaster, remake or expanded version of a game you own: judged by how the original went.
export function originalAnchor(original, state) {
  return { ...original, relation: 'original', relationLabel: RELATION_LABELS.original, feeling: enjoyment(state, original), answered: Boolean(answerFor(state, original)) };
}
export function versionVerdict(wishIgdb, anchor, version) {
  const wishScore = igdbRating(wishIgdb)?.value ?? null, ownScore = anchor.rating?.value ?? null;
  if (['unplayed', 'tried'].includes(anchor.feeling)) return { kind: 'play-first', anchor, text: `You own the original, ${anchor.title}, and ${anchor.feeling === 'tried' ? 'have barely played it' : "haven't played it yet"}. Play that first; the ${version} can wait.`, action: 'snooze' };
  if (anchor.feeling === 'disliked') return version === 'remake' && wishScore !== null && ownScore !== null && wishScore - ownScore >= 10
    ? { kind: 'reconsider', anchor, text: `You didn't enjoy ${anchor.title}, but this remake is rated ${wishScore - ownScore} points higher (${wishScore} vs ${ownScore}).`, action: null }
    : { kind: 'remove', anchor, text: `You didn't enjoy the original, ${anchor.title}. A ${version} is unlikely to change that.`, action: 'archive' };
  if (['enjoyed', 'probably-enjoyed'].includes(anchor.feeling)) return { kind: 'upgrade', anchor, text: `You ${anchor.feeling === 'enjoyed' ? 'enjoyed' : `put ${anchor.hours}h into`} ${anchor.title}. Keep the ${version} only if you want to play it again; a sale is a good time.`, action: 'wait-for-price' };
  return { kind: 'ask', anchor, text: `You're ${anchor.feeling === 'playing' ? 'playing' : 'part-way through'} the original, ${anchor.title}. Decide on the ${version} once you've finished it.`, action: 'snooze' };
}

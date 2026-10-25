// List goals: finish a list from tracking/lists.js. The top 10, 25, 50 or 100 of one
// system's list, of every system, of a year or decade, or of a genre; the best of an
// iconic series; or the games that shaped a genre. Goals are checklists: they follow the
// current lists, each game counts once whichever version you finish, and finishes from
// before the goal was set count too. Completing a list records a list award: its badge,
// and XP (10 per game) when a finish logged after the goal was set completed it.
import { connectLibrary } from '../library/core.js';
import { requireId, instant, text, clone } from './domain.js';
import { listEntries, listTitle, scoreOf, GENRES, SERIES, SHAPED, DECADES } from './lists.js';

export const GOAL_SIZES = [10, 25, 50, 100];
export const MAX_GOALS = 24;
const FIELDS = ['id', 'createdAt', 'size', 'system', 'year', 'decade', 'genre', 'series', 'shaped'];
const check = (value, message) => { if (!value) throw new Error(message); };
const listed = game => !game.unlisted && game.rank != null;

export function validateGoal(goal) {
  check(goal && typeof goal === 'object' && !Array.isArray(goal), 'Invalid list goal.');
  requireId(goal.id); instant(goal.createdAt);
  check(GOAL_SIZES.includes(goal.size), 'Choose a top 10, 25, 50 or 100.');
  check(typeof goal.system === 'string' && goal.system.length <= 100, 'Invalid list goal system.');
  check(goal.year === null || Number.isInteger(goal.year) && goal.year >= 1950 && goal.year <= 2200, 'Invalid list goal year.');
  check(goal.decade === undefined || DECADES.includes(goal.decade) && goal.year === null, 'Invalid list goal decade.');
  check(goal.genre === undefined || Object.hasOwn(GENRES, goal.genre), 'Invalid list goal genre.');
  check(goal.series === undefined || Object.hasOwn(SERIES, goal.series), 'Invalid list goal series.');
  check(goal.shaped === undefined || Object.hasOwn(SHAPED, goal.shaped), 'Invalid list goal genre history.');
  // A series or a genre's history is a list of its own, across every system.
  check(!(goal.series || goal.shaped) || !goal.system && goal.year === null && goal.decade === undefined && goal.genre === undefined && !(goal.series && goal.shaped), 'Invalid list goal.');
  check(Object.keys(goal).every(key => FIELDS.includes(key)), 'Unsupported list goal fields.');
}
export function validateListGoals(goals) {
  if (goals === undefined) return;
  check(Array.isArray(goals) && goals.length <= MAX_GOALS, 'Invalid list goals.');
  goals.forEach(validateGoal);
  check(new Set(goals.map(goal => goal.id)).size === goals.length, 'Duplicate list goal.');
}
const sameGoal = (a, b) => FIELDS.slice(2).every(key => (a[key] ?? null) === (b[key] ?? null));
export function addListGoal(current, { size, system = '', year = null, decade, genre, series, shaped }, { id, at }) {
  const state = structuredClone(current), goal = { id, createdAt: at, size, system: system ?? '', year: year ?? null,
    ...(decade != null ? { decade } : {}), ...(genre ? { genre } : {}), ...(series ? { series } : {}), ...(shaped ? { shaped } : {}) };
  validateGoal(goal);
  const goals = state.settings.listGoals ?? [];
  check(!goals.some(other => sameGoal(other, goal)), 'You already have this goal.');
  check(goals.length < MAX_GOALS, `Keep at most ${MAX_GOALS} list goals. Remove one first.`);
  state.settings.listGoals = [...goals, goal];
  return state;
}
export function removeListGoal(current, id) {
  const state = structuredClone(current);
  state.settings.listGoals = (state.settings.listGoals ?? []).filter(goal => goal.id !== id);
  if (!state.settings.listGoals.length) delete state.settings.listGoals;
  return state;
}
// Backups merge goals from both sides; the same goal set twice stays one.
export function mergeListGoals(...lists) {
  const merged = [];
  for (const goal of lists.flat().filter(Boolean)) if (!merged.some(other => other.id === goal.id || sameGoal(other, goal))) merged.push(structuredClone(goal));
  return merged.slice(0, MAX_GOALS);
}

// The games a goal asks for: see listEntries.
export const goalEntries = (catalog, goal) => listEntries(catalog, goal);
// Years with at least ten scored games, newest first: enough for a "top 10 of the year".
export function goalYears(catalog, system = '') {
  const counts = new Map();
  for (const game of catalog.games) if (listed(game) && Number.isInteger(game.year) && (!system || game.systemId === system) && scoreOf(game) !== null) counts.set(game.year, (counts.get(game.year) ?? 0) + 1);
  return [...counts].filter(([, count]) => count >= 10).map(([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year);
}

// Unreviewed library copies that can only be one list game: the same title on the same
// system, with no other copy or list entry sharing it. Copy id → catalog id. Challenges
// show these as "title/platform hint" and ask you to check them before accepting.
export function titleHints(connections) {
  const byCopy = new Map(), byGame = new Map();
  for (const candidates of Object.values(connections.candidatesByRelease)) for (const item of candidates) if (item.sameSystem && item.status !== 'rejected') {
    byCopy.set(item.copyId, [...(byCopy.get(item.copyId) ?? []), item]);
    byGame.set(item.catalogId, [...(byGame.get(item.catalogId) ?? []), item]);
  }
  const hints = new Map();
  for (const [copyId, items] of byCopy) if (items.length === 1 && items[0].status === 'unresolved' && byGame.get(items[0].catalogId).length === 1) hints.set(copyId, items[0].catalogId);
  return hints;
}
// Catalog games you finished: through the Atlas entry itself, or a library copy of that
// game (a confirmed match or an unambiguous title hint). Any finished playthrough counts,
// including ones logged as past.
// The finished playthrough behind each catalog game you finished: through the Atlas entry
// itself, or a library copy of that game (a confirmed match or an unambiguous title hint).
// Any finished playthrough counts, including ones logged as past. Catalog id → play id.
export function finishedCatalogPlays(state, catalog, library, connections = connectLibrary(catalog, library, state.matchReviews)) {
  const playOf = new Map();
  for (const play of Object.values(state.playthroughs).sort((a, b) => a.id.localeCompare(b.id))) if (play.status === 'finished' && !playOf.has(play.targetId)) playOf.set(play.targetId, play.id);
  const byCopy = new Map();
  for (const candidates of Object.values(connections.candidatesByRelease)) {
    for (const item of candidates) if (item.status === 'accepted' && item.sameSystem) byCopy.set(item.copyId, [...(byCopy.get(item.copyId) ?? []), item.catalogId]);
  }
  for (const [copyId, catalogId] of titleHints(connections)) if (!byCopy.has(copyId)) byCopy.set(copyId, [catalogId]);
  const plays = new Map();
  for (const target of Object.values(state.targets)) {
    const play = playOf.get(target.id); if (!play) continue;
    for (const ref of target.refs) {
      if (ref.provider === 'catalog' && !plays.has(ref.id)) plays.set(ref.id, play);
      if (ref.provider === 'playnite') for (const id of byCopy.get(ref.id) ?? []) if (!plays.has(id)) plays.set(id, play);
    }
  }
  return plays;
}
export const finishedCatalogIds = (state, catalog, library, connections) => new Set(finishedCatalogPlays(state, catalog, library, connections).keys());
export function goalProgress(catalog, goal, finishedIds) {
  const entries = goalEntries(catalog, goal).map(entry => ({ ...entry, done: entry.games.some(game => finishedIds.has(game.id)) }));
  const finished = entries.filter(entry => entry.done).length;
  return { entries, finished, total: entries.length, complete: entries.length > 0 && finished === entries.length };
}
export const goalTitle = (goal, systemName, count) => listTitle(goal, systemName, count);

// ---------- list awards ----------
// One award per goal, kept when the goal is removed: the list's badge, and its XP (10 per
// game, at most 1,000) when at least one of the finishes that completed it was logged after
// the goal was set. A list you had already finished earns the badge only. Undoing one of
// its finishes takes the award back (the XP with it), until the list is complete again.
export const LIST_XP_PER_GAME = 10, LIST_XP_LIMIT = 1000, LIST_KINDS = ['history', 'series', 'decade', 'genre'];
export const listKinds = goal => [goal.shaped && 'history', goal.series && 'series', goal.decade != null && 'decade', goal.genre && 'genre'].filter(Boolean);
export const validListAward = (state, award) => award.proofIds.every(id => state.playthroughs[id]?.status === 'finished');
// When a play was last marked finished (or logged as finished before).
function finishedAt(state, playId) {
  return Object.values(state.events).filter(event => event.details.playthroughId === playId && ['status', 'play-edit'].includes(event.type)).reduce((latest, event) => event.recordedAt > latest ? event.recordedAt : latest, '');
}
export function captureListAwards(before, proposed, { catalog, library, at, connections }) {
  const goals = (proposed.settings.listGoals ?? []).filter(goal => { const award = proposed.listAwards[`list:${goal.id}`]; return !award || !validListAward(proposed, award); });
  if (!goals.length) return proposed;
  const plays = finishedCatalogPlays(proposed, catalog, library, connections), systems = new Map(catalog.systems.map(system => [system.id, system.name ?? system.id]));
  const profile = proposed.progression.profile ?? null;
  let state = proposed;
  for (const goal of goals) {
    const entries = listEntries(catalog, goal), proof = entries.map(entry => entry.games.map(game => plays.get(game.id)).find(Boolean));
    if (!entries.length || proof.some(id => !id)) continue;
    if (state === proposed) state = clone(proposed);
    const proofIds = [...new Set(proof)].sort(), fresh = proofIds.some(id => finishedAt(state, id) > goal.createdAt);
    const xp = profile && at >= profile.startedAt && fresh ? Math.min(LIST_XP_LIMIT, LIST_XP_PER_GAME * entries.length) : 0;
    const id = `list:${goal.id}`;
    state.listAwards[id] = { id, goalId: goal.id, title: listTitle(goal, systemId => systems.get(systemId) ?? systemId, entries.length), kinds: listKinds(goal), games: entries.length, at, proofIds, xp };
  }
  return state;
}
export function listAwardEntitlements(state) {
  const desired = {};
  for (const award of Object.values(state.listAwards ?? {})) if (award.xp > 0 && validListAward(state, award)) {
    const id = `list:${award.goalId}`;
    desired[id] = { id, type: 'list', subjectId: award.goalId, amount: award.xp, ruleVersion: 1, sourceIds: [award.id] };
  }
  return desired;
}
export const listXpLimit = (state, goalId) => state.listAwards?.[`list:${goalId}`]?.xp ?? 0;
export function validateListAwards(state) {
  for (const [id, award] of Object.entries(state.listAwards)) {
    check(award && award.id === id && id === `list:${award.goalId}`, 'Invalid list award.'); requireId(award.goalId); instant(award.at); text(award.title, 500);
    check(Array.isArray(award.kinds) && award.kinds.every(kind => LIST_KINDS.includes(kind)), 'Invalid list award kind.');
    check(Number.isInteger(award.games) && award.games > 0 && award.games <= 1000, 'Invalid list award size.');
    check(Array.isArray(award.proofIds) && award.proofIds.length > 0 && award.proofIds.length <= 1000, 'Invalid list award evidence.'); award.proofIds.forEach(requireId);
    check(Number.isInteger(award.xp) && award.xp >= 0 && award.xp <= LIST_XP_LIMIT && award.xp % LIST_XP_PER_GAME === 0, 'Invalid list award XP.');
    check(!award.xp || state.progression.profile, 'A list award with XP needs a reward profile.');
  }
}


// Backlog triage: decide, one owned game at a time, what deserves a place in the plan.
// Decisions live on the game's annotation, so they travel with tracking backups.
import { applyCommand, validateTriage, TRIAGE_DECISIONS, clone, recordEvent } from './domain.js';
import { patchAnnotation, setUpNext } from './compat.js';
import { markPlayed, planPoint, restorePlanPoint } from './plan.js';
import { isExtra } from '../library/core.js';
import { compareRatings } from './score.js';
import { compareWithAwards } from './awards.js';
import { handledGames } from './suggestions.js';

export { TRIAGE_DECISIONS, validateTriage };
export const TRIAGE_LABELS = { soon: 'Play soon', maybe: 'Maybe later', played: 'Already played', pass: 'Not for me' };
export const MAYBE_DAYS = 90;
const WANT_SOON = 2;

export function triageFor(state, targetId) {
  return Object.values(state.annotations).find(item => item.targetId === targetId && item.triage)?.triage ?? null;
}

const addDays = (day, days) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);

// Owned, available games with no plan yet and no standing decision, best-rated first.
// "Maybe" comes back once its date has passed. Copies of the same IGDB game (e.g. a
// GOG Complete Edition and an Epic GOTY Edition) become one card with siblings.
export function triageQueue(choices, state, { today }) {
  const handled = handledGames(choices);
  const eligible = choices.filter(choice => {
    // Another copy of this game already has a decision, a plan or a finish.
    if (choice.status === 'untracked' && !choice.triage && choice.options.some(option => option.igdb?.id && handled.has(option.igdb.id))) return false;
    if (choice.archived || choice.queued || !['untracked', 'not-started'].includes(choice.status) || isExtra(choice.title)) return false;
    if (!choice.options.some(option => option.owned && !option.unavailable && !option.hidden)) return false;
    const triage = choice.triage ?? triageFor(state, choice.id);
    return !triage || (triage.decision === 'maybe' && triage.until && triage.until <= today);
  }).map(choice => ({ ...choice, option: bestOption(choice) }))
    // Best-rated first; an award winner edges out a game rated about the same.
    .sort((a, b) => compareWithAwards(a.option, b.option) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const byGame = new Map(), cards = [];
  for (const choice of eligible) {
    const key = choice.option.igdb?.id ? `igdb:${choice.option.igdb.id}` : null;
    if (key && byGame.has(key)) { byGame.get(key).siblings.push(choice); continue; }
    const card = { ...choice, siblings: [] };
    if (key) byGame.set(key, card);
    cards.push(card);
  }
  return cards;
}
const bestOption = choice => [...choice.options].filter(option => option.owned && !option.unavailable && !option.hidden)
  .sort((a, b) => compareRatings(a.rating, b.rating))[0];

// Returns the new state plus what is needed to undo it exactly.
// One decision covers every copy on the card. "Play soon" puts the best copy in Up Next;
// "Already played" records an undated finish so the game leaves triage and suggestions.
export function applyTriage(current, choice, decision, { at, eventId, today }) {
  if (!TRIAGE_DECISIONS.includes(decision)) throw new Error('Invalid triage decision.');
  const copies = [choice, ...(choice.siblings ?? [])];
  const undo = planPoint(current, copies.map(item => item.id));
  const triage = validateTriage({ decision, at, until: decision === 'maybe' ? addDays(today, MAYBE_DAYS) : null });
  let state = current;
  for (const item of copies) state = patchAnnotation(state, item.option.descriptor, { triage });
  state = clone(state);
  recordEvent(state, { type: 'triage', targetId: choice.id, at, eventId }, { decision, copies: copies.map(item => item.id) });
  if (decision === 'soon') {
    if (!state.backlog[choice.id]) state = applyCommand(state, { type: 'queue', targetId: choice.id, priority: WANT_SOON, at, eventId: `${eventId}:queue` });
    if (!state.backlog[choice.id].upNext) state = setUpNext(state, choice.option.descriptor, true, { at, eventId: `${eventId}:upnext` });
  }
  if (decision === 'played') {
    state = markPlayed(state, choice.option.descriptor, 'finished', { at, eventIds: [`${eventId}:start`, `${eventId}:finish`, `${eventId}:undated`], playthroughId: `triage:${eventId}` }).state;
  }
  return { state, undo };
}

export function undoTriage(current, choice, undo, { at, eventId }) {
  return restorePlanPoint(current, undo, { at, eventId });
}

// Counts for the intro: how many games still wait for a decision.
export function triageSummary(queue) {
  return { waiting: queue.length, rated: queue.filter(choice => choice.option.rating).length };
}

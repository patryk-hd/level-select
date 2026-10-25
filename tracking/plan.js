// Quick plan actions: remove a game added by mistake, or mark it finished/retired
// without opening the full play panel.
import { applyCommand, ensureTarget, clone, recordEvent } from './domain.js';
import { editPlaythrough } from './history.js';

const ACTIVE = ['playing', 'paused', 'not-started'];
const activePlay = (state, targetId) => Object.values(state.playthroughs).find(play => play.targetId === targetId && ACTIVE.includes(play.status));

// Take a game off Up Next and the backlog. Planned-but-unstarted replays go too;
// real playthroughs and history are never deleted. Triage may ask about it again.
export function removeFromPlan(current, targetId, { at, eventId }) {
  let state = current;
  if (state.backlog[targetId]) state = applyCommand(state, { type: 'unqueue', targetId, at, eventId });
  else state = clone(state);
  for (const play of Object.values(state.playthroughs)) if (play.targetId === targetId && play.id.startsWith('planned:') && play.status === 'not-started') delete state.playthroughs[play.id];
  for (const note of Object.values(state.annotations)) if (note.targetId === targetId && note.triage?.decision === 'soon') delete note.triage;
  return state;
}

// Finish or retire. A game you are playing gets today's date; a game you finished some
// time ago ("I already played it") is recorded with unknown dates, so it earns no
// dated-finish rewards and keeps history honest.
export function markPlayed(current, descriptor, status, { at, eventIds, playthroughId }) {
  if (!['finished', 'retired'].includes(status)) throw new Error('Choose finished or retired.');
  let state = clone(current);
  const target = ensureTarget(state, descriptor), active = activePlay(state, target.id);
  if (active && ['playing', 'paused'].includes(active.status)) {
    return { state: applyCommand(state, { type: 'status', targetId: target.id, playthroughId: active.id, status, at, eventId: eventIds[0] }), playthroughId: active.id, dated: true };
  }
  let id = active?.id;
  if (!id) { id = playthroughId; state = applyCommand(state, { type: 'start', targetId: target.id, playthroughId: id, playedSource: descriptor.ref, playedPlatforms: descriptor.platforms ?? [], at, eventId: eventIds[0] }); }
  state = applyCommand(state, { type: 'status', targetId: target.id, playthroughId: id, status, at, eventId: eventIds[1] });
  state = editPlaythrough(state, id, { expected: state.playthroughs[id], fields: { startedAt: null, finishedAt: null, endedAt: null }, at, eventId: eventIds[2] });
  return { state, playthroughId: id, dated: false, created: !active };
}

// Undo for quick actions and triage: what these games' plan records looked like before.
export function planPoint(state, targetIds) {
  const ids = [].concat(targetIds);
  return { targets: Object.fromEntries(ids.map(id => [id, {
      backlog: clone(state.backlog[id] ?? null),
      plays: clone(Object.values(state.playthroughs).filter(play => play.targetId === id)),
      triage: Object.fromEntries(Object.values(state.annotations).filter(note => note.targetId === id).map(note => [note.id, clone(note.triage ?? null)])),
    }])), events: Object.keys(state.events) };
}

// Restores the records and keeps history: events are never deleted. Each reversed event
// gets an "undo" event (so rewards earned from it are withdrawn through the ledger), and
// events whose playthrough no longer exists keep its id separately.
export function restorePlanPoint(current, point, { at, eventId }) {
  const state = clone(current), known = new Set(point.events), ids = Object.keys(point.targets);
  for (const [id, before] of Object.entries(point.targets)) {
    if (before.backlog) state.backlog[id] = before.backlog; else delete state.backlog[id];
    for (const play of Object.values(state.playthroughs)) if (play.targetId === id) delete state.playthroughs[play.id];
    for (const play of before.plays) state.playthroughs[play.id] = play;
    for (const note of Object.values(state.annotations)) if (note.targetId === id) {
      const triage = before.triage[note.id] ?? null;
      if (triage) note.triage = triage; else delete note.triage;
    }
  }
  const reversed = Object.values(state.events).filter(event => !known.has(event.id) && ids.includes(event.targetId) && event.type !== 'undo')
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  for (const event of reversed) if (event.details.playthroughId && !state.playthroughs[event.details.playthroughId]) {
    const { playthroughId, ...details } = event.details;
    event.details = { ...details, discardedPlaythroughId: playthroughId };
  }
  reversed.forEach((event, index) => recordEvent(state, { type: 'undo', targetId: event.targetId, at, eventId: `${eventId}:${index}` }, { undoneEventId: event.id, reversal: 'restore' }));
  return state;
}

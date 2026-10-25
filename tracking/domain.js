// Browser/Node domain logic. Imports, persistence and UI do not assign progress.
export const SCHEMA_VERSION = 8;
export const NAMESPACES = ['personal', 'sample'];
export const PLAY_STATUSES = ['not-started', 'playing', 'paused', 'finished', 'retired'];
export const DECISIONS = ['interested', 'want-soon', 'wait-for-price', 'maybe', 'archived', 'acquired'];
export const SECTIONS = ['targets', 'ownership', 'wishlist', 'backlog', 'playthroughs', 'events', 'annotations', 'migrations', 'reviewSessions', 'journalEntries', 'progression', 'rewardEvidence', 'rewardLedger', 'rewardAdjustments', 'rewardLinks', 'weeklyGoals', 'challenges', 'challengeRevisions', 'challengeEvidence', 'challengeAwards', 'matchReviews', 'productReviews', 'listAwards'];
export const clone = value => structuredClone(value);
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const stableJSON = value => JSON.stringify(value, (_, item) => record(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export function safeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 600 && !['__proto__', 'constructor', 'prototype'].includes(value);
}
export function requireId(value) {
  if (!safeId(value)) throw new Error('Invalid record identifier.');
  return value;
}
export function instant(value, optional = false) {
  if (optional && value === null) return value;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Use a valid UTC timestamp or null for an unknown date.');
  return value;
}
export function text(value, max = 10000) {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid or oversized text field.');
  return value;
}
export function calendarDate(value, optional = false) {
  if (optional && value === null) return value;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new Error('Choose a valid calendar date.');
  return value;
}
// Backlog triage decision stored on an annotation: play soon, maybe (until a date),
// already played, or pass.
export const TRIAGE_DECISIONS = ['soon', 'maybe', 'played', 'pass'];
export function validateTriage(value) {
  if (!record(value) || !TRIAGE_DECISIONS.includes(value.decision)) throw new Error('Invalid triage decision.');
  instant(value.at); calendarDate(value.until, true);
  return { decision: value.decision, at: value.at, until: value.until };
}
export function emptyState(namespace = 'personal') {
  if (!NAMESPACES.includes(namespace)) throw new Error('Unknown tracking namespace.');
  return { schemaVersion: SCHEMA_VERSION, namespace, revision: 0,
    ...Object.fromEntries(SECTIONS.map(section => [section, {}])),
    settings: { pinnedSystems: [], gamificationVisible: true } };
}

export function referenceKey(ref) {
  if (!record(ref) || !['catalog', 'playnite', 'steam', 'legacy-owned', 'manual'].includes(ref.provider)) throw new Error('Unknown source reference.');
  requireId(ref.id);
  return `${ref.provider}:${encodeURIComponent(ref.id)}`;
}
export function findTarget(state, ref) {
  const key = referenceKey(ref);
  return Object.values(state.targets).find(target => target.refs.some(item => referenceKey(item) === key));
}
export function ensureTarget(state, { ref, title, platforms = [], unresolved = false }) {
  const found = findTarget(state, ref);
  if (found) return found;
  const id = `target:${referenceKey(ref)}`;
  requireId(id); text(title, 500);
  if (!Array.isArray(platforms) || platforms.length > 100) throw new Error('Invalid platform list.');
  platforms.forEach(platform => text(platform, 200));
  return state.targets[id] = { id, title, platforms: [...new Set(platforms)], refs: [clone(ref)], unresolved: Boolean(unresolved) };
}

function targetExists(state, id) {
  requireId(id);
  if (!Object.hasOwn(state.targets, id)) throw new Error('Tracking target is missing.');
}
export function latestEvent(state, targetId) {
  return Object.values(state.events).filter(item => item.targetId === targetId).sort((a, b) =>
    (b.sequence ?? 0) - (a.sequence ?? 0) || b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id))[0];
}
export function recordEvent(state, command, details) {
  requireId(command.eventId); instant(command.at);
  if (Object.hasOwn(state.events, command.eventId)) throw new Error('This event identifier is already in use.');
  state.events[command.eventId] = { id: command.eventId, targetId: command.targetId, type: command.type,
    occurredAt: command.at, recordedAt: command.at,
    sequence: Object.values(state.events).reduce((max, item) => Math.max(max, item.sequence ?? 0), 0) + 1, details };
}

// The caller supplies IDs/timestamps so retries, tests and imports are deterministic.
export function applyCommand(current, command) {
  if (!record(command)) throw new Error('Invalid tracking command.');
  targetExists(current, command.targetId);
  const state = clone(current);
  switch (command.type) {
    case 'queue': {
      const priority = command.priority ?? 0;
      if (!Number.isInteger(priority) || priority < 0 || priority > 3) throw new Error('Priority must be between 0 and 3.');
      const previous = state.backlog[command.targetId] ?? null;
      state.backlog[command.targetId] = { ...previous, targetId: command.targetId, priority, queuedAt: previous ? previous.queuedAt : command.at };
      recordEvent(state, command, { previous, result: clone(state.backlog[command.targetId]) });
      break;
    }
    case 'unqueue': {
      const previous = state.backlog[command.targetId] ?? null;
      delete state.backlog[command.targetId];
      recordEvent(state, command, { previous, result: null });
      break;
    }
    case 'wishlist': {
      if (!DECISIONS.includes(command.decision)) throw new Error('Invalid wishlist decision.');
      const previous = state.wishlist[command.targetId] ?? null;
      state.wishlist[command.targetId] = { ...previous, ...wishlistFields(command.fields ?? {}), targetId: command.targetId, decision: command.decision, decidedAt: command.at };
      delete state.wishlist[command.targetId].legacyRemovedAt;
      recordEvent(state, command, { previous, result: clone(state.wishlist[command.targetId]), ...(command.reviewSessionId ? { reviewSessionId: command.reviewSessionId } : {}) });
      break;
    }
    case 'start': {
      const active = Object.values(state.playthroughs).find(play => play.targetId === command.targetId && ['not-started', 'playing', 'paused'].includes(play.status));
      if (active) throw new Error('Resume or finish the existing playthrough before starting a replay.');
      requireId(command.playthroughId);
      if (Object.hasOwn(state.playthroughs, command.playthroughId)) throw new Error('Playthrough identifier is already in use.');
      const objective = command.objective ?? 'unspecified';
      if (!['unspecified', 'main-game', 'personal'].includes(objective)) throw new Error('Invalid play objective.');
      state.playthroughs[command.playthroughId] = { id: command.playthroughId, targetId: command.targetId,
        status: 'playing', objective, objectiveText: text(command.objectiveText ?? '', 1000),
        startedAt: command.at, finishedAt: null, historical: false, ordinal: nextPlayOrdinal(state, command.targetId),
        ...(command.playedSource ? { playedSource: clone(command.playedSource), playedPlatforms: clone(command.playedPlatforms ?? []) } : {}) };
      recordEvent(state, command, { playthroughId: command.playthroughId });
      break;
    }
    case 'status': {
      const play = state.playthroughs[requireId(command.playthroughId)];
      if (!play || play.targetId !== command.targetId) throw new Error('Playthrough does not belong to this target.');
      if (!PLAY_STATUSES.includes(command.status)) throw new Error('Invalid play status.');
      if (['finished', 'retired'].includes(play.status)) throw new Error('Start a replay to preserve this finished or retired playthrough.');
      if (!['playing', 'paused', 'finished', 'retired'].includes(command.status)) throw new Error('Invalid status transition.');
      const previous = clone(play);
      if (play.status === 'not-started' && command.status === 'playing') {
        if (!play.historical) play.startedAt = command.at;
        if (command.objective !== undefined) {
          if (!['unspecified', 'main-game', 'personal'].includes(command.objective)) throw new Error('Invalid play objective.');
          play.objective = command.objective; play.objectiveText = text(command.objectiveText ?? '', 1000);
        }
      }
      play.status = command.status;
      play.finishedAt = command.status === 'finished' ? command.at : null;
      play.endedAt = command.status === 'retired' ? command.at : null;
      recordEvent(state, command, { playthroughId: play.id, previous, result: clone(play) });
      break;
    }
    case 'undo': {
      const latest = latestEvent(state, command.targetId);
      if (!latest || latest.id !== command.undoEventId || !['queue', 'unqueue', 'wishlist', 'status', 'play-edit'].includes(latest.type)) throw new Error('Only the latest reversible progress change can be undone.');
      if (['status', 'play-edit'].includes(latest.type)) {
        const play = state.playthroughs[latest.details.playthroughId];
        if (!latest.details.result || stableJSON(play) !== stableJSON(latest.details.result)) throw new Error('This playthrough has changed since that event. Review its current history.');
        state.playthroughs[latest.details.playthroughId] = clone(latest.details.previous);
      }
      else {
        const section = latest.type === 'wishlist' ? 'wishlist' : 'backlog';
        if (latest.type === 'wishlist' && latest.details.result && stableJSON(state.wishlist[command.targetId]) !== stableJSON(latest.details.result)) throw new Error('This wishlist decision has changed. Review the current value before undoing.');
        if (latest.details.reviewSessionId) {
          const session = state.reviewSessions[latest.details.reviewSessionId];
          if (!session || session.reviewed[command.targetId] !== latest.id) throw new Error('This review session has changed.');
          delete session.reviewed[command.targetId]; session.completedAt = null;
        }
        if (latest.details.previous) state[section][command.targetId] = clone(latest.details.previous);
        else delete state[section][command.targetId];
      }
      recordEvent(state, command, { undoneEventId: latest.id });
      break;
    }
    default: throw new Error('Unknown tracking command.');
  }
  return state;
}

export function nextPlayOrdinal(state, targetId) {
  const plays = Object.values(state.playthroughs).filter(play => play.targetId === targetId);
  return Math.max(plays.length, ...plays.map(play => play.ordinal ?? 0), 0) + 1;
}

export const PRICE_CURRENCIES = { GBP: 2, USD: 2, EUR: 2, CAD: 2, AUD: 2, JPY: 0 };
export function wishlistFields(fields) {
  if (!record(fields)) throw new Error('Invalid wishlist fields.');
  const clean = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'priority') {
      if (!Number.isInteger(value) || value < 0 || value > 3) throw new Error('Priority must be between 0 and 3.');
    } else if (key === 'reason') text(value, 2000);
    else if (['reviewOn', 'snoozeUntil'].includes(key)) calendarDate(value, true);
    else if (['reviewedAt', 'acquiredAt'].includes(key)) instant(value, true);
    else if (key === 'targetPrice') {
      if (value !== null && (!record(value) || !Object.hasOwn(PRICE_CURRENCIES, value.currency) || !Number.isSafeInteger(value.amountMinor) || value.amountMinor < 0 || value.amountMinor > 1_000_000_000)) throw new Error('Choose a valid target amount and supported currency.');
    } else throw new Error('Unknown wishlist field.');
    clean[key] = clone(value);
  }
  return clean;
}

// Explicit user confirmation is required. A shared title is never enough.
export function linkReference(current, { targetId, ref, confirmed }) {
  if (confirmed !== true) throw new Error('Confirm the edition and platform before linking tracking.');
  targetExists(current, targetId);
  const other = findTarget(current, ref);
  if (other && other.id !== targetId) throw new Error('This reference already has its own target. Preserve both histories until they can be reviewed.');
  const state = clone(current);
  if (!other) state.targets[targetId].refs.push(clone(ref));
  return state;
}

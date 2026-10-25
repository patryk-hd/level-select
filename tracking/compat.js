import { clone, ensureTarget, referenceKey, applyCommand, recordEvent, requireId, text, nextPlayOrdinal, validateTriage } from './domain.js';

export function playHistory(state, targetId) {
  const plays = Object.values(state.playthroughs).filter(play => play.targetId === targetId);
  const starts = new Map();
  if (plays.length > 1 && plays.some(play => !play.ordinal)) {
    for (const event of Object.values(state.events)) if (event.targetId === targetId) {
      if (event.type === 'start') starts.set(event.details.playthroughId, event);
      if (event.type === 'upnext' && state.playthroughs[`planned:${event.id}`]) starts.set(`planned:${event.id}`, event);
    }
  }
  return plays.sort((a, b) =>
    Number(['playing', 'paused', 'not-started'].includes(b.status)) - Number(['playing', 'paused', 'not-started'].includes(a.status)) ||
    (b.ordinal ?? 0) - (a.ordinal ?? 0) ||
    (starts.get(b.id)?.sequence ?? 0) - (starts.get(a.id)?.sequence ?? 0) ||
    (starts.get(b.id)?.recordedAt ?? '').localeCompare(starts.get(a.id)?.recordedAt ?? '') ||
    (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || b.id.localeCompare(a.id));
}
export function progress(state, targetId) {
  const play = playHistory(state, targetId)[0];
  return play?.status ?? (state.backlog[targetId] ? 'backlog' : 'untracked');
}
export function collectionView(state) {
  const entries = {};
  for (const target of Object.values(state.targets)) for (const ref of target.refs.filter(ref => ref.provider === 'catalog')) {
    const annotation = state.annotations[`catalog:${ref.id}`] ?? {};
    const status = progress(state, target.id);
    const entry = { favorite: annotation.favorite === true,
      owned: Object.values(state.ownership).some(item => item.targetId === target.id && item.evidence === 'manual'),
      wishlist: Boolean(state.wishlist[target.id] && !['archived', 'acquired'].includes(state.wishlist[target.id].decision)),
      status: ({ finished: 'completed', retired: 'dropped', 'not-started': 'backlog' })[status] ?? status };
    if (entry.favorite || entry.owned || entry.wishlist || entry.status !== 'untracked') entries[ref.id] = entry;
  }
  return { schemaVersion: 1, entries, pinnedSystems: [...state.settings.pinnedSystems] };
}
export function editsView(state) {
  const overrides = {}, removed = {}, notes = {};
  for (const annotation of Object.values(state.annotations)) {
    if (annotation.source.provider === 'legacy-owned') {
      const edit = {};
      for (const key of ['favorite', 'hidden', 'notes']) if (key in annotation) edit[key] = annotation[key];
      overrides[annotation.source.id] = edit;
    }
    if (annotation.source.provider === 'steam' && 'notes' in annotation) notes[annotation.source.id] = annotation.notes;
  }
  for (const target of Object.values(state.targets)) for (const ref of target.refs.filter(ref => ref.provider === 'steam')) {
    const decision = state.wishlist[target.id];
    if (decision?.decision === 'archived') removed[ref.id] = { title: target.title, removedAt: decision.legacyRemovedAt ?? decision.decidedAt ?? '' };
  }
  return { overrides, removed, notes };
}
export function patchAnnotation(current, descriptor, patch, expected = {}) {
  const state = clone(current), target = ensureTarget(state, descriptor);
  const prefix = descriptor.ref.provider === 'legacy-owned' ? 'owned' : descriptor.ref.provider;
  const id = `${prefix}:${descriptor.ref.id}`;
  const entry = { id, targetId: target.id, source: clone(descriptor.ref), ...state.annotations[id] };
  if ('notes' in expected && (entry.notes ?? '') !== expected.notes) throw new Error('These notes changed in another tab. Your draft is still in this field; copy it before reopening the game to review the saved notes.');
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'notes') entry.notes = text(value);
    else if (['favorite', 'hidden'].includes(key) && typeof value === 'boolean') entry[key] = value;
    else if (key === 'triage') { if (value === null) delete entry.triage; else entry.triage = validateTriage(value); }
    // Your answer to "Did you enjoy it?", used to judge similar wishlist games.
    else if (key === 'enjoyed') { if (value === null) delete entry.enjoyed; else if (['yes', 'no', 'unplayed'].includes(value)) entry.enjoyed = value; else throw new Error('Invalid annotation change.'); }
    else throw new Error('Invalid annotation change.');
  }
  state.annotations[id] = entry;
  return state;
}
export function patchCatalog(current, descriptor, patch, { at, eventId }) {
  let state = clone(current); const target = ensureTarget(state, descriptor);
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== 'boolean') throw new Error('Invalid tracking flag.');
    if (key === 'favorite') state = patchAnnotation(state, descriptor, { favorite: value });
    else if (key === 'owned') {
      const id = `manual:${descriptor.ref.id}`;
      if (value) state.ownership[id] = { id, targetId: target.id, evidence: 'manual', source: clone(descriptor.ref), acquiredAt: null };
      else delete state.ownership[id];
    } else if (key === 'wishlist') state = applyCommand(state, { type: 'wishlist', targetId: target.id, decision: value ? 'interested' : 'archived', at, eventId });
    else throw new Error('Use playthrough actions to change progress.');
  }
  return state;
}

function hasProgress(state, id) {
  if (Object.values(state.challengeRevisions).some(revision => revision.cells.some(cell => cell.member.targetId === id))) return true;
  return Boolean(state.backlog[id] || state.wishlist[id] || Object.values(state.playthroughs).some(play => play.targetId === id) || Object.values(state.events).some(event => event.targetId === id) || Object.values(state.reviewSessions).some(session => session.targetIds.includes(id)) ||
    state.progression.profile?.baselineFinishedTargets.includes(id) || Object.values(state.rewardLinks).some(link => link.targetIds.includes(id)) || Object.values(state.weeklyGoals).some(goal => goal.targetId === id) || Object.values(state.progression).some(entry => entry.previous?.targetId === id || entry.result?.targetId === id));
}
// Only one side may have progress. Never collapse two independent histories.
export function confirmIdentity(current, first, second, { at } = {}) {
  const state = clone(current), a = ensureTarget(state, first), b = ensureTarget(state, second);
  if (a.id === b.id) return state;
  if (hasProgress(state, a.id) && hasProgress(state, b.id)) throw new Error('Both releases have tracking history. Keep them separate until their histories can be reviewed.');
  const [keep, drop] = hasProgress(state, b.id) ? [b, a] : [a, b];
  keep.refs.push(...drop.refs.filter(ref => !keep.refs.some(existing => referenceKey(existing) === referenceKey(ref))).map(ref => ({ ...ref, matchMethod: 'user-confirmed', ...(at ? { confirmedAt: at } : {}) })));
  for (const section of ['ownership', 'annotations']) for (const entry of Object.values(state[section])) if (entry.targetId === drop.id) entry.targetId = keep.id;
  delete state.targets[drop.id];
  return state;
}

export function setUpNext(current, descriptor, enabled, { at, eventId }) {
  let state = clone(current); const target = ensureTarget(state, descriptor);
  const previous = clone(state.backlog[target.id] ?? null);
  if (!state.backlog[target.id]) state.backlog[target.id] = { targetId: target.id, priority: 0, queuedAt: at };
  state.backlog[target.id].upNext = enabled;
  if (enabled && ['finished', 'retired'].includes(progress(state, target.id))) {
    const id = `planned:${eventId}`;
    state.playthroughs[id] = { id, targetId: target.id, status: 'not-started', objective: 'unspecified', objectiveText: '', startedAt: null, finishedAt: null, historical: false,
      ordinal: nextPlayOrdinal(state, target.id), playedSource: clone(descriptor.ref), playedPlatforms: clone(descriptor.platforms) };
  }
  if (enabled && state.backlog[target.id].position == null) state.backlog[target.id].position = Object.values(state.backlog).filter(item => item.upNext).length;
  recordEvent(state, { type: 'upnext', targetId: target.id, at, eventId }, { enabled, previous, result: clone(state.backlog[target.id]) });
  return state;
}
export function orderedQueue(state) {
  return Object.values(state.backlog).filter(item => item.upNext && !['playing', 'paused', 'finished', 'retired'].includes(progress(state, item.targetId)))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.targetId.localeCompare(b.targetId));
}
export function moveInQueue(current, targetId, direction) {
  requireId(targetId);
  if (![-1, 1].includes(direction)) throw new Error('Invalid queue move.');
  const state = clone(current), queue = orderedQueue(state), index = queue.findIndex(item => item.targetId === targetId), next = index + direction;
  if (index >= 0 && next >= 0 && next < queue.length) [queue[index], queue[next]] = [queue[next], queue[index]];
  queue.forEach((item, position) => { state.backlog[item.targetId].position = position; });
  return state;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, ensureTarget, findTarget, applyCommand, latestEvent } from '../tracking/domain.js';
import { collectionView, editsView, patchAnnotation, confirmIdentity, setUpNext, moveInQueue, orderedQueue } from '../tracking/compat.js';
import { validateState, createBackup, parseBackup } from '../tracking/backup.js';
import { ingestOwned } from '../tracking/legacy.js';

const at = '2026-09-14T18:00:00.000Z';
const catalog = { ref: { provider: 'catalog', id: 'fixture-snes' }, title: 'Fixture Quest', platforms: ['snes'] };
const copy = { ref: { provider: 'playnite', id: 'copy-a' }, title: 'Fixture Quest', platforms: ['SNES'] };
const group = { ref: { provider: 'legacy-owned', id: 'fixture-group' }, title: 'Fixture Quest', platforms: ['SNES', 'PS1'] };
function play(state, descriptor, id) {
  const target = ensureTarget(state, descriptor);
  return applyCommand(state, { type: 'start', targetId: target.id, playthroughId: id, eventId: `start-${id}`, at });
}

test('confirmed copy links share history while keeping other platforms and grouped notes separate', () => {
  let state = play(emptyState(), catalog, 'original');
  const targetId = findTarget(state, catalog.ref).id;
  state = applyCommand(state, { type: 'status', targetId, playthroughId: 'original', status: 'paused', eventId: 'pause', at });
  state = patchAnnotation(state, catalog, { favorite: true });
  state = patchAnnotation(state, group, { notes: 'Notes about both copies', hidden: true });
  state = ingestOwned(state, [{ id: 'fixture-group', name: 'Fixture Quest', copies: [
    { id: 'copy-a', platforms: ['SNES'], sources: ['Manual'] },
    { id: 'copy-b', platforms: ['PS1'], sources: ['Manual'] },
  ] }]);
  const before = structuredClone(state);
  state = confirmIdentity(state, copy, catalog, { at });
  assert.equal(findTarget(state, copy.ref).id, targetId);
  assert.equal(state.ownership['playnite:copy-a'].targetId, targetId);
  assert.notEqual(state.ownership['playnite:copy-b'].targetId, targetId);
  assert.notEqual(state.annotations['owned:fixture-group'].targetId, targetId);
  assert.equal(editsView(state).overrides['fixture-group'].notes, 'Notes about both copies');
  assert.equal(collectionView(state).entries['fixture-snes'].status, 'paused');
  assert.equal(collectionView(state).entries['fixture-snes'].favorite, true);
  assert.equal(state.targets[targetId].refs.find(ref => ref.provider === 'playnite').confirmedAt, at);
  assert.deepEqual(before.playthroughs, state.playthroughs); validateState(state);
});

test('identity confirmation refuses to collapse two independently tracked releases', () => {
  const state = play(play(emptyState(), catalog, 'first'), copy, 'second');
  const original = structuredClone(state);
  assert.throws(() => confirmIdentity(state, copy, catalog, { at }), /Both releases/);
  assert.deepEqual(state, original);
});

test('a note draft cannot overwrite a newer note received from another tab', () => {
  const state = patchAnnotation(emptyState(), group, { notes: 'Newer saved note' });
  const original = structuredClone(state);
  assert.throws(() => patchAnnotation(state, group, { notes: 'Stale draft' }, { notes: 'Old note' }), /changed in another tab/);
  assert.deepEqual(state, original);
  const updated = patchAnnotation(state, group, { notes: 'Reviewed update' }, { notes: 'Newer saved note' });
  assert.equal(editsView(updated).overrides['fixture-group'].notes, 'Reviewed update');
});

test('Up Next ordering and priority preserve a finished playthrough and declare a fresh replay objective', () => {
  let state = play(emptyState(), catalog, 'first');
  const targetId = findTarget(state, catalog.ref).id;
  state = applyCommand(state, { type: 'status', targetId, playthroughId: 'first', status: 'finished', eventId: 'finish', at });
  const finished = structuredClone(state.playthroughs.first);
  state = setUpNext(state, catalog, true, { at, eventId: 'next-a' });
  state = setUpNext(state, copy, true, { at, eventId: 'next-b' });
  state = moveInQueue(state, targetId, 1);
  assert.equal(orderedQueue(state)[1].targetId, targetId);
  state = applyCommand(state, { type: 'queue', targetId, priority: 3, eventId: 'priority', at });
  assert.equal(state.backlog[targetId].upNext, true);
  assert.equal(orderedQueue(state)[1].targetId, targetId);
  state = applyCommand(state, { type: 'status', targetId, playthroughId: 'planned:next-a', status: 'playing', objective: 'personal', objectiveText: 'Reach the third island', eventId: 'replay-start', at });
  assert.equal(state.playthroughs['planned:next-a'].startedAt, at);
  assert.equal(state.playthroughs['planned:next-a'].objectiveText, 'Reach the third island');
  assert.deepEqual(state.playthroughs.first, finished);
  assert.equal(orderedQueue(state).length, 1);
  assert.deepEqual(parseBackup(JSON.stringify(createBackup(state, at)), 'personal'), state);
});

test('undo restores progress after JSON key reordering and refuses a correction changed by a merge', () => {
  let state = play(emptyState(), catalog, 'first');
  const targetId = findTarget(state, catalog.ref).id;
  state = applyCommand(state, { type: 'status', targetId, playthroughId: 'first', status: 'finished', eventId: 'finish', at });
  state.events = Object.fromEntries(Object.entries(state.events).reverse());
  assert.equal(latestEvent(state, targetId).id, 'finish');
  const changed = structuredClone(state); changed.playthroughs.first.objectiveText = 'Merged correction';
  assert.throws(() => applyCommand(changed, { type: 'undo', targetId, undoEventId: 'finish', eventId: 'undo', at }), /changed since/);
  state = applyCommand(state, { type: 'undo', targetId, undoEventId: 'finish', eventId: 'undo', at });
  assert.equal(state.playthroughs.first.status, 'playing');
  assert.equal(state.playthroughs.first.finishedAt, null);
  assert.equal(Object.keys(state.events).length, 3);
  assert.throws(() => applyCommand(state, { type: 'undo', targetId, undoEventId: 'finish', eventId: 'twice', at }), /latest reversible/);
  validateState(state);
});

test('Up Next selection prevents undoing an older queue action; manual planning never grants ownership', () => {
  const manual = { ref: { provider: 'manual', id: 'manual-fixture' }, title: 'Offline Fixture', platforms: [] };
  let state = emptyState(); const targetId = ensureTarget(state, manual).id;
  state = applyCommand(state, { type: 'queue', targetId, eventId: 'queue', at });
  state = setUpNext(state, manual, true, { at, eventId: 'next' });
  assert.throws(() => applyCommand(state, { type: 'undo', targetId, undoEventId: 'queue', eventId: 'undo', at }), /latest reversible/);
  assert.equal(Object.keys(state.ownership).length, 0);
  assert.equal(Object.keys(state.playthroughs).length, 0);
  validateState(state);
});

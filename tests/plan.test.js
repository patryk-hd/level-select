import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyCommand } from '../tracking/domain.js';
import { setUpNext, progress, orderedQueue, patchAnnotation } from '../tracking/compat.js';
import { removeFromPlan, markPlayed } from '../tracking/plan.js';
import { parseBackup, createBackup } from '../tracking/backup.js';

const at = '2026-09-29T10:00:00.000Z';
const desc = (id, title = id) => ({ ref: { provider: 'playnite', id }, title, platforms: ['PC (Windows)'] });
const ids = prefix => [`${prefix}-1`, `${prefix}-2`, `${prefix}-3`];

test('removing a game added by mistake clears Up Next, backlog and a "play soon" triage', () => {
  let state = setUpNext(emptyState(), desc('a', 'Alpha'), true, { at, eventId: 'up' });
  state = patchAnnotation(state, desc('a', 'Alpha'), { triage: { decision: 'soon', at, until: null } });
  const target = 'target:playnite:a';
  assert.equal(orderedQueue(state).length, 1);
  state = removeFromPlan(state, target, { at, eventId: 'rm' });
  assert.equal(orderedQueue(state).length, 0);
  assert.equal(state.backlog[target], undefined);
  assert.equal(progress(state, target), 'untracked');
  assert.ok(!Object.values(state.annotations).some(note => note.triage));
  assert.doesNotThrow(() => parseBackup(JSON.stringify(createBackup(state, at)), 'personal'));
});

test('an unplayed game marked finished gets an undated finish; a game in progress gets today', () => {
  const past = markPlayed(emptyState(), desc('a', 'Alpha'), 'finished', { at, eventIds: ids('a'), playthroughId: 'p-a' });
  assert.equal(past.dated, false);
  assert.equal(progress(past.state, 'target:playnite:a'), 'finished');
  assert.deepEqual([past.state.playthroughs['p-a'].startedAt, past.state.playthroughs['p-a'].finishedAt], [null, null]);
  assert.doesNotThrow(() => parseBackup(JSON.stringify(createBackup(past.state, at)), 'personal'));

  let state = applyCommand({ ...emptyState(), targets: { 'target:playnite:b': { id: 'target:playnite:b', title: 'Beta', platforms: [], refs: [{ provider: 'playnite', id: 'b' }], unresolved: false } } },
    { type: 'start', targetId: 'target:playnite:b', playthroughId: 'p-b', at: '2026-09-20T10:00:00.000Z', eventId: 'start-b' });
  const current = markPlayed(state, desc('b', 'Beta'), 'finished', { at, eventIds: ids('b'), playthroughId: 'unused' });
  assert.equal(current.dated, true);
  assert.equal(current.state.playthroughs['p-b'].finishedAt, at);

  const retired = markPlayed(emptyState(), desc('c', 'Gamma'), 'retired', { at, eventIds: ids('c'), playthroughId: 'p-c' }).state;
  assert.equal(progress(retired, 'target:playnite:c'), 'retired');
  assert.throws(() => markPlayed(emptyState(), desc('d'), 'deleted', { at, eventIds: ids('d'), playthroughId: 'p-d' }));
});

test('undo of a quick action restores the game, keeps its history and keeps backups valid', async () => {
  const { planPoint, restorePlanPoint } = await import('../tracking/plan.js');
  let state = setUpNext(emptyState(), desc('a', 'Alpha'), true, { at, eventId: 'up' });
  const target = 'target:playnite:a', before = structuredClone(state);
  let point = planPoint(state, [target]);
  const finished = markPlayed(state, desc('a', 'Alpha'), 'finished', { at, eventIds: ids('f'), playthroughId: 'p-f' }).state;
  assert.equal(progress(finished, target), 'finished');
  const unfinished = restorePlanPoint(finished, point, { at, eventId: 'undo-f' });
  assert.deepEqual([unfinished.backlog, unfinished.playthroughs], [before.backlog, before.playthroughs]);
  assert.equal(progress(unfinished, target), 'backlog');
  // History is kept: the finish events remain and are marked as undone.
  assert.ok(ids('f').every(id => unfinished.events[id]));
  assert.equal(Object.values(unfinished.events).filter(event => event.type === 'undo').length, 3);
  assert.doesNotThrow(() => parseBackup(JSON.stringify(createBackup(unfinished, at)), 'personal'));
  point = planPoint(state, [target]);
  const restored = restorePlanPoint(removeFromPlan(state, target, { at, eventId: 'rm' }), point, { at, eventId: 'undo-rm' });
  assert.deepEqual(orderedQueue(restored).map(item => item.targetId), [target]);
  assert.doesNotThrow(() => parseBackup(JSON.stringify(createBackup(restored, at)), 'personal'));
});

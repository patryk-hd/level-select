import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, ensureTarget, applyCommand } from '../tracking/domain.js';
import { writeJournal } from '../tracking/history.js';
import { continueList } from '../tracking/home.js';

const library = [
  { id: 'g1', name: 'Hollow Knight', cover: 'assets/hk.jpg', copies: [{ id: 'hk', platforms: ['PC (Windows)'] }] },
  { id: 'g2', name: 'Celeste', cover: 'assets/celeste.jpg', copies: [{ id: 'cel', platforms: ['PC (Windows)'] }] },
  { id: 'g3', name: 'Portal', cover: null, copies: [{ id: 'portal', platforms: ['PC (Windows)'] }] },
];
function start(state, copy, title, at, id) {
  const target = ensureTarget(state, { ref: { provider: 'playnite', id: copy }, title, platforms: ['PC (Windows)'] });
  return applyCommand(state, { type: 'start', targetId: target.id, playthroughId: id, at, eventId: `${id}-start` });
}

test('continue lists playing before paused games, newest first, with the latest note and cover', () => {
  let state = emptyState();
  state = start(state, 'hk', 'Hollow Knight', '2026-09-01T10:00:00.000Z', 'p-hk');
  state = start(state, 'cel', 'Celeste', '2026-09-10T10:00:00.000Z', 'p-cel');
  state = start(state, 'portal', 'Portal', '2026-09-20T10:00:00.000Z', 'p-portal');
  state = applyCommand(state, { type: 'status', targetId: 'target:playnite:portal', playthroughId: 'p-portal', status: 'paused', at: '2026-09-21T10:00:00.000Z', eventId: 'pause' });
  state = writeJournal(state, 'p-hk', { entryId: 'n1', expected: null, kind: 'note', text: 'Reached Crystal Peak', occurredOn: '2026-09-02', at: '2026-09-02T10:00:00.000Z', eventId: 'j1' });
  state = writeJournal(state, 'p-hk', { entryId: 'n2', expected: null, kind: 'note', text: 'Beat Soul Master', occurredOn: '2026-09-25', at: '2026-09-25T10:00:00.000Z', eventId: 'j2' });
  const list = continueList(state, { library });
  assert.deepEqual(list.map(item => [item.title, item.status]), [['Hollow Knight', 'playing'], ['Celeste', 'playing'], ['Portal', 'paused']]);
  assert.equal(list[0].lastNote.text, 'Beat Soul Master');
  assert.equal(list[0].cover, 'assets/hk.jpg');
  assert.equal(list[1].lastNote, null);
});

test('finished games leave the continue list', () => {
  let state = start(emptyState(), 'hk', 'Hollow Knight', '2026-09-01T10:00:00.000Z', 'p-hk');
  state = applyCommand(state, { type: 'status', targetId: 'target:playnite:hk', playthroughId: 'p-hk', status: 'finished', at: '2026-09-05T10:00:00.000Z', eventId: 'done' });
  assert.deepEqual(continueList(state, { library }), []);
});

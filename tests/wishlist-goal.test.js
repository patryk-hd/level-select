import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../tracking/domain.js';
import { parseBackup, createBackup } from '../tracking/backup.js';

const at = '2026-09-29T10:00:00.000Z';
const settingsOf = backup => (backup.state ?? backup).settings;

test('a wishlist goal survives a backup round trip; invalid goals are rejected', () => {
  const state = emptyState();
  state.settings.wishlistGoal = 600; state.settings.wishlistGoalFrom = 921;
  const restored = parseBackup(JSON.stringify(createBackup(state, at)), 'personal');
  assert.deepEqual([settingsOf(restored).wishlistGoal, settingsOf(restored).wishlistGoalFrom], [600, 921]);
  for (const bad of [-1, 1.5, '600', 200000]) {
    // Rejected when writing a backup, and when reading a hand-edited one.
    assert.throws(() => createBackup({ ...state, settings: { ...state.settings, wishlistGoal: bad } }, at), /wishlist goal/, `write ${bad}`);
    const edited = JSON.parse(JSON.stringify(createBackup(state, at)).replace('"wishlistGoal":600', `"wishlistGoal":${JSON.stringify(bad)}`));
    assert.throws(() => parseBackup(JSON.stringify(edited), 'personal'), /wishlist goal/, `read ${bad}`);
  }
});

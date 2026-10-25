import test from 'node:test';
import assert from 'node:assert/strict';
import { overallProgress, describeStatus } from '../library/update-progress.js';

const steps = [{ id: 'a', label: 'One', state: 'done' }, { id: 'b', label: 'Two', state: 'running', progress: { done: 50, total: 100, detail: 'owned: 50/100 searched · ~1 min left' }, startedAt: '2026-10-03T10:00:00.000Z' }, { id: 'c', label: 'Three', state: 'pending' }, { id: 'd', label: 'Four', state: 'pending' }];

test('the bar grows with finished steps and the running step’s own count', () => {
  assert.equal(overallProgress(steps), 38);
  assert.equal(overallProgress(steps.map(step => ({ ...step, state: 'done' }))), 100);
  assert.equal(overallProgress([]), 0);
});

test('the panel names the current step, its count and time, and notices a silent update', () => {
  const now = Date.parse('2026-10-03T10:01:05.000Z');
  const view = describeStatus({ running: true, status: { steps, updatedAt: '2026-10-03T10:01:00.000Z' } }, now);
  assert.equal(view.headline, 'Updating · step 2 of 4: Two');
  assert.equal(view.detail, '50 of 100 · owned: 50/100 searched · ~1 min left · 1m 05s on this step');
  assert.equal(view.stale, false);
  assert.equal(describeStatus({ running: true, status: { steps, updatedAt: '2026-10-03T09:59:00.000Z' } }, now).stale, true);
  assert.match(describeStatus({ running: false, status: { state: 'stopped', finishedAt: '2026-10-03T10:02:00.000Z', steps } }, now).headline, /You stopped the update/);
  assert.equal(describeStatus({ running: false, status: { state: 'done', steps } }, now).percent, overallProgress(steps));
});

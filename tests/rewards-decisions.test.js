import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../tracking/domain.js';
import { enableRewards, rewardTransition, rewardTotal, levelProgress, rewardChanges, xpBreakdown, nextTitle } from '../tracking/rewards.js';
import { buildSuggestionChoices } from '../tracking/suggestions.js';
import { triageQueue, applyTriage, undoTriage } from '../tracking/triage.js';
import { markPlayed, planPoint, restorePlanPoint } from '../tracking/plan.js';
import { parseBackup, createBackup } from '../tracking/backup.js';

const start = '2026-09-29T09:00:00.000Z', at = '2026-09-29T10:00:00.000Z', today = '2026-09-29';
let sequence = 0;
const stamp = () => ({ at, eventId: `e${++sequence}`, reason: 'test' });
const owned = (id, name, score) => ({ id, name, platforms: ['PC (Windows)'], genres: [], copies: [{ id: `${id}-copy`, name, platforms: ['PC (Windows)'], sources: ['Steam'], igdb: { id: score, players: score, playersCount: 500 } }] });
const library = [owned('a', 'Alpha', 90), owned('b', 'Beta', 80), owned('c', 'Gamma', 70)];
const context = state => ({ state, catalog: { systems: [], games: [] }, library });
const queue = state => triageQueue(buildSuggestionChoices(context(state)), state, { today });
const step = (state, change) => { const audit = stamp(); return rewardTransition(state, change(state, audit), audit); };
const valid = state => assert.doesNotThrow(() => parseBackup(JSON.stringify(createBackup(state, at)), 'personal'));

test('triage decisions earn 2 XP, "already played" earns 100 more, and undo withdraws both', () => {
  let state = enableRewards(emptyState(), { at: start, timeZone: 'UTC' });
  const [alpha, beta] = queue(state);
  state = step(state, (s, a) => applyTriage(s, alpha, 'maybe', { ...a, today }).state);
  assert.equal(rewardTotal(state), 2);
  let undo;
  state = step(state, (s, a) => { const result = applyTriage(s, beta, 'played', { ...a, today }); undo = result.undo; return result.state; });
  assert.equal(rewardTotal(state), 104);
  valid(state);
  state = step(state, (s, a) => undoTriage(s, beta, undo, a));
  assert.equal(rewardTotal(state), 2);
  valid(state);
  // Deciding again earns the decision back once, not twice.
  const again = queue(state).find(choice => choice.id === beta.id);
  state = step(state, (s, a) => applyTriage(s, again, 'pass', { ...a, today }).state);
  assert.equal(rewardTotal(state), 4);
  valid(state);
});

test('finishing from My plan: past finishes earn 100, a dated finish without an objective earns 100, undo withdraws', () => {
  let state = enableRewards(emptyState(), { at: start, timeZone: 'UTC' });
  const desc = (id, title) => ({ ref: { provider: 'playnite', id }, title, platforms: ['PC (Windows)'] });
  const point = planPoint(state, ['target:playnite:a-copy']);
  state = step(state, (s, a) => markPlayed(s, desc('a-copy', 'Alpha'), 'finished', { at: a.at, eventIds: [a.eventId, `${a.eventId}:2`, `${a.eventId}:3`], playthroughId: 'p-a' }).state);
  assert.equal(rewardTotal(state), 100);
  state = step(state, (s, a) => markPlayed(s, desc('b-copy', 'Beta'), 'retired', { at: a.at, eventIds: [a.eventId, `${a.eventId}:2`, `${a.eventId}:3`], playthroughId: 'p-b' }).state);
  assert.equal(rewardTotal(state), 100, 'retiring earns nothing');
  state = step(state, (s, a) => restorePlanPoint(s, point, a));
  assert.equal(rewardTotal(state), 0);
  valid(state);
  assert.deepEqual(levelProgress(state), { total: 0, step: 100, level: 1, within: 0, next: 100, span: 100, title: 'Explorer' });
});

test('XP moments name what earned them, the Progress tab totals XP by kind, and undo shows as a loss', () => {
  let state = enableRewards(emptyState(), { at: start, timeZone: 'UTC' });
  const [alpha, beta] = queue(state);
  let before = state;
  state = step(state, (s, a) => applyTriage(s, alpha, 'played', { ...a, today }).state);
  assert.deepEqual(rewardChanges(before, state).sort((a, b) => a.type.localeCompare(b.type)), [{ type: 'decision', amount: 2 }, { type: 'past', amount: 100 }]);
  let undo;
  state = step(state, (s, a) => { const result = applyTriage(s, beta, 'soon', { ...a, today }); undo = result.undo; return result.state; });
  assert.deepEqual(xpBreakdown(state).map(row => [row.type, row.amount, row.label]), [['past', 100, 'Past finish logged'], ['decision', 4, 'Decision made']]);
  before = state;
  state = step(state, (s, a) => undoTriage(s, beta, undo, a));
  assert.deepEqual(rewardChanges(before, state), [{ type: 'decision', amount: -2 }]);
});

test('the next title is the next rung of the ladder, with the XP still needed', () => {
  assert.deepEqual(nextTitle(0, 100), { level: 2, title: 'Player Two', xp: 100 });
  assert.deepEqual(nextTitle(100, 100), { level: 3, title: 'Wayfinder', xp: 200 });
  assert.deepEqual(nextTitle(340, 100), { level: 4, title: 'Cartridge Blower', xp: 260 });
  assert.deepEqual(nextTitle(19000, 100), { level: 21, title: 'Hall of Famer', xp: 2000 });
  // Level 30 holds the last title.
  assert.equal(nextTitle(43500, 100), null);
  assert.equal(levelProgress(enableRewards(emptyState(), { at: start, timeZone: 'UTC' })).title, 'Explorer');
});

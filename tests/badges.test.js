import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../tracking/domain.js';
import { setUpNext } from '../tracking/compat.js';
import { markPlayed, planPoint, restorePlanPoint } from '../tracking/plan.js';
import { badges, badgeStats, monthlyActivity } from '../tracking/badges.js';

const desc = (id, platform) => ({ ref: { provider: 'playnite', id }, title: id, platforms: [platform] });
const finish = (state, id, platform, at) => markPlayed(state, desc(id, platform), 'finished', { at, eventIds: [`${id}-1`, `${id}-2`, `${id}-3`], playthroughId: `p-${id}` }).state;

test('badges count finished games, platforms and retro finishes; undone finishes do not count', () => {
  let state = finish(emptyState(), 'metroid', 'Super Nintendo Entertainment System', '2026-08-10T10:00:00.000Z');
  state = finish(state, 'witcher', 'PC (Windows)', '2026-09-10T10:00:00.000Z');
  const point = planPoint(state, ['target:playnite:doom']);
  state = finish(state, 'doom', 'PC (DOS)', '2026-09-12T10:00:00.000Z');
  assert.deepEqual(badgeStats(state), { finished: 3, platforms: 2, retro: 1, triaged: 0, removed: 0, notes: 0, milestones: 0, mastery: 0, months: 0, past: 3, replays: 0, reflections: 0, challenges: 0, topTen: 0, goals: 0, listHistory: 0, listSeries: 0, listDecade: 0, listGenre: 0 });
  state = restorePlanPoint(state, point, { at: '2026-09-12T11:00:00.000Z', eventId: 'undo' });
  const unlocked = badges(state).filter(badge => badge.unlocked).map(badge => badge.id);
  assert.deepEqual(unlocked, ['first-finish', 'retro-1']);
  assert.equal(badges(state).find(badge => badge.id === 'finisher-10').progress, 2);
  // Catalog-based badges come from the Play page.
  assert.ok(badges(state, { topTen: 1, goals: 1 }).filter(badge => ['top-ten-1', 'goal-1'].includes(badge.id)).every(badge => badge.unlocked));
});

test('monthly activity shows added and finished games per month, ignoring undone actions', () => {
  let state = setUpNext(emptyState(), desc('a', 'PC (Windows)'), true, { at: '2026-08-02T10:00:00.000Z', eventId: 'up-a' });
  state = finish(state, 'a', 'PC (Windows)', '2026-09-05T10:00:00.000Z');
  const rows = monthlyActivity(state, { months: 3, now: '2026-09-29T10:00:00.000Z' });
  assert.deepEqual(rows.map(row => [row.month, row.added, row.finished]), [['2026-07', 0, 0], ['2026-08', 1, 0], ['2026-09', 0, 1]]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyCommand, ensureTarget } from '../tracking/domain.js';
import { validateState, mergeBackup, previewMerge } from '../tracking/backup.js';
import { addListGoal, removeListGoal, goalEntries, goalProgress, goalYears, goalTitle, finishedCatalogIds, captureListAwards, validListAward } from '../tracking/goals.js';
import { enableRewards, rewardTransition, rewardTotal } from '../tracking/rewards.js';
import { badges } from '../tracking/badges.js';
import { editPlaythrough } from '../tracking/history.js';
import { createBackup, parseBackup } from '../tracking/backup.js';

const at = '2026-10-02T10:00:00.000Z';
const reviews = (value, count = 10) => ({ critics: { value, count, source: 'wikipedia' }, players: { value, count: 100 } });
const game = (id, title, systemId, rank, year, score) => ({ id, title, systemId, rank, year, genres: [], reviews: reviews(score) });
const catalog = { systems: [{ id: 'snes', name: 'Super Nintendo' }, { id: 'md', name: 'Mega Drive' }], games: [
  game('snes-1', 'Chrono Trigger', 'snes', 1, 1995, 95), game('snes-2', 'Super Metroid', 'snes', 2, 1994, 96), game('snes-3', 'Street Fighter II', 'snes', 3, 1992, 90),
  game('md-1', 'Street Fighter II', 'md', 1, 1993, 91), game('md-2', 'Gunstar Heroes', 'md', 2, 1993, 89),
  { ...game('snes-x', 'Removed', 'snes', null, 1995, 99), unlisted: true },
] };

test('a system goal follows its list; other goals rank by score with one place per game', () => {
  assert.deepEqual(goalEntries(catalog, { system: 'snes', year: null, size: 10 }).map(entry => entry.title), ['Chrono Trigger', 'Super Metroid', 'Street Fighter II']);
  const all = goalEntries(catalog, { system: '', year: null, size: 10 });
  assert.deepEqual(all.map(entry => entry.title), ['Super Metroid', 'Chrono Trigger', 'Street Fighter II', 'Gunstar Heroes']);
  assert.deepEqual(all[2].games.map(item => item.id), ['md-1', 'snes-3']);
  assert.deepEqual(goalEntries(catalog, { system: '', year: 1993, size: 10 }).map(entry => entry.title), ['Street Fighter II', 'Gunstar Heroes']);
  assert.deepEqual(goalYears({ ...catalog, games: Array.from({ length: 10 }, (_, i) => game(`g${i}`, `Game ${i}`, 'snes', i + 1, 2000, 80)) }), [{ year: 2000, count: 10 }]);
  assert.equal(goalTitle({ system: 'snes', year: null, size: 25 }, id => id === 'snes' ? 'Super Nintendo' : id), 'Super Nintendo top 25');
  assert.equal(goalTitle({ system: '', year: 2000, size: 10 }), 'Top 10 of 2000');
});

test('any finish of any version counts, and goals survive backups and merges', () => {
  let state = emptyState();
  const target = ensureTarget(state, { ref: { provider: 'catalog', id: 'snes-3' }, title: 'Street Fighter II', platforms: ['snes'] }).id;
  state = applyCommand(state, { type: 'start', targetId: target, playthroughId: 'p1', eventId: 'e1', at });
  state = applyCommand(state, { type: 'status', targetId: target, playthroughId: 'p1', status: 'finished', eventId: 'e2', at });
  const finished = finishedCatalogIds(state, catalog, []);
  assert.deepEqual([...finished], ['snes-3']);
  const progress = goalProgress(catalog, { system: '', year: null, size: 10 }, finished);
  assert.deepEqual([progress.finished, progress.total, progress.complete], [1, 4, false]);
  state = validateState(addListGoal(state, { size: 10, system: 'snes' }, { id: 'goal-1', at }));
  assert.throws(() => addListGoal(state, { size: 10, system: 'snes' }, { id: 'goal-2', at }), /already have/);
  assert.throws(() => addListGoal(state, { size: 15 }, { id: 'goal-3', at }), /top 10, 25, 50 or 100/);
  const other = validateState(addListGoal(emptyState(), { size: 100 }, { id: 'goal-4', at }));
  const merged = mergeBackup(state, other, Object.fromEntries(previewMerge(state, other).conflicts.map(c => [`${c.section}/${c.id}`, 'current'])), { at, eventId: 'merge' });
  assert.deepEqual(merged.settings.listGoals.map(goal => goal.id), ['goal-1', 'goal-4']);
  assert.equal('listGoals' in removeListGoal(state, 'goal-1').settings, false);
});

test('goals can follow a genre, a decade, a series or a genre history, and reject mixed lists', () => {
  let state = emptyState();
  state = validateState(addListGoal(state, { size: 10, genre: 'rpg', decade: 1990 }, { id: 'goal-rpg', at }));
  state = validateState(addListGoal(state, { size: 10, series: 'zelda' }, { id: 'goal-zelda', at }));
  state = validateState(addListGoal(state, { size: 10, shaped: 'fps' }, { id: 'goal-fps', at }));
  assert.deepEqual(state.settings.listGoals.map(goal => goalTitle(goal)), ['Top 10 RPGs of the 1990s', 'Top 10 Zelda games', 'The games that shaped first-person shooters']);
  // The same list twice is one goal; a different decade is another.
  assert.throws(() => addListGoal(state, { size: 10, genre: 'rpg', decade: 1990 }, { id: 'again', at }), /already have/);
  assert.doesNotThrow(() => addListGoal(state, { size: 10, genre: 'rpg', decade: 2000 }, { id: 'goal-2000s', at }));
  for (const bad of [{ size: 10, genre: 'dating-sim' }, { size: 10, series: 'zelda', system: 'snes' }, { size: 10, decade: 1995 }, { size: 10, year: 1994, decade: 1990 }, { size: 10, series: 'zelda', shaped: 'fps' }]) {
    assert.throws(() => addListGoal(emptyState(), bad, { id: 'bad', at }), /Invalid list goal/, JSON.stringify(bad));
  }
});

test('completing a list records its award: XP when a new finish completes it, the badge either way, and undo takes it back', () => {
  let serial = 0;
  // The client records list awards (they need the catalog), then XP follows from state.
  const step = (state, mutate, time = at) => validateState(rewardTransition(state, captureListAwards(state, mutate(structuredClone(state)), { catalog, library: [], at: time }), { at: time, eventId: `event-${++serial}`, reason: 'test' }));
  const finish = (state, id, time) => {
    const target = ensureTarget(state, { ref: { provider: 'catalog', id }, title: id, platforms: [] }).id, play = `play-${id}`;
    state = applyCommand(state, { type: 'start', targetId: target, playthroughId: play, eventId: `start-${id}-${time}`, at: time });
    return applyCommand(state, { type: 'status', targetId: target, playthroughId: play, status: 'finished', eventId: `finish-${id}-${time}`, at: time });
  };
  const decade = { size: 10, decade: 1990 };
  let state = step(emptyState(), current => enableRewards(current, { at, timeZone: 'UTC' }));
  // Three of the four 1990s games before the goal (Street Fighter II counts once, on either system).
  for (const id of ['snes-1', 'snes-2', 'md-1']) state = step(state, current => finish(current, id, at));
  state = step(state, current => addListGoal(current, decade, { id: 'goal-90s', at: '2026-10-02T11:00:00.000Z' }));
  assert.deepEqual(state.listAwards, {});
  state = step(state, current => finish(current, 'md-2', '2026-10-02T12:00:00.000Z'), '2026-10-02T12:00:00.000Z');
  const award = state.listAwards['list:goal-90s'];
  assert.deepEqual([award.title, award.games, award.xp, award.kinds], ['Top 10 of the 1990s', 4, 40, ['decade']]);
  assert.equal(state.rewardLedger['list:goal-90s'].amount, 40);
  assert.ok(badges(state).find(badge => badge.id === 'list-decade').unlocked);
  // It survives a backup round trip and removing the goal.
  assert.deepEqual(parseBackup(JSON.stringify(createBackup(state, at)), 'personal').listAwards, state.listAwards);
  const removed = step(state, current => removeListGoal(current, 'goal-90s'));
  assert.equal(removed.rewardLedger['list:goal-90s'].amount, 40);
  // Taking back the finish that completed it takes the award back, XP and badge with it.
  const total = rewardTotal(state);
  state = step(state, current => editPlaythrough(current, 'play-md-2', { at: '2026-10-02T13:00:00.000Z', eventId: 'unfinish-1', expected: current.playthroughs['play-md-2'], fields: { status: 'playing', finishedAt: null } }), '2026-10-02T13:00:00.000Z');
  assert.equal(validListAward(state, state.listAwards['list:goal-90s']), false);
  assert.equal(state.rewardLedger['list:goal-90s'].amount, 0);
  assert.ok(rewardTotal(state) < total);
  assert.ok(!badges(state).find(badge => badge.id === 'list-decade').unlocked);
  // A list already finished when you set it earns the badge, not XP.
  const snes = step(state, current => addListGoal(current, { size: 10, system: 'snes', decade: 1990 }, { id: 'goal-snes', at: '2026-10-03T10:00:00.000Z' }), '2026-10-03T10:00:00.000Z');
  assert.equal(snes.listAwards['list:goal-snes'].xp, 0);
  assert.equal(snes.rewardLedger['list:goal-snes'], undefined);
  assert.ok(badges(snes).find(badge => badge.id === 'list-decade').unlocked);
});


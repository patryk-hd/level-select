import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../tracking/domain.js';
import { buildSuggestionChoices, selectSuggestions } from '../tracking/suggestions.js';
import { triageQueue, applyTriage, undoTriage, triageFor, MAYBE_DAYS } from '../tracking/triage.js';
import { parseBackup, createBackup } from '../tracking/backup.js';

const at = '2026-09-28T18:00:00.000Z', today = '2026-09-28';
const catalog = { systems: [], games: [] };
const owned = (id, name, extra = {}) => ({ id, name, platforms: ['PC (Windows)'], genres: [], hidden: false, favorite: false, cover: `assets/${id}.jpg`, summary: `${name} summary`,
  copies: [{ id: `${id}-copy`, name, platforms: ['PC (Windows)'], sources: ['Steam'], hidden: false, ...extra }] });
function context() {
  return { state: emptyState(), catalog, library: [
    owned('a', 'Average Game', { criticScore: 70 }),
    owned('b', 'Brilliant Game', { igdb: { players: 94, playersCount: 3000, critic: 92, criticCount: 20 } }),
    owned('u', 'Unrated Game'),
    owned('d', 'Brilliant Game Demo', { igdb: { players: 99, playersCount: 3000 } }),
  ] };
}
const queue = (ctx, day = today) => triageQueue(buildSuggestionChoices(ctx), ctx.state, { today: day });
const titles = list => list.map(choice => choice.title);

test('triage asks about owned games best-rated first, without demos or extras', () => {
  const ctx = context();
  assert.deepEqual(titles(queue(ctx)), ['Brilliant Game', 'Average Game', 'Unrated Game']);
  assert.equal(queue(ctx)[0].option.cover, 'assets/b.jpg');
});

test('play soon adds the game to the backlog as "want soon"; undo removes both', () => {
  const ctx = context(), first = queue(ctx)[0];
  const { state, undo } = applyTriage(ctx.state, first, 'soon', { at, eventId: 'triage-1', today });
  assert.equal(state.backlog[first.id].priority, 2);
  assert.equal(triageFor(state, first.id).decision, 'soon');
  assert.ok(!titles(queue({ ...ctx, state })).includes('Brilliant Game'));
  // It now leads the suggestions as a backlog pick.
  assert.equal(selectSuggestions(buildSuggestionChoices({ ...ctx, state }))[0].title, 'Brilliant Game');
  const restored = undoTriage(state, first, undo, { at, eventId: 'triage-undo-1' });
  assert.equal(restored.backlog[first.id], undefined);
  assert.equal(triageFor(restored, first.id), null);
  assert.deepEqual(titles(queue({ ...ctx, state: restored })), ['Brilliant Game', 'Average Game', 'Unrated Game']);
});

test('maybe returns after its date; not for me leaves triage and suggestions but stays in the library', () => {
  const ctx = context(), [brilliant, average] = queue(ctx);
  let { state } = applyTriage(ctx.state, brilliant, 'maybe', { at, eventId: 'm', today });
  ({ state } = applyTriage(state, average, 'pass', { at, eventId: 'p', today }));
  const next = { ...ctx, state };
  assert.deepEqual(titles(queue(next)), ['Unrated Game']);
  const later = new Date(Date.parse(`${today}T00:00:00Z`) + MAYBE_DAYS * 86400000).toISOString().slice(0, 10);
  assert.deepEqual(titles(queue(next, later)), ['Brilliant Game', 'Unrated Game']);
  const suggested = titles(selectSuggestions(buildSuggestionChoices(next)));
  assert.ok(!suggested.includes('Average Game')); assert.ok(suggested.includes('Brilliant Game'));
  assert.equal(state.backlog[average.id], undefined);
});

test('triage decisions survive a backup round trip and invalid ones are rejected', () => {
  const ctx = context(), first = queue(ctx)[0];
  const { state } = applyTriage(ctx.state, first, 'maybe', { at, eventId: 'm', today });
  const restored = parseBackup(JSON.stringify(createBackup(state, at)), 'personal');
  assert.equal(triageFor(restored.state ?? restored, first.id).decision, 'maybe');
  const broken = createBackup(state, at);
  const data = broken.tracking ?? broken.state ?? broken;
  for (const entry of Object.values(data.annotations ?? {})) if (entry.triage) entry.triage.decision = 'delete-everything';
  assert.throws(() => parseBackup(JSON.stringify(broken), 'personal'));
});

test('copies of the same IGDB game share one card and one decision; only the best copy is queued', () => {
  const ctx = context();
  const witcher = { players: 94, playersCount: 5000, critic: 92, criticCount: 26 };
  ctx.library.push(owned('w1', 'The Witcher 3 - Complete Edition', { sources: ['GOG'], igdb: { id: 1942, ...witcher } }),
    owned('w2', 'The Witcher 3 GOTY Edition', { sources: ['Epic'], igdb: { id: 1942, ...witcher } }));
  const cards = queue(ctx), card = cards.find(item => item.title.startsWith('The Witcher'));
  assert.equal(cards.filter(item => item.title.startsWith('The Witcher')).length, 1);
  assert.equal(card.siblings.length, 1);
  const { state, undo } = applyTriage(ctx.state, card, 'soon', { at, eventId: 'w', today });
  assert.equal(Object.keys(state.backlog).length, 1);
  assert.ok(!titles(queue({ ...ctx, state })).some(title => title.startsWith('The Witcher')));
  const restored = undoTriage(state, card, undo, { at, eventId: 'wu' });
  assert.equal(queue({ ...ctx, state: restored }).filter(item => item.title.startsWith('The Witcher')).length, 1);
});

test('play soon lands in Up Next; already played finishes the game (undated) and undo restores all', async () => {
  const { orderedQueue, progress } = await import('../tracking/compat.js');
  const ctx = context(), [first, second] = queue(ctx);
  let { state, undo } = applyTriage(ctx.state, first, 'soon', { at, eventId: 's1', today });
  assert.deepEqual(orderedQueue(state).map(item => item.targetId), [first.id]);
  const played = applyTriage(state, second, 'played', { at, eventId: 'p1', today });
  assert.equal(progress(played.state, second.id), 'finished');
  assert.equal(Object.values(played.state.playthroughs).find(play => play.targetId === second.id).finishedAt, null);
  assert.ok(!titles(queue({ ...ctx, state: played.state })).includes(second.title));
  assert.ok(!selectSuggestions(buildSuggestionChoices({ ...ctx, state: played.state })).some(choice => choice.id === second.id));
  assert.doesNotThrow(() => parseBackup(JSON.stringify(createBackup(played.state, at)), 'personal'));
  const unplayed = undoTriage(played.state, second, played.undo, { at, eventId: 'p1-undo' });
  assert.equal(progress(unplayed, second.id), 'untracked');
  assert.equal(Object.values(unplayed.playthroughs).length, 0);
  assert.doesNotThrow(() => parseBackup(JSON.stringify(createBackup(unplayed, at)), 'personal'));
  const cleared = undoTriage(unplayed, first, undo, { at, eventId: 's1-undo' });
  assert.equal(orderedQueue(cleared).length, 0);
  assert.equal(cleared.backlog[first.id], undefined);
});

test('once one copy of a game is finished or planned, its other editions leave triage and new suggestions', () => {
  const ctx = context();
  const witcher = { players: 94, playersCount: 5000, critic: 92, criticCount: 26 };
  ctx.library.push(owned('w1', 'The Witcher 3 - Complete Edition', { sources: ['GOG'], igdb: { id: 1942, ...witcher } }),
    owned('w2', 'The Witcher 3 GOTY Edition', { sources: ['PlayStation'], igdb: { id: 1942, ...witcher } }));
  const card = queue(ctx).find(item => item.title.startsWith('The Witcher'));
  // Decide on only one copy (as if the other had been imported later).
  const lone = { ...card, siblings: [] };
  const { state } = applyTriage(ctx.state, lone, 'played', { at, eventId: 'w', today });
  const next = { ...ctx, state };
  assert.ok(!titles(queue(next)).some(title => title.startsWith('The Witcher')));
  assert.ok(!selectSuggestions(buildSuggestionChoices(next)).some(choice => choice.title.startsWith('The Witcher')));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, ensureTarget, findTarget, applyCommand, linkReference } from '../tracking/domain.js';
import { migrateLegacy, readLegacy, ingestOwned, LEGACY_KEYS } from '../tracking/legacy.js';
import { validateState, createBackup, parseBackup, previewMerge, mergeBackup, MAX_BACKUP_BYTES } from '../tracking/backup.js';
import { createRepository, RevisionConflict } from '../tracking/persistence.js';
import { STORAGE_KEY } from '../lib.js';

const at = '2026-09-12T18:00:00.000Z', later = '2026-09-13T18:00:00.000Z';
const catalog = { systems: [{ id: 'snes' }, { id: 'ps1' }], games: [
  { id: 'snes-original', title: 'Fixture Quest', systemId: 'snes' },
  { id: 'ps1-port', title: 'Fixture Quest', systemId: 'ps1' },
] };
const library = [{ id: 'fixture-quest', name: 'Fixture Quest', platforms: ['SNES', 'PS1'], played: true,
  copies: [{ id: 'copy-a', platforms: ['SNES'], sources: ['Manual'], timePlayed: 1200 }, { id: 'copy-b', platforms: ['PS1'], sources: ['Manual'], timePlayed: 0 }] }];
const wishlist = [{ appid: '101', title: 'Fixture Quest Remaster' }];
function seed(namespace) {
  const state = emptyState(namespace);
  const target = ensureTarget(state, { ref: { provider: 'catalog', id: 'snes-original' }, title: 'Fixture Quest', platforms: ['snes'] });
  return { state, targetId: target.id };
}
function legacy() {
  return { collection: { schemaVersion: 1, pinnedSystems: ['snes', 'unknown-system'], entries: {
    'snes-original': { favorite: true, owned: true, wishlist: true, status: 'completed' },
    'ps1-port': { status: 'playing' }, 'unknown-release': { status: 'backlog' },
  } }, overrides: { 'fixture-quest': { favorite: false, hidden: true, notes: 'Different notes for my copies.' }, vanished: { notes: 'Keep this note.' } },
  removed: { 101: { title: 'Fixture Quest Remaster', removedAt: '2026-08-01' } }, notes: { 101: 'Wait for another sale.' } };
}

test('legacy key matches the live app; sample reads never copy personal recommendations', () => {
  assert.equal(LEGACY_KEYS.collection, STORAGE_KEY);
  const values = new Map([[STORAGE_KEY, JSON.stringify(legacy().collection)], ['sample:steam-wishlist-notes', '{"101":"sample"}'], ['steam-wishlist-notes', '{"101":"personal"}']]);
  const storage = { getItem: key => values.get(key) ?? null };
  assert.equal(readLegacy(storage, 'personal').input.notes[101], 'personal');
  assert.equal(readLegacy(storage, 'sample').input.collection, undefined);
  assert.equal(readLegacy(storage, 'sample').input.notes[101], 'sample');
  values.set(STORAGE_KEY, '{broken');
  const failed = readLegacy(storage, 'personal');
  assert.equal(failed.ok, false); assert.equal(failed.recovery[STORAGE_KEY], '{broken');
  assert.equal(values.get(STORAGE_KEY), '{broken');
});

test('migration preserves scoped histories, manual ownership, annotations and unresolved records', () => {
  const current = emptyState(), original = structuredClone(current);
  const result = migrateLegacy(current, legacy(), { catalog, library, wishlist, at });
  validateState(result.state); assert.deepEqual(current, original);
  const snes = findTarget(result.state, { provider: 'catalog', id: 'snes-original' });
  const ps1 = findTarget(result.state, { provider: 'catalog', id: 'ps1-port' });
  assert.notEqual(snes.id, ps1.id);
  assert.equal(result.state.playthroughs['legacy:snes-original'].status, 'finished');
  assert.equal(result.state.playthroughs['legacy:snes-original'].objective, 'unspecified');
  assert.equal(result.state.playthroughs['legacy:snes-original'].finishedAt, null);
  assert.equal(result.state.playthroughs['legacy:snes-original'].historical, true);
  assert.equal(result.state.playthroughs['legacy:ps1-port'].status, 'playing');
  assert.equal(result.state.ownership['manual:snes-original'].evidence, 'manual');
  assert.equal(result.state.annotations['owned:fixture-quest'].notes, 'Different notes for my copies.');
  assert.equal(result.state.annotations['owned:vanished'].notes, 'Keep this note.');
  assert.equal(result.state.annotations['steam:101'].notes, 'Wait for another sale.');
  const wanted = findTarget(result.state, { provider: 'steam', id: '101' });
  assert.equal(result.state.wishlist[wanted.id].decision, 'archived');
  assert.equal(result.state.wishlist[wanted.id].legacyRemovedAt, '2026-08-01');
  assert.equal(Object.keys(result.state.events).length, 0);
  assert.equal(Object.values(result.state.targets).filter(target => target.unresolved).length, 2);
  assert.deepEqual(result.state.settings.pinnedSystems, ['snes', 'unknown-system']);
  assert.deepEqual(migrateLegacy(result.state, legacy(), { catalog, at: later }).state, result.state);
});

test('bad legacy data rejects the entire migration without changing its input', () => {
  const state = emptyState(), input = legacy(); input.notes[101] = 42;
  assert.throws(() => migrateLegacy(state, input, { catalog, at }));
  assert.deepEqual(state, emptyState());
  const polluted = JSON.parse('{"overrides":{"__proto__":{"notes":"bad"}}}');
  assert.throws(() => migrateLegacy(state, polluted, { at }));
  input.notes[101] = 'ok'; input.collection.entries['ps1-port'].status = 'mastered';
  assert.throws(() => migrateLegacy(state, input, { at }));
  const existing = seed().state;
  assert.throws(() => migrateLegacy(existing, legacy(), { catalog, at }), /preview its merge/);
  assert.equal(Object.keys(existing.playthroughs).length, 0);
});

test('owned import preserves stable copy IDs without inferring progress; renames and missing copies keep history', () => {
  let state = ingestOwned(emptyState(), library);
  assert.equal(Object.keys(state.targets).length, 2); assert.equal(Object.keys(state.backlog).length, 0);
  assert.equal(Object.keys(state.playthroughs).length, 0);
  const a = findTarget(state, { provider: 'playnite', id: 'copy-a' });
  const b = findTarget(state, { provider: 'playnite', id: 'copy-b' });
  assert.notEqual(a.id, b.id);
  state = applyCommand(state, { type: 'queue', targetId: a.id, eventId: 'queue-a', at });
  const renamed = [{ ...library[0], name: 'Corrected title', copies: [library[0].copies[0]] }];
  state = ingestOwned(state, renamed);
  assert.equal(findTarget(state, { provider: 'playnite', id: 'copy-a' }).id, a.id);
  assert.ok(state.ownership['playnite:copy-b']); assert.ok(state.backlog[a.id]);
  assert.equal(Object.keys(state.events).length, 1); validateState(state);
  assert.throws(() => ingestOwned(state, [...library, ...library]), /Duplicate/);
});

test('linking requires explicit confirmation and never combines existing targets or platforms by title', () => {
  const { state, targetId } = seed();
  const ref = { provider: 'playnite', id: 'copy-a' };
  assert.throws(() => linkReference(state, { targetId, ref }), /Confirm/);
  const linked = linkReference(state, { targetId, ref, confirmed: true });
  assert.equal(findTarget(linked, ref).id, targetId); validateState(linked);
  const owned = ingestOwned(linked, library);
  assert.equal(owned.ownership['playnite:copy-a'].targetId, targetId);
  assert.notEqual(owned.ownership['playnite:copy-b'].targetId, targetId);
  assert.throws(() => linkReference(owned, { targetId, ref: { provider: 'playnite', id: 'copy-b' }, confirmed: true }), /own target/);
});

test('backlog and wishlist intent remain independent from ownership and playing', () => {
  const { state, targetId } = seed();
  const queued = applyCommand(state, { type: 'queue', targetId, eventId: 'queue', at });
  const acquired = applyCommand(queued, { type: 'wishlist', targetId, eventId: 'decision', at, decision: 'acquired' });
  assert.equal(Object.keys(acquired.ownership).length, 0); assert.ok(acquired.backlog[targetId]);
  const unqueued = applyCommand(acquired, { type: 'unqueue', targetId, eventId: 'unqueue', at });
  assert.equal(unqueued.wishlist[targetId].decision, 'acquired'); assert.equal(Object.keys(unqueued.playthroughs).length, 0);
  assert.equal(Object.keys(state.events).length, 0); validateState(unqueued);
});

test('pause, resume, finish, retirement and replay preserve distinct history without rewards', () => {
  const { state: initial, targetId } = seed(); let state = initial;
  state = applyCommand(state, { type: 'start', targetId, playthroughId: 'first', eventId: 'start', at, objective: 'personal', objectiveText: 'Reach the third island' });
  assert.throws(() => applyCommand(state, { type: 'start', targetId, playthroughId: 'second', eventId: 'invalid', at }), /existing/);
  for (const status of ['paused', 'playing', 'finished']) state = applyCommand(state, { type: 'status', targetId, playthroughId: 'first', eventId: `status-${status}`, at: later, status });
  const finished = structuredClone(state.playthroughs.first);
  assert.equal(finished.objective, 'personal'); assert.equal(finished.finishedAt, later);
  assert.throws(() => applyCommand(state, { type: 'status', targetId, playthroughId: 'first', eventId: 'restart', at: later, status: 'playing' }), /replay/);
  state = applyCommand(state, { type: 'start', targetId, playthroughId: 'replay', eventId: 'new-start', at: later });
  state = applyCommand(state, { type: 'status', targetId, playthroughId: 'replay', eventId: 'retire', at: later, status: 'retired' });
  assert.deepEqual(state.playthroughs.first, finished); assert.equal(state.playthroughs.replay.finishedAt, null);
  assert.equal(Object.keys(state.events).length, 6); assert.equal('rewards' in state, false); validateState(state);
});

test('backup round-trip is lossless, bounded, namespaced, and retains unresolved identities', () => {
  const state = migrateLegacy(emptyState(), legacy(), { catalog, library, wishlist, at }).state;
  const json = JSON.stringify(createBackup(state, at));
  assert.deepEqual(parseBackup(json, 'personal'), state);
  assert.throws(() => parseBackup(json, 'sample'), /Sample and personal/);
  assert.throws(() => parseBackup(' '.repeat(MAX_BACKUP_BYTES + 1), 'personal'), /5 MB/);
  const invalid = structuredClone(state); invalid.schemaVersion = 99;
  assert.throws(() => validateState(invalid), /schema/);
  const unknown = structuredClone(state); unknown.futureFeature = {};
  assert.throws(() => validateState(unknown), /unsupported sections/);
  const unknownSettings = structuredClone(state); unknownSettings.settings.futurePreference = true;
  assert.throws(() => validateState(unknownSettings), /Unsupported tracking settings/);
  const dangling = structuredClone(state); delete dangling.targets[dangling.playthroughs['legacy:ps1-port'].targetId];
  assert.throws(() => validateState(dangling), /missing tracking target/);
  assert.equal(previewMerge(emptyState(), state).unresolved.length, 2);
});

test('backup merges require conflict decisions and repeated imports do not duplicate records', () => {
  const { state, targetId } = seed();
  const a = applyCommand(state, { type: 'queue', targetId, eventId: 'event-a', at, priority: 1 });
  const b = applyCommand(state, { type: 'queue', targetId, eventId: 'event-b', at, priority: 3 });
  assert.equal(previewMerge(a, b).conflicts.length, 1);
  assert.throws(() => mergeBackup(a, b), /Choose/);
  const merged = mergeBackup(a, b, { [`backlog/${targetId}`]: 'incoming' });
  assert.equal(merged.backlog[targetId].priority, 3); assert.equal(Object.keys(merged.events).length, 2);
  assert.deepEqual(mergeBackup(merged, b), merged);
  assert.deepEqual(mergeBackup(merged, merged), merged);
  const changedEvent = structuredClone(merged); changedEvent.events['event-a'].details = { tampered: true };
  assert.throws(() => mergeBackup(merged, changedEvent, { 'events/event-a': 'incoming' }), /cannot be replaced/);
});

// A durable transport double, independent of the IndexedDB transaction implementation.
function transport() {
  const rows = new Map(); let failRead = false, failWrite = false;
  return {
    rows, setReadFailure(value) { failRead = value; }, setWriteFailure(value) { failWrite = value; },
    async read(namespace) { if (failRead) throw new Error('Storage denied'); return structuredClone(rows.get(namespace) ?? null); },
    async compareAndSwap(namespace, revision, next) {
      if (failWrite) throw new Error('Quota exceeded');
      if ((rows.get(namespace)?.revision ?? 0) !== revision) throw new RevisionConflict();
      rows.set(namespace, structuredClone(next)); return structuredClone(next);
    },
  };
}
test('repository serializes same-tab changes and commits status with history atomically', async () => {
  const adapter = transport(), repo = await createRepository({ adapter });
  await repo.update(() => seed().state); const targetId = Object.keys(repo.snapshot().targets)[0];
  const results = await Promise.all([
    repo.update(state => applyCommand(state, { type: 'queue', targetId, eventId: 'q', at })),
    repo.update(state => applyCommand(state, { type: 'start', targetId, playthroughId: 'play', eventId: 's', at })),
  ]);
  assert.ok(results.every(result => result.saved)); assert.equal(repo.snapshot().revision, 3);
  assert.equal(adapter.rows.get('personal').playthroughs.play.status, 'playing');
  assert.ok(adapter.rows.get('personal').events.s);
  await assert.rejects(repo.update(async state => state), /synchronous/);
  assert.equal(repo.snapshot().revision, 3); await repo.close();
});

test('a stale tab cannot overwrite a newer decision and can retry after refresh', async () => {
  const adapter = transport(), first = await createRepository({ adapter }), second = await createRepository({ adapter });
  await first.update(() => seed().state);
  await assert.rejects(second.update(() => emptyState()), RevisionConflict);
  assert.equal(second.snapshot().revision, 1); assert.equal(Object.keys(second.snapshot().targets).length, 1);
  await second.update(state => ({ ...state, settings: { ...state.settings, gamificationVisible: false } }));
  await first.refresh(); assert.equal(first.snapshot().settings.gamificationVisible, false);
  await first.close(); await second.close();
});

test('write failure keeps the previous durable state and an exportable session draft', async () => {
  const adapter = transport(), notices = [], repo = await createRepository({ adapter, onNotice: message => notices.push(message) });
  await repo.update(() => seed().state); const before = repo.durableSnapshot();
  adapter.setWriteFailure(true); const targetId = Object.keys(before.targets)[0];
  const result = await repo.update(state => applyCommand(state, { type: 'start', targetId, playthroughId: 'play', eventId: 'start', at }));
  assert.equal(result.saved, false); assert.deepEqual(adapter.rows.get('personal'), before);
  assert.deepEqual(repo.durableSnapshot(), before); assert.equal(repo.status().sessionOnly, true);
  const restored = parseBackup(JSON.stringify(createBackup(repo.snapshot(), at)), 'personal');
  assert.ok(restored.playthroughs.play); assert.ok(restored.events.start); assert.equal(notices.length, 1);
  await repo.close();
});

test('unreadable storage is preserved and unavailable storage never reports success', async () => {
  const adapter = transport(); adapter.rows.set('personal', { bad: 'preserve me' });
  const repo = await createRepository({ adapter });
  assert.deepEqual(repo.recovery(), { bad: 'preserve me' });
  const result = await repo.update(() => seed().state);
  assert.equal(result.saved, false); assert.deepEqual(adapter.rows.get('personal'), { bad: 'preserve me' });
  await repo.close();
  adapter.setReadFailure(true); const denied = await createRepository({ adapter });
  assert.equal((await denied.update(() => seed().state)).saved, false); await denied.close();
});

test('a misplaced sample record cannot become personal state during recovery', async () => {
  const adapter = transport(); adapter.rows.set('personal', seed('sample').state);
  const repo = await createRepository({ adapter });
  assert.equal(repo.snapshot().namespace, 'personal'); assert.equal(repo.recovery().namespace, 'sample');
  assert.equal((await repo.update(() => seed('personal').state)).saved, false);
  assert.equal(adapter.rows.get('personal').namespace, 'sample'); await repo.close();
});

test('interrupted migration is not marked durable, and restart retries it exactly once', async () => {
  const adapter = transport(), repo = await createRepository({ adapter });
  adapter.setWriteFailure(true);
  const migrate = state => migrateLegacy(state, legacy(), { catalog, library, wishlist, at }).state;
  assert.equal((await repo.update(migrate)).saved, false); assert.equal(adapter.rows.has('personal'), false);
  await repo.close(); adapter.setWriteFailure(false);
  const reopened = await createRepository({ adapter });
  await reopened.update(migrate); const before = reopened.snapshot();
  await reopened.update(migrate); const after = reopened.snapshot();
  assert.deepEqual({ ...after, revision: before.revision }, before); await reopened.close();
});

test('sample and personal repositories sharing a database remain isolated', async () => {
  const adapter = transport(), personal = await createRepository({ adapter }), sample = await createRepository({ adapter, namespace: 'sample' });
  await personal.update(() => seed('personal').state); await sample.update(() => seed('sample').state);
  await personal.update(state => ({ ...state, settings: { ...state.settings, pinnedSystems: ['snes'] } }));
  await sample.refresh(); assert.deepEqual(sample.snapshot().settings.pinnedSystems, []);
  await assert.rejects(sample.update(() => personal.snapshot()), /workspaces/);
  await personal.close(); await sample.close();
});

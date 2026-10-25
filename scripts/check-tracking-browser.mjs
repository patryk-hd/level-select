// Optional integration check with real Chromium IndexedDB. No app/user profile is opened.
// node scripts/check-tracking-browser.mjs --playwright /path/to/playwright/index.js --browser /path/to/chromium
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--playwright' || args[2] !== '--browser') throw new Error('Provide --playwright <module path> --browser <Chromium executable>.');
const module = await import(pathToFileURL(args[1]).href);
const { chromium } = module.default ?? module;
const browser = await chromium.launch({ executablePath: args[3], headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const origin = 'http://127.0.0.1:18888';
  await context.route(`${origin}/**`, async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Tracking storage test</title>' });
    if (pathname !== '/library/core.js' && !/^\/tracking\/(?:products|domain|backup|legacy|persistence|browser|history|compat|rewards|identity|challenges|suggestions|matches)\.js$/.test(pathname)) return route.abort();
    const source = await readFile(new URL(`..${pathname}`, import.meta.url), 'utf8');
    return route.fulfill({ contentType: 'text/javascript', body: source });
  });
  await page.goto(origin);
  const results = await page.evaluate(async () => {
    const { openTracking } = await import('/tracking/browser.js');
    const { applyCommand, ensureTarget, findTarget } = await import('/tracking/domain.js');
    const { openDatabase, indexedDBAdapter } = await import('/tracking/persistence.js');
    const at = '2026-09-12T18:00:00.000Z';
    const checks = [];
    function check(condition, label) { if (!condition) throw new Error(label); checks.push(label); }
    const raw = JSON.stringify({ schemaVersion: 1, pinnedSystems: ['snes'], entries: { fixture: { status: 'completed', favorite: true } } });
    const storage = { getItem(key) { return key === 'retro-library.collection.v1' ? raw : null; } };
    const options = { databaseName: 'tracking-integration-fixture', storage, BroadcastChannel: null, catalog: { games: [{ id: 'fixture', title: 'Fixture Quest', systemId: 'snes' }] } };
    let first = await openTracking(options), second = await openTracking(options);
    const preview = first.prepareMigration(at);
    check(preview.ok && preview.migrated && preview.additions.length > 0, 'Migration preview includes legacy records');
    check((await first.commitMigration(preview)).saved, 'IndexedDB migration commits');
    const targetId = findTarget(first.snapshot(), { provider: 'catalog', id: 'fixture' }).id;
    check(first.snapshot().playthroughs['legacy:fixture'].finishedAt === null, 'Historical dates remain unknown');
    let conflict = false;
    try { await second.update(state => { ensureTarget(state, { ref: { provider: 'manual', id: 'manual' }, title: 'Another game' }); return state; }); }
    catch (error) { conflict = error.name === 'RevisionConflict'; }
    check(conflict && second.snapshot().revision === 1, 'Real transaction rejects stale writer and refreshes it');
    await second.update(state => applyCommand(state, { type: 'start', targetId, playthroughId: 'replay', eventId: 'start', at }));
    await first.refresh();
    check(first.snapshot().playthroughs.replay.status === 'playing' && first.snapshot().events.start, 'Progress and history commit together');
    const backup = JSON.stringify(first.exportBackup(at));
    await first.close(); await second.close();
    first = await openTracking(options);
    check(first.snapshot().revision === 2 && first.snapshot().playthroughs.replay.status === 'playing', 'State survives database close and reopen');
    check(first.prepareMigration(at).migrated === false, 'Reload does not repeat migration');
    check(storage.getItem('retro-library.collection.v1') === raw, 'Legacy storage remains intact');

    const restored = await openTracking({ ...options, databaseName: 'tracking-restore-fixture' });
    await restored.importBackup(restored.previewBackup(backup));
    check(Object.keys(restored.snapshot().playthroughs).length === 2, 'Backup restores historical and new playthroughs');
    await restored.importBackup(restored.previewBackup(backup));
    check(Object.keys(restored.snapshot().events).length === 1, 'Repeated backup import does not duplicate events');
    const sample = await openTracking({ ...options, namespace: 'sample' });
    check(Object.keys(sample.snapshot().targets).length === 0, 'Sample state is isolated in the same database');
    let sampleRejected = false;
    try { sample.previewBackup(backup); } catch { sampleRejected = true; }
    check(sampleRejected, 'Personal backup cannot enter sample state');

    // Queue a command, then abort the underlying write transaction after put().
    const db = await openDatabase(indexedDB, { name: 'tracking-abort-fixture' });
    const adapter = indexedDBAdapter(db);
    const initial = restored.snapshot(); initial.revision = 1;
    await adapter.compareAndSwap('personal', 0, initial);
    const originalTransaction = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = originalTransaction(...args);
      if (args[1] === 'readwrite') {
        const originalStore = transaction.objectStore.bind(transaction);
        transaction.objectStore = name => {
          const store = originalStore(name), put = store.put.bind(store);
          store.put = (...params) => { const request = put(...params); request.onsuccess = () => transaction.abort(); return request; };
          return store;
        };
      }
      return transaction;
    };
    const next = structuredClone(initial); next.revision = 2;
    next.settings.gamificationVisible = false;
    let aborted = false;
    try { await adapter.compareAndSwap('personal', 1, next); } catch { aborted = true; }
    check(aborted && (await adapter.read('personal')).revision === 1, 'Interrupted write leaves durable state intact');
    adapter.close();
    await first.close(); await restored.close(); await sample.close();

    // Broadcast invalidation with two real browser channels.
    first = await openTracking({ ...options, databaseName: 'tracking-broadcast-fixture', BroadcastChannel });
    second = await openTracking({ ...options, databaseName: 'tracking-broadcast-fixture', BroadcastChannel });
    const refreshed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No cross-tab invalidation')), 4000);
      second.subscribe(change => { if (change.type === 'refresh') { clearTimeout(timer); resolve(); } });
    });
    await first.commitMigration(first.prepareMigration(at)); await refreshed;
    check(second.snapshot().revision === 1, 'BroadcastChannel refreshes another repository');
    await first.close(); await second.close();
    return checks;
  });
  assert.equal(results.length, 14);
  for (const result of results) console.log(`PASS ${result}`);
  await context.close();
} finally { await browser.close(); }

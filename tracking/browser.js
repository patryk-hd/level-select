import { openDatabase, indexedDBAdapter, createRepository, serverAdapter, appKeepsTracking } from './persistence.js';
import { createBackup, parseBackup, previewMerge, mergeBackup } from './backup.js';
import { readLegacy, migrateLegacy } from './legacy.js';
import { emptyState } from './domain.js';

// Opt-in entry point. Importing this module does not touch browser storage.
export async function openTracking({ namespace = 'personal', indexedDB, server = null,
  storage, BroadcastChannel = globalThis.BroadcastChannel,
  databaseName = 'retro-library-tracking', onNotice, ...migrationContext } = {}) {
  let local = null, unavailable = null;
  try { local = indexedDBAdapter(await openDatabase(indexedDB ?? globalThis.indexedDB, { name: databaseName })); }
  catch (error) { unavailable = { read: async () => { throw error; }, compareAndSwap: async () => { throw error; } }; }
  // In the Level Select app, the app keeps tracking (shared with your phone) and this browser
  // keeps a copy. A static copy (the demo, a hosted build) keeps it in this browser only.
  const shared = server ?? await appKeepsTracking();
  const adapter = shared ? serverAdapter({ local, onNotice: message => { try { onNotice?.(message); } catch {} } }) : local ?? unavailable;
  let channel;
  try { channel = BroadcastChannel ? new BroadcastChannel(`${databaseName}:${namespace}`) : null; }
  catch { channel = null; }
  const repository = await createRepository({ adapter, namespace, channel, onNotice });
  // Another device (your phone, another browser) may change shared tracking: look again now
  // and then while this page is in view, and whenever you come back to it.
  if (shared && globalThis.document) {
    const look = () => { if (document.visibilityState === 'visible') repository.refresh().catch(() => {}); };
    document.addEventListener('visibilitychange', look);
    setInterval(look, 15000);
  }
  return {
    ...repository,
    // Kept by the Level Select app (shared with every browser and paired phone), not this browser.
    shared: Boolean(shared),
    prepareMigration(at) {
      let legacy;
      try { legacy = readLegacy(storage ?? globalThis.localStorage, namespace); }
      catch (error) { return { ok: false, recovery: {}, error: `Legacy storage could not be read: ${error.message}` }; }
      if (!legacy.ok) return legacy;
      const current = repository.snapshot();
      if (current.migrations['legacy-v1']) return { ok: true, migrated: false, state: current, additions: [], conflicts: [], unresolved: [], baseRevision: current.revision };
      const migrated = migrateLegacy(emptyState(namespace), legacy.input, { ...migrationContext, at });
      return { ok: true, ...migrated, ...previewMerge(current, migrated.state), recovery: legacy.recovery, baseRevision: current.revision };
    },
    commitMigration(prepared, resolutions) {
      if (!prepared?.ok) return Promise.reject(new Error('Preview a valid migration first.'));
      return repository.update(current => {
        if (current.revision !== prepared.baseRevision) throw new Error('Tracking changed after the preview. Review the migration again.');
        return mergeBackup(current, prepared.state, resolutions, {at:new Date().toISOString(),eventId:crypto.randomUUID(),reason:'legacy migration'});
      });
    },
    exportBackup(at) { return createBackup(repository.snapshot(), at); },
    // This browser's tracking from before sharing, when it differed (see serverAdapter).
    earlierBackup(at) { const own = adapter.earlier?.(namespace); return own ? createBackup(own, at) : null; },
    previewBackup(json) {
      const incoming = parseBackup(json, namespace), current = repository.snapshot();
      return { incoming, ...previewMerge(current, incoming), baseRevision: current.revision };
    },
    importBackup(preview, resolutions) {
      return repository.update(current => {
        if (current.revision !== preview.baseRevision) throw new Error('Tracking changed after the preview. Review the backup again.');
        return mergeBackup(current, preview.incoming, resolutions, {at:new Date().toISOString(),eventId:crypto.randomUUID(),reason:'backup merge'});
      });
    },
  };
}

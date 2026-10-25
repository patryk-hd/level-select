import { emptyState, clone } from './domain.js';
import { validateState, previewMerge, mergeBackup } from './backup.js';

export class RevisionConflict extends Error {
  constructor() { super('Tracking changed in another tab. Reload the latest state before applying this change.'); this.name = 'RevisionConflict'; }
}

export function openDatabase(indexedDB, { name = 'retro-library-tracking', timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new Error('IndexedDB is unavailable.')); return; }
    const request = indexedDB.open(name, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('Tracking storage did not open. Close older tabs and retry.')); }, timeoutMs);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('workspaces')) request.result.createObjectStore('workspaces'); };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
    request.onblocked = () => { /* The timeout leaves the existing database intact. */ };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) { request.result.close(); return; }
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

export function indexedDBAdapter(db) {
  return {
    read(namespace) {
      emptyState(namespace);
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('workspaces', 'readonly');
        const request = transaction.objectStore('workspaces').get(namespace);
        transaction.oncomplete = () => resolve(request.result ?? null);
        transaction.onabort = () => reject(transaction.error ?? new Error('Storage read was interrupted.'));
        transaction.onerror = () => {}; // onabort reports the failed transaction once.
      });
    },
    compareAndSwap(namespace, revision, proposed) {
      const next = validateState(proposed);
      if (next.namespace !== namespace || next.revision !== revision + 1) return Promise.reject(new Error('Invalid commit revision.'));
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('workspaces', 'readwrite');
        const store = transaction.objectStore('workspaces');
        const request = store.get(namespace);
        let reason;
        request.onsuccess = () => {
          try {
            const current = request.result ? validateState(request.result) : emptyState(namespace);
            if (current.revision !== revision) throw new RevisionConflict();
            // No awaits between read and write: this transaction owns both.
            store.put(next, namespace);
          } catch (error) { reason = error; transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(clone(next));
        transaction.onabort = () => reject(reason ?? transaction.error ?? new Error('Storage commit was interrupted.'));
        transaction.onerror = () => {};
      });
    },
    // Other slots beside the workspaces (see serverAdapter): read and written as they are.
    getSlot(key) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('workspaces', 'readonly'), request = transaction.objectStore('workspaces').get(key);
        transaction.oncomplete = () => resolve(request.result ?? null);
        transaction.onabort = () => reject(transaction.error ?? new Error('Storage read was interrupted.'));
        transaction.onerror = () => {};
      });
    },
    putSlot(key, value) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('workspaces', 'readwrite');
        transaction.objectStore('workspaces').put(value, key);
        transaction.oncomplete = () => resolve(value);
        transaction.onabort = () => reject(transaction.error ?? new Error('Storage write was interrupted.'));
        transaction.onerror = () => {};
      });
    },
    close() { db.close(); },
  };
}

// Tracking kept by the Level Select app (scripts/tracking-store.mjs), shared by every browser
// on this computer and every paired phone. Each browser keeps a copy of it in its own slot.
// A browser that tracked games before sharing hands them over once: as the first copy, or
// merged in when nothing differs. When something does differ, its own tracking stays here,
// untouched, to export and merge by hand (Backup & import), and you're told.
export function serverAdapter({ fetch: get = globalThis.fetch, local = null, url = '/__retro_library/tracking', onNotice = () => {} } = {}) {
  const post = body => get(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Retro-Library': '1' }, body: JSON.stringify(body) });
  const mirror = (namespace, state) => local?.putSlot?.(`app-copy:${namespace}`, state).catch(() => {});
  const handed = namespace => local?.putSlot?.(`handed-over:${namespace}`, new Date().toISOString()).catch(() => {});
  const earlier = {};
  async function hand(namespace, shared) {
    const own = local ? await local.read(namespace).catch(() => null) : null;
    if (!own || await local.getSlot?.(`handed-over:${namespace}`).catch(() => null)) return shared;
    if (!shared) {
      const seeded = await (await post({ namespace, state: own, seed: true })).json();
      if (seeded.state && !seeded.conflict) { await handed(namespace); return seeded.state; }
      shared = seeded.state;
    }
    try {
      const preview = previewMerge(shared, own);
      if (preview.conflicts.length) throw new Error('differs');
      if (preview.additions.length) {
        const merged = mergeBackup(shared, own, {}, { at: new Date().toISOString(), eventId: crypto.randomUUID(), reason: 'this browser’s tracking joined the shared copy' });
        const response = await post({ namespace, base: shared.revision, state: { ...merged, revision: shared.revision + 1 } });
        if (!response.ok) return shared;
        shared = (await response.json()).state;
      }
      await handed(namespace);
    } catch {
      earlier[namespace] = own;
      onNotice('This browser kept its own tracking from before Level Select shared it, and some of it differs. Nothing is lost: Backup & import has a copy to download and merge.');
    }
    return shared;
  }
  return {
    async read(namespace) {
      const response = await get(`${url}?namespace=${encodeURIComponent(namespace)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('The Level Select app couldn’t read your tracking.');
      const state = await hand(namespace, (await response.json()).state);
      if (state) mirror(namespace, state);
      return state;
    },
    async compareAndSwap(namespace, revision, proposed) {
      const next = validateState(proposed);
      if (next.namespace !== namespace || next.revision !== revision + 1) throw new Error('Invalid commit revision.');
      const response = await post({ namespace, base: revision, state: next });
      if (response.status === 409) throw new RevisionConflict();
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'The Level Select app couldn’t save your tracking.');
      const saved = validateState((await response.json()).state);
      mirror(namespace, saved);
      return clone(saved);
    },
    // This browser's own tracking that differed from the shared copy (see hand).
    earlier: namespace => earlier[namespace] ? clone(earlier[namespace]) : null,
    close() { local?.close?.(); },
  };
}

// Is the Level Select app behind this page (not a static copy of it)? It answers this address.
export async function appKeepsTracking(get = globalThis.fetch, url = '/__retro_library/tracking') {
  try { const response = await get(`${url}?namespace=personal`, { cache: 'no-store' }); return response.ok && response.headers.get('content-type')?.includes('application/json'); }
  catch { return false; }
}

// All mutations are serialized in-tab; durable commits additionally check revisions.
// Failed writes retain an exportable draft, while the last durable state stays intact.
export async function createRepository({ adapter, namespace = 'personal', channel = null, onNotice = () => {} }) {
  let state = emptyState(namespace), draft = null, recovery = null, failure = null, closed = false;
  const listeners = new Set();
  let tail = Promise.resolve();
  const announce = detail => { for (const listener of listeners) { try { listener(detail); } catch { /* A view cannot turn a durable commit into a failure. */ } } };
  const notice = message => { try { onNotice(message); } catch { /* Reporting must not alter persistence. */ } };
  try {
    const raw = await adapter.read(namespace);
    if (raw !== null) {
      try { const loaded = validateState(raw); if (loaded.namespace !== namespace) throw new Error('Wrong workspace in storage.'); state = loaded; }
      catch (error) { recovery = raw; throw error; }
    }
  } catch (error) { failure = error; notice('Tracking storage could not be read. Existing data is preserved; new changes are session-only.'); }

  function enqueue(operation) {
    const result = tail.then(() => { if (closed) throw new Error('Tracking repository is closed.'); return operation(); });
    tail = result.catch(() => {}); return result;
  }
  async function refresh() {
    if (draft || failure) return false;
    const raw = await adapter.read(namespace);
    const next = raw === null ? emptyState(namespace) : validateState(raw);
    if (next.namespace !== namespace) throw new Error('Wrong workspace in storage.');
    if (next.revision > state.revision) { state = next; announce({ type: 'refresh', revision: state.revision }); return true; }
    return false;
  }
  const onMessage = message => {
    if (message.data?.namespace !== namespace || closed) return;
    enqueue(refresh).catch(() => notice('Another tab changed tracking. Refresh before editing.'));
  };
  channel?.addEventListener('message', onMessage);

  return {
    snapshot() { return clone(draft ?? state); },
    durableSnapshot() { return clone(state); },
    recovery() { return clone(recovery); },
    status() { return { revision: state.revision, sessionOnly: Boolean(failure || draft), hasRecovery: recovery !== null }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh() { return enqueue(refresh); },
    update(mutator) {
      return enqueue(async () => {
        const base = draft ?? state;
        const result = mutator(clone(base));
        if (result && typeof result.then === 'function') throw new Error('Tracking mutations must be synchronous.');
        const next = validateState({ ...result, revision: base.revision + 1 });
        if (next.namespace !== namespace) throw new Error('A mutation cannot change workspaces.');
        if (failure || draft) { draft = next; announce({ type: 'session' }); return { saved: false, state: clone(draft) }; }
        try {
          const committed = await adapter.compareAndSwap(namespace, state.revision, next);
          state = validateState(committed);
        } catch (error) {
          if (error instanceof RevisionConflict) { await refresh(); throw error; }
          failure = error; draft = next;
          notice('Changes are kept for this session. Export a tracking backup before leaving.');
          announce({ type: 'session' }); return { saved: false, state: clone(draft) };
        }
        announce({ type: 'commit', revision: state.revision });
        try { channel?.postMessage({ namespace, revision: state.revision }); } catch { /* Optional invalidation only. */ }
        return { saved: true, state: clone(state) };
      });
    },
    close() {
      // Finish any queued mutations before releasing the connection.
      return enqueue(() => { closed = true; channel?.removeEventListener('message', onMessage); channel?.close(); adapter.close?.(); listeners.clear(); });
    },
  };
}

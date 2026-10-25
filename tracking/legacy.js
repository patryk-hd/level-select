import { clone, emptyState, ensureTarget, instant, record, requireId, text, SECTIONS } from './domain.js';

export const LEGACY_KEYS = {
  collection: 'retro-library.collection.v1',
  overrides: 'playnite-overrides', removed: 'steam-wishlist-removed', notes: 'steam-wishlist-notes',
};

function map(value, label) {
  if (!record(value) || Object.keys(value).length > 20000) throw new Error(`Invalid ${label}. The existing data was kept.`);
  for (const id of Object.keys(value)) requireId(id);
  return value;
}
function flag(entry, key) {
  if (key in entry && typeof entry[key] !== 'boolean') throw new Error(`Invalid ${key} flag. The existing data was kept.`);
  return entry[key] === true;
}

// Does not write to or remove legacy storage. The complete migration is one commit.
export function migrateLegacy(current, input, { catalog = { games: [], systems: [] }, library = [], wishlist = [], at, migrationId = 'legacy-v1' } = {}) {
  instant(at); requireId(migrationId);
  if (Object.hasOwn(current.migrations, migrationId)) return { state: clone(current), migrated: false };
  if (SECTIONS.some(section => Object.keys(current[section]).length) || current.settings.pinnedSystems.length) throw new Error('Prepare legacy migration in an empty workspace, then preview its merge with existing tracking.');
  if (!record(input)) throw new Error('Invalid legacy migration input.');
  const state = clone(current);
  const catalogById = new Map(catalog.games.map(game => [game.id, game]));
  const ownedById = new Map(library.map(game => [game.id, game]));
  for (const game of library) for (const group of game.legacyGroups ?? []) if (!ownedById.has(group.id)) ownedById.set(group.id, group);
  const wishlistById = new Map(wishlist.map(game => [String(game.appid), game]));
  const collection = input.collection ?? { schemaVersion: 1, entries: {}, pinnedSystems: [] };
  if (!record(collection) || collection.schemaVersion !== 1 || !Array.isArray(collection.pinnedSystems) || collection.pinnedSystems.length > 1000) throw new Error('Invalid legacy recommendation collection.');
  map(collection.entries, 'recommendation entries');
  collection.pinnedSystems.forEach(requireId);
  state.settings.pinnedSystems = [...new Set([...state.settings.pinnedSystems, ...collection.pinnedSystems])];

  const catalogTarget = id => {
    const game = catalogById.get(id);
    return ensureTarget(state, { ref: { provider: 'catalog', id }, title: game?.title ?? `Unresolved recommendation (${id})`, platforms: game ? [game.systemId] : [], unresolved: !game });
  };
  const steamTarget = id => {
    if (!/^\d+$/.test(id)) throw new Error('Invalid Steam application identifier.');
    const game = wishlistById.get(id);
    return ensureTarget(state, { ref: { provider: 'steam', id }, title: game?.title ?? input.removed?.[id]?.title ?? `Unresolved Steam game (${id})`, platforms: ['PC'], unresolved: !game });
  };
  for (const [id, entry] of Object.entries(collection.entries)) {
    if (!record(entry)) throw new Error('Invalid recommendation entry.');
    const status = entry.status ?? 'untracked';
    if (!['untracked', 'backlog', 'playing', 'paused', 'completed', 'dropped'].includes(status)) throw new Error('Invalid legacy play status.');
    const favorite = flag(entry, 'favorite'), owned = flag(entry, 'owned'), wanted = flag(entry, 'wishlist');
    if (!favorite && !owned && !wanted && status === 'untracked') continue;
    const target = catalogTarget(id), source = { provider: 'catalog', id };
    const annotationId = `catalog:${id}`;
    state.annotations[annotationId] = { id: annotationId, targetId: target.id, source, favorite };
    if (owned) {
      const ownershipId = `manual:${id}`;
      state.ownership[ownershipId] = { id: ownershipId, targetId: target.id, evidence: 'manual', source, acquiredAt: null };
    }
    if (wanted) state.wishlist[target.id] = { targetId: target.id, decision: 'interested', decidedAt: null };
    if (status === 'backlog') state.backlog[target.id] = { targetId: target.id, priority: 0, queuedAt: null };
    if (['playing', 'paused', 'completed', 'dropped'].includes(status)) {
      const playId = `legacy:${id}`;
      state.playthroughs[playId] = { id: playId, targetId: target.id,
        status: { playing: 'playing', paused: 'paused', completed: 'finished', dropped: 'retired' }[status],
        objective: 'unspecified', objectiveText: '', startedAt: null, finishedAt: null, historical: true };
    }
  }
  for (const [id, edit] of Object.entries(map(input.overrides ?? {}, 'owned game edits'))) {
    if (!record(edit)) throw new Error('Invalid owned game edit.');
    const favorite = flag(edit, 'favorite'), hidden = flag(edit, 'hidden');
    if ('notes' in edit) text(edit.notes);
    const game = ownedById.get(id);
    // Group notes may refer to several copies/editions. Do not assign them to one.
    const target = ensureTarget(state, { ref: { provider: 'legacy-owned', id }, title: game?.name ?? `Unresolved owned game (${id})`, platforms: game?.platforms ?? [], unresolved: !game });
    const annotationId = `owned:${id}`;
    state.annotations[annotationId] = { id: annotationId, targetId: target.id, source: { provider: 'legacy-owned', id },
      ...('favorite' in edit ? { favorite } : {}), ...('hidden' in edit ? { hidden } : {}), ...('notes' in edit ? { notes: edit.notes } : {}) };
  }
  for (const [id, removal] of Object.entries(map(input.removed ?? {}, 'wishlist removals'))) {
    if (!record(removal)) throw new Error('Invalid wishlist removal.');
    text(removal.title, 500); text(removal.removedAt, 100);
    const target = steamTarget(id);
    state.wishlist[target.id] = { targetId: target.id, decision: 'archived', decidedAt: null, legacyRemovedAt: removal.removedAt };
  }
  for (const [id, note] of Object.entries(map(input.notes ?? {}, 'wishlist notes'))) {
    text(note);
    const target = steamTarget(id), annotationId = `steam:${id}`;
    state.annotations[annotationId] = { id: annotationId, targetId: target.id, source: { provider: 'steam', id }, notes: note };
  }
  state.migrations[migrationId] = { id: migrationId, recordedAt: at };
  // Historic imports do not manufacture a finish event, completion date or XP.
  return { state, migrated: true };
}

export function readLegacy(storage, namespace) {
  emptyState(namespace); // Validate the namespace before selecting any keys.
  const result = {}, recovery = {};
  for (const [section, key] of Object.entries(LEGACY_KEYS)) {
    // Recommendation tracking predates sample namespaces and is personal data.
    if (namespace === 'sample' && section === 'collection') continue;
    const selected = namespace === 'sample' ? `sample:${key}` : key;
    const raw = storage.getItem(selected);
    if (raw === null) continue;
    recovery[selected] = raw;
    try { result[section] = JSON.parse(raw); }
    catch { return { ok: false, recovery, error: `Unreadable saved data in ${selected}. Export a recovery copy before migrating.` }; }
  }
  return { ok: true, input: result, recovery };
}

// Import source facts by stable copy IDs, never by title or nonzero playtime.
export function ingestOwned(current, library) {
  if (!Array.isArray(library) || library.length > 50000) throw new Error('Invalid owned snapshot.');
  const state = clone(current), seen = new Set();
  for (const game of library) {
    text(game.name, 500);
    if (!Array.isArray(game.copies)) throw new Error('Owned snapshot has no copy records.');
    for (const copy of game.copies) {
      requireId(copy.id);
      if (seen.has(copy.id)) throw new Error('Duplicate Playnite copy identifier.');
      seen.add(copy.id);
      const source = { provider: 'playnite', id: copy.id };
      const target = ensureTarget(state, { ref: source, title: copy.name ?? game.name, platforms: copy.platforms });
      const id = `playnite:${copy.id}`;
      state.ownership[id] = { id, targetId: target.id, evidence: 'imported', source, acquiredAt: null,
        platforms: clone(copy.platforms), sources: clone(copy.sources), available: true };
    }
  }
  // Absence alone is not a destructive deletion or evidence that access ended.
  return state;
}

import { reviewProduct } from './products.js';
import { copyGroupNotes } from './group-notes.js';
import { openTracking } from './browser.js';
import { emptyState, ensureTarget, applyCommand, SECTIONS } from './domain.js';
import { migrateLegacy, readLegacy, ingestOwned } from './legacy.js';
import { previewMerge, createBackup, MAX_BACKUP_BYTES } from './backup.js';
import { validateEdits, platformKey, titleKey, connectLibrary } from '../library/core.js';
import { reviewLibraryMatch } from './matches.js';
import { collectionView, editsView, patchAnnotation, patchCatalog, confirmIdentity, setUpNext, moveInQueue } from './compat.js';
import { decideWishlist, startReview, reviewWishlist, compareWishlist, acquireWishlist } from './wishlist.js';
import { applyTriage, undoTriage } from './triage.js';
import { removeFromPlan, markPlayed, planPoint, restorePlanPoint } from './plan.js';
import { editPlaythrough, writeJournal } from './history.js';
import { enableRewards, rewardTransition, setRewardPreferences, saveWeeklyGoal, linkRewardIdentity, unlinkRewardIdentity, rewardTotal, rewardChanges, levelProgress, profileFor } from './rewards.js';
import { previewChallenge, substitutionPreview, acceptChallenge, archiveChallenge, challengeFacets, challengeListCounts } from './challenges.js';
import { addListGoal, removeListGoal, finishedCatalogIds, captureListAwards } from './goals.js';
import { buildSuggestionChoices } from './suggestions.js';

const stamp = () => ({ at: new Date().toISOString(), eventId: crypto.randomUUID() });
let cached, catalogRequest;
export function trackingClient() { return cached ??= initialize(); }
// The catalog, downloaded once per page however many modules ask for it.
export function loadCatalog() {
  return catalogRequest ??= fetch(new URL('../data/catalog.json', import.meta.url)).then(response => {
    if (!response.ok) throw new Error('The catalog could not be loaded.');
    return response.json();
  });
}
// A page that already ran a snapshot with a script tag (Library, Wishlist) isn't sent it again.
const snapshotModule = (global, url) => global in window ? Promise.resolve() : import(url);

async function initialize() {
  const messages = [];
  const announce = message => { messages.push(message); document.dispatchEvent(new CustomEvent('tracking-notice', { detail: message })); };
  // These are the existing generated, same-origin runtime snapshots, not user uploads. All
  // three download at once.
  const snapshots = Promise.allSettled([
    snapshotModule('PLAYNITE_LIBRARY', '../library/data/library-data.js'), snapshotModule('STEAM_WISHLIST', '../library/data/wishlist-data.js'),
  ]);
  const catalog = await loadCatalog();
  const results = await snapshots;
  const ownedSample = results[0].status === 'fulfilled' ? Boolean(window.PLAYNITE_SAMPLE) : null;
  const wishSample = results[1].status === 'fulfilled' ? Boolean(window.WISHLIST_SAMPLE) : null;
  const ownedPage = /\/library\/(?:index\.html)?$/.test(location.pathname);
  const wishPage = location.pathname.endsWith('/library/wishlist.html');
  // The public demo has no personal workspace: every page shows its sample library.
  const demo = Boolean(document.querySelector('meta[name="level-select-demo"]')) && ownedSample;
  const namespace = (demo || (ownedPage ? ownedSample : wishPage ? wishSample : new URLSearchParams(location.search).get('workspace') === 'sample')) ? 'sample' : 'personal';
  const library = (ownedSample === (namespace === 'sample') ? window.PLAYNITE_LIBRARY : []) ?? [];
  const wishlist = (wishSample === (namespace === 'sample') ? window.STEAM_WISHLIST : []) ?? [];
  const context = { catalog, library, wishlist };
  const catalogById = new Map(catalog.games.map(game => [game.id, game]));
  const wishById = new Map(wishlist.map(game => [String(game.appid), game]));
  const ownedById = new Map(library.map(game => [game.id, game]));
  const legacyGroupsById = new Map(library.flatMap(game => (game.legacyGroups ?? []).map(group => [group.id, group])));
  const copiesById = new Map(library.flatMap(game => game.copies.map(copy => [copy.id, { game, copy }])));
  const repository = await openTracking({ namespace, ...context, onNotice: announce });
  let pending = null, migrationError = '', legacyRecovery = {}, ready = false, matched = null, choices = null;
  // Challenge candidates by template, reused while the planner is open (see challenges.js).
  const challengeMemo = new Map();
  const listeners = new Set();
  // Every change to your tracking comes through here, so it drops what was built from it.
  const emit = change => { choices = null; challengeMemo.clear(); for (const listener of listeners) listener(change); };
  function snapshot() {
    const current = repository.snapshot();
    return pending && !SECTIONS.some(section => Object.keys(current[section]).length) && !current.settings.pinnedSystems.length ? structuredClone(pending.incoming) : current;
  }
  function descriptor(provider, id) {
    id = String(id);
    if (provider === 'catalog') {
      const game = catalogById.get(id);
      return { ref: { provider, id }, title: game?.title ?? `Unresolved recommendation (${id})`, platforms: game ? [game.systemId] : [], unresolved: !game };
    }
    if (provider === 'steam') {
      const game = wishById.get(id);
      return { ref: { provider, id }, title: game?.title ?? `Unresolved Steam game (${id})`, platforms: ['PC'], unresolved: !game };
    }
    const game = provider === 'legacy-owned' ? ownedById.get(id) ?? legacyGroupsById.get(id) : copiesById.get(id)?.game;
    const copy = provider === 'playnite' ? copiesById.get(id)?.copy : null;
    return { ref: { provider, id }, title: copy?.name ?? game?.name ?? `Unresolved owned game (${id})`, platforms: copy?.platforms ?? game?.platforms ?? [], unresolved: !game };
  }
  function prepareMigration() {
    migrationError = ''; legacyRecovery = {};
    const current = repository.snapshot();
    if (current.migrations['legacy-v1']) { ready = true; pending = null; return; }
    try {
      const legacy = readLegacy(localStorage, namespace); legacyRecovery = legacy.recovery;
      if (!legacy.ok) throw new Error(legacy.error);
      // Capture authored edits already embedded in a local snapshot too.
      const overrides = { ...legacy.input.overrides }, notes = { ...legacy.input.notes };
      for (const group of legacyGroupsById.values()) if (group.notes || group.favorite || group.hidden) overrides[group.id] = { favorite: Boolean(group.favorite), hidden: Boolean(group.hidden), notes: group.notes ?? '', ...overrides[group.id] };
      for (const game of library) if (game.notes || game.favorite || game.hidden) overrides[game.id] = { favorite: Boolean(game.favorite), hidden: Boolean(game.hidden), notes: game.notes ?? '', ...overrides[game.id] };
      for (const game of wishlist) if (game.note && !(String(game.appid) in notes)) notes[String(game.appid)] = game.note;
      const incoming = migrateLegacy(emptyState(namespace), { ...legacy.input, overrides, notes }, { ...context, at: stamp().at }).state;
      pending = { incoming, ...previewMerge(current, incoming), baseRevision: current.revision };
    } catch (error) { migrationError = error.message; ready = false; }
  }
  prepareMigration();
  async function commitMigration(resolutions = {}) {
    if (!pending) throw new Error(migrationError || 'No migration is waiting.');
    const preview = pending;
    const result = await repository.importBackup(preview, resolutions);
    pending = null; ready = true; emit({ type: 'migration' });
    return result;
  }
  // The upgrade only adds records (the original browser keys stay intact), so with no
  // conflicts there is nothing to decide: apply it rather than blocking every edit.
  if (pending && !pending.conflicts.length) await commitMigration();
  // The sidebar player card follows every change, including ones made in another tab.
  let shownTotal = null;
  function publishProgress() {
    const state = repository.snapshot(), level = levelProgress(state), gained = shownTotal === null ? 0 : level.total - shownTotal;
    shownTotal = level.total;
    const player = { level: level.level, title: level.title, total: level.total, within: level.within, span: level.span, visible: Boolean(profileFor(state) && state.settings.gamificationVisible) };
    document.dispatchEvent(new CustomEvent('tracking-progress', { detail: { player, gained } }));
  }
  repository.subscribe(change => {
    if (pending && repository.snapshot().migrations['legacy-v1']) { pending = null; ready = true; }
    emit(change);
    publishProgress();
  });
  async function update(mutator) {
    if (!ready) throw new Error(migrationError || 'Review your saved tracking in Backup & import before editing.');
    let gained = 0, levelUp = null, reasons = [];
    const result = await repository.update(before => {
      // List awards need the catalog, so they are recorded here; XP then follows from state.
      const audit = { ...stamp(), reason: 'local tracking change' };
      const after = rewardTransition(before, captureListAwards(before, mutator(structuredClone(before)), { catalog, library, at: audit.at }), audit);
      gained = rewardTotal(after) - rewardTotal(before);
      reasons = rewardChanges(before, after);
      const [was, now] = [levelProgress(before), levelProgress(after)];
      if (profileFor(after) && now.level > was.level) levelUp = { ...now, previousTitle: was.title };
      return after;
    });
    if (!result.saved) announce('Session only — export your tracking backup before leaving.');
    // Pages show a small "+XP" / level-up moment when rewards are visible.
    if (gained && repository.snapshot().settings.gamificationVisible) document.dispatchEvent(new CustomEvent('tracking-reward', { detail: { gained, levelUp, reasons } }));
    return result;
  }
  async function run(operation) {
    try { return await operation(); }
    catch (error) { announce(error.message); emit({ type: 'error' }); return null; }
  }
  // Progress rewards are on by default; "Hide progress rewards" under Progress still hides them.
  if (ready && !profileFor(repository.snapshot())) await run(() => update(state => enableRewards(state, { ...stamp(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })));
  const client = {
    namespace, catalog, library, wishlist, ownedSample, wishSample, messages, descriptor, snapshot, repository, run,
    status: () => ({ ...repository.status(), ready, migrationError, pending }),
    collection: () => collectionView(snapshot()), edits: () => editsView(snapshot()),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // Matching the library to the catalog is the slow part of a page (35–140 ms), and only your
    // match decisions change it while a page is open: reuse it until they do. Read-only.
    // Your owned games as suggestion choices, built from the whole library (100–500 ms).
    // Play's suggestions, triage and the challenge planner share one build until anything
    // changes. Read-only.
    suggestionChoices() { return choices ??= buildSuggestionChoices({ state: snapshot(), catalog, library }); },
    connections() {
      const reviews = snapshot().matchReviews, key = JSON.stringify(reviews ?? {});
      if (matched?.key !== key) matched = { key, value: connectLibrary(catalog, library, reviews) };
      return matched.value;
    },
    reviewProduct(options) { return update(state => reviewProduct(state, library, { ...options, at: stamp().at })); },
    reviewMatch(options) { return update(state => reviewLibraryMatch(state, context, { ...options, at: stamp().at })); },
    refreshMigration() { prepareMigration(); emit({ type: 'preview' }); }, commitMigration,
    recovery: () => ({ legacy: legacyRecovery, tracking: repository.recovery() }),
    backup: () => createBackup(snapshot(), stamp().at),
    exportableRecovery: () => Boolean(Object.keys(legacyRecovery).length || repository.recovery()),
    shared: Boolean(repository.shared),
    earlierBackup: () => repository.earlierBackup?.(stamp().at) ?? null,
    async triage(choice, decision, today) {
      let undo = null;
      const result = await update(state => { const next = applyTriage(state, choice, decision, { ...stamp(), today }); undo = next.undo; return next.state; });
      return result && { ...result, undo };
    },
    // Quick My plan actions: 'remove', 'finished' or 'retired'. Returns an undo point.
    async planAction(kind, targetId) {
      let point = null;
      const result = await update(state => {
        const target = state.targets[targetId]; if (!target) throw new Error('This game is no longer in your plan.');
        point = planPoint(state, [targetId]);
        const { at, eventId } = stamp();
        if (kind === 'remove') return removeFromPlan(state, targetId, { at, eventId });
        return markPlayed(state, { ref: target.refs[0], title: target.title, platforms: target.platforms }, kind, { at, eventIds: [eventId, `${eventId}:2`, `${eventId}:3`], playthroughId: `plan:${eventId}` }).state;
      });
      return result && { ...result, point };
    },
    undoPlanAction(targetId, point) { return update(state => restorePlanPoint(state, point, stamp())); },
    undoTriage(choice, undo) { return update(state => undoTriage(state, choice, undo, stamp())); },
    annotate(provider, id, patch, expected) { return update(state => patchAnnotation(state, descriptor(provider, id), patch, expected)); },
    copyGroupNotes(options) { return update(state => copyGroupNotes(state, library, options)); },
    flag(id, patch) { return update(state => patchCatalog(state, descriptor('catalog', id), patch, stamp())); },
    pin(id) { return update(state => { const pins = state.settings.pinnedSystems; state.settings.pinnedSystems = pins.includes(id) ? pins.filter(pin => pin !== id) : [...pins, id]; return state; }); },
    removeWishlist(ids, removed) {
      return update(state => {
        for (const id of ids) {
          const target = ensureTarget(state, descriptor('steam', id));
          if (state.wishlist[target.id]?.decision === 'acquired') continue;
          state = applyCommand(state, { ...stamp(), type: 'wishlist', targetId: target.id, decision: removed ? 'archived' : 'interested' });
        }
        return state;
      });
    },
    decideWishlist(id, options) { return update(state => decideWishlist(state, descriptor('steam', id), { ...options, ...stamp() })); },
    startReview(ids, today) { return update(state => startReview(state, ids.map(id => descriptor('steam', id)), { sessionId: crypto.randomUUID(), today, ...stamp() })); },
    reviewWishlist(options) { return update(state => reviewWishlist(state, { ...options, ...stamp() })); },
    undoReview(sessionId) {
      return update(state => {
        const session = state.reviewSessions[sessionId];
        const event = Object.values(session?.reviewed ?? {}).map(id => state.events[id]).sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0))[0];
        if (!event) throw new Error('There is no review decision to undo.');
        return applyCommand(state, { ...stamp(), type: 'undo', targetId: event.targetId, undoEventId: event.id });
      });
    },
    compareWishlist(ids, options) { return update(state => compareWishlist(state, ids.map(id => descriptor('steam', id)), { ...options, ...stamp() })); },
    acquireWishlist(id, options) { return update(state => acquireWishlist(state, descriptor('steam', id), { ...options, ...stamp() })); },
    editPlaythrough(id, options) { return update(state => editPlaythrough(state, id, { ...options, ...stamp() })); },
    writeJournal(id, options) { return update(state => writeJournal(state, id, { ...options, ...stamp() })); },
    previewChallenge(options) { return previewChallenge(challengeContext(), options, { ...stamp(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }); },
    previewSubstitution(id, cellId) { return substitutionPreview(challengeContext(), id, cellId, { ...stamp(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }); },
    acceptChallenge(preview, { confirmed, previousId = null, reason = 'accepted' } = {}) {
      return update(state => acceptChallenge(state, preview, { confirmed, previousId, reason, id: previousId ?? crypto.randomUUID(), revisionId: crypto.randomUUID(), ...stamp() }));
    },
    archiveChallenge(id, expected) { return update(state => archiveChallenge(state, id, expected)); },
    challengeFacets(options) { return challengeFacets(challengeContext(), options); },
    challengeListCounts(templateId) { return challengeListCounts(challengeContext(), templateId); },
    addListGoal(goal) { return update(state => addListGoal(state, goal, { id: crypto.randomUUID(), at: stamp().at })); },
    removeListGoal(id) { return update(state => removeListGoal(state, id)); },
    finishedCatalogIds() { return finishedCatalogIds(snapshot(), catalog, library, client.connections()); },
    enableRewards() { return update(state => enableRewards(state, { ...stamp(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })); },
    rewardPreferences(options) { return update(state => setRewardPreferences(state, options)); },
    saveWeeklyGoal(options) { return update(state => saveWeeklyGoal(state, { ...options, ...stamp() })); },
    previewRewardLink(options) {
      const state = snapshot(), audit = stamp();
      const proposed = options.id ? unlinkRewardIdentity(state, { id: options.id, ...audit }) : linkRewardIdentity(state, { ...options, confirmed: true, ...audit });
      return { options, baseRevision: state.revision, before: rewardTotal(state), after: rewardTotal(proposed) };
    },
    confirmRewardLink(preview, confirmed) {
      return update(state => {
        if (confirmed !== true) throw new Error('Confirm the reviewed identity change.');
        if (state.revision !== preview.baseRevision) throw new Error('Tracking changed. Preview the XP adjustment again before confirming.');
        return preview.options.id ? unlinkRewardIdentity(state, { id: preview.options.id, ...stamp() }) : linkRewardIdentity(state, { ...preview.options, confirmed, ...stamp() });
      });
    },
    // "Mark finished" from any game dialog: today (dated, a main-game finish that can earn
    // XP) or some time ago (no dates, like "Already played").
    markFinished(desc, { dated }) {
      return update(state => {
        if (desc.ref.provider === 'playnite') {
          const game = copiesById.get(desc.ref.id)?.game;
          if (game) state = ingestOwned(state, [{ ...game, copies: game.copies.filter(copy => copy.id === desc.ref.id) }]);
        }
        const { at, eventId } = stamp(), target = ensureTarget(state, desc);
        if (!dated) return markPlayed(state, desc, 'finished', { at, eventIds: [eventId, `${eventId}:2`, `${eventId}:3`], playthroughId: crypto.randomUUID() }).state;
        const waiting = Object.values(state.playthroughs).find(play => play.targetId === target.id && play.status === 'not-started');
        const id = waiting?.id ?? crypto.randomUUID();
        state = waiting
          ? applyCommand(state, { type: 'status', targetId: target.id, playthroughId: id, status: 'playing', objective: 'main-game', at, eventId })
          : applyCommand(state, { type: 'start', targetId: target.id, playthroughId: id, objective: 'main-game', playedSource: desc.ref, playedPlatforms: desc.platforms ?? [], at, eventId });
        return applyCommand(state, { type: 'status', targetId: target.id, playthroughId: id, status: 'finished', at, eventId: `${eventId}:2` });
      });
    },
    action(desc, type, fields = {}) {
      return update(state => {
        const target = ensureTarget(state, desc);
        if (desc.ref.provider === 'playnite') {
          const game = copiesById.get(desc.ref.id)?.game;
          if (game) state = ingestOwned(state, [{ ...game, copies: game.copies.filter(copy => copy.id === desc.ref.id) }]);
        }
        return applyCommand(state, { ...stamp(), playedSource: desc.ref, playedPlatforms: desc.platforms, ...fields, type, targetId: target.id });
      });
    },
    upNext(desc, enabled) { return update(state => setUpNext(state, desc, enabled, stamp())); },
    move(targetId, direction) { return update(state => moveInQueue(state, targetId, direction)); },
    link(first, second) { return update(state => confirmIdentity(state, first, second, stamp())); },
    // A wishlist size target, remembered with the size it started from; null clears it.
    setWishlistGoal(goal, from) {
      return update(state => {
        if (goal === null) { delete state.settings.wishlistGoal; delete state.settings.wishlistGoalFrom; return state; }
        if (![goal, from].every(value => Number.isInteger(value) && value >= 0 && value <= 100000) || goal >= from) throw new Error('Choose a goal smaller than your current wishlist.');
        state.settings.wishlistGoal = goal; state.settings.wishlistGoalFrom = from; return state;
      });
    },
    setLimits(upNextLimit, playingLimit) { return update(state => { state.settings.upNextLimit = upNextLimit; state.settings.playingLimit = playingLimit; return state; }); },
    linkCandidates(desc) {
      if (desc.ref.provider === 'playnite') return Object.values(client.connections().candidatesByRelease).flat().filter(match => match.copyId === desc.ref.id && match.sameSystem && !['rejected','changed','unavailable'].includes(match.status)).map(match => descriptor('catalog', match.catalogId));
      if (desc.ref.provider === 'steam') return library.filter(game => titleKey(game.name) === titleKey(desc.title)).flatMap(game => game.copies.filter(copy => copy.platforms.some(platform => platformKey(platform) === 'dos')).map(copy => descriptor('playnite', copy.id)));
      return [];
    },
    previewBackup(json) {
      if (new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) throw new Error('Choose a backup smaller than 5 MB.');
      const value = JSON.parse(json);
      if (value.format === 'retro-library-tracking') return repository.previewBackup(json);
      const input = value.schemaVersion === 1 ? { collection: value } : validateEdits(value);
      const incoming = migrateLegacy(emptyState(namespace), input, { ...context, at: stamp().at }).state;
      delete incoming.migrations['legacy-v1'];
      return { incoming, ...previewMerge(repository.snapshot(), incoming), baseRevision: repository.snapshot().revision, legacy: true };
    },
    async importBackup(preview, resolutions) {
      if (!ready) throw new Error('Complete the saved-data migration before merging another backup.');
      return repository.importBackup(preview, resolutions);
    },
  };
  // Changes made elsewhere are picked up when you come back to the page, including a page
  // restored with Back or one loaded ahead when you pointed at its link (navigation.js).
  const catchUp = () => repository.refresh().catch(error => announce(error.message));
  window.addEventListener('focus', catchUp);
  window.addEventListener('pageshow', event => { if (event.persisted) catchUp(); });
  document.addEventListener('prerenderingchange', catchUp);
  publishProgress();
  // The planner's inputs: your library's suggestion choices and catalog matches, cached.
  function challengeContext() { return { ...context, state: snapshot(), choices: client.suggestionChoices(), connections: client.connections(), memo: challengeMemo }; }
  return client;
}

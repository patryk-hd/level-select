import { PRODUCT_SECTIONS, validateProductReviews } from './products.js';
import { clone, emptyState, instant, record, referenceKey, requireId, text, SECTIONS, PLAY_STATUSES, DECISIONS, wishlistFields, validateTriage } from './domain.js';
import { validatePlayDetails, validateJournalEntry } from './history.js';
import { REWARD_SECTIONS, validateRewards, reconcileRewards, mergeRewardProfiles, profileFor } from './rewards.js';

import { CHALLENGE_SECTIONS, validateChallenges } from './challenges.js';
import { MATCH_SECTIONS, validateMatchReviews } from './matches.js';
import { validateListGoals, mergeListGoals, validateListAwards } from './goals.js';

export const BACKUP_FORMAT = 'retro-library-tracking';
export const MAX_BACKUP_BYTES = 5_000_000;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const bool = value => assert(typeof value === 'boolean', 'Invalid boolean field.');
const list = (value, max) => assert(Array.isArray(value) && value.length <= max, 'Invalid or oversized list.');

// Bound the entire tree, including event payloads, before interpreting any fields.
function bounded(value, depth = 0, budget = { remaining: 150000 }) {
  assert(depth < 20 && --budget.remaining >= 0, 'Tracking data is too complex.');
  if (typeof value === 'string') text(value);
  else if (typeof value === 'number') assert(Number.isFinite(value), 'Invalid numeric field.');
  else if (Array.isArray(value)) { list(value, 50000); value.forEach(item => bounded(item, depth + 1, budget)); }
  else if (record(value)) for (const [key, item] of Object.entries(value)) { requireId(key); bounded(item, depth + 1, budget); }
  else assert(value === null || typeof value === 'boolean', 'Invalid field type.');
}
export function validateState(value) {
  bounded(value);
  assert(record(value), 'Invalid tracking state.');
  assert([1, 2, 3, 4, 5, 6, 7, 8].includes(value.schemaVersion), 'Unsupported tracking schema version.');
  value = clone(value);
  if (value.schemaVersion === 1) { assert(!('reviewSessions' in value), 'Review sessions need schema version 2.'); value.schemaVersion = 2; value.reviewSessions = {}; }
  if (value.schemaVersion === 2) { assert(!('journalEntries' in value), 'Journal entries need schema version 3.'); value.schemaVersion = 3; value.journalEntries = {}; }
  if (value.schemaVersion === 3) {
    for (const section of REWARD_SECTIONS) { assert(!(section in value), 'Rewards need schema version 4.'); value[section]={}; }
    value.schemaVersion=4;
  }
  if (value.schemaVersion === 4) {
    for (const section of CHALLENGE_SECTIONS) { assert(!(section in value), 'Challenges need schema version 5.'); value[section]={}; }
    value.schemaVersion=5;
  }
  if (value.schemaVersion === 5) {
    for (const section of MATCH_SECTIONS) { assert(!(section in value), 'Library matches need schema version 6.'); value[section] = {}; }
    value.schemaVersion = 6;
  }
  if (value.schemaVersion === 6) {
    for (const section of PRODUCT_SECTIONS) { assert(!(section in value), 'Product reviews need schema version 7.'); value[section] = {}; }
    value.schemaVersion = 7;
  }
  if (value.schemaVersion === 7) {
    assert(!('listAwards' in value), 'List awards need schema version 8.'); value.listAwards = {};
    value.schemaVersion = 8;
  }
  emptyState(value.namespace);
  const allowed = new Set(['schemaVersion', 'namespace', 'revision', 'settings', ...SECTIONS]);
  assert(Object.keys(value).every(key => allowed.has(key)), 'This state contains unsupported sections. Keep the original backup.');
  assert(Number.isSafeInteger(value.revision) && value.revision >= 0, 'Invalid state revision.');
  for (const section of SECTIONS) {
    assert(record(value[section]) && Object.keys(value[section]).length <= 50000, `Invalid ${section} section.`);
  }
  const target = id => { requireId(id); assert(Object.hasOwn(value.targets, id), 'A record refers to a missing tracking target.'); };
  const refs = new Set();
  for (const [id, entry] of Object.entries(value.targets)) {
    assert(record(entry) && entry.id === id, 'Invalid target record.');
    text(entry.title, 500); list(entry.platforms, 100); entry.platforms.forEach(item => text(item, 200));
    bool(entry.unresolved); list(entry.refs, 100); assert(entry.refs.length > 0, 'A target needs a source reference.');
    for (const ref of entry.refs) {
      const key = referenceKey(ref);
      if ('confirmedAt' in ref) instant(ref.confirmedAt);
      if ('matchMethod' in ref) assert(ref.matchMethod === 'user-confirmed', 'Invalid identity confirmation.');
      assert(!refs.has(key), 'A source reference belongs to more than one target.'); refs.add(key);
    }
  }
  for (const [id, entry] of Object.entries(value.ownership)) {
    assert(record(entry) && entry.id === id, 'Invalid ownership record.'); target(entry.targetId);
    assert(['manual', 'imported'].includes(entry.evidence), 'Invalid ownership evidence.');
    referenceKey(entry.source); instant(entry.acquiredAt, true);
    if ('available' in entry) bool(entry.available);
    for (const key of ['platforms', 'sources']) if (key in entry) { list(entry[key], 100); entry[key].forEach(item => text(item, 200)); }
  }
  for (const [id, entry] of Object.entries(value.wishlist)) {
    assert(record(entry) && entry.targetId === id, 'Invalid wishlist record.'); target(id);
    assert(DECISIONS.includes(entry.decision), 'Invalid wishlist decision.'); instant(entry.decidedAt, true);
    if ('legacyRemovedAt' in entry) text(entry.legacyRemovedAt, 100);
    wishlistFields(Object.fromEntries(['priority', 'reason', 'reviewOn', 'snoozeUntil', 'reviewedAt', 'acquiredAt', 'targetPrice'].filter(key => key in entry).map(key => [key, entry[key]])));
  }
  for (const [id, entry] of Object.entries(value.backlog)) {
    assert(record(entry) && entry.targetId === id, 'Invalid backlog record.'); target(id);
    assert(Number.isInteger(entry.priority) && entry.priority >= 0 && entry.priority <= 3, 'Invalid priority.'); instant(entry.queuedAt, true);
    if ('upNext' in entry) bool(entry.upNext);
    if ('position' in entry) assert(Number.isSafeInteger(entry.position) && entry.position >= 0, 'Invalid queue position.');
  }
  const active = new Set();
  for (const [id, play] of Object.entries(value.playthroughs)) {
    assert(record(play) && play.id === id, 'Invalid playthrough record.'); target(play.targetId);
    assert(PLAY_STATUSES.includes(play.status), 'Invalid playthrough status.');
    assert(['unspecified', 'main-game', 'personal'].includes(play.objective), 'Invalid objective.'); text(play.objectiveText, 1000);
    instant(play.startedAt, true); instant(play.finishedAt, true); bool(play.historical);
    validatePlayDetails(play);
    if (play.playedSource) assert(value.targets[play.targetId].refs.some(ref => referenceKey(ref) === referenceKey(play.playedSource)), 'Played copy must belong to its tracking target.');
    assert(play.finishedAt === null || play.status === 'finished', 'Only a finished playthrough can have a finish date.');
    assert(!play.startedAt || !play.finishedAt || play.startedAt <= play.finishedAt, 'Finish date precedes start date.');
    if (['playing', 'paused', 'not-started'].includes(play.status)) {
      assert(!active.has(play.targetId), 'Conflicting active playthroughs need review.'); active.add(play.targetId);
    }
  }
  for (const [id, entry] of Object.entries(value.events)) {
    assert(record(entry) && entry.id === id, 'Invalid event record.'); target(entry.targetId);
    assert(['queue', 'unqueue', 'wishlist', 'start', 'status', 'undo', 'upnext', 'acquire', 'play-edit', 'journal', 'triage'].includes(entry.type), 'Invalid event type.');
    if ('sequence' in entry) assert(Number.isSafeInteger(entry.sequence) && entry.sequence > 0, 'Invalid event sequence.');
    instant(entry.recordedAt); instant(entry.occurredAt, true); assert(record(entry.details), 'Invalid event details.');
    if (entry.type === 'undo') {
      const original = value.events[requireId(entry.details.undoneEventId)];
      assert(original && original.id !== id && original.targetId === entry.targetId, 'Undo refers to a missing or different event.');
    }
    if (entry.details.playthroughId) {
      const play = value.playthroughs[entry.details.playthroughId];
      assert(play && play.targetId === entry.targetId, 'Event refers to a missing or different playthrough.');
    }
    if (entry.type === 'journal') {
      const note = value.journalEntries[entry.details.entryId];
      assert(note && note.playthroughId === entry.details.playthroughId, 'Journal event refers to a missing or different entry.');
    }
  }
  for (const [id, entry] of Object.entries(value.journalEntries)) {
    validateJournalEntry(entry); assert(entry.id === id, 'Invalid journal identity.');
    assert(value.playthroughs[entry.playthroughId]?.targetId === entry.targetId, 'Journal entry refers to a missing or different playthrough.');
  }
  for (const [id, entry] of Object.entries(value.annotations)) {
    assert(record(entry) && entry.id === id, 'Invalid annotation record.'); target(entry.targetId); referenceKey(entry.source);
    for (const key of ['favorite', 'hidden']) if (key in entry) bool(entry[key]);
    if ('notes' in entry) text(entry.notes);
    if ('triage' in entry) validateTriage(entry.triage);
    if ('enjoyed' in entry) assert(['yes', 'no', 'unplayed'].includes(entry.enjoyed), 'Invalid enjoyment answer.');
  }
  for (const [id, entry] of Object.entries(value.migrations)) {
    assert(record(entry) && entry.id === id, 'Invalid migration record.'); instant(entry.recordedAt);
  }
  const undoneEvents = new Set(Object.values(value.events).filter(event => event.type === 'undo').map(event => event.details.undoneEventId));
  let activeReview = 0;
  for (const [id, session] of Object.entries(value.reviewSessions)) {
    assert(record(session) && session.id === id, 'Invalid review session.');
    list(session.targetIds, 10); assert(session.targetIds.length > 0 && new Set(session.targetIds).size === session.targetIds.length, 'Review sessions need distinct games.');
    session.targetIds.forEach(target); instant(session.startedAt); instant(session.completedAt, true);
    assert(record(session.reviewed), 'Invalid reviewed games.');
    for (const [targetId, eventId] of Object.entries(session.reviewed)) {
      const event = value.events[requireId(eventId)];
      assert(session.targetIds.includes(targetId) && event?.targetId === targetId && event.type === 'wishlist' && event.details.reviewSessionId === id, 'Review progress must refer to its original decision event.');
      assert(!undoneEvents.has(eventId), 'An undone review cannot count toward session progress.');
    }
    assert(Boolean(session.completedAt) === (Object.keys(session.reviewed).length === session.targetIds.length), 'Review completion must match the distinct reviewed games.');
    if (!session.completedAt) activeReview++;
  }
  assert(activeReview <= 1, 'Conflicting active review sessions need review before merging.');
  for (const event of Object.values(value.events)) if (event.details.reviewSessionId) {
    const session = value.reviewSessions[event.details.reviewSessionId];
    assert(session?.targetIds.includes(event.targetId), 'Review event refers to a missing session or game.');
  }
  assert(record(value.settings), 'Invalid settings.'); list(value.settings.pinnedSystems, 1000);
  assert(Object.keys(value.settings).every(key => ['pinnedSystems', 'gamificationVisible', 'upNextLimit', 'playingLimit', 'wishlistGoal', 'wishlistGoalFrom', 'listGoals'].includes(key)), 'Unsupported tracking settings. Keep the original backup.');
  validateListGoals(value.settings.listGoals);
  for (const key of ['upNextLimit', 'playingLimit']) if (key in value.settings) assert(Number.isInteger(value.settings[key]) && value.settings[key] >= 1 && value.settings[key] <= 50, 'Choose a suggested limit between 1 and 50.');
  for (const key of ['wishlistGoal', 'wishlistGoalFrom']) if (key in value.settings) assert(Number.isInteger(value.settings[key]) && value.settings[key] >= 0 && value.settings[key] <= 100000, 'Invalid wishlist goal.');
  value.settings.pinnedSystems.forEach(requireId); bool(value.settings.gamificationVisible);
  validateChallenges(value);
  validateListAwards(value);
  validateRewards(value);
  validateMatchReviews(value);
  validateProductReviews(value);
  assert(new TextEncoder().encode(JSON.stringify(value)).length <= MAX_BACKUP_BYTES - 500, 'Tracking storage exceeds the portable backup limit.');
  return clone(value);
}

export function createBackup(state, exportedAt) {
  instant(exportedAt);
  return { format: BACKUP_FORMAT, version: 8, exportedAt, state: validateState(state) };
}
export function parseBackup(json, namespace) {
  assert(typeof json === 'string' && new TextEncoder().encode(json).length <= MAX_BACKUP_BYTES, 'Choose a tracking backup smaller than 5 MB.');
  const value = JSON.parse(json);
  assert(record(value) && value.format === BACKUP_FORMAT && [1, 2, 3, 4, 5, 6, 7, 8].includes(value.version), 'Choose a supported tracking backup.');
  instant(value.exportedAt);
  const state = validateState(value.state);
  assert(state.namespace === namespace, 'Sample and personal backups must stay in their own workspace.');
  return state;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function previewMerge(current, incoming) {
  current = validateState(current); incoming = validateState(incoming);
  assert(current.namespace === incoming.namespace, 'Sample and personal backups must stay in their own workspace.');
  if (profileFor(current)&&profileFor(incoming)) assert(profileFor(current).timeZone===profileFor(incoming).timeZone,'Reward calendars use different timezones. Restore this backup in a separate browser workspace.');
  const conflicts = [], additions = [];
  for (const section of SECTIONS) for (const [id, entry] of Object.entries(incoming[section])) {
    if (!Object.hasOwn(current[section], id)) additions.push({ section, id });
    else if (section!=='rewardLedger' && stable(current[section][id]) !== stable(entry)) conflicts.push({ section, id, current: clone(current[section][id]), incoming: clone(entry) });
  }
  if (['gamificationVisible', 'upNextLimit', 'playingLimit', 'wishlistGoal', 'wishlistGoalFrom'].some(key => current.settings[key] !== incoming.settings[key])) conflicts.push({ section: 'settings', id: 'settings', current: clone(current.settings), incoming: clone(incoming.settings) });
  return { additions, conflicts, unresolved: Object.values(incoming.targets).filter(target => target.unresolved).map(target => ({ id: target.id, title: target.title })) };
}

// Every conflicting record needs an explicit choice; history is not overwritten by default.
export function mergeBackup(current, incoming, resolutions = {}, audit) {
  current = validateState(current); incoming = validateState(incoming);
  const preview = previewMerge(current, incoming), state = clone(current);
  for (const { section, id } of preview.additions) state[section][id] = clone(incoming[section][id]);
  for (const conflict of preview.conflicts) {
    const key = `${conflict.section}/${conflict.id}`, choice = resolutions[key];
    assert(['current', 'incoming'].includes(choice), `Choose which value to keep for ${key}.`);
    if (['events','rewardEvidence','rewardAdjustments','challengeRevisions','challengeEvidence','challengeAwards','listAwards'].includes(conflict.section)) assert(choice === 'current', 'Existing history events cannot be replaced. Keep the original event.');
    if (conflict.section === 'settings') state.settings = clone(conflict[choice]);
    else state[conflict.section][conflict.id] = clone(conflict[choice]);
  }
  state.settings.pinnedSystems = [...new Set([...current.settings.pinnedSystems, ...incoming.settings.pinnedSystems])];
  const goals = mergeListGoals(current.settings.listGoals, incoming.settings.listGoals);
  if (goals.length) state.settings.listGoals = goals; else delete state.settings.listGoals;
  // This also catches duplicate source references and conflicting active replays.
  return validateState(reconcileRewards(mergeRewardProfiles(current,incoming,state), audit));
}

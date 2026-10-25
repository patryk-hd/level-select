import { clone, record, requireId, text, instant, calendarDate, PLAY_STATUSES, referenceKey, recordEvent, stableJSON } from './domain.js';
import { playHistory } from './compat.js';
import { platformKey } from '../library/core.js';

const check = (condition, message) => { if (!condition) throw new Error(message); };
export const objectiveLabel = play => play.objectiveText || ({ 'main-game': 'Main game', personal: 'Personal objective', unspecified: 'Unspecified objective' })[play.objective];
export function validatePlayDetails(play) {
  if ('minutesPlayed' in play) check(play.minutesPlayed === null || Number.isSafeInteger(play.minutesPlayed) && play.minutesPlayed >= 0 && play.minutesPlayed <= 6_000_000, 'Enter a valid playthrough time or leave it unknown.');
  if ('rating' in play) check(play.rating === null || Number.isFinite(play.rating) && play.rating >= 0 && play.rating <= 5 && Number.isInteger(play.rating * 2), 'Choose a rating from 0 to 5 in half-star steps.');
  if ('reflection' in play) text(play.reflection, 10000);
  if ('ordinal' in play) check(Number.isSafeInteger(play.ordinal) && play.ordinal > 0, 'Invalid playthrough order.');
  if ('playedSource' in play) referenceKey(play.playedSource);
  if ('playedPlatforms' in play) {
    check(Array.isArray(play.playedPlatforms) && play.playedPlatforms.length <= 100, 'Invalid played platforms.');
    play.playedPlatforms.forEach(platform => text(platform, 200));
  }
  if ('endedAt' in play) {
    instant(play.endedAt, true);
    check(!play.endedAt || play.status === 'retired', 'Only retirement can have a retirement date.');
    check(!play.startedAt || !play.endedAt || play.startedAt <= play.endedAt, 'Retirement date precedes start date.');
  }
}

export function editPlaythrough(current, playthroughId, { expected, fields, at, eventId }) {
  const state = clone(current), play = state.playthroughs[requireId(playthroughId)];
  check(play, 'This playthrough is missing.');
  check(expected !== undefined && stableJSON(play) === stableJSON(expected), 'This playthrough changed in another tab. Your draft is kept; reopen it to review the current record.');
  check(record(fields), 'Invalid playthrough details.');
  const allowed = ['status', 'objective', 'objectiveText', 'startedAt', 'finishedAt', 'endedAt', 'minutesPlayed', 'rating', 'reflection'];
  check(Object.keys(fields).every(key => allowed.includes(key)), 'Unsupported playthrough field.');
  const previous = clone(play);
  Object.assign(play, clone(fields));
  check(PLAY_STATUSES.includes(play.status), 'Invalid play status.');
  check(['unspecified', 'main-game', 'personal'].includes(play.objective), 'Invalid objective.');
  text(play.objectiveText, 1000); instant(play.startedAt, true); instant(play.finishedAt, true);
  if (play.status !== 'finished') play.finishedAt = null;
  if (play.status !== 'retired') play.endedAt = null;
  check(!play.finishedAt || !play.startedAt || play.startedAt <= play.finishedAt, 'Finish date precedes start date.');
  check(!['playing', 'paused', 'not-started'].includes(play.status) || !Object.values(state.playthroughs).some(other => other.id !== play.id && other.targetId === play.targetId && ['playing', 'paused', 'not-started'].includes(other.status)), 'Another playthrough is active. Finish or retire that replay before reopening this one.');
  validatePlayDetails(play);
  recordEvent(state, { type: 'play-edit', targetId: play.targetId, at, eventId }, { playthroughId, previous, result: clone(play) });
  return state;
}

export function validateJournalEntry(entry) {
  check(record(entry), 'Invalid journal entry.');
  requireId(entry.id); requireId(entry.targetId); requireId(entry.playthroughId);
  check(['note', 'milestone', 'mastery'].includes(entry.kind), 'Choose a note, milestone or mastery objective.');
  text(entry.text, 5000); check(entry.text.trim().length > 0, 'Write a note or milestone.');
  calendarDate(entry.occurredOn, true); instant(entry.createdAt); instant(entry.updatedAt); instant(entry.deletedAt, true);
  check(typeof entry.achieved === 'boolean' && (entry.kind !== 'note' || !entry.achieved), 'Only milestones and mastery objectives can be marked achieved.');
}
export function writeJournal(current, playthroughId, { entryId, expected, kind, text: body, occurredOn = null, achieved = false, deleted = false, at, eventId }) {
  const state = clone(current), play = state.playthroughs[requireId(playthroughId)];
  check(play, 'This playthrough is missing.'); requireId(entryId);
  const previous = state.journalEntries[entryId] ?? null;
  check(expected !== undefined && stableJSON(previous) === stableJSON(expected), 'This journal entry changed in another tab. Your draft is kept.');
  check(!previous || previous.playthroughId === playthroughId, 'This entry belongs to another playthrough.');
  const entry = { id: entryId, targetId: play.targetId, playthroughId, kind, text: body, occurredOn, achieved,
    createdAt: previous?.createdAt ?? at, updatedAt: at, deletedAt: deleted ? at : null };
  validateJournalEntry(entry); state.journalEntries[entryId] = entry;
  recordEvent(state, { type: 'journal', targetId: play.targetId, at, eventId }, { playthroughId, entryId, previous: clone(previous), result: clone(entry) });
  return state;
}

export function dateYear(value, timeZone) {
  if (!value) return 'unknown';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(new Date(value));
}
export const endDate = play => play.status === 'finished' ? play.finishedAt : play.status === 'retired' ? play.endedAt ?? null : play.startedAt;
export function planStats(state) {
  const members = Object.keys(state.backlog);
  const statuses = members.map(id => playHistory(state, id)[0]?.status ?? 'not-started');
  const finished = statuses.filter(status => status === 'finished').length, retired = statuses.filter(status => status === 'retired').length;
  return { total: members.length, finished, retired, remaining: members.length - finished - retired, completion: members.length ? finished / members.length : null };
}
function membershipDelta(event) {
  if (event.type === 'queue') return event.details.previous ? 0 : 1;
  if (event.type === 'unqueue') return event.details.previous ? -1 : 0;
  if (event.type === 'upnext') return Object.hasOwn(event.details, 'previous') ? (event.details.previous ? 0 : 1) : null;
  return 0;
}
export function membershipChanges(state, year = 'all', timeZone) {
  let added = 0, removed = 0, unknown = 0;
  for (const event of Object.values(state.events)) {
    if (year !== 'all' && dateYear(event.occurredAt, timeZone) !== year) continue;
    let delta = membershipDelta(event);
    if (event.type === 'undo') {
      const original = state.events[event.details.undoneEventId];
      const originalDelta = original ? membershipDelta(original) : null;
      delta = originalDelta === null ? null : -originalDelta;
    }
    if (delta === null) unknown++; else if (delta > 0) added += delta; else removed -= delta;
  }
  return { added, removed, net: added - removed, unknown };
}
export function historyRows(state) {
  const journalByPlay = new Map();
  for (const entry of Object.values(state.journalEntries)) {
    if (!journalByPlay.has(entry.playthroughId)) journalByPlay.set(entry.playthroughId, []);
    journalByPlay.get(entry.playthroughId).push(entry);
  }
  return Object.values(state.playthroughs).map(play => ({ play, target: state.targets[play.targetId],
    platforms: [...new Set((play.playedPlatforms ?? state.targets[play.targetId].platforms).map(platformKey))],
    journal: journalByPlay.get(play.id) ?? [] }));
}
export function selectHistory(rows, { year = 'all', platform = '', status = 'finished', q = '' } = {}, timeZone) {
  const terms = q.toLowerCase().trim().split(/\s+/);
  return rows.filter(row => (status === 'all' || row.play.status === status) && (!platform || row.platforms.includes(platform)) && (year === 'all' || dateYear(endDate(row.play), timeZone) === year) && terms.every(term => `${row.target.title} ${objectiveLabel(row.play)} ${row.play.reflection ?? ''}`.toLowerCase().includes(term)))
    .sort((a, b) => (endDate(b.play) ?? '').localeCompare(endDate(a.play) ?? '') || a.target.title.localeCompare(b.target.title) || (b.play.ordinal ?? 0) - (a.play.ordinal ?? 0) || a.play.id.localeCompare(b.play.id));
}
export function yearSummary(rows, year = 'all', timeZone) {
  const selected = rows.filter(row => ['finished', 'retired'].includes(row.play.status) && (year === 'all' || dateYear(endDate(row.play), timeZone) === year));
  const times = selected.filter(row => row.play.minutesPlayed != null);
  return { finished: selected.filter(row => row.play.status === 'finished').length, retired: selected.filter(row => row.play.status === 'retired').length,
    minutesPlayed: times.reduce((sum, row) => sum + row.play.minutesPlayed, 0), timeRecords: times.length,
    unknownDates: rows.filter(row => ['finished', 'retired'].includes(row.play.status) && !endDate(row.play)).length };
}

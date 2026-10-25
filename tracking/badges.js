// Milestone badges and monthly activity for the Progress tab, computed from your
// tracking history. Undone actions never count.
import { platformKey } from '../library/core.js';
import { validChallengeAward } from './challenges.js';
import { validListAward } from './goals.js';

const RETRO = new Set(['nes', 'snes', 'n64', 'gc', 'gb', 'gbc', 'gba', 'sg1000', 'ms', 'md', 'gg', 'scd', '32x', 'saturn', 'dc', 'ps1', 'ps2', 'psp', 'xbox',
  'atari2600', 'atari5200', 'atari7800', 'lynx', 'jaguar', 'tg16', 'pcecd', 'neogeo', 'ngpc', 'mame', 'cps', 'naomi', 'cave', 'c64', 'amiga', 'spectrum', 'msx']);

const undoneIds = state => new Set(Object.values(state.events).filter(event => event.type === 'undo').map(event => event.details.undoneEventId));

function playPlatforms(state, play) {
  const names = play.playedPlatforms?.length ? play.playedPlatforms : state.targets[play.targetId]?.platforms ?? [];
  return names.map(platformKey);
}

// `extra` carries what needs the catalog: finished games from a system's top ten, and
// completed list goals (the Play page computes both).
export function badgeStats(state, extra = {}) {
  const finished = Object.values(state.playthroughs).filter(play => play.status === 'finished');
  const finishedGames = new Set(finished.map(play => play.targetId));
  const platforms = new Set(finished.flatMap(play => playPlatforms(state, play)).filter(Boolean));
  const retro = new Set(finished.filter(play => playPlatforms(state, play).some(key => RETRO.has(key))).map(play => play.targetId));
  const triaged = new Set(Object.values(state.annotations).filter(note => note.triage).map(note => note.targetId));
  const removed = Object.values(state.wishlist).filter(entry => entry.decision === 'archived').length;
  const journal = Object.values(state.journalEntries).filter(entry => !entry.deletedAt);
  const notes = journal.filter(entry => entry.kind === 'note').length;
  const milestones = journal.filter(entry => entry.achieved && entry.kind === 'milestone').length;
  const mastery = journal.filter(entry => entry.achieved && entry.kind === 'mastery').length;
  // Dated finishes, by month; games you logged as played before have no date.
  const months = new Set(finished.filter(play => play.finishedAt).map(play => play.finishedAt.slice(0, 7))).size;
  const past = new Set(finished.filter(play => !play.finishedAt).map(play => play.targetId)).size;
  const replays = finished.filter(play => play.ordinal > 1).length;
  const reflections = finished.filter(play => play.reflection?.trim()).length;
  const challenges = new Set(Object.values(state.challengeAwards ?? {}).filter(award => validChallengeAward(state, award)).map(award => award.challengeId)).size;
  // Completed lists by kind (list awards, kept when a goal is removed).
  const lists = Object.values(state.listAwards ?? {}).filter(award => validListAward(state, award)), listsOf = kind => lists.filter(award => award.kinds.includes(kind)).length;
  return { finished: finishedGames.size, platforms: platforms.size, retro: retro.size, triaged: triaged.size, removed, notes,
    milestones, mastery, months, past, replays, reflections, challenges, topTen: extra.topTen ?? 0, goals: extra.goals ?? 0,
    listHistory: listsOf('history'), listSeries: listsOf('series'), listDecade: listsOf('decade'), listGenre: listsOf('genre') };
}

const BADGES = [
  ['first-finish', 'First credits', 'Finish a game.', 'finished', 1],
  ['finisher-10', 'Ten down', 'Finish 10 games.', 'finished', 10],
  ['finisher-25', 'Quarter century', 'Finish 25 games.', 'finished', 25],
  ['finisher-50', 'Pile shrinker', 'Finish 50 games.', 'finished', 50],
  ['finisher-100', 'Centurion', 'Finish 100 games.', 'finished', 100],
  ['finisher-250', 'Completionist', 'Finish 250 games.', 'finished', 250],
  ['triage-25', 'Sorting hat', 'Make 25 backlog triage decisions.', 'triaged', 25],
  ['triage-100', 'Backlog tamer', 'Make 100 backlog triage decisions.', 'triaged', 100],
  ['triage-500', 'Master curator', 'Make 500 backlog triage decisions.', 'triaged', 500],
  ['wishlist-10', 'Second thoughts', 'Remove 10 games from your wishlist.', 'removed', 10],
  ['wishlist-50', 'Wishlist warden', 'Remove 50 games from your wishlist.', 'removed', 50],
  ['wishlist-100', 'Window shopper', 'Remove 100 games from your wishlist.', 'removed', 100],
  ['platforms-3', 'Platform hopper', 'Finish games on 3 different platforms.', 'platforms', 3],
  ['platforms-5', 'Multi-system master', 'Finish games on 5 different platforms.', 'platforms', 5],
  ['platforms-10', 'Console historian', 'Finish games on 10 different platforms.', 'platforms', 10],
  ['retro-1', 'Blast from the past', 'Finish a retro game.', 'retro', 1],
  ['retro-10', 'Retro pilgrim', 'Finish 10 retro games.', 'retro', 10],
  ['retro-25', 'Cartridge collector', 'Finish 25 retro games.', 'retro', 25],
  ['retro-50', 'Retro royalty', 'Finish 50 retro games.', 'retro', 50],
  ['top-ten-1', 'Hall of famer', 'Finish a game from a system’s top ten.', 'topTen', 1],
  ['top-ten-10', 'Canon reader', 'Finish 10 games from systems’ top tens.', 'topTen', 10],
  ['top-ten-25', 'Greatest hits', 'Finish 25 games from systems’ top tens.', 'topTen', 25],
  ['goal-1', 'List climber', 'Complete a list goal.', 'goals', 1],
  ['goal-3', 'List conqueror', 'Complete 3 list goals.', 'goals', 3],
  ['list-history', 'Historian', 'Complete a “games that shaped” list.', 'listHistory', 1],
  ['list-series', 'Series master', 'Complete a series list.', 'listSeries', 1],
  ['list-decade', 'Decade explorer', 'Complete a decade list.', 'listDecade', 1],
  ['list-genre', 'Genre expert', 'Complete a genre list.', 'listGenre', 1],
  ['challenge-1', 'Challenge accepted', 'Complete a challenge.', 'challenges', 1],
  ['challenge-5', 'Season veteran', 'Complete 5 challenges.', 'challenges', 5],
  ['months-3', 'Steady player', 'Finish games in 3 different months.', 'months', 3],
  ['months-12', 'Year-round player', 'Finish games in 12 different months.', 'months', 12],
  ['past-10', 'Memory lane', 'Log 10 games you finished before.', 'past', 10],
  ['past-50', 'A life in games', 'Log 50 games you finished before.', 'past', 50],
  ['replay-1', 'One more time', 'Finish a game again.', 'replays', 1],
  ['milestone-10', 'Checkpoint', 'Achieve 10 milestones.', 'milestones', 10],
  ['mastery-1', 'True ending', 'Achieve a mastery goal.', 'mastery', 1],
  ['notes-10', 'Chronicler', 'Write 10 session notes.', 'notes', 10],
  ['notes-50', 'Diarist', 'Write 50 session notes.', 'notes', 50],
  ['reflection-5', 'Critic’s corner', 'Write a reflection on 5 finished games.', 'reflections', 5],
];

export function badges(state, extra = {}) {
  const stats = badgeStats(state, extra);
  return BADGES.map(([id, title, description, stat, goal]) => ({ id, title, description, stat, goal, progress: Math.min(stats[stat], goal), unlocked: stats[stat] >= goal }));
}

const monthOf = at => at.slice(0, 7);

// Per month: games added to the plan, games finished, and decisions (triage + wishlist review).
export function monthlyActivity(state, { months = 6, now = new Date().toISOString() } = {}) {
  const undone = undoneIds(state), keys = [];
  const cursor = new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1, 1));
  for (let index = months - 1; index >= 0; index--) keys.push(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - index, 1)).toISOString().slice(0, 7));
  const rows = new Map(keys.map(key => [key, { month: key, added: 0, finished: 0, decisions: 0 }]));
  const bump = (at, field) => { const row = rows.get(monthOf(at)); if (row) row[field]++; };
  const addedTargets = new Set();
  const events = Object.values(state.events).filter(event => !undone.has(event.id)).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  for (const event of events) {
    if ((event.type === 'queue' || event.type === 'upnext' && event.details.enabled) && !event.details.previous && !addedTargets.has(event.targetId)) { addedTargets.add(event.targetId); bump(event.recordedAt, 'added'); }
    if (event.type === 'triage' || event.type === 'wishlist' && event.details.reviewSessionId) bump(event.recordedAt, 'decisions');
  }
  for (const play of Object.values(state.playthroughs)) if (play.status === 'finished') {
    const finishing = events.filter(event => event.details.playthroughId === play.id && event.details.result?.status === 'finished').at(-1);
    const at = play.finishedAt ?? finishing?.recordedAt;
    if (at) bump(at, 'finished');
  }
  return [...rows.values()];
}

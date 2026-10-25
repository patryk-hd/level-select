// "Continue" on the Play home: games you are playing or paused, most recent first,
// each with its latest session note so you can pick up where you left off.
import { latestEvent } from './domain.js';

function coverFor(target, library, catalog) {
  for (const ref of target.refs) {
    if (ref.provider === 'playnite') {
      const group = library.find(game => game.copies.some(copy => copy.id === ref.id));
      if (group?.cover) return group.cover;
    }
    if (ref.provider === 'catalog') {
      const game = catalog.games.find(item => item.id === ref.id);
      const cover = game?.cover?.local ?? game?.cover?.url;
      if (cover) return cover.startsWith('./') ? `.${cover}` : cover;
    }
  }
  return null;
}

export function continueList(state, { library = [], catalog = { games: [] } } = {}) {
  const active = Object.values(state.playthroughs).filter(play => ['playing', 'paused'].includes(play.status) && state.targets[play.targetId]);
  return active.map(play => {
    const target = state.targets[play.targetId];
    const notes = Object.values(state.journalEntries).filter(entry => entry.playthroughId === play.id && !entry.deletedAt)
      .sort((a, b) => (b.occurredOn ?? b.createdAt.slice(0, 10)).localeCompare(a.occurredOn ?? a.createdAt.slice(0, 10)) || b.createdAt.localeCompare(a.createdAt));
    const lastActivity = [latestEvent(state, target.id)?.recordedAt, notes[0]?.createdAt, play.startedAt].filter(Boolean).sort().at(-1) ?? '';
    return { targetId: target.id, title: target.title, platforms: play.playedPlatforms?.length ? play.playedPlatforms : target.platforms,
      status: play.status, lastNote: notes[0] ?? null, lastActivity, cover: coverFor(target, library, catalog) };
  }).sort((a, b) => Number(b.status === 'playing') - Number(a.status === 'playing') || b.lastActivity.localeCompare(a.lastActivity) || a.title.localeCompare(b.title));
}

import { copyMatchesFilters } from '../library/core.js';

// Finishes belong to a copy, not every storefront attached to the same title.
export function platformSummary(state, library, filters) {
  const finishedCopies = new Set();
  for (const play of Object.values(state.playthroughs)) {
    if (play.status !== 'finished') continue;
    const refs = state.targets[play.targetId]?.refs ?? [];
    const owned = refs.filter(ref => ref.provider === 'playnite');
    const source = play.playedSource ?? (refs.length === 1 ? owned[0] : null);
    if (source?.provider === 'playnite' && owned.some(ref => ref.id === source.id)) finishedCopies.add(source.id);
  }
  let total = 0, completed = 0;
  for (const game of library) {
    const copies = game.copies.filter(copy => copyMatchesFilters(copy, filters));
    if (!copies.length) continue;
    total++;
    if (copies.some(copy => finishedCopies.has(copy.id))) completed++;
  }
  return { total, completed };
}

import { stableJSON } from './domain.js';
import { patchAnnotation } from './compat.js';

// Read old group edits in their original scope. Never apply flags or notes to a
// child release implicitly, even if only one of the old copies remains imported.
export function preservedGroupNotes(state, game) {
  return (game.legacyGroups ?? []).map(group => {
    const edit = state.annotations[`owned:${group.id}`] ?? {};
    return { id: group.id, name: group.name, copyIds: group.copyIds ?? [],
      notes: edit.notes ?? group.notes ?? '', favorite: edit.favorite ?? group.favorite ?? false,
      hidden: edit.hidden ?? group.hidden ?? false };
  });
}

export function copyGroupNotes(state, library, { gameId, legacyId, expectedSource, expectedNotes }) {
  const game = library.find(game => game.id === gameId);
  const source = game && preservedGroupNotes(state, game).find(group => group.id === legacyId);
  if (!source || stableJSON(source) !== stableJSON(expectedSource)) throw new Error('The preserved group changed. Reopen this entry before copying its notes.');
  const current = state.annotations[`owned:${gameId}`]?.notes ?? game.notes ?? '';
  if (current !== expectedNotes) throw new Error('These notes changed in another tab. Reopen this entry before copying.');
  if (!source.notes) throw new Error('This group has no notes to copy.');
  const notes = current ? `${current}\n\n${source.notes}` : source.notes;
  return patchAnnotation(state, { ref: { provider: 'legacy-owned', id: gameId },
    title: game.name, platforms: game.platforms ?? [] }, { notes });
}

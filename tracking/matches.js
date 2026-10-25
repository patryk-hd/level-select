import { clone, instant, record, requireId, stableJSON, text } from './domain.js';
import { connectLibrary, matchKey } from '../library/core.js';

export const MATCH_SECTIONS = ['matchReviews'];

export function validateMatchReviews(state) {
  for (const [id, review] of Object.entries(state.matchReviews)) {
    if (!record(review) || review.id !== id || id !== matchKey(review.catalogId, review.copyId)) throw Error('Invalid library match identity.');
    requireId(review.catalogId); requireId(review.copyId);
    if (!['accepted', 'rejected', 'unresolved'].includes(review.decision)) throw Error('Invalid library match decision.');
    if (review.method !== 'user-reviewed-v1') throw Error('Invalid library match method.');
    instant(review.reviewedAt);
    for (const key of ['catalogIdentity', 'copyIdentity']) text(review[key], 4000);
  }
}

// This records a browsing association only. It never links tracking targets,
// creates ownership records, grants XP, or moves ratings to another release.
export function reviewLibraryMatch(current, { catalog, library }, { catalogId, copyId, decision, expected, at }) {
  if (!['accepted', 'rejected', 'unresolved'].includes(decision)) throw Error('Choose a valid match decision.');
  instant(at);
  const id = requireId(matchKey(catalogId, copyId)), previous = current.matchReviews[id] ?? null;
  if (stableJSON(previous) !== stableJSON(expected)) throw Error('This match changed in another tab. Review the current decision.');
  const candidate = connectLibrary(catalog, library, current.matchReviews).candidatesByRelease[catalogId]?.find(item => item.copyId === copyId);
  if (!candidate || candidate.status === 'unavailable') throw Error('This copy is not available in the current library.');
  const state = clone(current);
  state.matchReviews[id] = { id, catalogId, copyId, decision, method: 'user-reviewed-v1', reviewedAt: at,
    catalogIdentity: candidate.catalogIdentity, copyIdentity: candidate.copyIdentity };
  return state;
}

import { clone, instant, record, requireId, stableJSON, text } from './domain.js';
import { titleKey, platformKey, storeKey } from '../library/core.js';

export const PRODUCT_SECTIONS = ['productReviews'];
export function steamProductId(value) {
  const raw = String(value ?? '').trim();
  if (/^[1-9]\d{0,14}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && url.hostname === 'store.steampowered.com' && !url.port && !url.username && !url.password)
      return url.pathname.match(/^\/app\/([1-9]\d{0,14})(?:\/[^\s]*)?$/)?.[1] ?? null;
  } catch { /* A malformed URL is not a product identity. */ }
  return null;
}

export function productIdentity(game, copy) {
  // Old group-level IDs are only candidates, and never broadcast across copies.
  const candidateId = steamProductId(copy.steamAppId ?? (game.copies.length === 1 ? game.steamAppId : null));
  const origin = copy.steamAppIdProvenance?.origin ?? 'legacy-unknown';
  const applicable = (copy.platforms ?? []).some(p => platformKey(p) === 'dos') &&
    (copy.sources ?? []).some(source => storeKey(source) === 'steam');
  const fingerprint = JSON.stringify([copy.id, titleKey(copy.name ?? game.name), copy.year ?? null,
    [...new Set((copy.platforms ?? []).map(platformKey))].sort(),
    [...new Set((copy.sources ?? []).map(storeKey))].sort(), candidateId, origin]);
  return { candidateId, origin, applicable, fingerprint };
}

export function productMatch(game, copy, reviews = {}) {
  const identity = productIdentity(game, copy), review = reviews[copy.id];
  const status = copy.available === false ? 'unavailable' : !identity.applicable ? 'not-applicable'
    : review?.decision === 'rejected' ? 'rejected'
    : review?.decision === 'accepted' ? (review.fingerprint === identity.fingerprint ? 'accepted' : 'changed')
    : 'unresolved';
  return { ...identity, copyId: copy.id, ownedId: game.id, title: copy.name ?? game.name,
    year: copy.year ?? null, platforms: copy.platforms ?? [], sources: copy.sources ?? [], status,
    productId: review?.productId ?? identity.candidateId,
    ref: status === 'accepted' ? { provider:'steam', id:review.productId } : null };
}

export function productInventory(library, reviews = {}) {
  const items = library.flatMap(game => game.copies.map(copy => productMatch(game, copy, reviews)));
  const present = new Set(items.map(item => item.copyId));
  const counts = Object.fromEntries(['accepted','unresolved','changed','rejected','not-applicable','unavailable'].map(status => [status,items.filter(item => item.status === status).length]));
  return { items, counts, missingReviewedCopies:Object.keys(reviews).filter(id => !present.has(id)),
    verifiedProductIds:[...new Set(items.flatMap(item => item.ref ? [item.ref.id] : []))].sort() };
}

// Score association only: never merge histories, infer ownership, or award XP.
export function reviewProduct(current, library, { copyId, product, decision, confirmed = false, expected, expectedIdentity, at }) {
  const game = library.find(game => game.copies.some(copy => copy.id === copyId));
  const copy = game?.copies.find(copy => copy.id === copyId);
  if (!copy || copy.available === false) throw Error('This copy is unavailable in the current import.');
  const identity = productIdentity(game, copy);
  if (!identity.applicable) throw Error('Steam product reviews require a Steam copy on PC. Correct the imported platform or store first.');
  if (identity.fingerprint !== expectedIdentity) throw Error('The imported identity changed. Reopen the review.');
  if (stableJSON(current.productReviews[copyId] ?? null) !== stableJSON(expected)) throw Error('This product match changed in another tab. Reopen the review.');
  if (!['accepted','rejected','unresolved'].includes(decision)) throw Error('Choose a match decision.');
  const productId = steamProductId(product);
  if (decision !== 'unresolved' && !productId) throw Error('Enter a Steam app ID or an https://store.steampowered.com/app/… link.');
  if (decision === 'accepted' && !confirmed) throw Error('Check the product, edition and game type before confirming.');
  instant(at); requireId(copyId);
  const state = clone(current);
  state.productReviews[copyId] = { copyId, productId, decision, fingerprint:identity.fingerprint,
    origin:identity.origin, importedId:identity.candidateId, method:'user-reviewed-steam-v1', reviewedAt:at };
  return state;
}

export function validateProductReviews(state) {
  for (const [id, review] of Object.entries(state.productReviews)) {
    if (!record(review) || review.copyId !== id) throw Error('Invalid product review identity.');
    requireId(id); instant(review.reviewedAt); text(review.fingerprint,4000); text(review.origin,100);
    if (!['accepted','rejected','unresolved'].includes(review.decision) || review.method !== 'user-reviewed-steam-v1') throw Error('Invalid product review decision.');
    for (const value of [review.productId,review.importedId]) if (value !== null && (typeof value !== 'string' || !/^[1-9]\d{0,14}$/.test(value))) throw Error('Invalid reviewed Steam app ID.');
    if (review.decision !== 'unresolved' && !review.productId) throw Error('A decided product review needs an app ID.');
  }
}

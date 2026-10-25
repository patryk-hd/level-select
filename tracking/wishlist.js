import { clone, ensureTarget, findTarget, applyCommand, requireId, instant, calendarDate, PRICE_CURRENCIES, recordEvent, stableJSON } from './domain.js';
import { setUpNext } from './compat.js';
import { buildSuggestionChoices, selectSuggestions } from './suggestions.js';
import { platformKey } from '../library/core.js';
import { compareRatings } from './score.js';
import { gameplayFit, knowsGameplay } from './gameplay.js';

export const WISHLIST_LABELS = { interested: 'Keep', 'want-soon': 'Want soon', 'wait-for-price': 'Wait for price', maybe: 'Maybe', archived: 'Archived', acquired: 'Acquired' };
export function entryFor(state, ref) { return state.wishlist[findTarget(state, ref)?.id] ?? null; }
export function isSnoozed(entry, today) { calendarDate(today); return Boolean(entry?.snoozeUntil && entry.snoozeUntil > today); }
export function dueForReview(entry, today) { return !['archived', 'acquired'].includes(entry?.decision) && !isSnoozed(entry, today) && (!entry?.reviewOn || entry.reviewOn <= today); }
export function activeReview(state) { return Object.values(state.reviewSessions).find(session => !session.completedAt) ?? null; }
export function latestReview(state) { return activeReview(state) ?? Object.values(state.reviewSessions).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))[0] ?? null; }
export function nextReviewTarget(session) { return session?.targetIds.find(id => !session.reviewed[id]) ?? null; }

export function decideWishlist(current, descriptor, { decision, fields = {}, expected, at, eventId, reviewSessionId }) {
  const state = clone(current), target = ensureTarget(state, descriptor);
  if (expected !== undefined && stableJSON(expected) !== stableJSON(state.wishlist[target.id] ?? null)) throw new Error('This wishlist decision changed in another tab. Reopen the game to review the saved value; your form has been kept.');
  return applyCommand(state, { type: 'wishlist', targetId: target.id, decision, fields, at, eventId, reviewSessionId });
}
export function startReview(current, descriptors, { sessionId, at, today }) {
  if (activeReview(current)) throw new Error('Resume the current review session before starting another.');
  requireId(sessionId); instant(at); calendarDate(today);
  if (current.reviewSessions[sessionId]) throw new Error('This review session already exists.');
  const state = clone(current), targetIds = [];
  for (const desc of descriptors) {
    const existing = findTarget(state, desc.ref);
    if (!dueForReview(state.wishlist[existing?.id], today)) continue;
    const target = ensureTarget(state, desc);
    if (!targetIds.includes(target.id)) targetIds.push(target.id);
    if (targetIds.length === 10) break;
  }
  if (!targetIds.length) throw new Error('No games are due for review in these filters.');
  state.reviewSessions[sessionId] = { id: sessionId, targetIds, reviewed: {}, startedAt: at, completedAt: null };
  return state;
}
export function reviewWishlist(current, { sessionId, targetId, action, expected, snoozeUntil, targetPrice, at, today, eventId }) {
  const session = current.reviewSessions[sessionId];
  if (!session || session.completedAt || nextReviewTarget(session) !== targetId) throw new Error('The review moved to another game. Refresh the session before deciding.');
  const target = current.targets[targetId], before = current.wishlist[targetId];
  let decision = ({ keep: 'interested', 'want-soon': 'want-soon', 'wait-for-price': 'wait-for-price', archive: 'archived', snooze: before?.decision ?? 'interested' })[action];
  if (!decision) throw new Error('Unknown review action.');
  const fields = { reviewedAt: at, snoozeUntil: null };
  // A deliberate decision is not due again straight away: keeps come back in three
  // months, "buy soon" and "wait for a sale" in a month (to check price and interest).
  const again = { keep: 90, 'want-soon': 30, 'wait-for-price': 30 }[action];
  if (again) { calendarDate(today); fields.reviewOn = new Date(Date.parse(`${today}T00:00:00.000Z`) + again * 86400000).toISOString().slice(0, 10); }
  if (action === 'want-soon') fields.priority = Math.max(2, before?.priority ?? 0);
  if (action === 'wait-for-price' && targetPrice !== undefined) fields.targetPrice = targetPrice;
  if (action === 'snooze') {
    calendarDate(snoozeUntil); calendarDate(today);
    if (snoozeUntil <= today) throw new Error('Choose a future snooze date.');
    fields.snoozeUntil = snoozeUntil;
  }
  const state = decideWishlist(current, { ref: target.refs[0], title: target.title, platforms: target.platforms }, { decision, fields, expected, reviewSessionId: sessionId, at, eventId });
  state.reviewSessions[sessionId].reviewed[targetId] = eventId;
  if (!nextReviewTarget(state.reviewSessions[sessionId])) state.reviewSessions[sessionId].completedAt = at;
  return state;
}
export function compareWishlist(current, descriptors, { choice, expected, at, eventId }) {
  if (descriptors.length !== 2 || !['a', 'b', 'both', 'neither', 'skip'].includes(choice)) throw new Error('Choose two distinct games and a comparison action.');
  const check = clone(current), ids = descriptors.map(desc => ensureTarget(check, desc).id);
  if (ids[0] === ids[1]) throw new Error('Choose two distinct games.');
  if (choice === 'skip') return clone(current);
  let state = current;
  descriptors.forEach((desc, index) => {
    const picked = choice === 'both' || choice === (index === 0 ? 'a' : 'b');
    state = decideWishlist(state, desc, { decision: picked ? 'want-soon' : 'maybe', fields: { snoozeUntil: null }, expected: expected[index], at, eventId: `${eventId}:${index}` });
  });
  return state;
}
export function acquireWishlist(current, descriptor, { confirmed, acquiredAt = null, handoff = 'library', expected, at, eventId }) {
  if (confirmed !== true) throw new Error('Confirm ownership of this exact edition and platform.');
  if (!['library', 'backlog', 'upnext'].includes(handoff)) throw new Error('Choose where this acquisition belongs.');
  instant(acquiredAt, true);
  let state = clone(current); const target = ensureTarget(state, descriptor);
  if (state.wishlist[target.id]?.decision === 'acquired') throw new Error('This acquisition is already recorded.');
  const previous = clone(state.wishlist[target.id] ?? null);
  state = decideWishlist(state, descriptor, { decision: 'acquired', fields: { acquiredAt, snoozeUntil: null }, expected, at, eventId: `${eventId}:decision` });
  const id = `acquired:${descriptor.ref.provider}:${descriptor.ref.id}`;
  state.ownership[id] = { id, targetId: target.id, evidence: 'manual', source: clone(descriptor.ref), acquiredAt, platforms: clone(descriptor.platforms), sources: ['Manual acquisition'], available: true };
  if (handoff === 'backlog' && !state.backlog[target.id]) state = applyCommand(state, { type: 'queue', targetId: target.id, at, eventId: `${eventId}:queue` });
  if (handoff === 'upnext') state = setUpNext(state, descriptor, true, { at, eventId: `${eventId}:queue` });
  recordEvent(state, { type: 'acquire', targetId: target.id, at, eventId }, { ownershipId: id, previous, handoff });
  return state;
}

export function targetPriceStatus(entry, snapshot, now) {
  const target = entry?.targetPrice;
  if (!target) return { code: 'no-target', label: 'No target price set' };
  if (!snapshot || !Number.isSafeInteger(snapshot.amountMinor) || snapshot.amountMinor < 0 || !snapshot.currency) return { code: 'unknown', label: 'Price or currency not recorded' };
  if (snapshot.currency !== target.currency) return { code: 'currency', label: `Imported price is in ${snapshot.currency}; target is in ${target.currency}` };
  try { instant(snapshot.observedAt); instant(now); }
  catch { return { code: 'unknown', label: 'Price observation date is unknown or invalid' }; }
  const observed = Date.parse(snapshot.observedAt), current = Date.parse(now);
  if (observed > current) return { code: 'unknown', label: 'Price observation date is in the future' };
  if (current - observed > 7 * 86400000) return { code: 'stale', label: 'Price is over seven days old; refresh it before comparing' };
  return snapshot.amountMinor <= target.amountMinor ? { code: 'met', label: 'Target met in the imported snapshot — check the store before buying' } : { code: 'above', label: 'Imported price is above your target' };
}
export function parseTargetPrice(amount, currency) {
  if (amount.trim() === '') return null;
  const digits = PRICE_CURRENCIES[currency];
  if (digits === undefined || !new RegExp(`^\\d+(?:\\.\\d{1,${digits || 1}})?$`).test(amount.trim()) || !digits && amount.includes('.')) throw new Error('Enter a non-negative price with the correct decimal places.');
  const amountMinor = Math.round(Number(amount) * 10 ** digits);
  if (!Number.isSafeInteger(amountMinor) || amountMinor > 1_000_000_000) throw new Error('Target price is too large.');
  return { amountMinor, currency };
}
export function formatMoney(price) {
  if (!price || !Object.hasOwn(PRICE_CURRENCIES, price.currency)) return 'Unknown price';
  return `${price.currency} ${(price.amountMinor / 10 ** PRICE_CURRENCIES[price.currency]).toFixed(PRICE_CURRENCIES[price.currency])}`;
}
export function acquisitionCandidates(game, library) {
  return library.filter(owned => String(owned.steamAppId ?? '') === String(game.appid)).flatMap(owned => owned.copies
    .filter(copy => copy.platforms.some(platform => ['dos', 'pc', 'linux', 'macos', 'mac'].includes(platformKey(platform))) && copy.sources.some(source => source.toLowerCase() === 'steam'))
    .map(copy => ({ ownedId: owned.id, copyId: copy.id, title: owned.name, platforms: copy.platforms })));
}
// Store genres that describe how a game was made or sold, or nearly every game ("Action").
const GENERIC_GENRES = new Set(['indie', 'action', 'adventure', 'casual', 'free to play', 'early access', 'massively multiplayer']);
export function ownedAlternatives(game, context) {
  // With IGDB data on both sides only games of the same kind count (camera, genre, theme);
  // otherwise the store genres must share something more telling than "Action".
  const known = knowsGameplay(game.igdb);
  const genres = new Set((game.genres ?? []).map(value => value.toLowerCase()).filter(value => !GENERIC_GENRES.has(value)));
  const choices = selectSuggestions(buildSuggestionChoices(context));
  return choices.filter(choice => !choice.keys.includes(`steam:${game.appid}`)).map(choice => {
    const fit = known && knowsGameplay(choice.option.igdb) ? gameplayFit(game.igdb, choice.option.igdb, { strict: true }) : null;
    const overlap = fit ? (fit.fits ? [fit.kind ?? 'same kind of game'] : []) : known ? [] : choice.option.genres.filter(genre => genres.has(genre.toLowerCase()));
    const pc = choice.option.platforms.some(platform => ['dos', 'pc', 'linux', 'macos', 'mac'].includes(platform));
    return { ...choice, overlap, platformReason: pc ? 'Owned PC alternative; this does not satisfy the wanted edition' : 'Owned on another platform; the wanted edition stays wishlisted' };
  }).filter(choice => choice.overlap.length).sort((a, b) => Number(b.option.favorite) - Number(a.option.favorite) || b.overlap.length - a.overlap.length || compareRatings(a.option.rating, b.option.rating) || a.title.localeCompare(b.title)).slice(0, 3);
}

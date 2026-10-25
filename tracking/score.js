// One place decides which rating a game shows and sorts by, so every view agrees.
// Sources stay labelled; a missing rating is never treated as zero.
const valid = value => Number.isFinite(value) && value >= 0 && value <= 100;

// Critic and player scores are combined by evidence: each critic review counts as
// five player ratings, and a neutral 70 worth 25 ratings pulls thin evidence toward
// the middle. A 97 from five players lands near 75; a 94 from thousands stays 94.
const PRIOR = 70, PRIOR_WEIGHT = 25, CRITIC_WEIGHT = 5;
// Playnite scores carry no counts; treat each as a handful of ratings.
const PLAYNITE_WEIGHT = 10;

function blend(parts, source, via, extra = {}, prior = PRIOR_WEIGHT) {
  if (!parts.length) return null;
  const weight = parts.reduce((sum, part) => sum + part.weight, 0);
  const exact = (parts.reduce((sum, part) => sum + (part.scaled ?? part.value) * part.weight, 0) + PRIOR * prior) / (weight + prior);
  return { value: Math.round(exact), exact, weight, parts, source, via, thin: weight < 50, ...extra };
}

export function igdbRating(igdb) {
  if (!igdb) return null;
  const parts = [];
  if (valid(igdb.critic) && igdb.criticCount > 0) parts.push({ label: 'Critics', value: Math.round(igdb.critic), count: igdb.criticCount, weight: igdb.criticCount * CRITIC_WEIGHT });
  if (valid(igdb.players) && igdb.playersCount > 0) parts.push({ label: 'Players', value: Math.round(igdb.players), count: igdb.playersCount, weight: igdb.playersCount });
  return blend(parts, 'igdb', 'IGDB', igdb.ratingsFrom ? { from: igdb.ratingsFrom } : {});
}

// A Game Atlas list game: critic reviews of that version (Wikipedia's review boxes, else
// IGDB's critics) and IGDB players, by the same rule with a firmer pull to the middle (the
// neutral 70 counts as 50 ratings, or ten reviews): a top-100 place needs real evidence,
// not 24 enthusiastic ratings. Retro magazines scored generously, so their average is
// shifted onto the players' scale first: critics ran 2.3 points above IGDB players
// (median gap, 2,409 retro games with 4+ reviews and 20+ ratings, 2026-10-01).
export const RETRO_CRITIC_OFFSET = 2, LIST_PRIOR_WEIGHT = 50;
export function reviewRating({ critics, players } = {}) {
  const parts = [];
  if (critics && valid(critics.value) && critics.count > 0) parts.push({ label: 'Critics', value: Math.round(critics.value), scaled: critics.source === 'wikipedia' ? Math.max(0, critics.value - RETRO_CRITIC_OFFSET) : critics.value, count: critics.count, weight: critics.count * CRITIC_WEIGHT });
  if (players && valid(players.value) && players.count > 0) parts.push({ label: 'Players', value: Math.round(players.value), count: players.count, weight: players.count });
  return blend(parts, 'reviews', critics?.source === 'wikipedia' ? 'Wikipedia reviews and IGDB' : 'IGDB', {}, LIST_PRIOR_WEIGHT);
}

export function playniteRating(copy) {
  const parts = [['Critics', copy?.criticScore], ['Players', copy?.communityScore]].filter(([, value]) => valid(value))
    .map(([label, value]) => ({ label, value: Math.round(value), count: null, weight: PLAYNITE_WEIGHT }));
  return blend(parts, 'playnite', 'Playnite');
}

// Steam's share of positive reviews, used when IGDB has no rating for a game.
// Steam percentages run about 10 points above IGDB ratings for the same games
// (mean gap 10.4 across 511 owned games with both, measured 2026-09-28), so they are shifted onto
// the IGDB scale before ranking. The card still shows Steam's own percentage.
export const STEAM_OFFSET = 10;
export function steamRating(reviews) {
  if (!reviews || !valid(reviews.percent) || !(reviews.count > 0)) return null;
  return blend([{ label: 'Steam', value: reviews.percent, scaled: Math.max(0, reviews.percent - STEAM_OFFSET), count: reviews.count, weight: reviews.count, unit: '% positive' }], 'steam', 'Steam');
}

// IGDB (comparable across PC and consoles) first, then Steam, then Playnite's imported scores.
export const copyRating = copy => igdbRating(copy?.igdb) ?? steamRating(copy?.steamReviews) ?? playniteRating(copy);

const compact = count => count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count);
export function ratingText(rating) {
  if (!rating) return 'Not rated yet';
  const detail = rating.parts.map(part => `${part.label.toLowerCase()} ${part.value}${part.unit ?? ''}${part.count ? ` (${compact(part.count)})` : ''}`).join(' · ');
  return `Score ${rating.value} · ${detail}${rating.from ? ` · from ${rating.from}` : ''}${rating.thin ? ' · few ratings' : ''}`;
}

export const steamText = reviews => reviews?.count > 0 && valid(reviews.percent) ? `Steam ${reviews.percent}% positive (${compact(reviews.count)} reviews)` : null;

// Hours from IGDB's time-to-beat (seconds); main story first.
// IGDB's times are player reports. A lone "main + extras" report or an endless game
// (MMOs, sandboxes) gives numbers like 626h or 50,000h, which say nothing about length.
export const MAX_BEAT_HOURS = 150;
export function beatHours(igdb) {
  const ttb = igdb?.ttb; if (!ttb) return null;
  const seconds = ttb.main ?? (ttb.count >= 3 ? ttb.extra : null);
  const hours = seconds ? Math.max(1, Math.round(seconds / 3600)) : null;
  return hours && hours <= MAX_BEAT_HOURS ? hours : null;
}

// Higher first; unrated games follow rated ones.
export const compareRatings = (a, b) => (b?.value ?? -1) - (a?.value ?? -1);

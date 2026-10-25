import { copyMatchesFilters } from '../library/core.js';
// Ranking evidence v1. References use the same provider/id contract as tracking.
// No personal tracking mutations, provider requests or cross-edition inference.
export const EVIDENCE_VERSION = 1;
export const OWNED_MODES = Object.freeze({ critic: 'Imported critic', community: 'Imported community', personal: 'Personal (Playnite)', legacy: 'Legacy score' });
export const METHODS = Object.freeze({ editorial: 'editorial-system-rank-v1', approval: 'steam-wilson-approx-v1', exactApproval: 'steam-wilson-counts-v1' });
export const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const referenceKey = ref => `${ref.provider}:${encodeURIComponent(ref.id)}`;

/** Normalized observations retain original scales and explicit unknowns.
 * A copy reference establishes which imported record supplied a value, not a
 * verified edition or an independent review population. See ranking/README.md.
 */
export function importedEvidence(copy) {
  const ref = { provider: 'playnite', id: String(copy.id) };
  const fields = { critic: 'criticScore', community: 'communityScore', personal: 'userScore' };
  const hasComponents = Object.values(fields).some(field => Object.hasOwn(copy, field));
  const lanes = hasComponents ? fields : { legacy: 'bestScore' };
  return Object.entries(lanes).map(([lane, field]) => ({
    schemaVersion: EVIDENCE_VERSION,
    id: `${referenceKey(ref)}:${lane}:${copy.scoreImport?.checksum ?? 'legacy-snapshot'}`,
    source: { provider: 'playnite-import', family: null, upstreamId: null, url: null, label: OWNED_MODES[lane], lineage: [] },
    type: lane === 'personal' ? 'personal-rating' : lane === 'legacy' ? 'legacy-unspecified' : 'aggregate',
    lane,
    scope: { ref, work: null, edition: null, platforms: [...(copy.platforms ?? [])], region: null, build: null, mapping: 'imported-copy' },
    original: { value: percent(copy[field]), raw: copy[field] ?? null, scale: { min: 0, max: 100 }, positive: null, negative: null, count: null, countMeaning: null },
    dates: { publishedAt: null, observedAt: null, sourceUpdatedAt: null, windowFrom: null, windowTo: null },
    provenance: { adapterVersion: copy.scoreImport?.adapterVersion ?? 'legacy-snapshot-v1', checksum: copy.scoreImport?.checksum ?? null, fixture: null, extraction: field, attribution: 'Imported from Playnite; original rating provider and date unknown', access: 'personal-import', reviewStatus: 'unverified-source', supersedes: null },
  }));
}

export function validateEvidence(evidence) {
  const fail = message => { throw Error(`Invalid ranking evidence: ${message}`); };
  if (evidence?.schemaVersion !== EVIDENCE_VERSION || !evidence.id || !evidence.source?.provider) fail('identity');
  if (!['aggregate','personal-rating','legacy-unspecified','binary-approval','numeric-review','ranked-list','unranked-endorsement','external-composite'].includes(evidence.type)) fail('type');
  const ref = evidence.scope?.ref;
  if (!ref?.provider || typeof ref.id !== 'string' || !ref.id || !Array.isArray(evidence.scope.platforms)) fail('scope');
  const original = evidence.original, scale = original?.scale;
  if (!original || !scale || !Number.isFinite(scale.min) || !Number.isFinite(scale.max) || scale.max <= scale.min) fail('scale');
  if (original.value !== null && (!Number.isFinite(original.value) || original.value < scale.min || original.value > scale.max)) fail('value');
  for (const field of ['positive','negative','count']) if (original[field] !== null && count(original[field]) === null) fail(field);
  if (original.positive !== null || original.negative !== null) {
    if (original.positive === null || original.negative === null || original.count !== original.positive + original.negative) fail('inconsistent approval counts');
  }
  for (const field of ['publishedAt','observedAt','sourceUpdatedAt','windowFrom','windowTo']) {
    const value = evidence.dates?.[field];
    if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) fail('date');
  }
  if (evidence.dates.windowFrom && evidence.dates.windowTo && Date.parse(evidence.dates.windowFrom) > Date.parse(evidence.dates.windowTo)) fail('window');
  if (!evidence.provenance?.adapterVersion || !evidence.provenance.reviewStatus) fail('provenance');
  return evidence;
}

export function matchingCopies(game, { platform = '', source = '' } = {}) {
  return (game.copies ?? []).filter(copy => copyMatchesFilters(copy, {platform,source}));
}

export function ownedRating(game, lane = 'critic', filters = {}) {
  const copies = matchingCopies(game, filters);
  // Even matching values across different copies do not establish equivalence.
  if (copies.length !== 1) return { value: null, reason: copies.length ? 'Choose a copy' : 'No matching copy', evidence: null };
  const evidence = importedEvidence(copies[0]).find(item => item.lane === lane) ?? null;
  return { value: evidence?.original.value ?? null, reason: evidence?.original.value != null ? '' : lane === 'legacy' ? 'No legacy score' : 'Not recorded', evidence };
}

export function compareNullableDescending(a, b) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return b - a;
}

export function wilsonLowerBound(positivePct, total, z = 1.96) {
  if (percent(positivePct) === null || count(total) === null || total === 0) return null;
  const p = positivePct / 100, z2 = z * z;
  return Math.max(0, (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / (1 + z2 / total));
}

export function steamApproval(game) {
  const snapshot = game.reviewEvidence;
  const total = count(snapshot ? snapshot.total : game.reviewCount);
  const positive = count(snapshot?.positive), negative = count(snapshot?.negative);
  const countsConsistent = positive !== null && negative !== null && total !== null && positive + negative === total;
  const invalidCounts = snapshot && (snapshot.positive != null || snapshot.negative != null) && !countsConsistent;
  const exact = !invalidCounts && countsConsistent && total > 0;
  // Older exports coerced missing percentages to zero. With a positive count,
  // that zero cannot be distinguished from real 0% without a fresh export.
  const legacyAmbiguousZero = !snapshot && game.reviewPct === 0;
  const pct = invalidCounts || legacyAmbiguousZero || total === 0 ? null : exact ? 100 * positive / total : percent(snapshot ? snapshot.percentage : game.reviewPct);
  const approval = wilsonLowerBound(pct, total);
  return { pct, total, positive: exact ? positive : null, negative: exact ? negative : null,
    lowerBound: approval, approximate: !exact, method: exact ? METHODS.exactApproval : METHODS.approval,
    observedAt: snapshot?.observedAt ?? null, queryScope: snapshot?.queryScope ?? null,
    reason: invalidCounts ? 'Inconsistent review counts' : legacyAmbiguousZero ? 'Legacy zero: reimport to confirm' : total === 0 ? 'No reviews' : pct === null ? 'Approval not recorded' : '' };
}

export function compareSteam(a, b, mode = 'pick') {
  const left = steamApproval(a), right = steamApproval(b);
  const key = mode === 'reviewPct' ? 'pct' : mode === 'reviewCount' ? 'total' : 'lowerBound';
  return compareNullableDescending(key === 'lowerBound' && a.comingSoon ? null : left[key], key === 'lowerBound' && b.comingSoon ? null : right[key]) || String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' });
}

export const eligibleSteamRank = game => !game.comingSoon && steamApproval(game).lowerBound !== null;

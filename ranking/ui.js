import { importedEvidence, OWNED_MODES, steamApproval } from './evidence.js';
import { escapeHtml } from '../lib.js';

export function copyEvidenceHtml(copy) {
  const evidence = importedEvidence(copy);
  return `<div class="kv">${evidence.map(item => `<span>${escapeHtml(OWNED_MODES[item.lane])}</span><span>${item.original.value === null ? 'Not recorded' : `${item.original.value}/100`}</span>`).join('')}</div>
    <p class="data-note">${evidence[0]?.lane === 'legacy' ? 'This older snapshot kept only a maximum score. Its original source cannot be recovered. Reimport the original Playnite CSV to separate ratings.' : 'These are separate Playnite fields for this copy. The original rating providers, review counts and observation dates were not included in the export. Personal ratings are your Playnite ratings; playthrough ratings remain in your history.'}</p>`;
}

export function approvalText(game) {
  const data = steamApproval(game);
  return data.pct === null ? data.reason || 'Approval not recorded' : `${Number(data.pct.toFixed(1))}% positive`;
}

export function approvalEvidenceHtml(game) {
  const data = steamApproval(game);
  const legacy = game.legacyPickScore ?? (game.rankingMethod ? null : game.pickScore);
  return `<div class="detail-section rating-evidence"><h4>Ranking evidence</h4><div class="kv">
    <span>Steam approval</span><span>${escapeHtml(approvalText(game))}</span>
    <span>Review count</span><span>${data.total === null ? 'Not recorded' : data.total.toLocaleString()}</span>
    <span>Conservative approval</span><span>${data.lowerBound === null ? 'Unranked' : `${(data.lowerBound * 100).toFixed(1)}%${data.approximate ? ' (approximate)' : ''}`}</span>
    <span>Observed</span><span>${escapeHtml(data.observedAt ?? 'Unknown — saved import')}</span>
    <span>Review population</span><span>${data.queryScope ? escapeHtml(JSON.stringify(data.queryScope)) : 'Query settings not recorded'}</span>
    ${typeof legacy === 'number' && Number.isFinite(legacy) ? `<span>Legacy pick heuristic</span><span>${legacy.toFixed(4)} (retained for reference)</span>` : ''}
    </div><p class="data-note">Conservative approval uses the Wilson lower bound with z = 1.96. ${data.approximate ? 'This import supplies a percentage, so the calculation is approximate; exact positive and negative counts are unavailable.' : 'This calculation uses the imported positive and negative counts.'} It adds no popularity, price or artwork bonus. Reviewers may not represent all players. Unreleased games stay outside the top-by-genre ranking.</p></div>`;
}

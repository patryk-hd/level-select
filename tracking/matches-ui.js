import { escapeHtml as esc } from '../lib.js';

export function mountLibraryMatches(host, client, { catalogId = null, ownedId = null } = {}) {
  if (!host) return;
  const connections = client.connections(), state = client.snapshot();
  const candidates = catalogId ? connections.candidatesByRelease[catalogId] ?? []
    : Object.values(connections.candidatesByRelease).flat().filter(item => item.ownedId === ownedId);
  host.className = 'tracking-panel library-matches';
  if (!candidates.length) { host.replaceChildren(); return; }
  const names = new Map(client.catalog.systems.map(system => [system.id, system.name]));
  const labels = { accepted: 'Confirmed', rejected: 'Not counted as owned', unresolved: 'Needs review', changed: 'Details changed — review again', unavailable: 'Copy unavailable' };
  host.innerHTML = `<details><summary>Review library matches (${candidates.length})</summary>
    <p>A matching title is a suggestion. Confirm the game and edition, including originals, remakes and bundles. This connects browsing only; play histories and ratings stay separate.</p>
    ${candidates.map((item, index) => `<section class="match-candidate" data-match="${index}">
      <h4>${esc(item.catalogTitle)} · ${esc(names.get(item.systemId) ?? item.systemId)} · ${esc(item.catalogYear ?? 'Year unknown')}</h4>
      <p>Library copy: <strong>${esc(item.title)}</strong> · ${esc(item.platforms.join(', ') || 'Platform unknown')} · ${esc(item.copyYear ?? 'Year unknown')}<br>${esc(item.sources.join(', '))}</p>
      <p><strong>${esc(item.auto ? 'Matched automatically: same title, system and year' : labels[item.status])}</strong>${item.catalogYear && item.copyYear && item.catalogYear !== item.copyYear ? ' · Different release years: check the edition.' : ''}</p>
      <div class="tracking-actions"><button type="button" data-match-decision="accepted"${item.status === 'accepted' || item.status === 'unavailable' ? ' disabled' : ''}>${item.sameSystem ? 'Confirm this release' : 'Confirm same edition on another platform'}</button>
      <button type="button" data-match-decision="rejected"${item.status === 'rejected' || item.status === 'unavailable' ? ' disabled' : ''}>Different game / edition</button>
      <button type="button" data-match-decision="unresolved"${!state.matchReviews[item.id] || item.status === 'unresolved' || item.status === 'unavailable' ? ' disabled' : ''}>Reset to unreviewed</button></div>
    </section>`).join('')}<p data-match-status role="status"></p></details>`;
  host.querySelectorAll('[data-match-decision]').forEach(button => button.onclick = async () => {
    const item = candidates[Number(button.closest('[data-match]').dataset.match)];
    const status = host.querySelector('[data-match-status]');
    button.disabled = true;
    try {
      const result = await client.reviewMatch({ catalogId: item.catalogId, copyId: item.copyId, decision: button.dataset.matchDecision, expected: state.matchReviews[item.id] ?? null });
      if (host.isConnected) {
        mountLibraryMatches(host, client, { catalogId, ownedId });
        host.querySelector('details').open = true;
        host.querySelector('[data-match-status]').textContent = result.saved ? 'Match decision saved. Included in your tracking backup.' : 'Session only — export a tracking backup to keep this decision.';
        host.querySelector('summary').focus();
      }
    } catch (error) { status.textContent = `${error.message} Close and reopen this game to refresh the review.`; button.disabled = false; }
  });
}

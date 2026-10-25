import { escapeHtml } from '../lib.js';
import { ratingText, beatHours, steamText, MAX_BEAT_HOURS } from '../tracking/score.js';
import { awardSummary, awardPlace } from '../tracking/awards.js';
import { hoverAttr } from './hovercard.js';

// "To see everything", when it's a believable length next to the main story.
const everything = (igdb, beat) => { const hours = Math.round((igdb.ttb?.complete ?? 0) / 3600); return hours > beat && hours <= MAX_BEAT_HOURS * 2 ? hours : null; };

// "Score" detail section shared by Owned Games and Wishlist.
export function scoreSectionHtml({ rating, igdb, steamReviews, fix = null }) {
  const steam = steamText(steamReviews), beat = beatHours(igdb);
  const lines = [
    rating && `${ratingText(rating)} · via ${rating.via}`,
    rating?.source !== 'steam' && steam,
    beat && `About ${beat}h for the main story${everything(igdb, beat) ? `, ~${everything(igdb, beat)}h to see everything` : ''} (IGDB, ${igdb.ttb.count} reports)`,
    igdb && igdb.confidence !== 'high' && `Matched to “${igdb.name}” (${igdb.year ?? 'year unknown'}) on IGDB`,
  ].filter(Boolean);
  const fixes = fix ? matchFixHtml({ ...fix, igdb }) : '';
  if (!lines.length) return `<div class="detail-section"><h4>Score</h4><p class="data-note">No score yet for this game.</p>${fixes}</div>`;
  return `<div class="detail-section"><h4>Score</h4><ul class="score-lines">${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>${igdb?.url ? `<a class="provider-credit" href="${escapeHtml(igdb.url)}" target="_blank" rel="noopener noreferrer">IGDB ↗</a>` : ''}${fixes}</div>`;
}

// ---------- Hover previews (see hovercard.js) ----------
const plural = (n, word) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;
const hoverHead = (title, sub = '') => `<p class="hc-head"><strong>${escapeHtml(title)}</strong>${sub ? `<span>${escapeHtml(sub)}</span>` : ''}</p>`;
// The awards behind a chip or seal: Game of the Year wins, other wins, then nominations.
export function awardHoverHtml(awards) {
  const summary = awardSummary(awards);
  if (!summary) return '';
  const line = award => `<li><b>${escapeHtml(award.name)}</b><span>${escapeHtml(awardPlace(award))}</span></li>`;
  const wins = [...summary.gotyWins, ...summary.categoryWins], shown = wins.slice(0, 6);
  return `${hoverHead(summary.label, summary.tier === 'goty' && summary.categoryWins.length ? `and ${plural(summary.categoryWins.length, 'other award')}` : '')}
    ${shown.length ? `<ul class="hc-list">${shown.map(line).join('')}</ul>` : ''}${wins.length > shown.length ? `<p class="hc-note">and ${plural(wins.length - shown.length, 'more award')}</p>` : ''}
    ${summary.nominations.length ? `<p class="hc-note">Nominated: ${escapeHtml(summary.nominations.slice(0, 4).map(awardPlace).join(', '))}${summary.nominations.length > 4 ? '…' : ''}</p>` : ''}<p class="hc-source">Wikidata</p>`;
}
// How a score is made up: each part with its count, where it comes from, and other views.
export function ratingHoverHtml(rating, { steam = null, vgc = null, igdb = null } = {}) {
  if (!rating && !vgc?.score && !steam) return '';
  const parts = rating?.parts ?? [], beat = beatHours(igdb);
  return `${hoverHead(rating ? `Score ${rating.value}` : 'Not rated yet', rating ? `${rating.thin ? 'Few ratings so far · ' : ''}via ${rating.via}` : '')}
    ${parts.length ? `<ul class="hc-bars">${parts.map(part => `<li><span>${escapeHtml(part.label)}</span><i style="--v:${Math.max(0, Math.min(100, part.value))}%"></i><b>${part.value}${escapeHtml(part.unit ?? '')}</b><small>${part.count ? escapeHtml(plural(part.count, part.label === 'Critics' ? 'review' : 'rating')) : ''}</small></li>`).join('')}</ul>` : ''}
    ${rating?.from ? `<p class="hc-note">Ratings of ${escapeHtml(rating.from)}</p>` : ''}
    ${[rating?.source !== 'steam' && steamText(steam), vgc?.score != null && `VGC Score ${vgc.score}${vgc.criticCount ? ` · ${plural(vgc.criticCount, 'critic review')}` : ''}`, beat && `About ${beat}h for the main story`].filter(Boolean).map(line => `<p class="hc-note">${escapeHtml(line)}</p>`).join('')}`;
}
export function vgcHoverHtml(vgc) {
  if (vgc?.score == null) return '';
  return `${hoverHead(`VGC Score ${vgc.score}`, 'VideoGamesCritic')}<ul class="hc-bars">${[['Critics', vgc.critics], ['Players', vgc.players]].filter(([, value]) => value != null).map(([label, value]) => `<li><span>${label}</span><i style="--v:${value}%"></i><b>${value}</b><small>${label === 'Critics' && vgc.criticCount ? plural(vgc.criticCount, 'review') : ''}</small></li>`).join('')}</ul>${[vgc.gap, TREND[vgc.trend]].filter(Boolean).map(line => `<p class="hc-note">${escapeHtml(line)}</p>`).join('')}`;
}
export function beatHoverHtml(igdb) {
  const beat = beatHours(igdb); if (!beat) return '';
  const hours = key => { const value = Math.round((igdb.ttb?.[key] ?? 0) / 3600); return value > 0 && value <= MAX_BEAT_HOURS * 2 ? value : null; };
  const rows = [['Main story', beat], ['Main + extras', hours('extra')], ['Everything', hours('complete')]].filter(([, value]) => value);
  return `${hoverHead('Time to beat', `IGDB · ${plural(igdb.ttb?.count ?? 0, 'report')}`)}<ul class="hc-list">${rows.map(([label, value]) => `<li><b>${label}</b><span>~${value}h</span></li>`).join('')}</ul>`;
}

// A badge for game cards: Game of the Year, a number of awards, or a GOTY nomination.
export function awardChipHtml(awards) {
  const summary = awardSummary(awards);
  if (!summary) return '';
  const icon = summary.tier === 'goty' ? '🏆' : summary.tier === 'winner' ? '🏅' : '';
  return `<span class="chip award-chip is-${summary.tier}"${hoverAttr(awardHoverHtml(awards))}>${icon ? `<span aria-hidden="true">${icon}</span> ` : ''}${escapeHtml(summary.short)}</span>`;
}
// A seal on the cover for winners: gold foil for Game of the Year, a quieter laurel with
// the count for other awards. Nominees only get the chip. Its shape (a laurel pill) keeps
// it apart from the round list-rank medals.
const LAUREL = '<svg class="laurel" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 20.5C4 18.4 2.4 14.7 3 10.5M16.5 20.5c3.5-2.1 5.1-5.8 4.5-10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.3 16.2c1.7-.2 3 .5 3.6 1.9-1.6.4-3-.3-3.6-1.9zM3.2 12.4c1.6-.5 3 0 3.9 1.3-1.5.6-3 .1-3.9-1.3zM3.4 8.6c1.4-.7 2.9-.4 3.9.8-1.4.8-2.9.5-3.9-.8zM5 5.2c1.2-.9 2.7-.9 3.8.1-1.2 1-2.7 1-3.8-.1zM19.7 16.2c-1.7-.2-3 .5-3.6 1.9 1.6.4 3-.3 3.6-1.9zM20.8 12.4c-1.6-.5-3 0-3.9 1.3 1.5.6 3 .1 3.9-1.3zM20.6 8.6c-1.4-.7-2.9-.4-3.9.8 1.4.8 2.9.5 3.9-.8zM19 5.2c-1.2-.9-2.7-.9-3.8.1 1.2 1 2.7 1 3.8-.1z" fill="currentColor"/></svg>';
export function awardSealHtml(awards, { corner = 'start' } = {}) {
  const summary = awardSummary(awards);
  if (!summary || summary.tier === 'nominee') return '';
  const label = summary.short;
  return `<span class="award-seal is-${summary.tier} at-${corner}"${hoverAttr(awardHoverHtml(awards))} aria-label="${escapeHtml(summary.headline)}">${LAUREL}<b>${escapeHtml(label)}</b></span>`;
}

// "Awards" detail section: Game of the Year wins, other wins, then GOTY nominations.
export function awardsSectionHtml(awards) {
  const summary = awardSummary(awards);
  if (!summary) return '';
  const line = (award, prefix = '') => `<li>${prefix}<strong>${escapeHtml(award.name)}</strong> · ${escapeHtml(awardPlace(award))}</li>`;
  const wins = summary.categoryWins.slice(0, 8);
  return `<div class="detail-section award-section"><h4>Awards</h4>
    <ul class="award-list">${summary.gotyWins.map(award => line(award, '<span aria-hidden="true">🏆</span> ')).join('')}${wins.map(award => line(award, '<span aria-hidden="true">🏅</span> ')).join('')}</ul>
    ${summary.categoryWins.length > wins.length ? `<p class="data-note">…and ${summary.categoryWins.length - wins.length} more category awards.</p>` : ''}
    ${summary.nominations.length ? `<p class="data-note">Game of the Year nominee: ${escapeHtml(summary.nominations.map(awardPlace).join(', '))}</p>` : ''}
    <a class="provider-credit" href="https://www.wikidata.org/" target="_blank" rel="noopener noreferrer">Awards from Wikidata ↗</a></div>`;
}

// Where a review-backed Game Atlas list game's score comes from: the critics who reviewed
// this version (from its Wikipedia page's review box) and IGDB's players, with links.
const count = value => value.toLocaleString('en');
export function reviewsSectionHtml(reviews) {
  if (!reviews?.critics && !reviews?.players) return '';
  const { critics, players } = reviews, outlets = critics?.outlets ?? [];
  const wiki = reviews.wikipedia ? `https://en.wikipedia.org/wiki/${encodeURIComponent(reviews.wikipedia.replace(/ /g, '_'))}` : null;
  return `<div class="detail-section reviews-section"><h4>Reviews</h4><ul class="review-evidence">
    ${critics ? `<li><strong>Critics ${Math.round(critics.value)}</strong> · ${count(critics.count)} review${critics.count === 1 ? '' : 's'}${outlets.length ? `: ${escapeHtml(outlets.slice(0, 8).join(', '))}${outlets.length > 8 ? ` and ${outlets.length - 8} more` : ''}` : ' (IGDB)'}</li>` : '<li>No critic reviews of this version found.</li>'}
    ${players?.source === 'steam' ? `<li><strong>Players ${Math.round(players.value)}</strong> · Steam reviews of the PC version: ${players.percent}% positive of ${count(players.reviews ?? players.count)} (Steam runs about 6 points above other player scores)</li>`
      : players ? `<li><strong>Players ${Math.round(players.value)}</strong> · ${count(players.count)} rating${players.count === 1 ? '' : 's'} on IGDB</li>` : reviews.port ? '<li>Player ratings are left out: they rate the original release, not this later port.</li>' : ''}</ul>
    ${critics?.source === 'wikipedia' && wiki ? `<a class="provider-credit" href="${escapeHtml(wiki)}" target="_blank" rel="noopener noreferrer">Review scores from Wikipedia ↗</a>` : ''}
    ${reviews.igdb?.url && players?.source !== 'steam' ? `<a class="provider-credit" href="${escapeHtml(reviews.igdb.url)}" target="_blank" rel="noopener noreferrer">Player ratings from IGDB ↗</a>` : ''}</div>`;
}

// VideoGamesCritic's patch-aware score, always with its "Powered by" link (their terms).
const TREND = { improving: 'Player reviews are improving', declining: 'Player reviews are getting worse' };
export function vgcSectionHtml(vgc) {
  if (!vgc?.score && vgc?.score !== 0) return '';
  const patch = vgc.sincePatch && Math.abs(vgc.sincePatch.score - (vgc.players ?? vgc.score)) >= 3
    ? `Since ${vgc.sincePatch.title ?? 'the latest patch'}${vgc.sincePatch.date ? ` (${vgc.sincePatch.date})` : ''}: players ${vgc.sincePatch.score}${vgc.sincePatch.reviews ? ` from ${vgc.sincePatch.reviews.toLocaleString()} reviews` : ''}` : null;
  const lines = [
    [vgc.players != null && `players ${vgc.players}`, vgc.critics != null && `critics ${vgc.critics}${vgc.criticCount ? ` (${vgc.criticCount} reviews)` : ''}`, vgc.confidence && `${vgc.confidence} confidence`].filter(Boolean).join(' · '),
    vgc.gap, patch, TREND[vgc.trend],
  ].filter(Boolean);
  return `<div class="detail-section vgc-section"><h4>VGC Score</h4><p class="vgc-headline"><strong class="vgc-score">${vgc.score}</strong><span>${escapeHtml(lines[0] ?? '')}</span></p>
    ${lines.length > 1 ? `<ul class="score-lines">${lines.slice(1).map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : ''}
    ${vgcCreditHtml(vgc)}</div>`;
}
export const vgcCreditHtml = vgc => `<a class="provider-credit vgc-credit" href="${escapeHtml(vgc?.url ?? 'https://videogamescritic.com/')}" target="_blank" rel="noopener noreferrer">Powered by VideoGamesCritic ↗</a>`;
// The VGC Score next to ours on cards. Inside a card's button it can't be a link, so the
// credit their terms ask for goes just below the card (vgcCreditHtml); with no VGC score, neither shows.
export const vgcChipHtml = vgc => vgc?.score != null ? `<span class="chip vgc-chip"${hoverAttr(vgcHoverHtml(vgc))}>VGC ${vgc.score}</span>` : '';
export const vgcCardCreditHtml = vgc => vgc?.score != null ? vgcCreditHtml(vgc) : '';
// Both on one line, for cards that aren't a single button (Play suggestions, triage).
export const vgcLineHtml = vgc => vgc?.score != null ? `<p class="vgc-line">${vgcChipHtml(vgc)} ${vgcCreditHtml(vgc)}</p>` : '';

export function beatChipHtml(igdb) {
  const beat = beatHours(igdb);
  return beat ? `<span class="chip"${hoverAttr(beatHoverHtml(igdb))}>~${beat}h</span>` : '';
}

// Fixing a match: confirm it, reject it, or point at the right IGDB game.
// Corrections are saved by the local server and win over automatic matching.
export function matchFixHtml({ collection, key, igdb }) {
  const needsCheck = igdb && igdb.confidence !== 'high';
  return `<details class="match-fix" data-match-fix data-collection="${escapeHtml(collection)}" data-key="${escapeHtml(key)}"${needsCheck ? ' open' : ''}>
    <summary>${igdb ? (needsCheck ? 'Is this the right game?' : 'Wrong game?') : 'Link this game on IGDB'}</summary>
    <div class="match-fix-actions">
      ${needsCheck ? '<button type="button" data-fix="confirmed">Looks right</button>' : ''}
      ${igdb ? '<button type="button" data-fix="rejected">Wrong game — hide this score</button>' : ''}
      <form data-fix-form><label>IGDB game link or id<input name="target" placeholder="https://www.igdb.com/games/super-metroid" required></label><button type="submit">Use this game</button></form>
    </div>
    <p class="match-fix-status" role="status"></p>
  </details>`;
}

function parseTarget(value) {
  const text = String(value).trim(), slug = text.match(/igdb\.com\/games\/([a-z0-9-]+)/i)?.[1];
  if (slug) return { slug: slug.toLowerCase(), igdbId: null };
  if (/^\d{1,12}$/.test(text)) return { igdbId: Number(text), slug: null };
  if (/^[a-z0-9][a-z0-9-]+$/i.test(text)) return { slug: text.toLowerCase(), igdbId: null };
  return null;
}

export function bindMatchFixes(root) {
  async function save(box, payload) {
    const status = box.querySelector('.match-fix-status');
    status.textContent = 'Saving…';
    try {
      const response = await fetch('/__retro_library/igdb-match', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Retro-Library': '1' },
        body: JSON.stringify({ collection: box.dataset.collection, key: box.dataset.key, igdbId: null, slug: null, ...payload }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Corrections need the local Level Select server.');
      status.innerHTML = payload.decision === 'replaced'
        ? 'Saved. Scores for the new game arrive with the next <code>npm run igdb:refresh</code>. <button type="button" data-fix-reload>Reload now</button>'
        : 'Saved. <button type="button" data-fix-reload>Reload to update scores</button>';
    } catch (error) { status.textContent = error.message; }
  }
  root.addEventListener('click', event => {
    if (event.target.closest('[data-fix-reload]')) { location.reload(); return; }
    const button = event.target.closest('[data-fix]'), box = button?.closest('[data-match-fix]');
    if (box) save(box, { decision: button.dataset.fix });
  });
  root.addEventListener('submit', event => {
    const form = event.target.closest('[data-fix-form]'), box = form?.closest('[data-match-fix]'); if (!box) return;
    event.preventDefault();
    const target = parseTarget(new FormData(form).get('target'));
    if (!target) { box.querySelector('.match-fix-status').textContent = 'Paste a link like https://www.igdb.com/games/super-metroid, or a number.'; return; }
    save(box, { decision: 'replaced', ...target });
  });
}

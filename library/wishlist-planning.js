import { escapeHtml as esc } from '../lib.js';
import { awardSealHtml } from './score-ui.js';
import { PRICE_CURRENCIES } from '../tracking/domain.js';
import { igdbRating, beatHours } from '../tracking/score.js';
import { titleKey } from './core.js';
import { vgcCreditHtml } from './score-ui.js';
import { sendOff, bringBack } from './motion.js';
import { WISHLIST_LABELS, entryFor, latestReview, activeReview, nextReviewTarget, parseTargetPrice, formatMoney, targetPriceStatus, acquisitionCandidates, ownedAlternatives } from '../tracking/wishlist.js';

// Prices are in minor units of your Steam store's currency. The export's own price text can
// be a converted price from another region, so it's never shown.
const storePrice = pence => pence === 0 ? 'Free' : new Intl.NumberFormat(undefined, { style: 'currency', currency: window.WISHLIST_STATS?.currency ?? 'GBP' }).format(pence / 100);
export function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
const weekLater = () => { const date = new Date(); date.setDate(date.getDate()+7); return localDate(date); };
const amountText = price => price ? (price.amountMinor / 10 ** PRICE_CURRENCIES[price.currency]).toFixed(PRICE_CURRENCIES[price.currency]) : '';
const currencyOptions = price => Object.keys(PRICE_CURRENCIES).map(currency => `<option${currency === (price?.currency ?? window.WISHLIST_STATS?.currency ?? 'GBP') ? ' selected' : ''}>${currency}</option>`).join('');
const priceFields = (price, prefix) => `<label>Target price (optional)<input name="amount" data-${prefix}-amount inputmode="decimal" value="${esc(amountText(price))}" placeholder="For example, 15.00"></label><label>Currency<select name="currency" data-${prefix}-currency>${currencyOptions(price)}</select></label>`;
function snapshotText(game, entry) {
  const snapshot = game?.priceSnapshot, status = targetPriceStatus(entry, snapshot, new Date().toISOString());
  return `<p class="wish-muted">${snapshot ? `Imported price: ${esc(formatMoney(snapshot))} · Observed ${esc(snapshot.observedAt ?? 'on an unknown date')}. ` : 'Price observation date and currency are not recorded in this older import. '}${esc(status.label)}. No background price checks run.</p>`;
}

export function setupWishlistPlanning({ client, getVisibleGames, renderPage, describe = () => ({ steam: null, igdb: null, owned: [] }) }) {
  const $ = id => document.getElementById(id);
  let reviewId = '', compareExpected = [], compareGames = [];
  function render() {
    const session = latestReview(client.snapshot()), active = activeReview(client.snapshot());
    $('reviewSummary').textContent = session ? `${Object.keys(session.reviewed).length} of ${session.targetIds.length} distinct games reviewed${session.completedAt ? ' · Session complete' : ' · Progress saved in this workspace'}. Keeps count too.` : 'Review up to ten games from your current filters. Keeping a game counts as progress.';
    $('reviewStart').textContent = active ? 'Resume review' : 'Review up to 10 games';
    $('reviewLast').hidden = !session || !session.completedAt;
  }
  async function attempt(operation, status, success) {
    try {
      if (status?.isConnected) status.textContent = 'Saving…';
      const result = await operation();
      if (success) success(result);
      if (status?.isConnected) status.textContent = result.saved ? 'Saved in this workspace.' : 'Session only — export a backup before leaving.';
      return result;
    } catch (error) { if (status?.isConnected) status.textContent = error.message; return null; }
  }
  function savedPlan(result) {
    renderPage();
    const status = $('wishlistDecisionTracking')?.querySelector('[data-wish-status]');
    if (status) status.textContent = result.saved ? 'Saved in this workspace.' : 'Session only — export a backup before leaving.';
  }
  function mount(host, game) {
    const snapshot = client.snapshot(), before = entryFor(snapshot, { provider: 'steam', id: String(game.appid) });
    const decision = before?.decision ?? 'interested', matches = acquisitionCandidates(game, client.library);
    const alternatives = ownedAlternatives(game, { state: snapshot, catalog: client.catalog, library: client.library });
    host.className = 'wish-planning';
    host.innerHTML = `<h3>Your wishlist plan</h3><p><strong>${esc(WISHLIST_LABELS[decision])}</strong>${before?.snoozeUntil ? ` · Snoozed until ${esc(before.snoozeUntil)}` : ''}</p>
      <form data-wish-form><div class="wish-fields"><label>Decision<select name="decision">${Object.entries(WISHLIST_LABELS).filter(([key]) => key !== 'acquired' || decision === 'acquired').map(([key, label]) => `<option value="${key}"${decision === key ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label>Interest priority<select name="priority">${['Normal','Interested','Want soon','Highest'].map((label,index)=>`<option value="${index}"${index === (before?.priority ?? 0) ? ' selected' : ''}>${label}</option>`).join('')}</select></label>${priceFields(before?.targetPrice,'wish')}<label>Review on (optional)<input name="reviewOn" type="date" value="${esc(before?.reviewOn ?? '')}"></label><label>Snooze until (optional)<input name="snoozeUntil" type="date" value="${esc(before?.snoozeUntil ?? '')}"></label></div><label>Reason (optional)<textarea name="reason" maxlength="2000" rows="2">${esc(before?.reason ?? '')}</textarea></label><button type="submit">Save wishlist plan</button></form>${snapshotText(game,before)}
      ${decision === 'acquired' ? `<p>Acquisition recorded · ${esc(before.acquiredAt?.slice(0,10) ?? 'date unknown')}. It is excluded from removal exports.</p>` : `<details><summary>Record acquisition</summary><p>Record ownership of this exact wanted edition. Another platform or a similar title does not automatically satisfy it.</p>${matches.length ? `<p>Import match by Steam app ID: ${matches.map(match=>esc(`${match.title} · ${match.platforms.join(', ')}`)).join('; ')}. Confirm your acquisition below.</p>` : ''}<form data-acquire-form><label class="wish-check"><input name="confirmed" type="checkbox" required> I own this wanted Steam/PC edition.</label><label>Acquisition date (clear if unknown)<input name="acquiredDate" type="date" value="${localDate()}"></label><label>After recording<select name="handoff"><option value="library">Keep in library</option><option value="backlog">Add to backlog</option><option value="upnext">Add to Up Next</option></select></label><button type="submit">Record acquisition</button></form></details>`}
      ${alternatives.length ? `<details><summary>Owned alternatives (${alternatives.length})</summary><ul>${alternatives.map(choice => {
        const ref = choice.option.descriptor.ref, owned = client.library.find(item => item.copies.some(copy => copy.id === ref.id));
        const href = ref.provider === 'playnite' && owned ? `index.html?game=${encodeURIComponent(owned.id)}` : `../library/backlog.html?workspace=${client.namespace}`;
        return `<li><a href="${href}">${esc(choice.title)}</a> · ${esc(choice.overlap.join(', '))}${choice.option.favorite ? ' · Favorite' : ''}<br><small>${esc(choice.platformReason)}</small></li>`;
      }).join('')}</ul></details>` : '<p class="wish-muted">No eligible owned alternatives share the available genre metadata.</p>'}<p data-wish-status role="status"></p>`;
    host.querySelector('[data-wish-form]').onsubmit = async event => {
      event.preventDefault(); const values = new FormData(event.target), status = host.querySelector('[data-wish-status]');
      await attempt(() => client.decideWishlist(game.appid, { expected: before, decision: values.get('decision'), fields: {
        priority: Number(values.get('priority')), reason: values.get('reason'), targetPrice: parseTargetPrice(values.get('amount'),values.get('currency')),
        reviewOn: values.get('reviewOn') || null, snoozeUntil: values.get('snoozeUntil') || null,
      } }), status, savedPlan);
    };
    host.querySelector('[data-acquire-form]')?.addEventListener('submit', async event => {
      event.preventDefault(); const values = new FormData(event.target), day = values.get('acquiredDate');
      await attempt(() => client.acquireWishlist(game.appid, { expected: before, confirmed: values.get('confirmed') === 'on', handoff: values.get('handoff'), acquiredAt: day ? `${day}T00:00:00.000Z` : null }), host.querySelector('[data-wish-status]'), savedPlan);
    });
    const acquisitionForm = host.querySelector('[data-acquire-form]');
    if (acquisitionForm) {
      const hint = document.createElement('p');
      hint.className = 'wish-muted';
      hint.textContent = 'Saved acquisitions appear in the Acquired view. The Owned Games page updates when you import your library.';
      acquisitionForm.after(hint);
    }
  }
  // One wishlist game per card: what you need to decide, then five plain choices.
  const REVIEW_ACTIONS = [['want-soon', 'Buy soon', '1'], ['keep', 'Keep', '2'], ['wait-for-price', 'Wait for a sale', '3'], ['archive', 'Remove', '4'], ['snooze', 'Ask me later', 'S']];
  const SEND_OFF = { 'want-soon': ['right', 'Buy soon'], keep: ['right', 'Kept'], 'wait-for-price': ['down', 'Wait for a sale'], archive: ['left', 'Removed'], snooze: ['up', 'Later'] };
  const DONE_TEXT = { 'want-soon': 'Marked to buy soon.', keep: 'Kept on your wishlist.', 'wait-for-price': 'Waiting for a sale.', archive: 'Removed here — also remove it on Steam when you are ready.', snooze: 'We’ll ask again in a month.' };
  const monthLater = () => { const date = new Date(); date.setDate(date.getDate() + 30); return localDate(date); };
  const ageText = added => {
    if (!added) return null;
    const days = Math.floor((Date.now() - Date.parse(`${added}T00:00:00Z`)) / 86400000);
    return days >= 730 ? `On your wishlist for ${Math.floor(days / 365)} years` : days >= 60 ? `On your wishlist for ${Math.floor(days / 30)} months` : 'Added recently';
  };
  const compactCount = count => count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count);
  // The owned game a wish is judged against, the suggestion, and (when we can't tell) a
  // one-tap "Did you enjoy it?" that updates the suggestion straight away.
  const VERDICT_TITLES = { 'play-first': 'Play yours first', keep: 'Worth keeping', 'keep-best': 'Keep the best one', remove: 'Probably not for you', reconsider: 'Worth a second look', ask: 'See how you like it first', upgrade: 'Only if you’ll play it again' };
  function anchorHtml(info) {
    const { verdict: result } = info, anchor = result.anchor, score = anchor.rating ? ` · score ${anchor.rating.value}` : '';
    const ask = !anchor.answered && ['unplayed', 'tried', 'playing', 'probably-enjoyed', 'mixed'].includes(anchor.feeling);
    // A remaster or remake of a game you own says so first; the suggestion follows.
    const heading = anchor.relation === 'original' ? `You own the original · ${VERDICT_TITLES[result.kind]}` : VERDICT_TITLES[result.kind];
    const about = anchor.relation === 'original' ? `${anchor.title}${anchor.igdb?.year ? ` (${anchor.igdb.year})` : ''}${score}${anchor.hours ? ` · ${anchor.hours}h played` : ''}` : `Judged against ${anchor.title} (${anchor.relationLabel}${anchor.gameplay ? ` · ${anchor.gameplay}` : ''}${score}${anchor.hours ? ` · ${anchor.hours}h played` : ''})`;
    return `<div class="wish-callout is-anchor is-${result.kind}"><strong>${esc(heading)}</strong><span>${esc(result.text)}</span>
      <small>${esc(about)}</small>
      ${ask ? `<div class="anchor-ask" data-anchor-copy="${esc(anchor.copyId)}"><span>Did you enjoy ${esc(anchor.title)}?</span><button type="button" data-enjoyed="yes">Yes</button><button type="button" data-enjoyed="no">Not really</button><button type="button" data-enjoyed="unplayed">Haven't played</button></div>` : ''}
    </div>`;
  }
  // What you own of this game, strongest first: the game itself, another edition, a newer version.
  const OWNS_ORDER = ['same', 'edition', 'newer'];
  function ownedHtml(info, game, place) {
    const copies = [...info.owned].sort((a, b) => OWNS_ORDER.indexOf(a.owns) - OWNS_ORDER.indexOf(b.owns)), first = copies[0];
    const heading = first.owns === 'same' ? 'You already own this' : first.owns === 'edition' ? 'You own another edition' : `You own the ${first.version ?? 'newer version'}`;
    const lines = copies.map(copy => [titleKey(copy.name) !== titleKey(game.title) ? copy.name : null, place(copy)].filter(Boolean).join(' · '));
    return `<div class="wish-callout is-owned"><strong>${esc(heading)}</strong><span>${esc(lines.join('; '))}</span><small>Nothing more to buy. Remove it here, then on Steam when you're ready.</small></div>`;
  }
  // One wish as a game sheet: art with the numbers that matter under it, then what we know.
  function reviewCard(game, target, before) {
    if (!game) return `<div class="wish-card-copy"><h3 id="wishCardTitle">${esc(target.title)}</h3><p class="wish-muted">No longer in your imported wishlist; your saved decision is kept.</p></div>`;
    const info = describe(game), igdb = info.igdb, igdbScore = igdbRating(igdb), beat = beatHours(igdb);
    const place = copy => [copy.sources.join('/'), copy.platforms.map(name => name.replace(/^PC \(Windows\)$/, 'PC').replace(/^Sony /, '')).join('/')].filter(Boolean).join(' · ') + (copy.hours ? ` · ${copy.hours}h played` : '');
    const callout = info.owned.length ? ownedHtml(info, game, place)
      : info.verdict ? anchorHtml(info)
      : (() => { const alternatives = ownedAlternatives(game, { state: client.snapshot(), catalog: client.catalog, library: client.library }).slice(0, 2);
          const similar = alternatives.length ? `<div class="wish-callout"><strong>Similar games you own</strong><span>${esc(alternatives.map(choice => `${choice.title}${choice.option.rating ? ` (${choice.option.rating.value})` : ''}`).join(', '))}</span></div>` : '';
          // Nothing you own to judge it by: its awards speak for it.
          const award = info.awards && info.awards.tier !== 'nominee' ? `<div class="wish-callout is-award"><strong>${info.awards.tier === 'goty' ? 'Game of the Year winner' : 'Award winner'}</strong><span>${esc(info.awards.headline)}</span>${info.awards.tier === 'goty' ? '<small>One of the most recognised games of its year. Worth keeping if it’s your kind of game.</small>' : ''}</div>` : '';
          return award + similar; })();
    const tile = (label, value, note, good = false) => `<div class="${good ? 'is-good' : ''}"><dt>${label}</dt><dd>${value}</dd>${note ? `<small>${note}</small>` : ''}</div>`;
    const tiles = [
      info.steam ? tile('Steam', `${info.steam.percent}%`, info.steam.count ? `${compactCount(info.steam.count)} reviews` : 'positive', info.steam.percent >= 90) : null,
      igdbScore ? tile('Score', igdbScore.value, igdbScore.thin ? 'IGDB · few ratings' : 'IGDB', igdbScore.value >= 85) : null,
      game.vgc ? tile('VGC Score', game.vgc.score, vgcCreditHtml(game.vgc), game.vgc.score >= 85) : null,
      !info.steam && !igdbScore ? tile('Reviews', '–', 'none yet') : null,
      tile('Price', game.pricePence != null ? esc(storePrice(game.pricePence)) : game.comingSoon ? 'Soon' : '–', game.discount ? `<span class="wish-sale">−${game.discount}% right now</span>` : game.comingSoon ? 'not released yet' : game.pricePence == null ? 'price unknown' : ''),
      beat ? tile('Length', `${beat}h`, 'main story') : null,
    ].filter(Boolean);
    const kicker = [game.year || 'TBA', ...(game.genres ?? []).slice(0, 3)].join(' · ');
    // The awards line, unless the award callout above already says it.
    const awardFact = info.awards && (info.owned.length || info.verdict || info.awards.tier === 'nominee') ? info.awards.headline : null;
    // VGC tracks player reviews since the latest patch; a real change is worth knowing about.
    const trend = { improving: 'Player reviews improving lately', declining: 'Player reviews getting worse lately' }[game.vgc?.trend];
    const facts = [awardFact, trend, ageText(game.addedSort), before?.decision && `Currently: ${WISHLIST_LABELS[before.decision]}`].filter(Boolean);
    return `<div class="wish-sheet">
        <div class="wish-card-art">${game.image ? `<img src="${esc(game.image)}" alt="">` : `<span>${esc(game.title.slice(0, 2).toUpperCase())}</span>`}${awardSealHtml(game.awards)}</div>
        <dl class="wish-stats">${tiles.join('')}</dl>
      </div>
      <div class="wish-card-copy">
        <p class="wish-card-kicker">${esc(kicker)}</p>
        <h3 id="wishCardTitle">${esc(game.title)}</h3>
        ${callout}
        ${facts.length ? `<ul class="wish-facts">${facts.map(fact => `<li>${esc(fact)}</li>`).join('')}</ul>` : ''}
      </div>`;
  }
  function renderReview(result, message = '') {
    const state = client.snapshot(), session = state.reviewSessions[reviewId];
    if (!session) return;
    const targetId = nextReviewTarget(session), target = state.targets[targetId], before = state.wishlist[targetId] ?? null;
    const appid = target?.refs.find(ref => ref.provider === 'steam')?.id, game = client.wishlist.find(game => String(game.appid) === appid);
    const done = Object.keys(session.reviewed).length, total = session.targetIds.length;
    const suggested = game ? describe(game).suggested ?? null : null;
    $('reviewBody').innerHTML = `<p class="eyebrow wish-progress">${target ? `Game ${done + 1} of ${total}` : `${total} of ${total}`}</p><div class="triage-track" aria-hidden="true"><span style="width:${done / Math.max(total, 1) * 100}%"></span></div>
      ${target ? `<article class="wish-card enter"${game?.image ? ` style="--art:url('${esc(game.image)}')"` : ''}>${reviewCard(game, target, before)}</article>
        <details class="wish-sale-target"><summary>Set a target price for “Wait for a sale”</summary><div class="wish-fields">${priceFields(before?.targetPrice,'review')}</div></details>
        <div class="wish-decisions">${REVIEW_ACTIONS.map(([action, label, key]) => `<button type="button" data-review-action="${action}" class="${suggested === action ? 'is-suggested ' : ''}${action === 'want-soon' ? 'is-primary' : action === 'archive' ? 'is-remove' : action === 'snooze' ? 'is-quiet' : ''}">${label} <kbd>${key}</kbd></button>`).join('')}</div>`
      : `<div class="wish-done"><h3 id="wishCardTitle">Session complete</h3><p>${esc(reviewSummary(session, state))}</p><p class="wish-muted">Removed games stay on Steam until you remove them there — see the removal checklist on this page.</p><button type="button" id="reviewAgain" class="is-primary">Review 10 more</button></div>`}
      <footer class="wish-review-foot"><p id="reviewActionStatus" role="status">${esc(message)}</p><button type="button" id="reviewUndo" class="is-quiet"${done ? '' : ' disabled'}>Undo <kbd>Z</kbd></button></footer>`;
    if (result && !message) $('reviewActionStatus').textContent = result.saved ? '' : 'Session only — export a backup before leaving.';
    $('reviewBody').querySelectorAll('[data-review-action]').forEach(button => button.onclick = () => decide(button.dataset.reviewAction, targetId, before, target));
    $('reviewBody').querySelectorAll('[data-enjoyed]').forEach(button => button.onclick = async () => {
      const copyId = button.closest('[data-anchor-copy]').dataset.anchorCopy;
      const result = await attempt(() => client.annotate('playnite', copyId, { enjoyed: button.dataset.enjoyed }), $('reviewActionStatus'));
      if (result) renderReview(result, 'Thanks — that updates the suggestion.');
    });
    $('reviewUndo').onclick = undoReview;
    const again = $('reviewAgain'); if (again) again.onclick = startNewReview;
  }
  function reviewSummary(session, state) {
    const counts = {};
    for (const targetId of Object.keys(session.reviewed)) { const decision = state.wishlist[targetId]?.decision ?? 'snoozed'; counts[decision] = (counts[decision] ?? 0) + 1; }
    return Object.entries(counts).map(([decision, count]) => `${count} ${(WISHLIST_LABELS[decision] ?? 'asked later').toLowerCase()}`).join(' · ') || 'No decisions this time.';
  }
  let reviewBusy = false;
  async function decide(action, targetId, before, target) {
    if (reviewBusy) return;
    reviewBusy = true;
    const amount = $('reviewBody').querySelector('[data-review-amount]'), currency = $('reviewBody').querySelector('[data-review-currency]'), card = $('reviewBody').querySelector('.wish-card');
    $('reviewBody').querySelectorAll('[data-review-action]').forEach(button => { button.disabled = true; });
    const [result] = await Promise.all([attempt(() => client.reviewWishlist({ sessionId: reviewId, targetId, action, expected: before, today: localDate(), snoozeUntil: monthLater(),
      ...(action === 'wait-for-price' && amount?.value ? { targetPrice: parseTargetPrice(amount.value, currency.value) } : {}) }), $('reviewActionStatus')), sendOff(card, ...SEND_OFF[action])]);
    reviewBusy = false;
    if (result) { renderReview(result, `${target?.title ?? 'Game'}: ${DONE_TEXT[action]}`); renderPage(); }
    else { bringBack(card); $('reviewBody').querySelectorAll('[data-review-action]').forEach(button => { button.disabled = false; }); }
  }
  async function undoReview() {
    if (reviewBusy) return;
    reviewBusy = true;
    const result = await attempt(() => client.undoReview(reviewId), $('reviewActionStatus'));
    reviewBusy = false;
    if (result) { renderReview(result, 'Undone.'); renderPage(); }
  }
  // Easiest calls first: games you already own, then the weakest reviews, then the longest-waiting.
  function easiestFirst(games) {
    const order = { remove: 1, 'keep-best': 1, 'play-first': 2, upgrade: 2 };
    // Game of the Year winners are the hardest to let go of, so they come last.
    const key = game => { const info = describe(game); return [info.owned.length ? 0 : order[info.verdict?.kind] ?? (info.awards?.tier === 'goty' ? 4 : 3), info.steam?.percent ?? 75, game.addedSort ?? '9999']; };
    return games.map(game => [key(game), game]).sort(([a], [b]) => a[0] - b[0] || a[1] - b[1] || String(a[2]).localeCompare(String(b[2]))).map(([, game]) => game);
  }
  // Only wishes related to a game you own, grouped so a series comes up together.
  async function startAnchoredReview() {
    const games = getVisibleGames().map(game => [game, describe(game)]).filter(([, info]) => info.verdict || info.owned.length)
      .sort(([a, x], [b, y]) => Number(Boolean(y.owned.length)) - Number(Boolean(x.owned.length)) || (x.verdict?.anchor.igdbId ?? 0) - (y.verdict?.anchor.igdbId ?? 0) || (y.igdb?.players ?? 0) - (x.igdb?.players ?? 0))
      .map(([game]) => game.appid);
    const active = activeReview(client.snapshot()); if (active) { openReview(active); return; }
    const result = await attempt(() => client.startReview(games, localDate()), $('wishlistPlanningStatus'));
    if (result) openReview(activeReview(client.snapshot()));
  }
  $('reviewAnchored').onclick = startAnchoredReview;
  async function startNewReview() {
    const result = await attempt(() => client.startReview(easiestFirst(getVisibleGames()).map(game => game.appid), localDate()), $('wishlistPlanningStatus'));
    if (result) openReview(activeReview(client.snapshot()));
  }
  $('wishlistReview').addEventListener('keydown', event => {
    if (event.target.closest('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase(), action = REVIEW_ACTIONS.find(([, , hotkey]) => hotkey.toLowerCase() === key);
    const button = action && $('reviewBody').querySelector(`[data-review-action="${action[0]}"]`);
    if (button) { event.preventDefault(); button.click(); }
    else if (key === 'z' || key === 'backspace') { event.preventDefault(); undoReview(); }
  });
  function openReview(session) { reviewId = session.id; renderReview(); if(!$('wishlistReview').open)$('wishlistReview').showModal(); }
  $('reviewStart').onclick = async () => {
    const active = activeReview(client.snapshot()); if(active) { openReview(active); return; }
    await startNewReview();
  };
  $('reviewLast').onclick = () => openReview(latestReview(client.snapshot()));
  function compareSelection() {
    const games = [$('compareA').value,$('compareB').value].map(id=>client.wishlist.find(game=>String(game.appid)===id));
    compareExpected = games.map(game=>game ? entryFor(client.snapshot(),{provider:'steam',id:String(game.appid)}) : null);
    $('compareSummary').textContent = games.map((game,index)=>`${index ? 'B' : 'A'}: ${game?.title ?? 'Choose a game'} · ${compareExpected[index]?.decision ? WISHLIST_LABELS[compareExpected[index].decision] : 'Not reviewed'}`).join(' / ');
  }
  $('wishlistCompareOpen').onclick = () => {
    compareGames = getVisibleGames().filter(game=>!['archived','acquired'].includes(entryFor(client.snapshot(),{provider:'steam',id:String(game.appid)})?.decision));
    if(compareGames.length < 2) { $('wishlistPlanningStatus').textContent='Choose filters with at least two active wishlist games to compare.'; return; }
    compareGames.sort((a,b)=>a.title.localeCompare(b.title));
    for(const id of ['compareA','compareB']) $(id).innerHTML=compareGames.map(game=>`<option value="${esc(game.appid)}">${esc(game.title)}</option>`).join('');
    $('compareB').selectedIndex=1; compareSelection(); $('compareStatus').textContent=''; $('wishlistCompare').showModal();
  };
  $('compareA').onchange=compareSelection; $('compareB').onchange=compareSelection;
  $('wishlistCompare').querySelectorAll('[data-compare-choice]').forEach(button=>button.onclick=async()=>{
    const choice=button.dataset.compareChoice;
    if(choice==='skip') { $('compareStatus').textContent='Skipped. Both decisions are unchanged; choose another pair when ready.'; return; }
    const result=await attempt(()=>client.compareWishlist([$('compareA').value,$('compareB').value],{choice,expected:compareExpected}),$('compareStatus'));
    if(result) { compareSelection(); renderPage(); }
  });
  document.querySelectorAll('[data-close-wishlist-dialog]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
  client.subscribe(change=>{ render(); if(change.type==='refresh'&&$('wishlistReview').open&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))renderReview(); });
  return { render, mount };
}

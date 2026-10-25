import { showSearchSuggestions } from './search-ui.js';
import { trackingClient } from '../tracking/client.js';
import { mountTracking } from '../tracking/ui.js';
import { setupWishlistPlanning, localDate } from './wishlist-planning.js';
import { WISHLIST_LABELS, dueForReview, isSnoozed, targetPriceStatus, acquisitionCandidates } from '../tracking/wishlist.js';
import { titleSearch, matchesSearch, matchesCopy, titleKey, platformKey } from './core.js';
import { steamApproval } from '../ranking/evidence.js';
import { approvalText, approvalEvidenceHtml } from '../ranking/ui.js';
import { mountProviderRatings, loadRatings } from '../ranking/panels.js';
import { emptyRatings } from '../ranking/snapshot.js';
import { scoreSectionHtml, beatChipHtml, bindMatchFixes, awardChipHtml, awardsSectionHtml, vgcSectionHtml, vgcChipHtml, vgcCardCreditHtml, awardSealHtml } from './score-ui.js';
import { bindHovercards } from './hovercard.js';
import { ownedIndex, anchorsFor, ownedCopiesOf, verdict, originalAnchor, versionVerdict } from '../tracking/anchors.js';
import { awardSummary } from '../tracking/awards.js';
import { igdbRating } from '../tracking/score.js';
import { sourceIndex, sourceRating, importedWishlistRating, rankCandidates, compareResults, refKey, ratingText, SOURCE_MODES } from '../ranking/modes.js';
import { rankingSummaryHtml, rankingExplanationHtml, ratingAttributionHtml } from '../ranking/mode-ui.js';
import { readStore, writeStore, createRoute, openDetails, closeDetails as closePanel, setupCommon, notify } from './runtime.js';
import { pageReady } from '../navigation.js';

// Ratings download alongside the tracking data (this page's script tag already says which workspace).
loadRatings(window.WISHLIST_SAMPLE ? 'sample' : 'personal').catch(() => {});
const tracking = await trackingClient();
window.retroTracking = tracking;
let ratingsUnavailable=false;
const ratings=sourceIndex(await loadRatings(tracking.namespace).catch(()=>{ratingsUnavailable=true;return emptyRatings(tracking.namespace);}));
let ranked;
const PAGE_SIZE_KEY = 'steam-wishlist-page-size';
const PAGE_SIZE_OPTIONS = [12, 24, 48, 96];
let removedStore = tracking.edits().removed, notesStore = tracking.edits().notes;
let planningState, decisions;
function syncTracking() {
  ({removed:removedStore,notes:notesStore}=tracking.edits()); planningState=tracking.snapshot(); decisions=new Map();
  for(const target of Object.values(planningState.targets))for(const ref of target.refs)if(ref.provider==='steam')decisions.set(ref.id,planningState.wishlist[target.id]);
}
syncTracking();
const decisionFor = game => decisions.get(String(game.appid));
const isAcquired = game => decisionFor(game)?.decision === 'acquired';
const wishlist = window.STEAM_WISHLIST || [];
const stats = window.WISHLIST_STATS || {};
const ownedNames = new Map();
for (const game of tracking.library) {
  const key = titleKey(game.name);
  ownedNames.set(key, ownedNames.has(key) ? null : game);
}
function ownership(game) {
  const exact = acquisitionCandidates(game,tracking.library)[0];
  if(exact)return `<a class="snapshot-owned" href="index.html?game=${encodeURIComponent(exact.ownedId)}">Imported Steam copy — confirm acquisition ↗</a>`;
  const match = ownedNames.get(titleKey(game.title));
  if (!match) return '';
  const pc = match.platforms.some(platform => platformKey(platform) === 'dos');
  return `<a class="snapshot-owned" href="index.html?game=${encodeURIComponent(match.id)}">${pc ? 'Similar title on PC — confirm edition' : 'Similar title on another platform'} ↗</a>`;
}

function isRemoved(game) {
  return Boolean(removedStore[game.appid]);
}

async function setRemoved(appid, removed) {
  await tracking.run(() => tracking.removeWishlist([appid],removed));
  syncTracking();
}

function loadPageSize() {
  const stored = Number(readStore(PAGE_SIZE_KEY, 0));
  return PAGE_SIZE_OPTIONS.includes(stored) ? stored : 48;
}

const state = {
  page: 1,
  pageSize: loadPageSize(),
  view: "grid",
  removed: "active",
  release: "",
  sale: "",
  topCount: 5,
};

const el = {
  meta: document.querySelector("#wishlistMeta"),
  search: document.querySelector("#searchInput"),
  mainGenre: document.querySelector("#mainGenreFilter"),
  genre: document.querySelector("#genreFilter"),
  feature: document.querySelector("#featureFilter"),
  reviewPctMin: document.querySelector("#reviewPctMin"),
  reviewCountMin: document.querySelector("#reviewCountMin"),
  priceMax: document.querySelector("#priceMax"),
  sort: document.querySelector("#sortMode"),
  ratingSource: document.querySelector("#ratingSource"),
  decision: document.querySelector('#decisionFilter'),
  reviewDue: document.querySelector('#reviewDueFilter'),
  targetPrice: document.querySelector('#targetPriceFilter'),
  removedFilter: document.querySelector("#removedFilter"),
  releaseFilter: document.querySelector("#releaseFilter"),
  saleFilter: document.querySelector("#saleFilter"),
  yearMin: document.querySelector("#yearMin"),
  yearMax: document.querySelector("#yearMax"),
  reset: document.querySelector("#resetFilters"),
  exportRemoved: document.querySelector("#exportRemoved"),
  exportTrimmed: document.querySelector("#exportTrimmed"),
  restoreAll: document.querySelector("#restoreAll"),
  stats: document.querySelector("#statsStrip"),
  resultCount: document.querySelector("#resultCount"),
  activeSummary: document.querySelector("#activeSummary"),
  pageInfo: document.querySelector("#pageInfo"),
  prev: document.querySelector("#prevPage"),
  next: document.querySelector("#nextPage"),
  pageSize: document.querySelector("#pageSizeSelect"),
  pageSizeField: document.querySelector("#pageSizeField"),
  topCount: document.querySelector("#topCountSelect"),
  topCountField: document.querySelector("#topCountField"),
  results: document.querySelector("#results"),
  gridView: document.querySelector("#gridView"),
  listView: document.querySelector("#listView"),
  topViewButton: document.querySelector("#topView"),
  overlay: document.querySelector("#detailsOverlay"),
  panel: document.querySelector("#detailsPanel"),
  details: document.querySelector("#detailsContent"),
  closeDetails: document.querySelector("#closeDetails"),
};

function selectedMode() {
  if(el.ratingSource.value==='steam' && state.view!=='top')return el.sort.value==='reviewPct'?'steam-raw':el.sort.value==='reviewCount'?'steam-volume':'steam';
  return el.ratingSource.value;
}
function baseRating(game) {
  return el.ratingSource.value==='imported'?importedWishlistRating(game,{mode:state.view==='top'?'imported':el.sort.value==='reviewPct'?'imported-raw':el.sort.value==='reviewCount'?'imported-volume':'imported'}):sourceRating(ratings,{provider:'steam',id:String(game.appid)},selectedMode(),{comingSoon:game.comingSoon});
}
function selectedRating(game) { return ranked?.records.get(refKey({provider:'steam',id:String(game.appid)}))??baseRating(game); }
function compareSelected(a,b) {
  return compareResults({...selectedRating(a),title:a.title},{...selectedRating(b),title:b.title});
}
function selectedEligible(game) { return selectedRating(game).value!==null; }
const compactCount = count => count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count);
function selectedLabel(game) {
  if(el.ratingSource.value==='imported')return approvalText(game);
  // Steam cards show what Steam shows (% positive and review count); the sort still
  // uses the confidence-weighted value so tiny samples don't jump the queue.
  if(el.ratingSource.value==='steam'){const steam=describeGame(game).steam;return steam?`Steam ${steam.percent}%${steam.count?` · ${compactCount(steam.count)} reviews`:''}`:'No Steam reviews yet';}
  const result=selectedRating(game);
  return ratingText(result)+(result.value!==null && result.scope==='work-context'?' · overall game':'');
}
function prepareRanking() {
  const steam=['steam','imported'].includes(el.ratingSource.value);
  for(const option of el.sort.options)if(['reviewPct','reviewCount'].includes(option.value))option.disabled=!steam;
  if(!steam && ['reviewPct','reviewCount'].includes(el.sort.value))el.sort.value='pick';
  el.reviewCountMin.disabled=!steam;
  if(!steam)el.reviewCountMin.value='';
  document.getElementById('ratingThresholdLabel').textContent=steam?'Min raw Steam approval %':'Min source score';
  ranked=rankCandidates(wishlist.map(game=>({...baseRating(game),title:game.title})),{cohort:'the full imported wishlist'});
  document.getElementById('ratingSummary').innerHTML=rankingSummaryHtml(ranked,{label:el.ratingSource.value==='imported'?'Imported Steam approval':SOURCE_MODES[selectedMode()].label,context:!steam,sample:tracking.namespace==='sample'&&el.ratingSource.value!=='imported',unavailable:ratingsUnavailable&&el.ratingSource.value!=='imported'});
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

// Prices are in the minor units of your Steam store's currency (library/data/store.json).
const priceFormat = new Intl.NumberFormat(undefined, { style: 'currency', currency: stats.currency || 'GBP' });
function formatPrice(pence) {
  if (pence == null) return "";
  if (pence === 0) return "Free";
  return priceFormat.format(pence / 100);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function averageApproval() {
  const values = wishlist.map(game => steamApproval(game).pct).filter(value => value !== null);
  return values.length ? `${Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)}%` : "Not recorded";
}

function reviewClass(pct) {
  if (pct === null) return "";
  if (pct >= 85) return "good";
  if (pct >= 70) return "ok";
  return "bad";
}

function fillSelect(select, label, pairs = []) {
  select.innerHTML = `<option value="">All ${label}</option>`;
  // A–Z, with how many games each has.
  [...pairs].sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true })).forEach(([name, count]) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = `${name} (${count})`;
    select.append(option);
  });
}

function setSegment(group, value) {
  group.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.value === value);
    button.setAttribute("aria-pressed", String(button.dataset.value === value));
  });
}

function passesFilters(game, options = {}) {
  const query = el.search.value.trim().toLowerCase();
  const yearMin = Number(el.yearMin.value);
  const yearMax = Number(el.yearMax.value);
  const minPct = Number(el.reviewPctMin.value);
  const minCount = Number(el.reviewCountMin.value);
  const maxPrice = el.priceMax.value === "" ? null : Number(el.priceMax.value);

  if (state.removed === "active" && (isRemoved(game) || isAcquired(game))) return false;
  if (state.removed === "removed" && !isRemoved(game)) return false;
  if (state.removed === 'acquired' && !isAcquired(game)) return false;
  const decision=decisionFor(game);
  if(el.decision.value && (decision?.decision ?? 'interested') !== el.decision.value)return false;
  if(el.reviewDue.value==='due' && !dueForReview(decision,localDate()))return false;
  if(el.reviewDue.value==='snoozed' && !isSnoozed(decision,localDate()))return false;
  if(el.targetPrice.value && targetPriceStatus(decision,game.priceSnapshot,new Date().toISOString()).code !== el.targetPrice.value)return false;
  if (!options.ignoreSearch && query && !matchesSearch(game, query)) return false;
  if (el.mainGenre.value && game.mainGenre !== el.mainGenre.value) return false;
  if (el.genre.value && !game.genres.includes(el.genre.value)) return false;
  if (el.feature.value && !game.features.includes(el.feature.value)) return false;
  const approval = el.ratingSource.value==='imported'?steamApproval(game):el.ratingSource.value==='steam'?{pct:sourceRating(ratings,{provider:'steam',id:String(game.appid)},'steam-raw').value,total:sourceRating(ratings,{provider:'steam',id:String(game.appid)},'steam-volume').value}:{pct:selectedRating(game).value,total:null};
  if (minPct && (approval.pct === null || approval.pct < minPct)) return false;
  if (minCount && (approval.total === null || approval.total < minCount)) return false;
  if (maxPrice !== null && (game.pricePence == null || game.pricePence > maxPrice)) return false;
  if (state.release === "released" && game.comingSoon) return false;
  if (state.release === "soon" && !game.comingSoon) return false;
  if (state.sale === "sale" && !game.discount) return false;
  if (yearMin && (!game.year || game.year < yearMin)) return false;
  if (yearMax && (!game.year || game.year > yearMax)) return false;
  return true;
}

function sortGames(items) {
  const mode = el.sort.value;
  const byName = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  const price = (game) => (game.pricePence == null ? Number.MAX_SAFE_INTEGER : game.pricePence);

  const search = titleSearch(el.search.value);
  return [...items].sort((a, b) => {
    if (mode === 'relevance' || (mode === 'auto' && el.search.value.trim())) return search.compare(a, b);
    if (mode === "reviewPct" || mode === 'reviewCount') return compareSelected(a, b);
    if (mode === "added") return (b.addedSort || "").localeCompare(a.addedSort || "") || byName(a, b);
    if (mode === "addedOld") return (a.addedSort || "9999").localeCompare(b.addedSort || "9999") || byName(a, b);
    if (mode === "release") return (b.releaseSort || "").localeCompare(a.releaseSort || "") || byName(a, b);
    if (mode === "priceLow") return price(a) - price(b) || byName(a, b);
    if (mode === "priceHigh") return (b.pricePence ?? -1) - (a.pricePence ?? -1) || byName(a, b);
    if (mode === "discount") return b.discount - a.discount || byName(a, b);
    if (mode === "name") return byName(a, b);
    if (mode === 'priority') return (decisionFor(b)?.priority ?? 0)-(decisionFor(a)?.priority ?? 0) || byName(a,b);
    return compareSelected(a, b);
  });
}

function activeFilters() {
  const active = [el.ratingSource.selectedOptions[0].textContent];
  if (el.search.value.trim()) active.push(`search "${el.search.value.trim()}"`);
  if (el.mainGenre.value) active.push(el.mainGenre.value);
  if (el.genre.value) active.push(`any: ${el.genre.value}`);
  if (el.feature.value) active.push(el.feature.value);
  if (el.reviewPctMin.value) active.push(`${el.reviewPctMin.value}+ selected score`);
  if (el.reviewCountMin.value) active.push(`${formatNumber(Number(el.reviewCountMin.value))}+ reviews`);
  if (el.priceMax.value !== "") active.push(`max ${formatPrice(Number(el.priceMax.value))}`);
  if (state.removed === "removed") active.push("removed only");
  if (state.removed === 'acquired') active.push('acquired only');
  if (state.removed === "") active.push("all decisions");
  if(el.decision.value)active.push(WISHLIST_LABELS[el.decision.value]);
  if(el.reviewDue.value)active.push(el.reviewDue.value==='due'?'due for review':'snoozed');
  if(el.targetPrice.value)active.push(`target price: ${el.targetPrice.selectedOptions[0].textContent}`);
  if (state.release) active.push(state.release === "soon" ? "unreleased" : "released");
  if (state.sale) active.push("on sale");
  if (el.yearMin.value || el.yearMax.value) active.push(`${el.yearMin.value || "any"}-${el.yearMax.value || "any"}`);
  return active;
}

// A size target for the wishlist: progress from the size when the goal was set.
function renderGoal(current) {
  const { wishlistGoal: goal, wishlistGoalFrom: from } = tracking.snapshot().settings, host = document.getElementById('wishGoal');
  const suggested = Math.max(0, Math.round(current * 0.7 / 50) * 50);
  const form = value => `<form data-goal-form class="wish-goal-form"><label>Wishlist goal<input name="goal" type="number" min="0" max="${Math.max(0, current - 1)}" value="${value}" required></label><button type="submit">Set goal</button></form>`;
  if (!Number.isInteger(goal)) { host.innerHTML = current > 1 ? form(suggested) : ''; return; }
  const done = Math.max(0, from - current), total = Math.max(1, from - goal), reached = current <= goal;
  host.innerHTML = `<p class="wish-goal-line"><strong>${reached ? `Goal reached — ${formatNumber(current)} games` : `${formatNumber(current - goal)} to go`}</strong> · goal ${formatNumber(goal)}, started at ${formatNumber(from)}</p>
    <div class="wish-goal-track" role="progressbar" aria-label="Wishlist goal progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${Math.min(done, total)}"><span style="width:${Math.min(100, done / total * 100)}%"></span></div>
    <details><summary>Change goal</summary>${form(goal)}<button type="button" data-goal-clear>Clear goal</button></details>`;
}
document.getElementById('wishGoal').addEventListener('submit', async event => {
  event.preventDefault();
  const current = wishlist.filter(game => !isRemoved(game) && !isAcquired(game)).length, goal = Number(new FormData(event.target).get('goal'));
  const { wishlistGoal, wishlistGoalFrom } = tracking.snapshot().settings;
  // Changing an existing goal keeps its starting point so progress is not lost.
  await tracking.run(() => tracking.setWishlistGoal(goal, Number.isInteger(wishlistGoal) ? Math.max(wishlistGoalFrom, current) : current));
  renderStats();
});
document.getElementById('wishGoal').addEventListener('click', async event => {
  if (!event.target.closest('[data-goal-clear]')) return;
  await tracking.run(() => tracking.setWishlistGoal(null)); renderStats();
});

// Games removed here that were still on Steam at the last import: the manual to-do for Steam.
function renderSteamChecklist() {
  const pending = wishlist.filter(game => isRemoved(game) && !isAcquired(game));
  const button = document.getElementById('steamChecklistOpen');
  button.hidden = !pending.length;
  button.textContent = `Remove on Steam (${formatNumber(pending.length)})`;
  document.getElementById('steamChecklistItems').innerHTML = pending.map(game => `<li><span>${escapeHtml(game.title)}</span>${game.url ? `<a href="${escapeHtml(game.url)}" target="_blank" rel="noopener noreferrer">Open on Steam ↗</a>` : ''}</li>`).join('');
}
document.getElementById('steamChecklistOpen').addEventListener('click', () => { renderSteamChecklist(); document.getElementById('steamChecklist').showModal(); });

function renderStats() {
  renderSteamChecklist();
  const removedCount = Object.keys(removedStore).length;
  const kept = wishlist.filter((game) => !isRemoved(game) && !isAcquired(game));
  const acquired = wishlist.filter(isAcquired).length;
  const keptValue = kept.reduce((sum, game) => sum + (game.pricePence || 0), 0);
  const cards = [
    [formatNumber(wishlist.length), "games wishlisted"],
    [formatNumber(kept.length), "still on the shortlist"],
    [formatNumber(removedCount), "marked for removal"],
    [formatNumber(acquired), 'acquired locally'],
    [formatPrice(keptValue), "saved shortlist value"],
    [averageApproval(), "mean imported approval (known only)"],
    [formatNumber(stats.onSale || 0), "discounted in snapshot"],
  ];
  el.stats.innerHTML = cards
    .map(([value, label]) => `<div class="stat-card"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`)
    .join("");
  const reviewed = kept.filter(game => decisionFor(game)?.decision).length;
  renderGoal(kept.length);
  el.meta.textContent = `${formatNumber(kept.length)} on your wishlist · ${formatNumber(reviewed)} reviewed · ${formatNumber(removedCount)} removed · ${formatNumber(acquired)} acquired`;
}

function card(game) {
  const removed = isRemoved(game);
  const image = game.image
    ? `<img loading="lazy" src="${escapeHtml(game.image)}" alt="">`
    : `<div class="cover-fallback">${escapeHtml(game.title.slice(0, 2).toUpperCase())}</div>`;
  const discount = game.discount ? `<span class="discount-badge">-${game.discount}%</span>` : "";
  const meta = [game.year || "TBA", game.mainGenre].filter(Boolean).join(" · ");

  return `
    <article class="game-card wishlist-card ${removed ? "is-removed" : ""}">
      <button class="game-button" type="button" data-id="${escapeHtml(game.appid)}" aria-label="Details for ${escapeHtml(game.title)}">
        <div class="cover wide">
          ${image}
          ${awardSealHtml(game.awards)}
          ${discount}
        </div>
        <div class="game-body">
          <h3 class="game-title">${escapeHtml(game.title)}</h3>
          <div class="meta">${escapeHtml(meta)}</div>
          <div class="chips">
            <span class="chip">${escapeHtml(decisionFor(game)?.decision ? WISHLIST_LABELS[decisionFor(game).decision] : 'Not reviewed')}${isSnoozed(decisionFor(game),localDate())?' · Snoozed':''}</span>
            <span class="chip review ${el.ratingSource.value==='imported'?reviewClass(steamApproval(game).pct):''}">${escapeHtml(selectedLabel(game))}${el.ratingSource.value==='imported' && steamApproval(game).total !== null ? ` · ${formatNumber(steamApproval(game).total)} reviews` : ''}</span>
            ${vgcChipHtml(game.vgc)}
            ${game.pricePence != null ? `<span class="chip">${formatPrice(game.pricePence)}</span>` : ""}
            ${awardChipHtml(game.awards)}
            ${beatChipHtml(game.igdb)}
            ${game.comingSoon ? `<span class="chip soon">Unreleased</span>` : ""}
          </div>
        </div>
      </button>
      ${ratingAttributionHtml(selectedRating(game))}
      ${vgcCardCreditHtml(game.vgc)}
      ${ownership(game)}
      <div class="card-actions">
        ${game.url ? `<a class="card-action" href="${escapeHtml(game.url)}" target="_blank" rel="noopener" aria-label="Open ${escapeHtml(game.title)} on Steam">Steam</a>` : '<span class="chip">Sample</span>'}
        <button class="card-action ${removed ? "restore" : "remove"}" type="button" data-toggle="${escapeHtml(game.appid)}" ${isAcquired(game) ? 'disabled' : ''} aria-label="${isAcquired(game) ? "Acquired" : removed ? "Restore" : "Remove"} ${escapeHtml(game.title)}">
          ${isAcquired(game) ? "Acquired" : removed ? "Restore" : "Remove"}
        </button>
      </div>
    </article>
  `;
}

function renderTopByGenre(filtered) {
  const groups = new Map();
  filtered.forEach((game) => {
    if (!groups.has(game.mainGenre)) groups.set(game.mainGenre, []);
    groups.get(game.mainGenre).push(game);
  });

  // Biggest genre first, but "Unclassified" is a gap in the data rather than a
  // genre, so it always sits at the bottom.
  const sections = [...groups.entries()]
    .map(([genre, games]) => [genre, [...games].sort(compareSelected)])
    .sort((a, b) => {
      if ((a[0] === "Unclassified") !== (b[0] === "Unclassified")) return a[0] === "Unclassified" ? 1 : -1;
      return b[1].length - a[1].length;
    });

  if (!sections.length) {
    el.results.innerHTML = `<div class="empty">No games match these filters. <button type="button" data-reset-empty>Clear filters</button></div>`;
    return 0;
  }

  el.results.innerHTML = sections
    .map(([genre, games]) => {
      const ranked = games.filter(selectedEligible);
      const top = ranked.slice(0, state.topCount);
      const unranked = games.length - ranked.length;
      const rest = ranked.slice(top.length).filter(game => !isAcquired(game) && !isRemoved(game)).length;
      return `
        <section class="genre-block">
          <header class="genre-header">
            <div>
              <h3>${escapeHtml(genre)}</h3>
              <p>Top ${top.length} of ${formatNumber(ranked.length)} by ${escapeHtml(el.ratingSource.value==='imported'?'imported conservative Steam approval':SOURCE_MODES[el.ratingSource.value].label)}${unranked ? ` · ${unranked} unranked (unreleased or missing evidence); available in grid/list` : ''}</p>
            </div>
            ${
              rest > 0 && genre !== "Unclassified"
                ? `<button type="button" class="genre-trim" data-trim="${escapeHtml(genre)}">Remove the other ${formatNumber(rest)}</button>`
                : ""
            }
          </header>
          <div class="results-grid wishlist-grid">${top.map(card).join("")}</div>
        </section>
      `;
    })
    .join("");
  return sections.reduce((sum, [, games]) => sum + Math.min(games.filter(selectedEligible).length, state.topCount), 0);
}

function render() {
  prepareRanking();
  planning.render();
  route.sync();
  syncView();
  const filtered = sortGames(wishlist.filter(passesFilters));
  el.sort.querySelector('[value=auto]').textContent = el.search.value.trim() && state.view !== 'top' ? 'Relevance (default)' : 'Selected rating (default)';
  showSearchSuggestions(el.results, filtered.length ? filtered : wishlist.filter(game => passesFilters(game, { ignoreSearch: true })), el.search.value, title => {
    el.search.value = title; state.page = 1; render(); el.search.focus();
  });
  const active = activeFilters();
  el.activeSummary.textContent = active.length ? active.join(" · ") : "No filters active";

  if (state.view === "top") {
    el.results.className = "top-genre-view";
    const shown = renderTopByGenre(filtered);
    el.resultCount.textContent = `${formatNumber(shown)} shown of ${formatNumber(filtered.length)}`;
    el.pageInfo.textContent = "Grouped by genre";
    el.prev.disabled = true;
    el.next.disabled = true;
    renderStats();
    return;
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  state.page = Math.min(state.page, pageCount);
  const start = (state.page - 1) * state.pageSize;
  const pageItems = filtered.slice(start, start + state.pageSize);

  el.results.className = state.view === "list" ? "results-grid wishlist-grid list" : "results-grid wishlist-grid";
  el.resultCount.textContent = `${formatNumber(filtered.length)} game${filtered.length === 1 ? "" : "s"}`;
  el.pageInfo.textContent = `Page ${state.page} of ${pageCount}`;
  el.prev.disabled = state.page <= 1;
  el.next.disabled = state.page >= pageCount;
  el.results.innerHTML = pageItems.length
    ? pageItems.map(card).join("")
    : `<div class="empty">No games match these filters. <button type="button" data-reset-empty>Clear filters</button></div>`;
  renderStats();
  route.sync();
}

function showDetails(appid) {
  const game = wishlist.find((item) => item.appid === appid);
  if (!game) return;
  const removed = isRemoved(game);
  const note = notesStore[game.appid] ?? game.note ?? "";

  el.details.innerHTML = `
    <div class="detail-hero ${game.image ? "" : "no-image"}" ${
      game.image
        ? `style="background-image: linear-gradient(transparent, rgba(18,22,26,.96)), url('${escapeHtml(game.image)}')"`
        : ""
    }>
      <div class="detail-hero-content">
        <h3>${escapeHtml(game.title)}</h3>
        <div class="chips">
          <span class="chip review ${el.ratingSource.value==='imported'?reviewClass(steamApproval(game).pct):''}">${escapeHtml(selectedLabel(game))}</span>
          ${el.ratingSource.value==='imported'?`<span class="chip">${steamApproval(game).total === null ? 'Review count unknown' : `${formatNumber(steamApproval(game).total)} reviews`}</span>`:''}
          ${game.pricePence != null ? `<span class="chip">${formatPrice(game.pricePence)}</span>` : ""}
          ${vgcChipHtml(game.vgc)}
          ${game.discount ? `<span class="chip sale">-${game.discount}%</span>` : ""}
          ${awardChipHtml(game.awards)}
        </div>
      </div>
    </div>
    <div class="detail-body">
      <div id="wishlistDecisionTracking"></div>
      <div id="wishlistPlayTracking"></div>
      <div id="detailsOwnership">${ownership(game)}</div>
      <div class="detail-actions">
        <button type="button" id="toggleRemoved" class="edit-toggle ${removed ? "active" : ""}" ${isAcquired(game) ? 'disabled' : ''}>
          ${isAcquired(game) ? "Acquired" : removed ? "Removed — restore" : "Remove from wishlist"}
        </button>
        ${game.url ? `<a class="edit-toggle" href="${escapeHtml(game.url)}" target="_blank" rel="noopener">Open on Steam</a>` : ''}
      </div>
      ${scoreSectionHtml({ rating: igdbRating(game.igdb), igdb: game.igdb, fix: { collection: 'wishlist', key: String(game.appid) } })}
      ${vgcSectionHtml(game.vgc)}
      ${awardsSectionHtml(game.awards)}
      <p>${escapeHtml(game.summary || "No description available.")}</p>
      ${rankingExplanationHtml(selectedRating(game))}${el.ratingSource.value==='imported'?approvalEvidenceHtml(game):''}<div id="wishlistProviderRatings"></div>
      <div class="detail-section">
        <h4>Wishlist data</h4>
        <div class="kv">
          <span>Main genre</span><span>${escapeHtml(game.mainGenre)}</span>
          <span>Genres</span><span>${escapeHtml(game.genres.join(", ") || "Unknown")}</span>
          <span>Imported Metacritic context</span><span>${game.metacritic ?? "—"} (platform/date unverified)</span>
          <span>Released</span><span>${escapeHtml(game.releaseDate || "TBA")}</span>
          <span>Added</span><span>${escapeHtml(game.addedDate || "Unknown")}</span>
          <span>Developer</span><span>${escapeHtml(game.developers.join(", ") || "Unknown")}</span>
          <span>Publisher</span><span>${escapeHtml(game.publishers.join(", ") || "Unknown")}</span>
        </div>
      </div>
      ${
        game.features.length
          ? `<div class="detail-section"><h4>Features</h4><div class="chips">${game.features
              .map((feature) => `<span class="chip">${escapeHtml(feature)}</span>`)
              .join("")}</div></div>`
          : ""
      }
      <div class="detail-section">
        <h4><label for="notesInput">Notes</label></h4>
        <textarea id="notesInput" class="notes-field" rows="3" placeholder="Why keep it? Why drop it?">${escapeHtml(note)}</textarea>
      </div>
    </div>
  `;

  el.details.querySelector("#toggleRemoved").addEventListener("click", async () => {
    await setRemoved(game.appid, !isRemoved(game));
    showDetails(appid);
    render();
  });
  let savedNote = note;
  el.details.querySelector("#notesInput").addEventListener("change", async (event) => {
    const notes = event.target.value;
    if (await tracking.run(() => tracking.annotate('steam',game.appid,{notes},{notes:savedNote}))) savedNote = notes;
  });

  mountProviderRatings(el.details.querySelector('#wishlistProviderRatings'), { ref: { provider: 'steam', id: String(game.appid) }, workspace: tracking.namespace });
  mountTracking(el.details.querySelector('#wishlistPlayTracking'), tracking, [tracking.descriptor('steam',appid)]);
  planning.mount(el.details.querySelector('#wishlistDecisionTracking'),game);
  openDetails(el.panel, appid);
}

function closeDetails() {
  closePanel(el.panel);
}

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Steam has no public API for editing a wishlist, so removals stay local. The
// export gives a checklist (with direct links) to work through on the store.
function exportRemoved() {
  const rows = wishlist
    .filter(isRemoved)
    .map((game) => ({
      appid: game.appid,
      title: game.title,
      url: game.url,
      reviewPct: game.reviewPct,
      reviewCount: game.reviewCount,
      removedAt: removedStore[game.appid]?.removedAt || "",
    }));
  download("wishlist-removals.json", JSON.stringify(rows, null, 2));
}

function exportTrimmed() {
  const kept = wishlist.filter((game) => !isRemoved(game) && !isAcquired(game));
  const payload = {
    version: "05",
    data: kept.map((game) => ({
      gameid: ["steam", `app/${game.appid}`],
      title: game.title,
      url: game.url,
      added_date: game.addedDate,
      release_date: game.releaseRaw || game.releaseDate,
      note: notesStore[game.appid] ?? game.note ?? null,
      price: game.price,
      price_snapshot: game.priceSnapshot ?? null,
      discount: game.discount,
      reviews: { count: steamApproval(game).total, percPositive: steamApproval(game).pct,
        positive: steamApproval(game).positive, negative: steamApproval(game).negative,
        observedAt: steamApproval(game).observedAt, queryScope: steamApproval(game).queryScope },
    })),
  };
  download("steam-wishlist-trimmed.json", JSON.stringify(payload, null, 2));
}

async function trimGenre(genre) {
  const survivors = new Set(
    sortGames(wishlist.filter(passesFilters))
      .filter((game) => game.mainGenre === genre && selectedEligible(game))
      .sort(compareSelected)
      .slice(0, state.topCount)
      .map((game) => game.appid)
  );
  const doomed = wishlist.filter(
    (game) => game.mainGenre === genre && passesFilters(game) && selectedEligible(game) && !isAcquired(game) && !isRemoved(game) && !survivors.has(game.appid)
  );
  if (!doomed.length) return;
  const ok = window.confirm(
    `Mark ${doomed.length} ${genre} game${doomed.length === 1 ? "" : "s"} as removed, keeping the top ${state.topCount}?\n\nThis only changes this browser — nothing is sent to Steam, and you can restore them at any time.`
  );
  if (!ok) return;
  await tracking.run(() => tracking.removeWishlist(doomed.map(game=>game.appid),true));
  syncTracking();
  render();
}

function setView(view) {
  state.view = view;
  el.gridView.classList.toggle("active", view === "grid");
  el.listView.classList.toggle("active", view === "list");
  el.topViewButton.classList.toggle("active", view === "top");
  el.pageSizeField.hidden = view === "top";
  el.topCountField.hidden = view !== "top";
  state.page = 1;
  render();
}

function bind() {
  [
    el.search,
    el.mainGenre,
    el.genre,
    el.feature,
    el.reviewPctMin,
    el.reviewCountMin,
    el.priceMax,
    el.yearMin,
    el.yearMax,
    el.sort, el.ratingSource,
    el.decision, el.reviewDue, el.targetPrice,
  ].forEach((input) => {
    input.addEventListener("input", () => {
      state.page = 1;
      render();
    });
  });

  [
    [el.removedFilter, "removed"],
    [el.releaseFilter, "release"],
    [el.saleFilter, "sale"],
  ].forEach(([group, key]) => {
    group.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      state[key] = button.dataset.value;
      setSegment(group, state[key]);
      state.page = 1;
      render();
    });
  });

  el.prev.addEventListener("click", () => {
    state.page -= 1;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  el.next.addEventListener("click", () => {
    state.page += 1;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  el.gridView.addEventListener("click", () => setView("grid"));
  el.listView.addEventListener("click", () => setView("list"));
  el.topViewButton.addEventListener("click", () => setView("top"));

  el.reset.addEventListener("click", () => {
    [
      el.search,
      el.mainGenre,
      el.genre,
      el.feature,
      el.reviewPctMin,
      el.reviewCountMin,
      el.priceMax,
      el.decision, el.reviewDue, el.targetPrice,
      el.yearMin,
      el.yearMax,
    ].forEach((input) => {
      input.value = "";
    });
    el.sort.value = "auto";
    el.ratingSource.value = "steam";
    state.removed = "active";
    state.release = "";
    state.sale = "";
    state.page = 1;
    setSegment(el.removedFilter, "active");
    setSegment(el.releaseFilter, "");
    setSegment(el.saleFilter, "");
    render();
  });

  el.pageSize.addEventListener("change", () => {
    state.pageSize = Number(el.pageSize.value);
    writeStore(PAGE_SIZE_KEY, state.pageSize);
    state.page = 1;
    render();
  });
  el.topCount.addEventListener("change", () => {
    state.topCount = Number(el.topCount.value);
    render();
  });

  el.exportRemoved.addEventListener("click", exportRemoved);
  el.exportTrimmed.addEventListener("click", exportTrimmed);
  el.restoreAll.addEventListener("click", async () => {
    const count = Object.keys(removedStore).length;
    if (!count) return;
    if (!window.confirm(`Restore all ${count} removed games?`)) return;
    await tracking.run(() => tracking.removeWishlist(Object.keys(removedStore),false));
    syncTracking();
    render();
  });

  el.results.addEventListener("click", async (event) => {
    const trim = event.target.closest("[data-trim]");
    if (trim) {
      trimGenre(trim.dataset.trim);
      return;
    }
    const toggle = event.target.closest("[data-toggle]");
    if (toggle) {
      await setRemoved(toggle.dataset.toggle, !removedStore[toggle.dataset.toggle]);
      render();
      return;
    }
    if (event.target.closest("[data-reset-empty]")) { el.reset.click(); return; }
    const button = event.target.closest("[data-id]");
    if (button) showDetails(button.dataset.id);
  });

  el.closeDetails.addEventListener("click", closeDetails);
  el.overlay.addEventListener("click", closeDetails);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDetails();
    if (event.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !el.panel.open) {
      event.preventDefault();
      el.search.focus();
    }
  });
}

function init() {
  el.pageSize.value = String(state.pageSize);
  fillSelect(el.mainGenre, "main genres", stats.mainGenres || []);
  fillSelect(el.genre, "genres", stats.genres || []);
  fillSelect(el.feature, "features", stats.features || []);
  if (stats.yearMin) el.yearMin.placeholder = String(stats.yearMin);
  if (stats.yearMax) el.yearMax.placeholder = String(stats.yearMax);
  setupCommon();
  route.restore();
  bind();
  render();
  route.openInitial();
}

function syncView() {
  for (const [view, button] of [["grid",el.gridView],["list",el.listView],["top",el.topViewButton]]) if(button) {
    button.classList.toggle("active",state.view===view);
    button.setAttribute("aria-pressed",String(state.view===view));
  }
}
const route = createRoute({ controls:{rating:el.ratingSource,decision:el.decision,reviewDue:el.reviewDue,targetPrice:el.targetPrice,q:el.search, mainGenre:el.mainGenre, genre:el.genre, feature:el.feature, review:el.reviewPctMin, reviews:el.reviewCountMin, price:el.priceMax, yearMin:el.yearMin, yearMax:el.yearMax, sort:el.sort}, state, numeric:{pageSize:PAGE_SIZE_OPTIONS,topCount:[3,5,10]}, enums:{view:["grid","list","top"], removed:["active","removed","acquired",""], release:["","released","soon"], sale:["","sale"]}, render, showDetails, syncControls(){el.pageSize.value=String(state.pageSize);el.topCount.value=String(state.topCount);setSegment(el.removedFilter,state.removed);setSegment(el.releaseFilter,state.release);setSegment(el.saleFilter,state.sale);el.pageSizeField.hidden=state.view==="top";el.topCountField.hidden=state.view!=="top";syncView();} });

// Your owned games with their IGDB series and similar games, to judge each wish against
// what you already have (see tracking/anchors.js).
const ownedGames = ownedIndex(tracking.library);
// Judging hundreds of wishes reads your tracking state for each one: share one copy while a
// render (or sort) runs instead of copying it every time. A copy is read-only, and any
// change drops it (see tracking.subscribe below).
let stateCopy = null;
function trackingState() {
  if (!stateCopy) { stateCopy = tracking.snapshot(); queueMicrotask(() => { stateCopy = null; }); }
  return stateCopy;
}
let wishAnchors = null;
// Wishes related to each owned game, so "keep the best" can compare them.
function relatedWishes() {
  if (wishAnchors) return wishAnchors;
  wishAnchors = new Map();
  for (const wish of wishlist) for (const anchor of anchorsFor(wish.igdb, ownedGames, trackingState(), wish.title)) {
    if (!wishAnchors.has(anchor.igdbId)) wishAnchors.set(anchor.igdbId, []);
    wishAnchors.get(anchor.igdbId).push(wish);
  }
  return wishAnchors;
}
function describeGame(game) {
  const id = { provider: 'steam', id: String(game.appid) };
  const percent = sourceRating(ratings, id, 'steam-raw').value ?? steamApproval(game).pct, count = sourceRating(ratings, id, 'steam-volume').value ?? steamApproval(game).total;
  // Copies you own of this game (same game, another edition, or a newer version) versus an
  // original you own of a remaster/remake, which is judged by how the original went.
  const versions = ownedCopiesOf(game, ownedGames), original = versions.find(copy => copy.owns === 'original');
  const owned = versions.filter(copy => copy.owns !== 'original').map(copy => ({ name: copy.title, owns: copy.owns, version: copy.version ?? null, year: copy.igdb?.year ?? null, platforms: copy.platforms, sources: copy.sources, hours: copy.hours }));
  const anchors = owned.length || original ? [] : anchorsFor(game.igdb, ownedGames, trackingState(), game.title);
  const siblings = anchors.length ? (relatedWishes().get(anchors[0].igdbId) ?? []).filter(other => other !== game && !isRemoved(other)).map(other => other.igdb).filter(Boolean) : [];
  const result = owned.length ? null : original ? versionVerdict(game.igdb, originalAnchor(original, trackingState()), original.version) : anchors.length ? verdict(game.igdb, anchors, siblings) : null;
  // With nothing you own to judge it by, a Game of the Year winner is worth keeping.
  const awards = awardSummary(game.awards);
  return { steam: percent != null ? { percent: Math.round(percent), count } : null, igdb: game.igdb ?? null, owned, anchors, verdict: result, awards,
    suggested: owned.length ? 'archive' : result?.action ?? (awards?.tier === 'goty' ? 'keep' : null) };
}
const planning = setupWishlistPlanning({ client:tracking, describe:describeGame, getVisibleGames:()=>sortGames(wishlist.filter(passesFilters)), renderPage(){syncTracking();render();if(el.panel.open)showDetails(new URLSearchParams(location.search).get('game'));} });
document.getElementById('exportAcquired').onclick=()=>download('wishlist-acquisitions.json',JSON.stringify(wishlist.filter(isAcquired).map(game=>({appid:game.appid,title:game.title,decision:'acquired',acquiredAt:decisionFor(game).acquiredAt??null,notes:notesStore[game.appid]??game.note??''})),null,2));
init();
pageReady();
tracking.subscribe(change=>{stateCopy=null;syncTracking();render();if(change.type==='refresh' && el.panel.open && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))showDetails(new URLSearchParams(location.search).get('game'));});
bindMatchFixes(document.getElementById("detailsContent"));
bindHovercards();

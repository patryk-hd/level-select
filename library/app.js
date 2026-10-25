import { showSearchSuggestions } from './search-ui.js';
import { openProductReview } from '../tracking/products-ui.js';
import { productMatch } from '../tracking/products.js';
import { preservedGroupNotes } from '../tracking/group-notes.js';
import { trackingClient } from '../tracking/client.js';
import { mountTracking } from '../tracking/ui.js';
import { mountLibraryMatches } from '../tracking/matches-ui.js';
import { titleSearch, matchesSearch, matchesCopy, PC_STORES, storeKey } from './core.js';
import { ownedRating, matchingCopies, OWNED_MODES, compareNullableDescending } from '../ranking/evidence.js';
import { copyEvidenceHtml } from '../ranking/ui.js';
import { mountProviderRatings, loadRatings } from '../ranking/panels.js';
import { emptyRatings } from '../ranking/snapshot.js';
import { sourceIndex, ownedSourceRating, rankCandidates, compareResults, refKey, ratingText, SOURCE_MODES, CONTEXT_MODES } from '../ranking/modes.js';
import { rankingSummaryHtml, rankingExplanationHtml, ratingAttributionHtml } from '../ranking/mode-ui.js';
import { readStore, writeStore, createRoute, openDetails, closeDetails as closePanel, setupCommon, notify } from './runtime.js';
import { copyRating, compareRatings } from '../tracking/score.js';
import { manualOwnedGroups } from '../tracking/owned.js';
import { scoreSectionHtml, beatChipHtml, bindMatchFixes, awardChipHtml, awardsSectionHtml, vgcSectionHtml, vgcChipHtml, vgcCardCreditHtml, awardSealHtml, ratingHoverHtml } from './score-ui.js';
import { bindHovercards, hoverAttr } from './hovercard.js';
import { carouselHtml, bindCarousel, spotlightHtml, bindSpotlight, artStyle } from './browse-ui.js';
import { pageReady } from '../navigation.js';

// The VGC Score of the copy our score comes from, else of any Steam copy.
const vgcOf = game => gameScore(game).copy?.vgc ?? game.copies.find(copy => copy.vgc)?.vgc ?? null;

// Ratings download alongside the tracking data (this page's script tag already says which workspace).
loadRatings(window.PLAYNITE_SAMPLE ? 'sample' : 'personal').catch(() => {});
const tracking = await trackingClient();
window.retroTracking = tracking;
document.getElementById('reviewSteamProducts').addEventListener('click',()=>openProductReview(tracking));
let ratingsUnavailable=false;
const ratings=sourceIndex(await loadRatings(tracking.namespace).catch(()=>{ratingsUnavailable=true;return emptyRatings(tracking.namespace);}));
let providerRanks;
let productReviews=tracking.snapshot().productReviews;
const isProviderMode=()=>Boolean(SOURCE_MODES[el.ratingMode.value]);
const modeLabel=()=>el.ratingMode.value==='score'?'Score':SOURCE_MODES[el.ratingMode.value]?.label??OWNED_MODES[el.ratingMode.value];
// The shared score (IGDB → Steam → Playnite) of the best-rated copy matching the filters.
function gameScore(game){
  const copies=matchingCopies(game,{platform:el.platform.value,source:el.source.value});
  const best=copies.map(copy=>({copy,score:copyRating(copy)})).sort((a,b)=>compareRatings(a.score,b.score))[0];
  return {value:best?.score?.value??null,reason:'Not rated yet',score:best?.score??null,copy:best?.copy??copies[0]??null};
}
let overridesStore = tracking.edits().overrides;

function mergeOverride(game, override) {
  if (!override) return { ...game };
  return {
    ...game,
    favorite: override.favorite ?? game.favorite,
    hidden: override.hidden ?? game.hidden,
    notes: override.notes ?? game.notes,
  };
}

async function setOverride(id, patch, expected) {
  const result = await tracking.run(() => tracking.annotate('legacy-owned', id, patch, expected));
  syncTracking();
  return result;
}
function syncTracking() {
  overridesStore = tracking.edits().overrides;
  library.splice(0,library.length,...(window.PLAYNITE_LIBRARY || []).map(game=>mergeOverride(game,overridesStore[game.id])));
  connections = tracking.connections();
  const links = document.getElementById('recommendationLinks');
  if (links) links.innerHTML = recommendationLinks(new URLSearchParams(location.search).get('game'));
}

const library = (window.PLAYNITE_LIBRARY || []).map((game) => mergeOverride(game, overridesStore[game.id]));
// Games you own outside the Playnite import (Game Atlas "Owned", wishlist purchases).
library.push(...manualOwnedGroups(tracking.snapshot(), { catalog: tracking.catalog, wishlist: tracking.wishlist, library }));
// Headline numbers and filter lists count everything in your library: Playnite, connected
// sources, ROMs and games marked owned. The builder's own stats only know its import.
const countBy = values => { const counts = new Map(); for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1); return [...counts].sort((a, b) => b[1] - a[1]); };
const stats = { ...(window.PLAYNITE_STATS || {}), total: library.length, totalCopies: library.reduce((total, game) => total + game.copies.length, 0),
  played: library.filter(game => game.played).length, duplicateTitles: library.filter(game => game.copies.length > 1).length,
  totalHours: Math.round(library.reduce((total, game) => total + (game.timePlayed || 0), 0) / 3600),
  platforms: countBy(library.flatMap(game => [...new Set(game.platforms ?? [])])), sources: countBy(library.flatMap(game => [...new Set(game.sources ?? [])])),
  mainGenres: countBy(library.map(game => game.mainGenre)), genres: countBy(library.flatMap(game => [...new Set(game.genres ?? [])])) };
let connections = tracking.connections();

const PAGE_SIZE_KEY = "playnite-page-size";
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function loadPageSize() {
  const stored = Number(readStore(PAGE_SIZE_KEY, 0));
  return PAGE_SIZE_OPTIONS.includes(stored) ? stored : 50;
}

const state = {
  page: 1,
  pageSize: loadPageSize(),
  view: "grid",
  status: "",
  visibility: "",
  cover: "",
  favorite: "",
  duplicate: "",
  check: "",
};

const el = {
  libraryMeta: document.querySelector("#libraryMeta"),
  search: document.querySelector("#searchInput"),
  platform: document.querySelector("#platformFilter"),
  source: document.querySelector("#sourceFilter"),
  mainGenre: document.querySelector("#mainGenreFilter"),
  mainGenreField: document.querySelector("#mainGenreField"),
  genre: document.querySelector("#genreFilter"),
  genreField: document.querySelector("#genreField"),
  category: document.querySelector("#categoryFilter"),
  categoryField: document.querySelector("#categoryField"),
  tag: document.querySelector("#tagFilter"),
  status: document.querySelector("#statusFilter"),
  visibility: document.querySelector("#visibilityFilter"),
  cover: document.querySelector("#coverFilter"),
  favorite: document.querySelector("#favoriteFilter"),
  duplicate: document.querySelector("#duplicateFilter"),
  yearMin: document.querySelector("#yearMin"),
  yearMax: document.querySelector("#yearMax"),
  scoreMin: document.querySelector("#scoreMin"),
  ratingMode: document.querySelector("#ratingMode"),
  sort: document.querySelector("#sortMode"),
  reset: document.querySelector("#resetFilters"),
  pageSize: document.querySelector("#pageSizeSelect"),
  exportOverrides: document.querySelector("#exportOverrides"),
  stats: document.querySelector("#statsStrip"),
  resultCount: document.querySelector("#resultCount"),
  activeSummary: document.querySelector("#activeSummary"),
  pageInfo: document.querySelector("#pageInfo"),
  prev: document.querySelector("#prevPage"),
  next: document.querySelector("#nextPage"),
  results: document.querySelector("#results"),
  gridView: document.querySelector("#gridView"),
  spotlightView: document.querySelector("#spotlightView"),
  shelves: document.querySelector("#shelves"),
  listView: document.querySelector("#listView"),
  overlay: document.querySelector("#detailsOverlay"),
  panel: document.querySelector("#detailsPanel"),
  details: document.querySelector("#detailsContent"),
  closeDetails: document.querySelector("#closeDetails"),
};

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

// Playnite's CSV export records Time Played in seconds.
function hours(seconds) {
  if (!seconds) return "0h";
  const value = seconds / 3600;
  if (value < 1) return `${Math.round(seconds / 60)}m`;
  return value >= 10 ? `${Math.round(value)}h` : `${value.toFixed(1)}h`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function initials(name) {
  const words = String(name || "").replace(/[^a-z0-9 ]/gi, " ").trim().split(/\s+/).filter(Boolean);
  return (words[0]?.[0] || "?").toUpperCase() + (words[1]?.[0] || "").toUpperCase();
}

function platformIcons(names = []) {
  if (!window.PlayniteIcons) return "";
  return names.map((name) => window.PlayniteIcons.platformIcon(name)).join("");
}

// One icon per copy: prefer the storefront logo (Steam/Epic/GOG/...) over the
// generic PC icon since it's more informative, and never show the same logo
// twice for one copy (e.g. a PlayStation platform + PlayStation-store source).
// Some Playnite entries have no platform recorded at all, in which case the
// storefront logo is the only thing worth drawing.
function copyIconMetas(copy) {
  if (!window.PlayniteIcons) return [];
  const platformName = (copy.platforms || [])[0] || "";
  const platformMeta = platformName ? window.PlayniteIcons.matchPlatform(platformName) : null;
  const sourceMetas = (copy.sources || []).filter(Boolean).map((name) => window.PlayniteIcons.matchSource(name));
  const recognizedSources = sourceMetas.filter((meta) => meta.icon);

  const ordered =
    (!platformMeta || platformMeta.icon === "windows") && recognizedSources.length
      ? recognizedSources
      : [platformMeta, ...sourceMetas].filter(Boolean);

  const seen = new Set();
  const metas = [];
  ordered.forEach((meta) => {
    const key = meta.icon || `label:${meta.label}`;
    if (!meta.icon && !String(meta.label || "").trim()) return;
    if (seen.has(key)) return;
    seen.add(key);
    metas.push(meta);
  });
  return metas;
}

function renderCopyIcons(copy) {
  return copyIconMetas(copy)
    .map((meta) => window.PlayniteIcons.renderIcon(meta, "platform-icon"))
    .join("");
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

function score(game) {
  return rating(game).value;
}

function rating(game) {
  if(el.ratingMode.value==='score')return gameScore(game);
  const filters={platform:el.platform.value,source:el.source.value};
  if(isProviderMode()){const result=ownedSourceRating(ratings,game,el.ratingMode.value,filters,productReviews);return providerRanks?.records.get(result.targetId)??result;}
  return ownedRating(game,el.ratingMode.value,filters);
}

// The score chip's hover card: how our score is made up (the "Score" view only).
function scoreHover(game) {
  if (el.ratingMode.value !== 'score') return '';
  const { score: current, copy } = gameScore(game);
  return hoverAttr(ratingHoverHtml(current, { steam: copy?.steamReviews, vgc: vgcOf(game), igdb: copy?.igdb }));
}

function scoreLabel(game) {
  const result = rating(game);
  if (el.ratingMode.value === 'score') return result.score ? `Score ${result.score.value}${result.score.thin ? ' · few ratings' : ''}` : 'Not rated yet';
  return result.value === null ? result.reason : isProviderMode()?`${ratingText(result)}${result.scope==='work-context'?' · work context':''}${['stale','refresh-failed'].includes(result.freshness)?' · saved / refresh due':''}`:`${modeLabel()} ${result.value}/100`;
}

// "Unclassified" is what the builder writes when no Steam match was found, and
// it reads as noise on a card, so it's dropped there.
function genreLabel(game) {
  return game.mainGenre && game.mainGenre !== "Unclassified" ? game.mainGenre : "";
}

// An IGDB match that isn't certain; its details panel asks "Is this the right game?".
const needsMatchCheck = game => game.copies.some(copy => copy.igdb && copy.igdb.confidence !== 'high');

function passesFilters(game, options = {}) {
  const query = el.search.value.trim().toLowerCase();
  const yearMin = Number(el.yearMin.value);
  const yearMax = Number(el.yearMax.value);
  const minScore = Number(el.scoreMin.value);

  if (!options.ignoreSearch && query && !matchesSearch(game, query)) return false;
  if (!matchesCopy(game, el.platform.value, el.source.value)) return false;
  if (el.mainGenre.value && game.mainGenre !== el.mainGenre.value) return false;
  if (el.genre.value && !(game.genres || []).includes(el.genre.value)) return false;
  if (el.category.value && !game.categories.includes(el.category.value)) return false;
  if (el.tag.value && !game.tags.includes(el.tag.value)) return false;
  if (state.status === "played" && !game.played) return false;
  if (state.status === "unplayed" && game.played) return false;
  if (state.visibility === "visible" && game.hidden) return false;
  if (state.visibility === "hidden" && !game.hidden) return false;
  if (state.cover === "with" && !game.cover) return false;
  if (state.favorite === "favorite" && !game.favorite) return false;
  if (state.duplicate === "duplicate" && !game.duplicate) return false;
  if (state.check === "check" && !needsMatchCheck(game)) return false;
  if (yearMin && (!game.year || game.year < yearMin)) return false;
  if (yearMax && (!game.year || game.year > yearMax)) return false;
  if (el.scoreMin.value !== '' && (score(game) === null || score(game) < minScore)) return false;
  return true;
}

function sortGames(items) {
  const mode = el.sort.value;
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const byScore = (a, b) => isProviderMode()?compareResults({...rating(a),title:a.name,targetId:a.id},{...rating(b),title:b.name,targetId:b.id}):compareNullableDescending(score(a), score(b)) || byName(a, b);

  const search = titleSearch(el.search.value);
  return [...items].sort((a, b) => {
    if (mode === 'relevance' || (mode === 'smart' && el.search.value.trim())) return search.compare(a, b);
    if (mode === "name") return byName(a, b);
    if (mode === "newest") return (b.dateSort || "").localeCompare(a.dateSort || "") || byName(a, b);
    if (mode === "oldest") return (a.dateSort || "9999").localeCompare(b.dateSort || "9999") || byName(a, b);
    if (mode === "score") return byScore(a, b);
    if (mode === "time") return (b.timePlayed || 0) - (a.timePlayed || 0) || byName(a, b);
    if (mode === "source") return (a.sources[0] || "").localeCompare(b.sources[0] || "") || byName(a, b);
    return byName(a, b);
  });
}

function activeFilters() {
  const active = [];
  if (el.search.value.trim()) active.push(`search "${el.search.value.trim()}"`);
  if (el.platform.value) active.push(el.platform.selectedOptions[0].textContent);
  if (el.source.value) active.push(el.source.selectedOptions[0].textContent);
  if (el.mainGenre.value) active.push(el.mainGenre.value);
  if (el.genre.value) active.push(`genre: ${el.genre.value}`);
  if (el.category.value) active.push(el.category.value);
  if (el.tag.value) active.push(el.tag.value);
  if (state.status) active.push(state.status);
  if (state.visibility) active.push(state.visibility);
  if (state.cover) active.push("with images");
  if (state.favorite) active.push("favorites");
  if (state.duplicate) active.push("multiple copies");
  if (el.yearMin.value || el.yearMax.value) active.push(`${el.yearMin.value || "any"}-${el.yearMax.value || "any"}`);
  if (el.scoreMin.value) active.push(`${modeLabel()} ${el.scoreMin.value}+`);
  return active;
}

function renderStats() {
  const cards = [
    [formatNumber(stats.total), "owned titles"],
    [formatNumber(stats.played), "played"],
    [formatNumber(stats.duplicateTitles), "with multiple copies"],
    [formatNumber(stats.totalHours), "hours played"],
    [formatNumber(stats.totalHours), "hours tracked"],
    [`${stats.yearMin || "?"}-${stats.yearMax || "?"}`, "release span"],
  ];
  el.stats.innerHTML = cards.map(([value, label]) => `<div class="stat-card"><strong>${value}</strong><span>${label}</span></div>`).join("");
  const toCheck = library.filter(needsMatchCheck).length;
  el.libraryMeta.innerHTML = `${formatNumber(stats.total)} titles · ${formatNumber(stats.totalCopies)} copies${toCheck ? ` · <button type="button" class="text-button" data-toggle-check>${state.check === 'check' ? 'Show all games' : `${formatNumber(toCheck)} matches to check`}</button>` : ''}`;
}

function copyPlatformRow(game) {
  return game.copies.map(renderCopyIcons).join("");
}

function card(game) {
  const cover = game.cover
    ? `<img loading="lazy" src="${escapeHtml(game.cover)}" alt="">`
    : `<div class="cover-fallback">${escapeHtml(initials(game.name))}</div>`;
  const source = game.sources[0] || "Unknown source";
  const scoreChip = `<span class="chip ${score(game) !== null ? 'score' : ''}"${scoreHover(game)}>${escapeHtml(scoreLabel(game))}</span>`;
  const hiddenChip = game.hidden ? `<span class="chip hidden">Hidden</span>` : "";
  const favMark = game.favorite ? `<span class="fav-mark" title="Favorite">★</span>` : "";
  const played = game.played ? `<span class="chip">${hours(game.timePlayed)}</span>` : `<span class="chip">Unplayed</span>`;
  const beatChip = beatChipHtml(gameScore(game).copy?.igdb);

  return `
    <article class="game-card">
      <button class="game-button" type="button" data-id="${escapeHtml(game.id)}" aria-label="Details for ${escapeHtml(game.name)}">
        <div class="cover">
          ${cover}
          ${awardSealHtml(game.awards)}
          ${favMark}
          <div class="platform-strip">${copyPlatformRow(game)}</div>
        </div>
        <div class="game-body">
          <h3 class="game-title">${escapeHtml(game.name)}</h3>
          <div class="meta">${escapeHtml([game.year || "No year", source, genreLabel(game)].filter(Boolean).join(" · "))}</div>
          <div class="chips">
            ${scoreChip}
            ${vgcChipHtml(vgcOf(game))}
            ${awardChipHtml(game.awards)}
            ${beatChip}
            ${played}
            ${hiddenChip}
          </div>
        </div>
      </button>
      ${ratingAttributionHtml(rating(game))}
      ${vgcCardCreditHtml(vgcOf(game))}
    </article>
  `;
}

// ---------- Shelves (carousel) and spotlight, from browse-ui.js ----------
// A shelf is a Platform or Store filter: all games, each PC store, other stores, then each
// console you own games for. Choosing one sets those filters.
const SHELF_COLORS = [[/steam/i, '#66c0f4'], [/gog/i, '#b86cf0'], [/epic/i, '#c7c9cc'], [/nintendo|game ?boy|famicom|wii|switch/i, '#ed807d'], [/sega|genesis|mega drive|dreamcast|saturn/i, '#78bde1'],
  [/sony|playstation|psp|vita/i, '#97a7ec'], [/xbox|microsoft/i, '#a3ce80'], [/atari/i, '#e9b576'], [/nec|snk|neo geo|turbografx|pc engine/i, '#8bcebd'], [/arcade|mame/i, '#c39ee6']];
const shelfColor = name => SHELF_COLORS.find(([pattern]) => pattern.test(name))?.[1] ?? 'var(--accent)';
let spotSelected = '', spotlight = null;
function shelves() {
  const list = [{ title: 'All games', short: 'All', platform: '', source: '' },
    ...PC_STORES.map(store => ({ title: store.name, short: store.name, eyebrow: 'PC store', platform: '', source: `store:${store.id}` })),
    ...(stats.sources || []).map(([name]) => name).filter(name => !PC_STORES.some(store => store.id === storeKey(name))).map(name => ({ title: name, short: name, eyebrow: 'Store or source', platform: '', source: name })),
    ...(stats.platforms || []).map(([name]) => name).filter(name => !/^pc\b|windows|dos/i.test(name)).map(name => ({ title: name, short: name, eyebrow: 'Platform', platform: name, source: '' }))];
  return list.map(shelf => {
    const games = library.filter(game => !game.hidden && matchesCopy(game, shelf.platform, shelf.source));
    if (!games.length || (shelf.eyebrow === 'Store or source' && games.length < 5)) return null;
    const played = games.filter(game => game.played).length, time = games.reduce((sum, game) => sum + (game.timePlayed || 0), 0);
    const covers = games.filter(game => game.cover).sort((a, b) => (score(b) ?? -1) - (score(a) ?? -1)).slice(0, 5).map(game => game.cover);
    return { ...shelf, eyebrow: shelf.eyebrow ?? 'Your library', meta: `${formatNumber(games.length)} games · ${formatNumber(played)} played${time ? ` · ${hours(time)}` : ''}`, progress: played / games.length,
      covers, color: shelfColor(shelf.title), action: { label: `Browse ${shelf.title}`, attrs: `data-shelf-platform="${escapeHtml(shelf.platform)}" data-shelf-source="${escapeHtml(shelf.source)}"` } };
  }).filter(Boolean);
}
// Rebuilt only when what the shelves show changes: switching grid, list and spotlight, or
// paging, leaves them (and their animations) alone.
let shelfView = null, shelfKey = '';
function renderShelves() {
  // The shelves are for browsing; a search hides them.
  if (el.search.value.trim()) { el.shelves.innerHTML = ''; shelfView = null; shelfKey = ''; return; }
  const slides = shelves(), active = Math.max(0, slides.findIndex(slide => slide.platform === el.platform.value && slide.source === el.source.value));
  const key = JSON.stringify(slides.map(slide => [slide.title, slide.meta, slide.covers[0]]));
  if (key === shelfKey && shelfView) { if (shelfView.current !== active) shelfView.go(active); return; }
  shelfKey = key;
  el.shelves.innerHTML = carouselHtml({ label: 'Shelves', slides, active });
  shelfView = bindCarousel(el.shelves, { active });
}
function spotRow(game) {
  const value = score(game), cover = game.cover ? `<img src="${escapeHtml(game.cover)}" alt="" loading="lazy" decoding="async">` : `<span class="art-fallback">${escapeHtml(initials(game.name))}</span>`;
  const meta = [game.year, game.sources[0], game.played ? hours(game.timePlayed) : 'Unplayed'].filter(Boolean).join(' · ');
  return `<button class="spot-row" type="button" data-spot="${escapeHtml(game.id)}"><span class="spot-rank${value !== null ? ' has-score' : ''}" title="${escapeHtml(scoreLabel(game))}">${value ?? '–'}</span><span class="artwork">${cover}</span><span class="spot-text"><span class="spot-title">${escapeHtml(game.name)}</span><span class="spot-meta">${escapeHtml(meta)}</span></span></button>`;
}
function spotPanel(id) {
  const game = library.find(item => item.id === id); if (!game) return '';
  const value = score(game), current = rating(game), beat = beatChipHtml(gameScore(game).copy?.igdb);
  const evidence = (current?.score ?? current)?.parts?.map(part => `${part.label} ${part.value}${part.count ? ` (${formatNumber(part.count)})` : ''}`).join(' · ') ?? '';
  const facts = [game.year, (game.developers || [])[0], ...(game.genres || []).slice(0, 2)].filter(Boolean);
  const cover = game.cover ? `<img src="${escapeHtml(game.cover)}" alt="" decoding="async">` : `<span class="art-fallback">${escapeHtml(initials(game.name))}</span>`;
  return `<div class="spotlight-backdrop" style="${artStyle('art', game.background || game.cover)}" aria-hidden="true"></div>
    <div class="spotlight-head"><span class="artwork">${cover}</span><div class="spotlight-heading">
      <p class="spotlight-place">${game.copies.map(renderCopyIcons).join('')}</p>
      <h2 class="spotlight-title">${escapeHtml(game.name)}</h2>
      <p class="spotlight-sub">${facts.map(escapeHtml).join(' · ')}</p>
      ${value !== null ? `<p class="spotlight-score"><strong>${value}</strong><span>${escapeHtml(evidence || scoreLabel(game))}</span></p>` : '<p class="spotlight-score is-empty"><span>Not rated yet</span></p>'}
      <div class="chips">${vgcChipHtml(vgcOf(game))}${awardChipHtml(game.awards)}${beat}<span class="chip">${game.played ? `${hours(game.timePlayed)} played` : 'Unplayed'}</span>${game.favorite ? '<span class="chip">★ Favorite</span>' : ''}</div>
    </div></div>
    ${game.summary ? `<p class="spotlight-text">${escapeHtml(game.summary)}</p>` : ''}
    <div class="spotlight-actions"><button class="primary-button" type="button" data-id="${escapeHtml(game.id)}">Open details</button></div>`;
}

function render() {
  productReviews=tracking.snapshot().productReviews;
  renderShelves();
  const provider=isProviderMode();
  const summary=document.getElementById('ratingSummary');summary.hidden=!provider;
  if(provider){
    providerRanks=rankCandidates(library.flatMap(game=>game.copies.map(copy=>({...ownedSourceRating(ratings,game,el.ratingMode.value,{copyId:copy.id},productReviews),title:copy.name??game.name}))),{cohort:'all imported owned copies',mode:el.ratingMode.value});
    summary.innerHTML=rankingSummaryHtml(providerRanks,{label:modeLabel(),context:CONTEXT_MODES.includes(el.ratingMode.value),sample:tracking.namespace==='sample',unavailable:ratingsUnavailable});
  }else providerRanks=null;
  const filtered = sortGames(library.filter(passesFilters));
  el.sort.querySelector('[value=smart]').textContent = el.search.value.trim() ? 'Relevance (default)' : 'Title A–Z (default)';
  showSearchSuggestions(el.results, filtered.length ? filtered : library.filter(game => passesFilters(game, { ignoreSearch: true })), el.search.value, title => {
    el.search.value = title; state.page = 1; render(); el.search.focus();
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  state.page = Math.min(state.page, pageCount);
  const start = (state.page - 1) * state.pageSize;
  const pageItems = filtered.slice(start, start + state.pageSize);
  const active = activeFilters();

  el.results.className = state.view === "spotlight" ? "results-spotlight" : state.view === "list" ? "results-grid list" : "results-grid";
  el.resultCount.textContent = `${formatNumber(filtered.length)} game${filtered.length === 1 ? "" : "s"}`;
  el.activeSummary.textContent = active.length ? active.join(" · ") : "No filters active";
  el.pageInfo.textContent = `Page ${state.page} of ${pageCount}`;
  el.prev.disabled = state.page <= 1;
  el.next.disabled = state.page >= pageCount;
  spotlight = null;
  if (state.view === "spotlight" && pageItems.length) {
    el.results.innerHTML = spotlightHtml(pageItems.map(spotRow).join(""), "Games");
    spotlight = bindSpotlight(el.results, { panel: spotPanel, onOpen: id => showDetails(id), selected: spotSelected, onSelect: id => { spotSelected = id; } });
  } else el.results.innerHTML = pageItems.length ? pageItems.map(card).join("") : `<div class="empty">No games match these filters. <button type="button" data-reset-empty>Clear filters</button></div>`;
  route.sync();
  syncView();
}

function copyRow(copy) {
  const meta = [
    copy.releaseDate || "No release date",
    copy.played ? `${hours(copy.timePlayed)} played` : "Unplayed",
  ].filter(Boolean);
  return `
    <div class="copy-row">
      <div class="copy-icons">${renderCopyIcons(copy)}</div>
      <div class="copy-meta">${escapeHtml(meta.join(" · "))}${copyEvidenceHtml(copy)}</div>
    </div>
  `;
}

function recommendationLinks(id) {
  const matches = [...new Map((connections.byOwned[id] || []).filter(item => !['rejected', 'unavailable'].includes(item.status)).sort((a,b) => Number(a.status === 'accepted') - Number(b.status === 'accepted')).map(item => [item.id, item])).values()];
  if (!matches.length) return '';
  return `<div class="detail-section"><h4>Related catalog entries</h4><div class="recommendation-links">${matches.map(match=>`<a href="../index.html?game=${encodeURIComponent(match.id)}${tracking.namespace === 'sample' ? '&workspace=sample' : ''}">${escapeHtml(match.systemId.toUpperCase())} · ${match.status === 'accepted' ? 'confirmed match' : 'possible match — review'} ↗</a>`).join('')}</div></div>`;
}

// Detail panel for a game you own outside Playnite: tracking uses its Atlas or wishlist identity.
function showManualDetails(game) {
  const { score: rating, copy } = gameScore(game), atlas = game.ref.provider === 'catalog';
  const hero = game.background || game.cover;
  el.details.innerHTML = `
    <div class="detail-hero ${hero ? "" : "no-image"}" ${hero ? `style="background-image: linear-gradient(transparent, rgba(18,22,26,.96)), url('${escapeHtml(hero)}')"` : ""}>
      <div class="detail-hero-content"><h3>${escapeHtml(game.name)}</h3>
        <div class="chips"><span class="chip">${escapeHtml(scoreLabel(game))}</span>${beatChipHtml(copy?.igdb)}<span class="chip">${escapeHtml(game.platforms.join(' · '))}</span></div></div>
    </div>
    <div class="detail-body">
      <p class="data-note">${atlas ? 'You marked this game as owned in Game Atlas.' : `Bought from your wishlist${game.acquiredAt ? ` on ${escapeHtml(game.acquiredAt.slice(0, 10))}` : ''}.`} It isn't part of your Playnite import.</p>
      <div class="detail-actions">${atlas ? `<a class="edit-toggle" href="../index.html?game=${encodeURIComponent(game.ref.id)}">Open in Game Atlas</a><button type="button" class="edit-toggle" id="unmarkOwned">Remove from owned</button>` : ''}</div>
      <div id="ownedPlayTracking"></div>
      ${scoreSectionHtml({ rating, igdb: copy?.igdb, fix: { collection: atlas ? 'catalog' : 'wishlist', key: game.ref.id } })}
      <p>${escapeHtml(game.summary || '')}</p>
    </div>`;
  mountTracking(el.details.querySelector('#ownedPlayTracking'), tracking, [tracking.descriptor(game.ref.provider, game.ref.id)]);
  el.details.querySelector('#unmarkOwned')?.addEventListener('click', async () => {
    if (await tracking.run(() => tracking.flag(game.ref.id, { owned: false }))) { location.search = new URLSearchParams([...new URLSearchParams(location.search)].filter(([key]) => key !== 'game')).toString(); }
  });
  openDetails(el.panel, game.id);
}

function showDetails(id) {
  const game = library.find((item) => item.id === id);
  el.details.refreshProductEvidence = null;
  if (game?.manual) return showManualDetails(game);
  if (!game) {
    const descendants = library.filter(item => item.legacyGroups?.some(group => group.id === id));
    if (!descendants.length) return;
    el.details.innerHTML = `<div class="detail-body"><h3>This library entry was separated</h3><p>Choose the release you want. Notes from the old group are preserved with their original scope.</p><div class="regrouped-entries">${descendants.map(item => `<button type="button" data-release-id="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.year ?? 'Year unknown')} · ${escapeHtml(item.platforms.join(', ') || 'Platform unknown')}</button>`).join('')}</div></div>`;
    el.details.querySelectorAll('[data-release-id]').forEach(button => button.addEventListener('click', () => showDetails(button.dataset.releaseId)));
    openDetails(el.panel, id); return;
  }
  const preserved = preservedGroupNotes(tracking.snapshot(), game).filter(group => group.notes || group.favorite || group.hidden);
  const hero = game.background || game.cover;
  const developer = game.developers.join(", ") || "Unknown";
  const publisher = game.publishers.join(", ") || "Unknown";
  const sources = game.sources.join(", ") || "Unknown";
  const tags = [...(game.genres || []), ...game.categories, ...game.tags].slice(0, 18);
  // Fix an imported game's title, year, platform or cover, or edit one you added (your own
  // library only; the sample isn't yours to change).
  const editable = !window.PLAYNITE_SAMPLE;

  el.details.innerHTML = `
    <div class="detail-hero ${hero ? "" : "no-image"}" ${hero ? `style="background-image: linear-gradient(transparent, rgba(18,22,26,.96)), url('${escapeHtml(hero)}')"` : ""}>
      <div class="detail-hero-content">
        <h3>${escapeHtml(game.name)}</h3>
        <div class="chips">
          <span class="chip" id="ownedRatingChip">${escapeHtml(scoreLabel(game))}</span>
          ${vgcChipHtml(vgcOf(game))}
          ${beatChipHtml(gameScore(game).copy?.igdb)}
          <span class="chip">${escapeHtml(game.releaseDate || "No release date")}</span>
          <span class="chip">${game.played ? `${hours(game.timePlayed)} played` : "Unplayed"}</span>
        </div>
      </div>
    </div>
    <div class="detail-body">
      <div class="detail-actions">
        <button type="button" id="toggleFavorite" class="edit-toggle ${game.favorite ? "active" : ""}">★ ${game.favorite ? "Favorited" : "Favorite"}</button>
        <button type="button" id="toggleHidden" class="edit-toggle ${game.hidden ? "active" : ""}">${game.hidden ? "Hidden" : "Hide game"}</button>
        ${editable ? '<button type="button" class="edit-toggle" id="editDetails">✎ Edit details</button>' : ''}
      </div>
      <div id="ownedPlayTracking"></div>
      ${game.groupingVersion === 2 && game.copies.length > 1 ? '<p class="data-note">These copies have matching imported release details. Each keeps its own ratings and play history.</p>' : ''}
      <div id="recommendationLinks">${recommendationLinks(game.id)}</div>
      ${(({ score: rating, copy }) => scoreSectionHtml({ rating, igdb: copy?.igdb, steamReviews: copy?.steamReviews, fix: copy ? { collection: 'owned', key: copy.id } : null }))(gameScore(game))}
      ${vgcSectionHtml(vgcOf(game))}
      ${awardsSectionHtml(game.awards)}
      <p>${escapeHtml(game.summary || "No description available.")}</p>
      <div class="detail-section" id="ownedRatingEvidence"><h4>Rating evidence by copy</h4>
        <label class="field">Copy to inspect<select id="ratingCopy"><option value="">Choose a copy</option>${game.copies.map((copy,index)=>`<option value="${escapeHtml(copy.id)}">${escapeHtml([...(copy.platforms || []), ...(copy.sources || []), `Copy ${index+1}`].join(' · '))}</option>`).join('')}</select></label>
        <div id="copyRatingEvidence"></div>
        <p class="data-note">The score filter and score sort use the selected rating field only when your platform/store filters identify one copy. Multiple copies remain unranked until narrowed down.</p>
      </div>
      <div class="detail-section">
        <h4>Library Data</h4>
        <div class="kv">
          <span>Platforms</span><span>${platformIcons(game.platforms) || "Not recorded"}</span>
          <span>Source</span><span>${escapeHtml(sources)}</span>
          <span>Genres</span><span>${escapeHtml((game.genres || []).join(", ") || "Unclassified")}</span>
          <span>Developer</span><span>${escapeHtml(developer)}</span>
          <span>Publisher</span><span>${escapeHtml(publisher)}</span>
          <span>Play count</span><span>${formatNumber(game.playCount)}</span>
        </div>
      </div>
      ${
        game.duplicate
          ? `<div class="detail-section">
              <h4>Available on (${game.copies.length} copies)</h4>
              <div class="copies-table">${game.copies.map(copyRow).join("")}</div>
            </div>`
          : ""
      }
      <div class="detail-section">
        <h4><label for="notesInput">Notes</label></h4>
        <textarea id="notesInput" class="notes-field" rows="3" placeholder="Add a personal note...">${escapeHtml(game.notes || "")}</textarea>
      </div>
      ${preserved.length ? `<div class="detail-section"><h4>Preserved group notes</h4><p>These notes may describe several releases. Copy them only if they apply here; favorite and hidden choices stay separate.</p>${preserved.map((group, index) => `<details class="preserved-group"><summary>${escapeHtml(group.name)} · ${group.copyIds.length} original ${group.copyIds.length === 1 ? 'copy' : 'copies'}</summary><p>${group.favorite ? 'Previously favorited. ' : ''}${group.hidden ? 'Previously hidden.' : ''}</p><p class="preserved-note">${escapeHtml(group.notes || 'No notes recorded for this group.')}</p>${group.notes ? `<button type="button" data-copy-group-notes="${index}">Append these notes to this entry</button>` : ''}</details>`).join('')}<p data-group-note-status role="status"></p></div>` : ''}
      ${tags.length ? `<div class="detail-section"><h4>Genres &amp; tags</h4><div class="chips">${tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</div></div>` : ""}
    </div>
  `;

  const ratingCopy = el.details.querySelector('#ratingCopy');
  const eligibleCopies = matchingCopies(game, { platform: el.platform.value, source: el.source.value });
  if (eligibleCopies.length === 1) ratingCopy.value = eligibleCopies[0].id;
  const renderEvidence = () => {
    const copy = game.copies.find(copy => copy.id === ratingCopy.value);
    el.details.querySelector('#copyRatingEvidence').innerHTML = copy ? copyEvidenceHtml(copy) + rankingExplanationHtml(providerRanks?.records.get(refKey({provider:'playnite',id:copy.id}))) + '<div data-copy-provider-ratings></div><div data-steam-product-review></div>' : '<p>Each copy keeps its own ratings. Choose one to inspect its evidence.</p>';
    if (copy) {
      const match=productMatch(game,copy,productReviews);
      const host=el.details.querySelector('[data-steam-product-review]');
      host.innerHTML=match.applicable||productReviews[copy.id]?`<p>Steam product: ${escapeHtml(match.status==='accepted'?`confirmed app ${match.ref.id}`:match.status==='changed'?'import changed — review again':match.status==='rejected'?'rejected':match.applicable?'needs review':'not applicable to this copy')}</p><button type="button" data-review-product>Review Steam product</button>`:'';
      host.querySelector('button')?.addEventListener('click',()=>openProductReview(tracking,copy.id));
      mountProviderRatings(el.details.querySelector('[data-copy-provider-ratings]'), { ref: { provider: 'playnite', id: copy.id }, steamRef:match.ref, workspace: tracking.namespace });
    }
    // The shared score already covers every copy; per-copy fields only apply to the older modes.
    if (el.ratingMode.value === 'score') return;
    const result = copy ? (isProviderMode()?ownedSourceRating(ratings,game,el.ratingMode.value,{copyId:copy.id},productReviews):ownedRating({copies:[copy]},el.ratingMode.value)) : null;
    el.details.querySelector('#ownedRatingChip').textContent = result?.value != null ? (isProviderMode()?`${ratingText(result)}${result.scope==='work-context'?' · work context':''}`:`${modeLabel()} ${Number(result.value.toFixed(2))}/100 · ${(copy.platforms || []).join(', ') || 'Platform unknown'}`) : result?.reason || 'Choose a copy';
  };
  ratingCopy.addEventListener('change', renderEvidence); renderEvidence();
  el.details.refreshProductEvidence=renderEvidence;

  el.details.querySelector('#editDetails')?.addEventListener('click', () => openAddGame({ group: game }));
  el.details.querySelector("#toggleFavorite").addEventListener("click", async () => {
    await setOverride(game.id, { favorite: !game.favorite });
    showDetails(id);
    render();
  });
  el.details.querySelector("#toggleHidden").addEventListener("click", async () => {
    await setOverride(game.id, { hidden: !game.hidden });
    showDetails(id);
    render();
  });
  let savedNote = game.notes || '';
  el.details.querySelectorAll('[data-copy-group-notes]').forEach(button => button.addEventListener('click', async () => {
    const status = el.details.querySelector('[data-group-note-status]');
    if (el.details.querySelector('#notesInput').value !== savedNote) {
      status.textContent = 'Save your current note before appending preserved notes.'; return;
    }
    const source = preserved[Number(button.dataset.copyGroupNotes)];
    const result = await tracking.run(() => tracking.copyGroupNotes({ gameId: game.id, legacyId: source.id, expectedSource: source, expectedNotes: savedNote }));
    if (result) { syncTracking(); showDetails(id); render(); el.details.querySelector('[data-group-note-status]').textContent = 'Notes copied. The original group notes are preserved.'; }
    else status.textContent = 'Notes were not copied. Reopen the entry to review the latest saved notes.';
  }));
  el.details.querySelector("#notesInput").addEventListener("change", async (event) => {
    const notes = event.target.value;
    if (await setOverride(game.id, { notes }, { notes: savedNote })) savedNote = notes;
  });

  mountTracking(el.details.querySelector('#ownedPlayTracking'), tracking, game.copies.map(copy=>({...tracking.descriptor('playnite',copy.id),sources:copy.sources})));
  const matches = document.createElement('section'); matches.id = 'ownedLibraryMatches';
  el.details.querySelector('#ownedPlayTracking').before(matches);
  mountLibraryMatches(matches, tracking, { ownedId: id });
  openDetails(el.panel, id);
}

function closeDetails() {
  closePanel(el.panel);
}

function exportOverrides() {
  const blob = new Blob([JSON.stringify(overridesStore, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "overrides.json";
  link.click();
  URL.revokeObjectURL(url);
}

function bind() {
  const inputs = [el.search, el.platform, el.source, el.mainGenre, el.genre, el.category, el.tag, el.yearMin, el.yearMax, el.scoreMin, el.sort, el.ratingMode];
  inputs.forEach((input) => {
    input.addEventListener("input", () => {
      state.page = 1;
      render();
    });
  });

  [
    [el.status, "status"],
    [el.visibility, "visibility"],
    [el.cover, "cover"],
    [el.favorite, "favorite"],
    [el.duplicate, "duplicate"],
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
  el.gridView.addEventListener("click", () => {
    state.view = "grid";
    el.gridView.classList.add("active");
    el.listView.classList.remove("active");
    render();
  });
  el.spotlightView.addEventListener("click", () => { state.view = "spotlight"; render(); });
  el.shelves.addEventListener("click", event => {
    const shelf = event.target.closest("[data-shelf-platform]");
    if (!shelf) return;
    el.platform.value = shelf.dataset.shelfPlatform; el.source.value = shelf.dataset.shelfSource;
    state.page = 1; render();
    el.results.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });
  el.listView.addEventListener("click", () => {
    state.view = "list";
    el.listView.classList.add("active");
    el.gridView.classList.remove("active");
    render();
  });
  el.reset.addEventListener("click", () => {
    inputs.forEach((input) => { input.value = ""; });
    el.sort.value = "smart";
    el.ratingMode.value = 'critic';
    state.status = "";
    state.visibility = "";
    state.cover = "";
    state.favorite = "";
    state.duplicate = "";
    state.page = 1;
    setSegment(el.status, "");
    setSegment(el.visibility, "");
    setSegment(el.cover, "");
    setSegment(el.favorite, "");
    setSegment(el.duplicate, "");
    render();
  });
  el.pageSize.addEventListener("change", () => {
    state.pageSize = Number(el.pageSize.value);
    writeStore(PAGE_SIZE_KEY, state.pageSize);
    state.page = 1;
    render();
  });
  el.exportOverrides.addEventListener("click", exportOverrides);
  el.results.addEventListener("click", (event) => {
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
  fillSelect(el.platform, "platforms", stats.platforms || []);
  fillSelect(el.source, "stores / sources", stats.sources || []);
  for (const option of el.source.options) if (PC_STORES.some(store=>store.id===storeKey(option.value))) option.hidden=true;
  el.platform.add(new Option('PC · Windows / DOS', 'pc'), 1);
  for (const [index,store] of PC_STORES.entries()) el.source.add(new Option(`${store.name} · storefront`, `store:${store.id}`),index+1);
  fillSelect(el.mainGenre, "main genres", stats.mainGenres || []);
  fillSelect(el.genre, "genres", stats.genres || []);
  fillSelect(el.category, "categories", stats.categories || []);
  fillSelect(el.tag, "tags", stats.tags || []);
  // Playnite categories are optional and usually empty, and genres only exist
  // once tools/steam_enrich.py has run; only offer filters that can match.
  el.categoryField.hidden = !(stats.categories || []).length;
  el.mainGenreField.hidden = !(stats.genres || []).length;
  el.genreField.hidden = !(stats.genres || []).length;
  if (stats.yearMin) el.yearMin.placeholder = String(stats.yearMin);
  if (stats.yearMax) el.yearMax.placeholder = String(stats.yearMax);
  setupCommon();
  route.restore();
  renderStats();
  bind();
  render();
  route.openInitial();
}

function syncView() {
  for (const [view, button] of [["grid",el.gridView],["list",el.listView],["spotlight",el.spotlightView],["top",el.topViewButton]]) if(button) {
    button.classList.toggle("active",state.view===view);
    button.setAttribute("aria-pressed",String(state.view===view));
  }
}
const route = createRoute({ controls:{q:el.search, platform:el.platform, source:el.source, mainGenre:el.mainGenre, genre:el.genre, category:el.category, tag:el.tag, yearMin:el.yearMin, yearMax:el.yearMax, score:el.scoreMin, rating:el.ratingMode, sort:el.sort}, state, numeric:{pageSize:PAGE_SIZE_OPTIONS}, enums:{view:["grid","list","spotlight"], check:["","check"], status:["","played","unplayed"], visibility:["","visible","hidden"], cover:["","with"], favorite:["","favorite"], duplicate:["","duplicate"]}, render, showDetails, syncControls(){el.pageSize.value=String(state.pageSize);for (const key of ["status","visibility","cover","favorite","duplicate"]) setSegment(el[key], state[key]);syncView();} });

// Add a game, edit one you added or fix an imported one: the dialog loads only when it's opened.
function openAddGame({ group = null } = {}) {
  import('./add-game.js').then(module => module.openGameEditor({ library, group })).catch(() => notify('The Add game window couldn’t open. Reload the page and try again.'));
}
document.getElementById('addGame')?.addEventListener('click', () => openAddGame());
// Import games links here to add a game (read before the page rewrites its address).
const addRequested = location.hash === '#add-game';

init();
pageReady();
if (addRequested) openAddGame();
// A save reloads the page; it says what changed.
try { const message = sessionStorage.getItem('level-select-flash'); if (message) { sessionStorage.removeItem('level-select-flash'); notify(message); } } catch { /* nothing to say */ }
tracking.subscribe(change=>{syncTracking();render();if(el.panel.open)el.details.refreshProductEvidence?.();if(change.type==='refresh' && el.panel.open && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))showDetails(new URLSearchParams(location.search).get('game'));});
bindMatchFixes(document.getElementById("detailsContent"));
bindHovercards();
el.libraryMeta.addEventListener('click', event => {
  if (!event.target.closest('[data-toggle-check]')) return;
  state.check = state.check === 'check' ? '' : 'check'; state.page = 1; render(); renderStats();
});

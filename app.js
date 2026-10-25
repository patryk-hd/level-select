import { showSearchSuggestions } from './library/search-ui.js';
import { beatHours, ratingText as scoreText, steamText } from './tracking/score.js';
// The detail header: the score with its evidence, and time to beat when known.
const catalogScoreText = game => { const score = catalogScore(game), beat = beatHours(game.igdb); return [score ? `${scoreText(score)}${game.reviews ? '' : ' · IGDB'}` : 'Not rated yet', beat && `about ${beat}h to beat`].filter(Boolean).join(' · '); };
// Review-backed lists rank by reviews; the other systems keep the original editorial order.
// The list switch shows the original (corrected) list on every system.
const reviewed = system => system?.method === 'reviews';
const showingOriginal = system => state.list === 'original' || !reviewed(system);
const listCount = system => state.list === 'original' ? system.originalCount : system.count;
// One system in list order reads in tiers (rankTier in lib.js).
const showTiers = () => hasSystemRank(state) && !sourceMode();
const tierOf = rankTier;

// ---------- Carousel and spotlight (library/browse-ui.js) ----------
// Where you were: the carousel's system and the spotlight's game survive redraws.
let carouselSystem = '', spotSelected = '', spotlight = null;
const coverOf = game => game?.cover?.local || game?.cover?.url || '';
// The top of a system's list, for the carousel slide's covers.
function topCovers(system, count = 5) {
  return catalog.games.filter(game => game.systemId === system.id && listRank(game, state) != null && coverOf(game))
    .sort((a, b) => listRank(a, state) - listRank(b, state)).slice(0, count).map(coverOf);
}
// Facts about each system (data/system-facts.json: Wikidata, Wikipedia, Commons photos).
let systemFacts = {};
const sold = amount => amount >= 1e6 ? `${(amount / 1e6).toFixed(amount >= 1e8 ? 0 : 1).replace(/\.0$/, '')} million` : amount.toLocaleString('en');
// What the list itself says about a system: its best, most-reviewed and golden-year games.
function listFacts(s) {
  const games = catalog.games.filter(g => g.systemId === s.id && listRank(g, state) != null);
  if (!games.length) return [];
  const facts = [], count = values => [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const scored = games.map(g => [g, catalogScore(g)]).filter(([, rating]) => rating).sort((a, b) => b[1].exact - a[1].exact);
  if (scored.length) facts.push(['Highest rated', `${scored[0][0].title} · score ${scored[0][1].value}`]);
  const reviewedMost = games.filter(g => g.reviews?.critics?.source === 'wikipedia').sort((a, b) => b.reviews.critics.count - a.reviews.critics.count)[0];
  if (reviewedMost) facts.push(['Most reviewed', `${reviewedMost.title} · ${reviewedMost.reviews.critics.count} critic reviews`]);
  const [year, inYear] = count(games.map(g => g.year).filter(Boolean))[0] ?? [];
  if (inYear >= 3) facts.push(['Golden year', `${year} · ${inYear} of the list's ${games.length} games`]);
  // "Action" is IGDB's tag for almost everything; a specific genre says more.
  const [genre, inGenre] = count(games.flatMap(g => g.genres).filter(g => !['Other', 'Action'].includes(g)))[0] ?? [];
  if (genre) facts.push(['Most common genre', `${genre} · ${inGenre} games`]);
  const winners = games.filter(g => awardSummary(g.awards)?.tier === 'goty');
  if (winners.length) facts.push(['Game of the Year winners', `${winners.slice(0, 3).map(g => g.title).join(', ')}${winners.length > 3 ? ` and ${winners.length - 3} more` : ''}`]);
  const years = games.map(g => g.year).filter(Boolean);
  if (years.length) facts.push(['Spans', `${Math.min(...years)}–${Math.max(...years)}`]);
  facts.push(['In your collection', `${games.filter(g => g.playniteOwned).length} owned · ${games.filter(g => collection.entries[g.id]?.status === 'completed').length} completed`]);
  return facts;
}
// The carousel lives in its own slot and is only rebuilt when what it shows changes, so
// pinning a system or other redraws don't replay its animations.
let carouselView = null, carouselKey = '';
function renderCarousel(systems) {
  const slot = $('carousel-slot'), slides = systemSlides(systems);
  const key = JSON.stringify(slides.map(slide => [slide.title, slide.meta, slide.chips, slide.covers[0]]));
  const active = Math.max(0, systems.findIndex(s => s.id === carouselSystem));
  if (!slides.length) { slot.innerHTML = ''; carouselView = null; carouselKey = ''; return; }
  if (key === carouselKey && carouselView) { if (carouselView.current !== active) carouselView.go(active); return; }
  carouselKey = key;
  slot.innerHTML = carouselHtml({ label: 'Systems', slides, active });
  carouselView = bindCarousel(slot, { active, onChange: index => { carouselSystem = systems[index].id; } });
}
function systemSlides(systems) {
  return systems.map(s => {
    const family = byFamily.get(s.family), completed = catalog.games.filter(g => g.systemId === s.id && listRank(g, state) != null && collection.entries[g.id]?.status === 'completed').length;
    return { title: s.name, short: s.abbreviation, eyebrow: `${family.name} · ${s.kind} · ${s.launchYear}`, subtitle: s.fullName !== s.name ? s.fullName : '',
      meta: `${listCount(s)} games ${showingOriginal(s) ? 'on the original list' : 'ranked by reviews'} · ${completed} completed`, progress: listCount(s) ? completed / listCount(s) : 0,
      covers: topCovers(s), color: family.color, action: { label: `Browse ${s.name}`, attrs: `data-browse-system="${esc(s.id)}"` },
      chips: [systemFacts[s.id]?.manufacturer?.[0], systemFacts[s.id]?.unitsSold && `${sold(systemFacts[s.id].unitsSold.amount)} sold`].filter(Boolean),
      more: { label: `About ${s.name}`, attrs: `data-system-info="${esc(s.id)}"` } };
  });
}
// Descriptions and screenshots, loaded the first time the spotlight needs them.
let atlasDetails = null, detailsRequest = null;
function loadDetails() {
  detailsRequest ??= fetch(new URL('./data/atlas-details.json', import.meta.url)).then(response => response.ok ? response.json() : { games: {} })
    .catch(() => ({ games: {} })).then(data => { atlasDetails = data.games ?? {}; spotlight?.refresh(); });
  return detailsRequest;
}
function spotRow(game, index) {
  const position = index + (state.page - 1) * PAGE_SIZE + 1, rank = hasSystemRank(state) ? listRank(game, state) : position;
  const score = catalogScore(game), multi = state.systems.length !== 1;
  const meta = [game.year, score && `Score ${score.value}`, multi && bySystem.get(game.systemId).abbreviation].filter(Boolean).join(' · ');
  return `<div class="spot-row has-marks"${tierAttrs(game)}><button class="spot-main" type="button" data-spot="${game.id}"><span class="spot-rank">${rank ?? '–'}</span>${artwork(game)}<span class="spot-text"><span class="spot-title">${esc(game.title)}</span><span class="spot-meta">${esc(meta)}</span></span></button>${gameMarks(game)}</div>`;
}
function spotPanel(id) {
  const game = byGame.get(id); if (!game) return '';
  const system = bySystem.get(game.systemId), rank = listRank(game, state), score = catalogScore(game), award = awardSummary(game.awards), beat = beatHours(game.igdb);
  const detail = atlasDetails?.[game.id], shots = [...libretroShots(game.cover?.url), ...(detail?.shots ?? []).map(igdbShot)];
  const evidence = score?.parts?.map(part => `${part.label} ${part.value}${part.count ? ` (${part.count.toLocaleString('en')})` : ''}`).join(' · ');
  const wiki = detail?.page ? `https://en.wikipedia.org/wiki/${encodeURIComponent(detail.page.replace(/ /g, '_'))}` : null;
  return `<div class="spotlight-backdrop" style="${artStyle('art', coverOf(game))}" aria-hidden="true"></div>
    <div class="spotlight-head">${artwork(game, true)}<div class="spotlight-heading">
      ${rank ? `<p class="spotlight-place"${tierAttrs(game)}><span class="spotlight-coin">${rank}</span>${showingOriginal(system) ? 'Original list' : 'Ranked by reviews'} · ${esc(system.name)}</p>` : ''}
      <h2 class="spotlight-title">${esc(game.title)}</h2>
      <p class="spotlight-sub">${[game.year, ...game.genres.slice(0, 3), beat && `about ${beat}h to beat`].filter(Boolean).map(esc).join(' · ')}</p>
      ${score ? `<p class="spotlight-score"><strong>${score.value}</strong><span>${esc(evidence)}${score.thin ? ' · few ratings' : ''}</span></p>` : '<p class="spotlight-score is-empty"><span>Not rated yet</span></p>'}
      ${game.steamReviews || game.vgc ? `<p class="spotlight-other">${[game.steamReviews && esc(steamText(game.steamReviews)), game.vgc && `VGC Score ${game.vgc.score} · ${vgcCreditHtml(game.vgc)}`].filter(Boolean).join(' · ')}</p>` : ''}
      ${ownership(game) ? `<p class="spotlight-owned">${ownedBadge(game)}<span>${esc(ownership(game).label)}</span></p>` : ''}
      ${award ? `<p class="spotlight-award">${award.tier === 'goty' ? '🏆' : '🏅'} ${esc(award.headline)}</p>` : ''}
    </div></div>
    ${detail?.text ? `<p class="spotlight-text">${esc(detail.text)}</p>${wiki ? `<a class="provider-credit" href="${esc(wiki)}" target="_blank" rel="noopener noreferrer">From Wikipedia ↗</a>` : ''}` : atlasDetails ? '' : '<p class="spotlight-text is-loading">Loading the description…</p>'}
    ${shotsHtml(shots)}
    <div class="spotlight-actions"><button class="primary-button" type="button" data-game="${game.id}">Open details</button>${favoriteButton(game)}${otherOwnership(game)}</div>`;
}
const tierAttrs = game => { if (!showTiers()) return ''; const rank = listRank(game, state), [tier] = tierOf(rank); return ` data-tier="${tier}"${tier === 'podium' ? ` data-place="${rank}"` : ''}`; };
// Consecutive games of a tier share a section with its heading and rank range.
function tiered(items, list) {
  const groups = [];
  items.forEach((game, index) => {
    const rank = listRank(game, state), [key, label] = tierOf(rank);
    if (groups.at(-1)?.key !== key) groups.push({ key, label, games: [], ranks: [] });
    groups.at(-1).games.push([game, index]); if (rank) groups.at(-1).ranks.push(rank);
  });
  return groups.map((group, n) => {
    const low = Math.min(...group.ranks), high = Math.max(...group.ranks);
    const range = group.ranks.length ? `<span class="tier-range">#${low}${high > low ? `–${high}` : ''}</span>` : '';
    return `<section class="rank-tier tier-${group.key}" style="--i:${n}" aria-label="${esc(group.label)}"><h2 class="tier-head"><span class="tier-name">${esc(group.label)}</span>${range}</h2>${list(group.games.map(([game, index]) => gameMarkup(game, index)).join(''), group.label)}</section>`;
  }).join('');
}
import { platformSummary } from './tracking/atlas.js';
import { awardSummary } from './tracking/awards.js';
import { awardsSectionHtml, reviewsSectionHtml, awardSealHtml, awardHoverHtml, ratingHoverHtml, beatHoverHtml, vgcSectionHtml, vgcCreditHtml } from './library/score-ui.js';
import { bindHovercards, hoverAttr } from './library/hovercard.js';
import { carouselHtml, bindCarousel, spotlightHtml, bindSpotlight, artStyle, libretroShots, igdbShot, shotsHtml } from './library/browse-ui.js';
import { mountProviderRatings, loadRatings } from './ranking/panels.js';
import { emptyRatings } from './ranking/snapshot.js';
import { sourceIndex, sourceRating, rankCandidates, compareResults, refKey, ratingText, CONTEXT_MODES, SOURCE_MODES } from './ranking/modes.js';
import { rankingSummaryHtml, rankingExplanationHtml, fictional } from './ranking/mode-ui.js';
import { trackingClient, loadCatalog } from './tracking/client.js';
import { setupTracking, openTrackingBackup, mountTracking } from './tracking/ui.js';
import { mountLibraryMatches } from './tracking/matches-ui.js';
import { setNavigation, syncNavigation, pageReady } from './navigation.js';
import { demoHome, isCatalogLanding, hasSystemRank, catalogSystems, PREFERENCES_KEY, PAGE_SIZE, STATUSES, STATUS_LABELS, freshState, normalize, escapeHtml as esc, emptyCollection, isTracked, parseState, encodeState, filterGames, paginate, catalogScore, listRank, rankTier } from './lib.js';

const $ = id => document.getElementById(id);
const dialog = $('dialog');
let catalog, bySystem, byFamily, byGame, state, collection = emptyCollection(), dialogKind = '', lastOpener, toastTimer, searchTimer;
const hasExplicitSort = () => { const sort = new URLSearchParams(location.search).get('sort'); return Boolean(sort && sort !== 'relevance'); };
let explicitSort = hasExplicitSort();
let connections = { byRelease: {} };
let ratings, providerRanks, ratingsUnavailable=false;
const sourceMode=()=>CONTEXT_MODES.includes(state.sort);
const catalogRating=game=>providerRanks?.records.get(refKey({provider:'catalog',id:game.id})) ?? {...sourceRating(ratings,{provider:'catalog',id:game.id},state.sort),reason:'Outside the current list filters'};
const failedArt = new Set();
const fmt = value => value.toLocaleString();
const selected = (a,b) => a === b ? ' selected' : '';
const checked = value => value ? ' checked' : '';

function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; },6500);
}
function readPreferences() { try { return JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}'); } catch { return {}; } }
let tracking;
function loadCollection() {
  collection = tracking.collection();
  connections = tracking.connections();
  for (const game of catalog.games) game.playniteOwned = Boolean(connections.byRelease[game.id]?.sameSystem);
}
function saveLayout() { try { localStorage.setItem(PREFERENCES_KEY,JSON.stringify({ layout:state.layout })); } catch { /* Optional preference; collection failures are reported separately. */ } }
function writeUrl(replace = false) {
  const url = new URL(location.href); url.search = encodeState(state); if(tracking?.namespace==='sample')url.searchParams.set('workspace','sample');
  const target = url.pathname + url.search + url.hash;
  if (target !== location.pathname + location.search + location.hash) history[replace ? 'replaceState' : 'pushState']({},'',target);
}
function change(patch, { replace = false, keepPage = false } = {}) {
  if (patch.q === '' && Object.hasOwn(patch,'sort')) explicitSort = !['curated','relevance','score'].includes(patch.sort);
  if (!Object.hasOwn(patch,'sort') && Object.hasOwn(patch,'q') && state.view !== 'systems' && state.rank === 'all' && !explicitSort) patch = {...patch, sort: patch.q.trim() ? 'relevance' : 'score'};
  state = {...state,...patch,...(keepPage ? {} : {page:1})};
  if(state.sort==='curated' && state.systems.length!==1 && !isCatalogLanding(state))state.sort='score';
  if(!hasSystemRank(state))state.rank='all';
  writeUrl(replace); render();
}
function resetFilters() {
  explicitSort = false;
  change({...freshState(),view:state.view,layout:state.layout,game:''});
}
function showDialog(title, html, kind) {
  if (!dialog.open) lastOpener = document.activeElement;
  dialogKind = kind; $('dialog-title').textContent = title; $('dialog-body').innerHTML = html;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
function closeDialog() {
  if (state?.game) { state.game = ''; writeUrl(true); }
  dialog.close();
}
dialog.addEventListener('close',() => { dialogKind=''; if (lastOpener?.isConnected) lastOpener.focus(); else $('main').focus({preventScroll:true}); });
dialog.addEventListener('cancel',() => { if (state?.game) {state.game='';writeUrl(true);} });
$('close-dialog').addEventListener('click',closeDialog);
dialog.addEventListener('click',event => { if (event.target===dialog) {const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();} });

function artwork(game, large = false) {
  const system = bySystem.get(game.systemId);
  const src = game.cover?.local || game.cover?.url;
  return `<span class="artwork"><span class="art-fallback" aria-hidden="true">${esc(large ? game.title : system.abbreviation)}</span>${src && !failedArt.has(src) ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" width="${large?300:90}" height="${large?400:124}" data-art>` : ''}</span>`;
}
// Steam's reviews and VideoGamesCritic beside our score on PC list games: context, not part
// of the ranking. VGC always comes with its "Powered by" link (their terms).
const steamTerm = game => game.steamReviews ? `<span class="hover-term"${hoverAttr(`<p class="hc-note">${esc(steamText(game.steamReviews))}</p><p class="hc-source">Steam · context, not part of our score</p>`)}>Steam ${game.steamReviews.percent}%</span>` : '';
const steamLink = game => `https://store.steampowered.com/app/${encodeURIComponent(game.steamAppId)}/`;
function otherScoresHtml(game) {
  const steam = game.steamReviews ? `<div class="detail-section"><h4>On Steam</h4><p class="score-lines">${esc(steamText(game.steamReviews))}</p><a class="provider-credit" href="${esc(steamLink(game))}" target="_blank" rel="noopener noreferrer">Steam store ↗</a></div>` : '';
  return steam + vgcSectionHtml(game.vgc);
}

// You have this release: a copy for this system in your library (Playnite, Steam, GOG, ES-DE,
// a ROM folder), or you ticked Owned yourself.
function ownership(game) {
  const match = connections.byRelease[game.id], copy = match?.sameSystem ? match : null, marked = Boolean(collection.entries[game.id]?.owned);
  if (!copy && !marked) return null;
  return { copy, label: copy ? `In your library${copy.sources?.length ? ` · ${copy.sources.join(', ')}` : ''}` : 'You marked it as owned' };
}
// "Owned" sits beside the favorite heart; a library copy opens in Library.
function ownedBadge(game) {
  const owned = ownership(game); if (!owned) return '';
  const inner = `<span aria-hidden="true">✓</span>Owned`;
  return owned.copy ? `<a class="owned-badge" href="./library/index.html?game=${encodeURIComponent(owned.copy.id)}" title="${esc(owned.label)} · open in Library" aria-label="Owned: ${esc(owned.label)}. Open in Library">${inner}</a>`
    : `<span class="owned-badge" title="${esc(owned.label)}" aria-label="Owned: ${esc(owned.label)}">${inner}</span>`;
}
const gameMarks = game => `<span class="game-marks">${ownedBadge(game)}${favoriteButton(game)}</span>`;
// Library links the badge doesn't already cover: a copy on another platform, or a match to review.
const otherOwnership = game => connections.byRelease[game.id]?.sameSystem ? '' : ownedLink(game);
// Grid cards use the short name (DC, PS2) so Owned and the heart fit beside it.
function systemTag(game, short = false) {
  const s=bySystem.get(game.systemId), f=byFamily.get(s.family);
  return `<button class="system-tag" type="button" data-browse-system="${s.id}" style="--family-color:${f.color}" aria-label="Browse ${esc(s.name)} games"${short?` title="${esc(s.name)}"`:''}>${esc(short?s.abbreviation:s.name)}</button>`;
}
function favoriteButton(game) {
  const active=Boolean(collection.entries[game.id]?.favorite);
  return `<button class="favorite-button" type="button" data-favorite="${game.id}" aria-label="${active?'Remove':'Add'} ${esc(game.title)} ${active?'from':'to'} favorites" aria-pressed="${active}">${active?'♥':'♡'}</button>`;
}
function ownedLink(game) {
  const match = connections.byRelease[game.id];
  // A ROM for another system is a different release, not something to review here.
  if (!match) return connections.candidatesByRelease?.[game.id]?.some(item => ['unresolved','changed'].includes(item.status) && !(item.rom && !item.sameSystem))
    ? `<button class="owned-link" type="button" data-game="${esc(game.id)}">Possible library match · review</button>` : '';
  return `<a class="owned-link" href="./library/index.html?game=${encodeURIComponent(match.id)}"${match.sources?.length ? ` title="${esc(match.sources.join(', '))}"` : ''}>${match.sameSystem ? 'In your library ↗' : 'Owned on another platform ↗'}</a>`;
}
function gameMarkup(game, index) {
  if (state.layout === 'spotlight') return spotRow(game, index);
  const position = index + (state.page - 1) * PAGE_SIZE + 1;
  const rowNumber = hasSystemRank(state) ? listRank(game, state) ?? '–' : position;
  const status=collection.entries[game.id]?.status || 'untracked';
  if(sourceMode()){
    const result=catalogRating(game),position=result.rank??'—';
    const credit=result.value!==null&&result.row?.source?(fictional(result)?'<span>Fictional example</span>':`<a class="provider-credit" href="${esc(result.row.source.url)}" target="_blank" rel="noopener noreferrer">${esc(result.row.source.attribution)} ↗</a>`):'';
    const description=`${ratingText(result)}${result.value!==null?' · work context':''}${result.value!==null&&['stale','refresh-failed'].includes(result.freshness)?' · saved / refresh due':''}`;
    const button=`<button class="game-title-button" type="button" data-game="${game.id}">${artwork(game,state.layout==='grid')}<span class="card-body"><span class="game-title">${esc(game.title)}</span><span class="game-subtitle">${esc(description)}</span></span></button>`;
    if(state.layout==='grid')return `<article class="game-card" role="listitem">${button}<p class="provider-credit">${credit}</p><div class="card-bottom"><span>#${position} in this selection</span>${gameMarks(game)}</div>${systemTag(game)}</article>`;
    return `<article class="game-row" role="listitem"><span class="rank" aria-label="Rank within the filtered catalog">${position}</span><div class="provider-game-main">${button}${credit}</div><span class="system-column">${systemTag(game)}</span><span class="status-column status-tag ${status}">${otherOwnership(game)||STATUS_LABELS[status]}</span>${gameMarks(game)}</article>`;
  }
  const score=catalogScore(game), beat=beatHours(game.igdb);
  const award=awardSummary(game.awards);
  // Score, awards and hours preview their details on hover.
  const description=[game.year&&esc(game.year), score&&`<span class="hover-term"${hoverAttr(ratingHoverHtml(score,{igdb:game.igdb,steam:game.steamReviews}))}>Score ${score.value}${score.thin?' (few ratings)':''}</span>`, steamTerm(game), award&&`<span class="hover-term"${hoverAttr(awardHoverHtml(game.awards))}>${award.tier==='goty'?'🏆 ':award.tier==='winner'?'🏅 ':''}${esc(award.short)}</span>`, beat&&`<span class="hover-term"${hoverAttr(beatHoverHtml(game.igdb))}>~${beat}h</span>`, ...game.genres.slice(0,2).map(esc)].filter(Boolean).join(' · ');
  if (state.layout==='grid') return `<article class="game-card" role="listitem"${tierAttrs(game)}><button class="game-title-button" type="button" data-game="${game.id}" aria-label="Open ${esc(game.title)} on ${esc(bySystem.get(game.systemId).name)}">${artwork(game,true)}${awardSealHtml(game.awards,{corner:'end'})}<span class="card-rank">${hasSystemRank(state)?`<b>${listRank(game,state)?`<span class="rank-hash">#</span>${listRank(game,state)}`:'Not ranked'}</b><span class="card-rank-system"> · ${esc(bySystem.get(game.systemId).abbreviation)}</span>`:'List #'+position}</span><div class="card-body"><div class="game-title">${esc(game.title)}</div><div class="game-subtitle">${description}</div>${status!=='untracked'?`<span class="status-tag ${status}">${STATUS_LABELS[status]}</span>`:''}</div></button><div class="card-bottom">${systemTag(game,true)}${gameMarks(game)}</div>${otherOwnership(game)}</article>`;
  return `<article class="game-row" role="listitem"${tierAttrs(game)}><span class="rank ${hasSystemRank(state)&&game.rank<=10?'top-rank':''}" aria-label="${hasSystemRank(state)?(showingOriginal(bySystem.get(game.systemId))?'Original list rank':'Rank by reviews'):'List position'} ${rowNumber}">${rowNumber}</span><button class="game-title-button" type="button" data-game="${game.id}" aria-label="Open ${esc(game.title)} on ${esc(bySystem.get(game.systemId).name)}">${artwork(game)}<span><span class="game-title">${esc(game.title)}</span><span class="game-subtitle">${description}</span></span></button><span class="system-column">${systemTag(game)}</span><span class="status-column status-tag ${status}">${otherOwnership(game) || STATUS_LABELS[status]}</span>${gameMarks(game)}</article>`;
}
function renderNavigation() {
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);if(b.dataset.view===state.view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  syncNavigation();
  $('pinned-section').hidden=!collection.pinnedSystems.length;
  $('pinned-nav').innerHTML=`<button type="button" data-favorites-catalog>★ Favorites catalog · ${collection.pinnedSystems.length}</button>`;
}
function renderChips() {
  const chips=[];
  const add=(key,label,value='')=>chips.push(`<button class="filter-chip" type="button" data-clear="${key}" data-value="${esc(value)}" aria-label="Remove ${esc(label)} filter">${esc(label)}<span aria-hidden="true">×</span></button>`);
  if(state.family)add('family',byFamily.get(state.family).name);
  if(state.scope==='favorites')add('scope','Favorite systems');
  state.systems.forEach(id=>add('systems',bySystem.get(id).name,id));state.genres.forEach(g=>add('genres',g,g));
  if(state.ownership!=='all')add('ownership',state.ownership==='owned'?'Confirmed copy · this system':'No confirmed copy · this system');
  if(state.q)add('q',`Search: ${state.q}`);
  if(state.rank!=='all')add('rank',`Top ${state.rank} per system`);
  if(state.yearFrom||state.yearTo)add('years',`${state.yearFrom||'Any year'} – ${state.yearTo||'present'}`);
  if(state.kind)add('kind',state.kind);
  if(state.era)add('era',{'before2000':'Before 2000','2000s':'2000–2009','2010plus':'2010 onwards'}[state.era]);
  $('active-filters').innerHTML=chips.join('')+(chips.length?'<button class="text-button" type="button" data-reset>Clear all</button>':'');
}
function renderGames() {
  const games=filterGames(catalog,state,collection);
  if(sourceMode())games.sort((a,b)=>compareResults(catalogRating(a),catalogRating(b)));
  showSearchSuggestions($('results'), games.length ? games : filterGames(catalog,{...state,q:''},collection), state.q, title=>{change({q:title},{replace:true});$('search').focus();});
  const page=paginate(games,state.page);
  if(state.page!==page.page){state.page=page.page;writeUrl(true);}
  $('result-count').innerHTML=`<strong>${fmt(games.length)}</strong> ${games.length===1?'game':'games'}${games.length?` <span class="muted">· ${fmt(page.start+1)}–${fmt(page.start+page.items.length)}</span>`:''}`;
  if(!games.length){
    const emptyCollectionView=state.view==='collection'&&!Object.values(collection.entries).some(isTracked);
    $('results').innerHTML=`<div class="empty-state"><h2>${emptyCollectionView?'Make this library yours.':'No games match these filters.'}</h2><p>${emptyCollectionView?'Favorite a game, mark one as owned, or start a backlog. Your collection will appear here.':'Try another title, choose All systems, or remove a filter.'}</p><button class="primary-button" type="button" ${emptyCollectionView?'data-view="games"':'data-reset'}>${emptyCollectionView?'Explore games':'Clear filters'}</button></div>`;
  } else {
    const header=`<div class="list-header" aria-hidden="true"><span>${sourceMode()?'Rank':hasSystemRank(state)?'System rank':'List #'}</span><span>Game</span><span>System</span><span class="status-column">Play status</span><span></span></div>`;
    spotlight=null;
    if(state.layout==='spotlight'){
      $('results').innerHTML=spotlightHtml(showTiers()?tiered(page.items,rows=>`<div class="spot-group">${rows}</div>`):page.items.map(gameMarkup).join(''),'Games');
      spotlight=bindSpotlight($('results'),{panel:spotPanel,onOpen:id=>openGame(id),selected:spotSelected,onSelect:id=>{spotSelected=id;}});
      if(!atlasDetails)loadDetails();
      $('pagination').innerHTML=page.pages>1?`<button type="button" data-page="${page.page-1}"${page.page===1?' disabled':''}>← Previous</button><span>Page ${page.page} of ${page.pages}</span><button type="button" data-page="${page.page+1}"${page.page===page.pages?' disabled':''}>Next →</button>`:'';
      return;
    }
    $('results').innerHTML=showTiers()
      ?(state.layout==='list'?`<div class="games-list is-tiered">${header}${tiered(page.items,(rows,label)=>`<div role="list" aria-label="${esc(label)}">${rows}</div>`)}</div>`:`<div class="tiered-grid">${tiered(page.items,(cards,label)=>`<div class="games-grid" role="list" aria-label="${esc(label)}">${cards}</div>`)}</div>`)
      :state.layout==='list'?`<div class="games-list">${header}<div role="list" aria-label="Games">${page.items.map(gameMarkup).join('')}</div></div>`:`<div class="games-grid" role="list" aria-label="Games">${page.items.map(gameMarkup).join('')}</div>`;
  }
  $('pagination').innerHTML=page.pages>1?`<button type="button" data-page="${page.page-1}"${page.page===1?' disabled':''}>← Previous</button><span>Page ${page.page} of ${page.pages}</span><button type="button" data-page="${page.page+1}"${page.page===page.pages?' disabled':''}>Next →</button>`:'';
}
function renderSystems() {
  showSearchSuggestions($('results'), [], '', ()=>{});
  const terms=normalize(state.q).split(' ').filter(Boolean);
  const systems=catalogSystems(catalog,{...state,systems:[]},collection.pinnedSystems).filter(s=>terms.every(t=>normalize(`${s.name} ${s.fullName} ${s.abbreviation} ${byFamily.get(s.family).name}`).includes(t)));
  $('result-count').innerHTML=`<strong>${systems.length}</strong> ${state.scope==='favorites'?'favorite systems':'systems & collections'}`;
  $('pagination').innerHTML='';
  renderCarousel(systems.length>1&&!state.q?systems:[]);
  $('results').innerHTML=systems.length?`<div class="systems-grid">${systems.map(s=>{
    const f=byFamily.get(s.family), entries=catalog.games.filter(g=>g.systemId===s.id&&listRank(g,state)!=null), completed=entries.filter(g=>collection.entries[g.id]?.status==='completed').length, pinned=collection.pinnedSystems.includes(s.id);
    return `<article class="system-card" data-system="${s.id}" style="--family-color:${f.color}"><button class="pin-button" data-pin="${s.id}" type="button" aria-label="${pinned?'Unpin':'Pin'} ${esc(s.name)}" aria-pressed="${pinned}">${pinned?'★':'☆'}</button><div class="system-card-badge">${esc(s.abbreviation)}</div><div><h2>${esc(s.name)}</h2><p>${esc(s.kind)} · ${s.launchYear}</p></div><div><small>${showingOriginal(s)?'Original list':'Ranked by reviews'} · ${completed} of ${listCount(s)} completed</small><div class="progress-track" role="progressbar" aria-label="${esc(s.name)} completion" aria-valuenow="${completed}" aria-valuemin="0" aria-valuemax="${listCount(s)}"><span style="width:${listCount(s)?completed/listCount(s)*100:0}%"></span></div></div><div class="system-actions"><button class="text-button" data-browse-system="${s.id}" type="button">Browse ${listCount(s)} games →</button><button class="text-button muted" data-system-info="${s.id}" type="button" aria-label="About ${esc(s.name)}">Details</button></div></article>`;
  }).join('')}</div>`:`<div class="empty-state"><h2>${state.scope==='favorites'?'Your favorites start here.':'No systems found.'}</h2><p>${state.scope==='favorites'?'Pin systems or PC storefronts with the star on their cards. They will appear in your Favorites catalog.':'Try a different name or platform family.'}</p><button class="primary-button" type="button" data-reset>Browse all systems</button></div>`;
}
function render() {
  if(sourceMode()){
    providerRanks=rankCandidates(filterGames(catalog,state,collection).map(game=>({...sourceRating(ratings,{provider:'catalog',id:game.id},state.sort),title:game.title})),{cohort:'this filtered catalog selection',mode:state.sort});
  }else providerRanks=null;
  $('rating-summary').hidden=!sourceMode()||(state.view==='systems'||isCatalogLanding(state));
  if(sourceMode())$('rating-summary').innerHTML=rankingSummaryHtml(providerRanks,{label:SOURCE_MODES[state.sort].label,context:true,sample:tracking.namespace==='sample',unavailable:ratingsUnavailable});
  $('rank-filter').disabled=!hasSystemRank(state);
  $('sort').querySelector('[value=curated]').disabled=state.systems.length!==1;
  $('rank-explanation').textContent=state.sort==='score'?'Ranked by score · critics and players, weighted by how many reviews back each game':sourceMode()?'One source, ranked within this selection · game-level context':hasSystemRank(state)?(showingOriginal(bySystem.get(state.systems[0]))?'Original list order · facts checked, order as the original project had it':'Ranked by critic reviews of this version and player ratings'):state.sort==='relevance'?'Ordered by title relevance':'List positions, not a cross-system ranking';
  renderNavigation();
  const isSystems=state.view==='systems'||isCatalogLanding(state);
  let title=state.view==='collection'?'My Atlas':isSystems?(state.scope==='favorites'?'Favorites catalog':'Game Atlas'):state.systems.length===1?bySystem.get(state.systems[0]).name:state.family?byFamily.get(state.family).name:'Game Atlas';
  $('page-title').innerHTML=`${esc(title)}<span class="title-dot">.</span>`;
  document.title=`${title} — Level Select`;
  // Browsing a system, a family or a search: one click back to the carousel of systems.
  $('atlas-back').hidden=isSystems||state.view==='collection';
  $('page-eyebrow').textContent=state.view==='collection'?'Your games, your pace':isSystems?'Explore games by system':'Games across generations';
  $('page-description').textContent=state.view==='collection'?'Every Game Atlas game you’ve saved: favorites, wishlist, owned and play progress. Use Show to see just one of them.':isSystems?'Explore consoles and PC across generations. Choose a system, browse a family, or return to your pinned favorites.':state.systems.length===1?`${bySystem.get(state.systems[0]).fullName} · ${listCount(bySystem.get(state.systems[0]))} ${showingOriginal(bySystem.get(state.systems[0]))?'games on the original list':'games ranked by reviews'}`:'Browse this selection by one score source, title or release date. Unrated games stay unranked.';
  $('search').value=state.q;$('search').placeholder=state.view==='systems'?'Search systems and families…':'Search games, find a favorite…';
  document.querySelector('label[for="search"]').textContent=state.view==='systems'?'Search systems and families':'Search games and aliases';
  $('filter-toolbar').hidden=isSystems;$('view-switch').hidden=isSystems;$('rank-explanation').hidden=isSystems;$('collection-filters').hidden=state.view!=='collection';
  $('ownership-filter').value=state.ownership; $('ownership-filter').disabled=!connections.totalTitles;
  $('rank-filter').value=state.rank;$('list-filter').value=state.list;
  // One system without a review-backed list has only its original list.
  $('list-filter').disabled=state.systems.length===1&&!reviewed(bySystem.get(state.systems[0]));$('sort').value=state.sort==='curated'&&state.systems.length!==1?'score':state.sort;$('collection-filter').value=state.collection;
  for(const layout of ['list','grid','spotlight'])$(`${layout}-view`).setAttribute('aria-pressed',String(state.layout===layout));
  $('catalog-scope').value=state.scope;
  $('system-filter').innerHTML=`<span class="control-label">${esc(state.systems.length===1?bySystem.get(state.systems[0]).name:state.family?byFamily.get(state.family).name:'Families & systems')}</span><span class="control-chevron" aria-hidden="true">⌄</span>`;$('system-filter').setAttribute('aria-pressed',String(Boolean(state.systems.length||state.family)));
  $('genre-filter').innerHTML=`Genres${state.genres.length?` · ${state.genres.length}`:''} <span>⌄</span>`;$('genre-filter').setAttribute('aria-pressed',String(Boolean(state.genres.length)));
  $('more-filters').setAttribute('aria-pressed',String(Boolean(state.yearFrom||state.yearTo||state.era||state.kind)));
  if(!isSystems)renderCarousel([]);
  renderChips();if(isSystems){renderSystems();if(!state.family&&!state.q){const pc=pcDestinations();if(pc&& !$('results').querySelector('[data-system]'))$('results').innerHTML='';$('results').insertAdjacentHTML('beforeend',pc);if(state.scope==='favorites')$('result-count').innerHTML=`<strong>${$('results').querySelectorAll('.system-card').length}</strong> favorite destinations`;}}else renderGames();$('results').setAttribute('aria-busy','false');
}

function pcDestinations(scope=state.scope, query='') {
  const cards=[
    {id:'pc',badge:'PC',title:'PC library',kind:'Platform · Windows / DOS',description:'Your imported PC copies, across stores.',href:'./library/index.html?platform=pc',action:'Browse owned PC games ↗'},
    ...[['steam','Steam'],['gog','GOG'],['epic','Epic Games']].map(([id,title])=>({id,badge:title,title,kind:'Storefront · PC',description:`Filter your imported PC copies from ${title}.`,href:`./library/index.html?platform=pc&source=store:${id}`,action:`Browse ${title} copies ↗`}))
  ].filter(card=>(scope!=='favorites'||collection.pinnedSystems.includes(`destination:${card.id}`))&&normalize(`${card.title} ${card.kind}`).includes(query));
  if(!cards.length)return '';
  const snapshot=tracking.snapshot();
  return `<section class="pc-destinations"><header><span class="eyebrow">PC & storefronts</span><h2>One platform, different stores</h2><p>Games in your imported library · completed at least once on a matching copy. Games owned in multiple stores appear in each store, but only once in PC library.</p></header><div class="systems-grid pc-grid">${cards.map(card=>{const counts=platformSummary(snapshot,tracking.library,{platform:'pc',...(card.id!=='pc'?{source:`store:${card.id}`}:{})}),pinned=collection.pinnedSystems.includes(`destination:${card.id}`);return `<article class="system-card platform-card" data-destination="${card.id}" style="--family-color:#78bde1"><button class="pin-button" data-pin="destination:${card.id}" type="button" aria-label="${pinned?'Unpin':'Pin'} ${esc(card.title)}" aria-pressed="${pinned}">${pinned?'★':'☆'}</button><div class="system-card-badge">${esc(card.badge)}</div><div><h3>${esc(card.title)}</h3><p>${esc(card.kind)}</p></div><div class="destination-description"><p>${esc(card.description)}</p>${card.id==='pc'?'<button class="text-button muted pc-classic-link" type="button" data-browse-system="pc">PC list (2000 on) →</button><button class="text-button muted pc-classic-link" type="button" data-browse-system="dos">Classic PC list →</button>':''}</div><div class="destination-counts"><strong>${fmt(counts.total)} ${counts.total===1?'game':'games'}</strong><small>${fmt(counts.completed)} completed</small><div class="progress-track" role="progressbar" aria-label="${esc(card.title)} completion" aria-valuenow="${counts.completed}" aria-valuemin="0" aria-valuemax="${counts.total||1}"><span style="width:${counts.total?counts.completed/counts.total*100:0}%"></span></div></div><div class="system-actions"><a class="text-button" href="${card.href}">${esc(card.action)}</a></div></article>`;}).join('')}</div></section>`;
}

function openSystems(preset={}) {
  showDialog('Families & systems', `<div class="scope-picker"><label class="form-field">Family<select id="scope-family"><option value="">Choose a family</option>${catalog.families.map(f=>`<option value="${f.id}"${selected(preset.family??(state.family||bySystem.get(state.systems[0])?.family),f.id)}>${esc(f.name)}</option>`).join('')}<option value="pc"${selected(preset.family,'pc')}>PC & storefronts</option></select></label><label class="form-field">Catalog scope<select id="scope-range"><option value="all"${selected(preset.scope??state.scope,'all')}>All systems</option><option value="favorites"${selected(preset.scope??state.scope,'favorites')}>Favorites catalog</option></select></label></div><label class="form-field">Find a system<input id="scope-search" type="search" value="${esc(preset.query??'')}" placeholder="SNES, PlayStation, Game Boy…"></label><div id="scope-options"></div><p class="muted">Pin your favorite systems in Game Atlas. Legacy editorial rankings still need verification; favorites do not change game scores.</p>`, 'systems');
  function options() {
    const family=$('scope-family').value,scope=$('scope-range').value,q=normalize($('scope-search').value);
    if(family==='pc'){$('scope-options').innerHTML=pcDestinations(scope,q)||'<p>No PC favorites match. Pin a PC or storefront card in All systems.</p>';return;}
    const systems=catalogSystems(catalog,{family,scope,systems:[]},collection.pinnedSystems).filter(s=>normalize(`${s.name} ${s.fullName} ${s.abbreviation}`).includes(q));
    $('scope-options').innerHTML=`${family?`<button class="primary-button family-list-button" id="browse-family" type="button">Browse ${esc(byFamily.get(family).name)} games · ${scope==='favorites'?'favorite systems':'all systems'}</button>`:''}<div class="system-options">${systems.map(s=>`<button type="button" data-browse-system="${s.id}"><strong>${esc(s.name)}</strong><span>${listCount(s)} games · ${showingOriginal(s)?'original list':'ranked by reviews'}</span></button>`).join('')}</div>${!systems.length?'<p>No systems in this scope. Choose All systems and pin your favorites.</p>':''}${!family?pcDestinations(scope,q):''}`;
    $('browse-family')?.addEventListener('click',()=>{closeDialog();change({family,systems:[],scope,view:'games',sort:'score',q:'',rank:'all'});});
  }
  for(const id of ['scope-family','scope-range','scope-search'])$(id).addEventListener(id==='scope-search'?'input':'change',options);
  options();
}

function openChoices(kind) {
  const options=[...new Set(catalog.games.flatMap(g=>g.genres))].sort().map(g=>({value:g,label:g,detail:''}));
  const chosen=new Set(state[kind]);
  showDialog('Choose genres',`<p class="dialog-copy">Select any combination. Results can match any selected genre.</p><label class="sr-only" for="choice-search">Find ${kind}</label><input class="dialog-search" id="choice-search" type="search" placeholder="Find ${kind}…"><div class="choice-list" id="choice-list">${options.map(o=>`<label class="check-label" data-choice-label="${esc(normalize(o.label))}"><input type="checkbox" value="${esc(o.value)}"${checked(chosen.has(o.value))}><span>${esc(o.label)}${o.detail?` <small class="muted">${o.detail}</small>`:''}</span></label>`).join('')}</div><div class="dialog-actions"><button class="secondary-button" type="button" id="clear-choices">Clear selection</button><button class="primary-button" type="button" id="apply-choices">Apply filters</button></div>`,kind);
  $('choice-search').addEventListener('input',e=>{const q=normalize(e.target.value);$('choice-list').querySelectorAll('label').forEach(label=>{label.hidden=!label.dataset.choiceLabel.includes(q);});});
  $('choice-list').addEventListener('change',e=>{e.target.checked?chosen.add(e.target.value):chosen.delete(e.target.value);});
  $('clear-choices').addEventListener('click',()=>{chosen.clear();$('choice-list').querySelectorAll('input').forEach(i=>{i.checked=false;});});
  $('apply-choices').addEventListener('click',()=>{closeDialog();change({[kind]:[...chosen]});});
}
function openMoreFilters() {
  showDialog('Refine your search',`<form id="more-form"><div class="form-grid"><label class="form-field">Released from<input name="yearFrom" type="number" min="1900" max="2100" placeholder="Any year" value="${state.yearFrom}"></label><label class="form-field">Released through<input name="yearTo" type="number" min="1900" max="2100" placeholder="Any year" value="${state.yearTo}"></label><label class="form-field">Era<select name="era"><option value="">Every era</option><option value="before2000"${selected(state.era,'before2000')}>Before 2000</option><option value="2000s"${selected(state.era,'2000s')}>2000–2009</option><option value="2010plus"${selected(state.era,'2010plus')}>2010 onwards</option></select></label><label class="form-field">System type<select name="kind"><option value="">Every type</option>${['Console','Handheld','Hybrid','Computer','Arcade collection'].map(k=>`<option${selected(state.kind,k)}>${k}</option>`).join('')}</select></label></div><p class="error-message" id="year-error" role="alert" hidden></p><div class="dialog-actions"><button class="secondary-button" id="clear-more" type="button">Reset these filters</button><button class="primary-button" type="submit">Apply filters</button></div></form>`,'more');
  $('clear-more').addEventListener('click',()=>{$('more-form').querySelectorAll('input,select').forEach(el=>{el.value='';});});
  $('more-form').addEventListener('submit',e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));if(values.yearFrom&&values.yearTo&&+values.yearFrom>+values.yearTo){$('year-error').textContent='The start year must be earlier than the end year.';$('year-error').hidden=false;return;}closeDialog();change(values);});
}
// Owned can always be unticked: a wrong match, or a game you sold or lost. Unticking a
// library copy sets its match aside (Atlas only; your library keeps the copy); ticking
// again brings that match back, otherwise it records that you own it.
const libraryMatches = (game, status) => (connections.candidatesByRelease[game.id] ?? []).filter(item => item.sameSystem && item.status === status);
async function setOwned(game, owned) {
  const review = (item, decision) => tracking.run(() => tracking.reviewMatch({ catalogId: game.id, copyId: item.copyId, decision, expected: tracking.snapshot().matchReviews[item.id] ?? null }));
  if (owned) {
    const setAside = libraryMatches(game, 'rejected');
    for (const item of setAside) await review(item, 'accepted');
    if (!setAside.length) await tracking.run(() => tracking.flag(game.id, { owned: true }));
  } else {
    for (const item of libraryMatches(game, 'accepted')) await review(item, 'rejected');
    if (collection.entries[game.id]?.owned) await tracking.run(() => tracking.flag(game.id, { owned: false }));
  }
}
function ownedNote(game) {
  const owned = ownership(game), setAside = libraryMatches(game, 'rejected');
  if (owned?.copy) return `In your library (${esc(owned.copy.sources?.join(', ') || 'imported')}). Untick it if that’s the wrong game or you no longer have it.`;
  if (setAside.length) return `Not counted as owned, though your library has a copy (${esc([...new Set(setAside.flatMap(item => item.sources))].join(', ') || 'imported')}). Tick it to count that copy again.`;
  return '';
}
function openGame(id, push = true) {
  const game=byGame.get(id);if(!game)return;
  if(push){state.game=id;writeUrl();}
  const system=bySystem.get(game.systemId), entry=collection.entries[id]||{}, family=byFamily.get(system.family);
  // Its place on the system's list, with the podium medal or top-10 mark, as in Spotlight.
  const place=listRank(game,state), [placeTier]=place?tierOf(place):[];
  const placeLine=place?`<p class="spotlight-place detail-place" data-tier="${placeTier}"${placeTier==='podium'?` data-place="${place}"`:''}><span class="spotlight-coin">${place}</span>${showingOriginal(system)?'Original list':'Ranked by reviews'} · ${esc(system.name)}</p>`:'';
  showDialog(game.title,`<div class="detail-hero">${artwork(game,true)}<div>${placeLine}<div class="detail-rank">${sourceMode()?`${esc(ratingText(catalogRating(game)))} · work context`:esc(catalogScoreText(game))}</div><span class="system-tag" style="--family-color:${family.color}">${esc(family.name)}</span><p class="detail-meta">${game.year} · ${esc(system.kind)}</p><div class="detail-badges">${game.genres.map(g=>`<span>${esc(g)}</span>`).join('')}</div></div></div>${reviewsSectionHtml(game.reviews)}${otherScoresHtml(game)}${awardsSectionHtml(game.awards)}<div id="catalogOwnership">${ownedLink(game)}</div>${sourceMode()?rankingExplanationHtml(catalogRating(game),{filtered:true}):''}<div id="catalogProviderRatings"></div><div class="form-section"><h3>Track this game</h3><div class="detail-tracking">${[['favorite','Favorite'],['owned','Owned'],['wishlist','Wishlist']].map(([key,label])=>key==='owned'?`<label class="check-label"><input type="checkbox" data-owned${checked(ownership(game))}>${label}</label>`:`<label class="check-label"><input type="checkbox" data-track="${key}"${checked(entry[key])}>${label}</label>`).join('')}</div><p class="owned-note" id="ownedNote">${ownedNote(game)}</p><div id="sharedGameTracking"></div></div><div class="form-section dialog-copy"><p>${listPlace(game,system)}</p>${game.aliases.length?`<p><small>Also listed as: ${esc(game.aliases.join(' · '))}</small></p>`:''}${game.cover?`<p><a href="${esc(game.cover.sourceUrl)}" target="_blank" rel="noopener noreferrer">Cover source ↗</a></p>`:''}<div class="dialog-actions"><button class="secondary-button" id="copy-game-link" type="button">Copy game link</button><button class="primary-button" data-browse-system="${system.id}" type="button">Browse ${esc(system.name)}</button></div></div>`,'game');
  $('dialog-body').querySelectorAll('[data-track]').forEach(input=>input.addEventListener('change',async()=>{await tracking.run(()=>tracking.flag(id,{[input.dataset.track]:input.checked}));loadCollection();input.checked=Boolean(collection.entries[id]?.[input.dataset.track]);render();}));
  $('dialog-body').querySelector('[data-owned]').addEventListener('change',async event=>{
    const input=event.target;input.disabled=true;
    try{await setOwned(game,input.checked);}catch(error){toast(error.message);}
    loadCollection();render();input.checked=Boolean(ownership(game));input.disabled=false;
    $('ownedNote').innerHTML=ownedNote(game);$('catalogOwnership').innerHTML=ownedLink(game);
  });
  mountProviderRatings($('catalogProviderRatings'), { ref: { provider: 'catalog', id }, workspace: tracking.namespace });
  mountTracking($('sharedGameTracking'), tracking, [tracking.descriptor('catalog',id)]);
  const matches = document.createElement('section'); matches.id = 'catalogLibraryMatches';
  $('sharedGameTracking').before(matches);
  mountLibraryMatches(matches, tracking, { catalogId: id });
  $('copy-game-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);toast('Game link copied.');}catch{toast('Copy this game’s link from your address bar.');}});
}
// Where a game sits: on the review-backed list and on the original list, and what the
// fact check of the original list changed.
function listPlace(game, system) {
  const removed=game.correction?.removed?` Taken out of the original list: ${esc(game.correction.removed)}.`:'';
  const original=game.legacyRank?`#${game.legacyRank} on the original ${esc(system.name)} list.`:game.sourceRank?'':'Not on the original list.';
  if(!reviewed(system))return `${game.legacyRank?`#${game.legacyRank} on the original ${esc(system.name)} list (order as the original project had it).`:''}${removed}`;
  const current=game.rank?`#${game.rank} on the ${esc(system.name)} list, ranked by critic reviews of this version and player ratings.${game.reviews?.port?' A later port: only reviews of this version count.':''}`:`Not on the ${esc(system.name)} list ranked by reviews: too few reviews, or a score below the list's cut.`;
  return `${current} ${original}${removed}`.trim();
}
function systemInfo(id) {
  const s=bySystem.get(id),f=byFamily.get(s.family),facts=systemFacts[id]??{};
  const emulation={nes:['Mesen','https://www.mesen.ca/'],snes:['Mesen','https://www.mesen.ca/'],n64:['ares','https://ares-emu.net/'],gc:['Dolphin','https://dolphin-emu.org/'],wii:['Dolphin','https://dolphin-emu.org/'],gb:['SameBoy','https://sameboy.github.io/'],gbc:['SameBoy','https://sameboy.github.io/'],gba:['mGBA','https://mgba.io/'],ds:['melonDS','https://melonds.kuribo64.net/'],ps1:['DuckStation','https://www.duckstation.org/'],ps2:['PCSX2','https://pcsx2.net/'],psp:['PPSSPP','https://www.ppsspp.org/'],dos:['DOSBox Staging','https://www.dosbox-staging.org/'],mame:['MAME','https://www.mamedev.org/']};
  const resource=emulation[id];
  const wiki=facts.page?`https://en.wikipedia.org/wiki/${encodeURIComponent(facts.page.replace(/ /g,'_'))}`:null;
  const rows=[['Made by',facts.manufacturer?.join(', ')],['Released',facts.released],['Discontinued',facts.discontinued],['Units sold',facts.unitsSold&&`${sold(facts.unitsSold.amount)}${facts.unitsSold.asOf?` (as of ${facts.unitsSold.asOf})`:''}`],
    ['Processor',facts.cpu?.join(', ')],['Came after',facts.predecessor?.join(', ')],['Followed by',facts.successor?.join(', ')]].filter(([,value])=>value);
  const table=items=>`<dl class="system-facts">${items.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  const fromList=listFacts(s);
  showDialog(s.name,`<div class="system-sheet" style="--family-color:${f.color}">
    <div class="system-hero">${facts.image?`<figure class="system-photo"><img src="${esc(facts.image.url)}" alt="${esc(s.fullName)}" loading="lazy" decoding="async"><figcaption><a href="${esc(facts.image.page)}" target="_blank" rel="noopener noreferrer">Photo: Wikimedia Commons ↗</a></figcaption></figure>`:''}
      <div><p class="system-eyebrow">${esc(f.name)} · ${esc(s.kind)}</p><h3 class="system-name">${esc(s.fullName)}</h3>${facts.tagline?`<p class="system-tagline">${esc(facts.tagline)}</p>`:''}<p class="system-tagline">${listCount(s)} ${showingOriginal(s)?'games on the original list':'games ranked by critic reviews and player ratings'}</p></div></div>
    ${facts.overview?`<p class="system-overview">${esc(facts.overview)}</p>${wiki?`<a class="provider-credit" href="${esc(wiki)}" target="_blank" rel="noopener noreferrer">From Wikipedia ↗</a>`:''}`:''}
    ${rows.length?`<h4 class="system-section">The hardware</h4>${table(rows)}`:''}
    ${fromList.length?`<h4 class="system-section">From the list</h4>${table(fromList)}`:''}
    ${s.kind==='Arcade collection'&&!reviewed(s)?'<p class="data-note">A themed arcade collection: its list can include games from more than one arcade board.</p>':''}${id==='dos'?'<p class="data-note">This list includes both DOS and early Windows games. A PC listing does not imply DOS compatibility.</p>':''}
    ${resource?`<h4 class="system-section">Emulation</h4><p><a href="${resource[1]}" target="_blank" rel="noopener noreferrer">${resource[0]} official project ↗</a> · check its documentation for compatibility and setup.</p>`:''}
    ${rows.length?'<p class="data-note">Hardware facts from Wikidata; they can lag behind the latest figures.</p>':''}
    <div class="dialog-actions"><button class="primary-button" type="button" data-browse-system="${id}">Browse ${esc(s.name)} games</button></div></div>`,'system');
}
function about() {
  showDialog('About the catalog',`<div class="dialog-copy"><p><strong>${fmt(catalog.games.filter(g=>!g.unlisted).length)} games across ${catalog.systems.length} systems and collections.</strong> ${esc(catalog.provenance.label)}.</p><p><a href="./ranking/methodology.html">Current rating modes and methodology ↗</a></p><h3 class="form-section">How the lists are ranked</h3><p>${esc(catalog.provenance.ranking)}</p><p>${esc(catalog.provenance.verification)}</p>${catalog.systems.some(reviewed)?`<p>Games the old lists had but the new ones leave out are still in the catalog: search finds them, and anything you track or own stays visible.</p>`:''}<p>${catalog.provenance.reviewEntries} entries of the original lists were set aside during cleanup, including duplicates, unspecified alternate editions, placeholders, and identified platform errors.</p><h3 class="form-section">Sources & artwork</h3><p>Critic scores come from the “Video game reviews” boxes on English Wikipedia (text available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0 ↗</a>); each game links to its page. Player ratings and covers of newly listed games come from <a href="https://www.igdb.com/" target="_blank" rel="noopener noreferrer">IGDB ↗</a>. The original lists name community polls and review sites, but give no item-level citations.</p><p>Cover artwork via <a href="https://github.com/libretro-thumbnails/libretro-thumbnails#credits" target="_blank" rel="noopener noreferrer">libretro-thumbnails contributors ↗</a>. Original artwork belongs to the respective developers and publishers. Regional artwork may differ. Games without an exact cover match use a title label.</p><h3 class="form-section">Your collection</h3><p>Favorites, ownership, wishlist, play status, and pinned systems are stored only in this browser. Use Backup & import to keep a copy or move to another device. Clearing browser data removes local tracking.</p><p><a href="https://github.com/patryk-hd/level-select" target="_blank" rel="noopener noreferrer">Level Select on GitHub ↗</a></p></div>`,'about');
}
function backup() { openTrackingBackup(tracking); }

function bindEvents() {
  $('ownership-filter').addEventListener('change', e => change({ownership:e.target.value}));
  $('search').addEventListener('input',e=>{clearTimeout(searchTimer);const q=e.target.value;searchTimer=setTimeout(()=>change({q},{replace:true}),120);});
  $('rank-filter').addEventListener('change',e=>change({rank:e.target.value}));$('list-filter').addEventListener('change',e=>change({list:e.target.value}));$('sort').addEventListener('change',e=>{explicitSort=e.target.value!=='relevance';change({sort:e.target.value});});$('collection-filter').addEventListener('change',e=>change({collection:e.target.value}));
  $('system-filter').addEventListener('click',openSystems);
  $('catalog-scope').addEventListener('change',e=>change({scope:e.target.value,systems:[],family:'',view:'games',sort:'score',q:'',genres:[],yearFrom:'',yearTo:'',kind:'',era:'',ownership:'all'}));$('genre-filter').addEventListener('click',()=>openChoices('genres'));$('more-filters').addEventListener('click',openMoreFilters);
  for(const layout of ['list','grid','spotlight'])$(`${layout}-view`).addEventListener('click',()=>{change({layout},{keepPage:true});saveLayout();});
  $('backup-button').addEventListener('click',backup);$('about-button').addEventListener('click',about);$('footer-about').addEventListener('click',about);
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)&&!dialog.open){e.preventDefault();$('search').focus();}});
  document.addEventListener('click',async e=>{
    const b=e.target.closest('button, a[data-view]');if(!b)return;
    if(b.matches('a') && (e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0))return;
    if(b.dataset.view){e.preventDefault();if(dialog.open)closeDialog();setNavigation(false);change({...freshState(),view:b.dataset.view,layout:state.layout,list:state.list});}
    else if(b.hasAttribute('data-favorites-catalog'))change({...freshState(),scope:'favorites',layout:state.layout});
    else if(b.dataset.family){setNavigation(false);change({family:state.family===b.dataset.family?'':b.dataset.family,systems:[],view:state.view==='collection'?'games':state.view,game:''});}
    else if(b.dataset.browseSystem){if(dialog.open)closeDialog();setNavigation(false);change({...freshState(),view:'games',systems:[b.dataset.browseSystem],scope:'all',layout:state.layout,list:state.list,sort:'curated'});}
    else if(b.dataset.game)openGame(b.dataset.game);
    else if(b.dataset.favorite){const id=b.dataset.favorite;await tracking.run(()=>tracking.flag(id,{favorite:!collection.entries[id]?.favorite}));loadCollection();render();document.querySelector(`[data-favorite="${id}"]`)?.focus({preventScroll:true});}
    else if(b.dataset.pin){const id=b.dataset.pin;await tracking.run(()=>tracking.pin(id));loadCollection();render();if(dialog.open&&dialogKind==='systems')openSystems({family:$('scope-family').value,scope:$('scope-range').value,query:$('scope-search').value});document.querySelector(`[data-pin="${id}"]`)?.focus({preventScroll:true});}
    else if(b.dataset.systemInfo)systemInfo(b.dataset.systemInfo);
    else if(b.dataset.page){change({page:+b.dataset.page},{keepPage:true});$('main').scrollIntoView({behavior:'instant'});$('main').focus({preventScroll:true});}
    else if(b.hasAttribute('data-reset'))resetFilters();
    else if(b.dataset.clear){const k=b.dataset.clear;change(k==='years'?{yearFrom:'',yearTo:''}:Array.isArray(state[k])?{[k]:state[k].filter(v=>v!==b.dataset.value)}:{[k]:['rank','ownership'].includes(k)?'all':k==='scope'?'all':''});}
  });
  document.addEventListener('error',e=>{if(e.target.matches?.('img[data-art]')){failedArt.add(e.target.getAttribute('src'));e.target.remove();}},true);
  window.addEventListener('popstate',()=>{explicitSort=hasExplicitSort();clearTimeout(searchTimer);state=parseState(location.search,catalog,readPreferences().layout);render();if(state.game)openGame(state.game,false);else if(dialog.open)dialog.close();});

}

async function init() {
  bindHovercards();
  const facts=fetch(new URL('./data/system-facts.json',import.meta.url)).then(response=>response.ok?response.json():{}).catch(()=>({}));
  // Everything downloads at once: the catalog (shared with tracking), your snapshots and the
  // ratings of the workspace this page will open (the tracking client confirms it below).
  const client=trackingClient();client.catch(()=>{});loadRatings(new URLSearchParams(location.search).get('workspace')==='sample'?'sample':'personal').catch(()=>{});
  catalog=await loadCatalog();
  systemFacts=(await facts).systems??{};
  bySystem=new Map(catalog.systems.map(s=>[s.id,s]));byFamily=new Map(catalog.families.map(f=>[f.id,f]));byGame=new Map(catalog.games.map(g=>[g.id,g]));
  tracking = await client; setupTracking(tracking);
  if (tracking.shared) { const saved = document.querySelector('.atlas-local'); if (saved) saved.lastChild.textContent = 'Saved by Level Select on your computer'; }
  connections = tracking.connections();
  if (tracking.namespace === 'sample') {
    const note = document.createElement('p'), home = demoHome(); note.className = 'sample-notice';
    if (home) note.innerHTML = `Live demo: games marked Owned belong to a made-up library. <a href="${esc(home)}">Get Level Select</a>, free, to bring in your own.`;
    else note.textContent = 'Sample workspace. Library matches are reviewable examples; import Playnite data to connect your own games.';
    $('main').prepend(note);
  }
  ratings=sourceIndex(await loadRatings(tracking.namespace).catch(()=>{ratingsUnavailable=true;return emptyRatings(tracking.namespace);}));
  state=parseState(location.search,catalog,readPreferences().layout);if(!connections.totalTitles)state.ownership='all';loadCollection();
  bindEvents();render();pageReady();if(state.game)openGame(state.game,false);
  tracking.subscribe(change=>{loadCollection();render();const ownership=document.getElementById('catalogOwnership');if(ownership&&state.game)ownership.innerHTML=ownedLink(byGame.get(state.game));if(dialogKind==='game'&&state.game&&change.type==='refresh')openGame(state.game,false);});
}
await init().catch(error=>{pageReady();$('results').setAttribute('aria-busy','false');$('result-count').textContent='Library unavailable';$('results').innerHTML=`<div class="empty-state"><h2>Couldn’t open the library.</h2><p>${esc(error.message)} Check your connection and try again.</p><button class="primary-button" id="reload-library" type="button">Try again</button></div>`;$('reload-library').addEventListener('click',()=>location.reload());});

// Mods: the best mods and ROM hacks of all time (data/mods.json, built by scripts/mods-lists.mjs),
// one tab per system, plus each popular game's essential mods. Games in your library are
// marked, and "Games I own" keeps only mods for them.
import { escapeHtml as esc, rankTier, demoHome } from '../lib.js';
import { titleKey, baseTitle } from './core.js';
import { pageReady } from '../navigation.js';

const $ = id => document.getElementById(id);
const PAGE = 40;
const n = value => Number(value ?? 0).toLocaleString();
const compact = value => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value ?? 0);
const params = new URLSearchParams(location.search);
const state = { tab: params.get('tab') || 'all', kind: params.get('kind') || '', q: params.get('q') || '', owned: params.get('owned') === '1', sort: params.get('sort') || 'rank', game: params.get('game') || '', shown: PAGE };
let data = null;

// ---------- your library ----------
// The sample library isn't yours, except on the public demo, where it shows what this looks like.
const library = window.PLAYNITE_SAMPLE && !demoHome() ? [] : window.PLAYNITE_LIBRARY ?? [];
const key = value => titleKey(baseTitle(value ?? ''));
const ownedTitles = new Set(), ownedIgdb = new Set();
for (const group of library) for (const copy of [group, ...(group.copies ?? [])]) {
  if (copy.name) ownedTitles.add(key(copy.name));
  if (copy.igdb?.id) ownedIgdb.add(Number(copy.igdb.id));
}
const ownsGame = (title, igdbId = null) => Boolean(title && ownedTitles.has(key(title))) || Boolean(igdbId && ownedIgdb.has(Number(igdbId)));
const ownsBase = mod => ownsGame(mod.game, mod.gameIgdbId);

// ---------- address ----------
function save() {
  const next = new URLSearchParams();
  if (state.tab !== 'all') next.set('tab', state.tab);
  if (state.kind) next.set('kind', state.kind);
  if (state.q) next.set('q', state.q);
  if (state.owned) next.set('owned', '1');
  if (state.sort !== 'rank') next.set('sort', state.sort);
  if (state.tab === 'essentials' && state.game) next.set('game', state.game);
  history.replaceState(null, '', `${location.pathname}${next.size ? `?${next}` : ''}`);
}

// ---------- which mods ----------
const SORTS = { rank: 'Most agreed on', newest: 'Newest', oldest: 'Oldest', rating: 'IGDB rating', name: 'A–Z' };
function visible() {
  const words = titleKey(state.q).split(' ').filter(Boolean);
  const mods = data.mods.filter(mod => (state.tab === 'all' || mod.system === state.tab) && (!state.kind || mod.kinds.includes(state.kind)) && (!state.owned || ownsBase(mod))
    && (!words.length || words.every(word => titleKey(`${mod.name} ${mod.game ?? ''}`).includes(word))));
  const by = {
    rank: (a, b) => a.rank - b.rank,
    newest: (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.rank - b.rank,
    oldest: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.rank - b.rank,
    rating: (a, b) => (b.igdb?.rating ?? -1) - (a.igdb?.rating ?? -1) || a.rank - b.rank,
    name: (a, b) => a.name.localeCompare(b.name),
  }[state.sort] ?? ((a, b) => a.rank - b.rank);
  return mods.sort(by);
}

// ---------- drawing ----------
const sources = () => new Map(data.sources.map(source => [source.id, source]));
function pickLabel(source, value) {
  if (!value) return source.short;
  if (source.kind === 'award') return `${source.short} ${value}`;
  return /^\d+$/.test(value) ? `${source.short} #${value}` : `${source.short}: ${value}`;
}
// tier: the rank's tier when the list is in ranked order, so the top 3 get medals and the
// top 5 and 10 their marks, as in the Game Atlas.
function card(mod, position, tier = null) {
  const byId = sources(), owned = ownsBase(mod), system = data.systems.find(entry => entry.id === mod.system);
  const picks = Object.entries(mod.picks).map(([id, value]) => { const source = byId.get(id); return `<li${source.supporting ? ' class="is-supporting"' : ''}><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(pickLabel(source, value))}</a></li>`; }).join('');
  const signals = [mod.igdb?.rating ? `IGDB ${mod.igdb.rating} <small>(${n(mod.igdb.ratingCount)} ${mod.igdb.ratingCount === 1 ? 'rating' : 'ratings'})</small>` : '', mod.notability ? `On ${n(mod.notability)} Wikipedia${mod.notability === 1 ? '' : 's'}` : ''].filter(Boolean);
  const links = [...(mod.igdb ? [{ label: 'IGDB', url: mod.igdb.url }] : []), ...mod.links];
  const tierAttrs = tier ? ` data-tier="${tier}"${tier === 'podium' ? ` data-place="${position}"` : ''}` : '';
  return `<article class="mod-card${owned ? ' is-owned' : ''}"${tierAttrs}>
    <span class="mod-rank" aria-label="Number ${position}">${position}</span>
    <div class="mod-art">${mod.cover ? `<img src="${esc(mod.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span>${esc(system?.short ?? '')}</span>`}</div>
    <div class="mod-body">
      <h3>${esc(mod.name)}</h3>
      <p class="mod-base">${mod.game ? `for <strong>${esc(mod.game)}</strong>` : ''}${owned ? ' <span class="mod-owned">✓ In your library</span>' : ''}</p>
      <p class="mod-meta">${esc([mod.year, system?.short].filter(Boolean).join(' · '))}${mod.kinds.map(kind => ` <span class="mod-kind">${esc(data.kinds[kind] ?? kind)}</span>`).join('')}</p>
      ${mod.became ? `<p class="mod-became">Became <strong>${esc(mod.became)}</strong></p>` : ''}
      <ul class="mod-picks" aria-label="Picked by">${picks}</ul>
      ${signals.length ? `<p class="mod-signals">${signals.join(' · ')}</p>` : ''}
      ${mod.summary ? `<details class="mod-about"><summary>About</summary><p>${esc(mod.summary)}</p><p class="mod-credit">Description from IGDB.</p></details>` : ''}
      ${links.length ? `<p class="mod-links">${links.map(link => `<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.label)} ↗</a>`).join('')}</p>` : ''}
    </div>
  </article>`;
}

function renderTabs() {
  const count = id => id === 'all' ? data.mods.length : data.mods.filter(mod => mod.system === id).length;
  const tabs = [{ id: 'all', short: 'All' }, ...data.systems, { id: 'essentials', short: 'Essentials' }];
  $('modsTabs').innerHTML = tabs.map(tab => `<a href="?tab=${esc(tab.id)}" data-tab="${esc(tab.id)}"${state.tab === tab.id ? ' aria-current="page"' : ''}>${esc(tab.short)}${tab.id === 'essentials' ? '' : ` <small>${count(tab.id)}</small>`}</a>`).join('');
}
// ← and → (Home and End too) step through the systems from the keyboard.
$('modsTabs').addEventListener('keydown', event => {
  const links = [...$('modsTabs').querySelectorAll('[data-tab]')], index = links.indexOf(event.target.closest('[data-tab]'));
  const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: links.length - 1 }[event.key];
  if (index < 0 || next == null) return;
  event.preventDefault();
  state.tab = links[(next + links.length) % links.length].dataset.tab; state.shown = PAGE; render();
  $('modsTabs').querySelector('[aria-current="page"]')?.focus();
});
function renderTools() {
  if (state.tab === 'essentials') { $('modsTools').innerHTML = ''; return; }
  const kinds = Object.keys(data.kinds).filter(kind => data.mods.some(mod => (state.tab === 'all' || mod.system === state.tab) && mod.kinds.includes(kind)));
  if (state.kind && !kinds.includes(state.kind)) state.kind = '';
  $('modsTools').innerHTML = `<label class="field field-search mods-search"><span>Search mods</span><input type="search" id="modsSearch" placeholder="Search mods or games…" autocomplete="off" value="${esc(state.q)}"></label>
    <div class="mods-kinds" role="group" aria-label="Kind">${['', ...kinds].map(kind => `<button type="button" data-kind="${esc(kind)}" aria-pressed="${state.kind === kind}">${esc(kind ? data.kinds[kind] : 'Everything')}</button>`).join('')}</div>
    <div class="mods-options">${library.length ? `<label class="mods-owned"><input type="checkbox" id="modsOwned"${state.owned ? ' checked' : ''}> Games I own</label>` : ''}
      <label class="field mods-sort"><span>Sort</span><select id="modsSort">${Object.entries(SORTS).map(([value, label]) => `<option value="${value}"${state.sort === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div>`;
}
function renderList() {
  if (state.tab === 'essentials') return renderEssentials();
  const mods = visible(), system = data.systems.find(entry => entry.id === state.tab);
  $('modsCount').textContent = `${n(mods.length)} ${mods.length === 1 ? 'mod' : 'mods'}${system ? ` for ${system.name}` : ''}${state.owned ? ' for games you own' : ''}.`;
  // Every mod keeps its place on this tab's list, whatever the filters, so "Games I own" still
  // shows where each one ranks. In ranked order the list reads in tiers, as the Game Atlas does.
  const rankOf = mod => state.tab === 'all' ? mod.rank : mod.systemRank, tiered = state.sort === 'rank';
  const more = mods.length > state.shown ? `<button type="button" class="mods-more" data-more>Show ${n(Math.min(PAGE, mods.length - state.shown))} more</button>` : '';
  const shown = mods.slice(0, state.shown);
  if (!mods.length) {
    $('modsList').className = 'mods-list';
    $('modsList').innerHTML = `<p class="mods-empty">${state.owned ? 'None of these mods are for games in your library yet.' : 'No mods match. Try fewer words or another kind.'}</p>`;
    return;
  }
  if (!tiered) { $('modsList').className = 'mods-list'; $('modsList').innerHTML = shown.map(mod => card(mod, rankOf(mod))).join('') + more; return; }
  const groups = [];
  for (const mod of shown) {
    const [key, label] = rankTier(rankOf(mod));
    if (groups.at(-1)?.key !== key) groups.push({ key, label, mods: [] });
    groups.at(-1).mods.push(mod);
  }
  $('modsList').className = 'mods-tiers';
  $('modsList').innerHTML = groups.map(group => {
    const low = rankOf(group.mods[0]), high = rankOf(group.mods.at(-1));
    return `<section class="rank-tier tier-${group.key}" aria-label="${esc(group.label)}"><h2 class="tier-head"><span class="tier-name">${esc(group.label)}</span><span class="tier-range">#${low}${high > low ? `–${high}` : ''}</span></h2>
      <div class="mods-list">${group.mods.map(mod => card(mod, rankOf(mod), group.key)).join('')}</div></section>`;
  }).join('') + more;
}
function renderEssentials() {
  const games = data.essentials?.games ?? [];
  if (!games.length) { $('modsList').innerHTML = '<p class="mods-empty">The essentials list isn’t built yet.</p>'; $('modsCount').textContent = ''; return; }
  const ordered = [...games].sort((a, b) => Number(ownsGame(b.libraryName) || ownsGame(b.name)) - Number(ownsGame(a.libraryName) || ownsGame(a.name)));
  const game = games.find(entry => entry.id === state.game) ?? ordered[0];
  state.game = game.id;
  const owned = entry => ownsGame(entry.libraryName) || ownsGame(entry.name);
  const unit = game.source === 'modrinth' ? 'followers' : 'endorsements', where = game.source === 'modrinth' ? 'Modrinth' : 'Nexus Mods';
  $('modsCount').textContent = `The most ${game.source === 'modrinth' ? 'followed' : 'endorsed'} mods for each of ${games.length} popular games${library.length ? '; games you own come first' : ''}.`;
  $('modsList').className = 'mods-essentials';
  $('modsList').innerHTML = `<div class="mods-games" role="group" aria-label="Game">${ordered.map(entry => `<button type="button" data-game="${esc(entry.id)}" aria-pressed="${entry.id === game.id}">${owned(entry) ? '<span aria-label="In your library">✓</span> ' : ''}${esc(entry.name)}</button>`).join('')}</div>
    <section class="mods-essential" aria-labelledby="essentialTitle"><header><h2 id="essentialTitle">Essential mods for ${esc(game.name)}</h2>
      <p>Most ${unit} on <a href="${esc(game.url)}" target="_blank" rel="noopener noreferrer">${where} ↗</a>: what its players install first.</p></header>
      <ol>${game.mods.map(mod => `<li><a href="${esc(mod.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(mod.name)}</strong></a>
        <span class="mods-essential-meta">${esc([mod.category, mod.year].filter(Boolean).join(' · '))}</span>
        <span class="mods-essential-votes"><strong>${compact(mod.votes)}</strong> ${unit} · ${compact(mod.downloads)} downloads</span></li>`).join('')}</ol></section>`;
}
function renderMethod() {
  const date = value => value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
  $('modsMethodBody').innerHTML = `<p>${esc(data.method)} Every pick links to its source. Sources checked ${esc(date(data.checked))}.</p>
    <ul class="mods-sources">${data.sources.map(source => `<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(source.by)}: ${esc(source.name)}</strong> ↗</a> <span>${esc(source.about)} ${n(source.count)} ${source.count === 1 ? 'pick' : 'picks'}${source.supporting ? '; counts half' : ''}.</span></li>`).join('')}</ul>
    <p><strong>Essentials:</strong> the most endorsed mods on Nexus Mods for its most downloaded games, and Minecraft's most followed mods on Modrinth (adult mods left out), updated ${esc(date(data.essentials?.fetchedAt))}.</p>
    <p>Covers, years, base games and descriptions come from IGDB. Links go to each mod's own pages; ROM hacks are patches you apply to a game you own.</p>`;
}
function render() {
  renderTabs(); renderTools(); renderList(); save();
  $('modsSummary').textContent = `${n(data.mods.length)} mods and ROM hacks, picked by ${data.sources.length} respected sources.`;
}

// ---------- interaction ----------
document.addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]');
  if (tab) { event.preventDefault(); state.tab = tab.dataset.tab; state.shown = PAGE; render(); return; }
  const kind = event.target.closest('[data-kind]');
  if (kind) { state.kind = kind.dataset.kind; state.shown = PAGE; render(); return; }
  const game = event.target.closest('[data-game]');
  if (game) { state.game = game.dataset.game; renderList(); save(); document.getElementById('essentialTitle')?.focus?.(); return; }
  if (event.target.closest('[data-more]')) { state.shown += PAGE; renderList(); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'modsSearch') { state.q = event.target.value; state.shown = PAGE; renderList(); save(); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'modsOwned') { state.owned = event.target.checked; state.shown = PAGE; renderList(); save(); }
  if (event.target.id === 'modsSort') { state.sort = event.target.value; renderList(); save(); }
});

try {
  const response = await fetch(new URL('../data/mods.json', import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  data = await response.json();
  if (state.tab !== 'all' && state.tab !== 'essentials' && !data.systems.some(system => system.id === state.tab)) state.tab = 'all';
  render(); renderMethod();
} catch {
  $('modsList').innerHTML = '<p class="mods-empty">The mods list couldn’t load. Reload the page to try again.</p>';
}
pageReady();

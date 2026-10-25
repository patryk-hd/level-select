import { escapeHtml as esc } from '../lib.js';
import { selectSuggestions, suggestionFacets, suggestionFilters, writeSuggestionFilters, roulettePool, drawSuggestion, rememberOffer, recentTaste, MOODS, LENGTHS, TASTES } from '../tracking/suggestions.js';
import { vgcLineHtml, awardSealHtml, ratingHoverHtml } from './score-ui.js';
import { hoverAttr } from './hovercard.js';

export function setupSuggestions({ client, openChoice, onRouteChange }) {
  const $ = id => document.getElementById(id), storageKey = `retro-library.roulette.v1:${client.namespace}`;
  let recent = [], choices = [], selected = [], drawn = null, sessionOnly = false, taste = null;
  try {
    const raw = sessionStorage.getItem(storageKey);
    const value = raw && raw.length < 100000 ? JSON.parse(raw) : [];
    if (Array.isArray(value) && value.length <= 10 && value.every(keys => Array.isArray(keys) && keys.length <= 100 && keys.every(key => typeof key === 'string' && key.length <= 2000))) recent = value;
  } catch { sessionOnly = true; }
  // "Not tonight" hides a pick until tomorrow; nothing in your plan changes.
  const tonightKey = () => `retro-library.not-tonight.v1:${client.namespace}:${new Date().toDateString()}`;
  const readTonight = () => { try { const value = JSON.parse(localStorage.getItem(tonightKey()) ?? '[]'); return new Set(Array.isArray(value) ? value.slice(-200) : []); } catch { return new Set(); } };
  const dismissTonight = id => { const ids = readTonight(); ids.add(id); try { localStorage.setItem(tonightKey(), JSON.stringify([...ids])); } catch {} };
  const systemNames = new Map(client.catalog.systems.map(system => [system.id, system.name ?? system.id]));
  // Owned Windows copies share the catalog's classic-PC key; in your library they are simply PC.
  systemNames.set('dos', 'PC');
  function saveRecent() {
    try { sessionStorage.setItem(storageKey, JSON.stringify(recent)); }
    catch { sessionOnly = true; }
  }
  function selectOptions(id, values, current, placeholder) {
    const options = [{ id: '', label: placeholder }, ...values];
    if (current && !options.some(item => item.id === current)) options.push({ id: current, label: `${current} (not in this import)` });
    $(id).innerHTML = options.map(item => `<option value="${esc(item.id)}"${item.id === current ? ' selected' : ''}>${esc(item.label)}</option>`).join('');
  }
  function card(choice, kind, index = 0) {
    const option = choice.option, label = option.platforms.map(id => systemNames.get(id) ?? id).join(' · ') || (option.sources.length ? 'PC' : 'Unknown platform');
    // The score already sits in the badge; the remaining reasons explain the pick.
    const reasons = choice.reasons.filter(reason => !reason.startsWith('Score ') && reason !== option.ownershipReason);
    const cover = option.cover ? `<img src="${esc(option.cover)}" alt="" loading="lazy">` : `<span>${esc(choice.title.slice(0, 2).toUpperCase())}</span>`;
    const ribbon = awardSealHtml(option.awards);
    return `<article class="suggestion-card" data-choice="${esc(choice.id)}"><div class="suggestion-cover">${cover}${ribbon}${option.rating ? `<strong class="suggestion-score"${hoverAttr(ratingHoverHtml(option.rating, { steam: null, vgc: option.vgc }))}>${option.rating.value}</strong>` : ''}</div><div class="suggestion-main"><p class="eyebrow">${kind === 'draw' ? 'Roulette pick' : `Pick ${index + 1}`}</p><h3>${esc(choice.title)}</h3><p class="suggestion-copy">${esc(label)}${option.sources.length ? ` · ${esc(option.sources.join(', '))}` : ''}</p>${vgcLineHtml(option.vgc)}<ul>${reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul><div class="suggestion-actions"><button type="button" data-suggest-open="${esc(choice.id)}">Play this</button>${kind === 'draw' ? '' : `<button type="button" class="is-quiet" data-not-tonight="${esc(choice.id)}">Not tonight</button>`}</div>${choice.options.length > 1 ? `<p class="suggestion-copy">${choice.options.length} copies — you'll pick one</p>` : ''}</div></article>`;
  }
  // The most common genres among the games that fit the other filters, plus the chosen one.
  // ("Indie" says who made a game, not how it plays; the Genre filter still has it.)
  const GENRE_CHIPS = 8, NOT_A_GENRE = new Set(['Indie', 'Other']);
  function renderTonight(filters) {
    const chips = (key, entries) => [['', { label: 'Any' }], ...Object.entries(entries)].map(([value, item]) =>
      `<button type="button" data-tonight-key="${key}" data-tonight-value="${esc(value)}" aria-pressed="${filters[key] === value}"${item.title ? ` title="${esc(item.title)}"` : ''}>${esc(item.label)}${item.hint ? ` <small>${esc(item.hint)}</small>` : ''}</button>`).join('');
    document.querySelector('[data-tonight="mood"]').innerHTML = chips('mood', MOODS);
    document.querySelector('[data-tonight="length"]').innerHTML = chips('length', LENGTHS);
    const counts = new Map();
    for (const choice of selectSuggestions(choices, { ...filters, genre: '' }, { taste })) for (const genre of new Set(choice.options.flatMap(option => option.genres))) if (!NOT_A_GENRE.has(genre)) counts.set(genre, (counts.get(genre) ?? 0) + 1);
    const genres = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, GENRE_CHIPS);
    if (filters.genre && !genres.some(([genre]) => genre === filters.genre)) genres.push([filters.genre, counts.get(filters.genre) ?? 0]);
    document.querySelector('[data-tonight="genre"]').innerHTML = chips('genre', Object.fromEntries(genres.map(([genre, count]) => [genre, { label: genre, hint: String(count) }])));
    // After your recent games: more of their genres, or something else.
    const group = document.querySelector('[data-tonight="taste"]');
    if (!taste.games.length) { group.innerHTML = '<p class="tonight-note">Start or finish a game and this offers more of the same, or a change of pace.</p>'; return; }
    const hints = { more: taste.top.join(', '), fresh: `not ${taste.top.join(', ')}` };
    group.innerHTML = `${chips('taste', Object.fromEntries(Object.entries(TASTES).map(([key, item]) => [key, { ...item, hint: hints[key], title: `Going by ${taste.games.map(game => game.title).join(', ')}` }])))}<p class="tonight-note">Going by ${esc(taste.games.slice(0, 3).map(game => game.title).join(', '))}${taste.games.length > 3 ? ` and ${taste.games.length - 3} more` : ''}.</p>`;
  }
  function renderDraw() {
    const exclude = $('rouletteRecent').checked, pool = roulettePool(selected, recent, exclude);
    if (drawn) drawn = selected.find(choice => choice.keys.some(key => drawn.keys.includes(key))) ?? null;
    $('rouletteResult').innerHTML = drawn ? card(drawn, 'draw') : '';
    $('rouletteRoll').textContent = drawn ? 'Reroll' : 'Pick a game';
    $('rouletteRoll').disabled = !pool.length;
    $('rouletteClear').disabled = !recent.length;
    $('rouletteStatus').textContent = !selected.length ? 'No eligible choices. Adjust the filters or select more games for your plan.' : !pool.length ? 'Every eligible choice is among the last 10 draws. Clear recent draws or turn off the exclusion to continue.' : `${pool.length} eligible ${pool.length === 1 ? 'choice' : 'choices'} in the draw. Each has the same chance; drawing changes no tracking.`;
    $('rouletteMemory').textContent = sessionOnly ? 'Recent draws are kept on this page only because tab storage is unavailable.' : 'The last 10 draws are remembered in this tab, separately for each workspace.';
  }
  function render() {
    const filters = suggestionFilters(new URLSearchParams(location.search));
    const state = client.snapshot();
    choices = client.suggestionChoices();
    taste = recentTaste({ state, catalog: client.catalog, choices });
    const facets = suggestionFacets(choices, client.catalog);
    selectOptions('suggestSystem', facets.systems, filters.system, 'All systems');
    selectOptions('suggestSource', facets.sources.map(id => ({ id, label: id })), filters.source, 'Any store / source');
    selectOptions('suggestGenre', facets.genres.map(id => ({ id, label: id })), filters.genre, 'Any genre');
    $('suggestIntent').value = filters.intent; $('suggestOwnership').value = filters.ownership;
    $('suggestFavorites').checked = filters.favorites; $('suggestHidden').checked = filters.hidden;
    renderTonight(filters);
    selected = selectSuggestions(choices, filters, { taste });
    $('suggestionCount').textContent = selected.length ? `Top 3 of ${selected.length.toLocaleString()} games that fit` : '';
    $('suggestionOrder').textContent = `Up Next comes first, then games you're playing, then your backlog priorities and favorites. ${filters.system ? `On ${systemNames.get(filters.system) ?? filters.system}, curated list positions come next. ` : ''}After that, the best-rated games rise to the top.${filters.mood ? ' Moods are a guess from each game\'s genres.' : ''}${filters.taste && taste.games.length ? ` ${filters.taste === 'more' ? 'More like' : 'Something other than'} your recent games, by genre.` : ''}${filters.length ? ' Games without a known length are left out while a length is chosen.' : ''}`;
    // Games in progress already sit in Continue above; Tonight offers something else
    // unless you asked for "Continue playing".
    const skipped = readTonight(), tonight = selected.filter(choice => !skipped.has(choice.id) && (filters.intent === 'continue' || !['playing', 'paused'].includes(choice.status)));
    $('suggestionCards').innerHTML = tonight.length ? tonight.slice(0, 3).map((choice, index) => card(choice, 'suggestion', index)).join('') : '<p class="suggestion-empty">No games match. Try another system or source, include manually planned games, or add an owned game. Unknown metadata never counts as a filter match.</p>';
    renderDraw();
  }
  $('suggestionFilters').onchange = () => {
    const query = new URLSearchParams(location.search);
    writeSuggestionFilters(query, { system: $('suggestSystem').value, source: $('suggestSource').value, genre: $('suggestGenre').value,
      intent: $('suggestIntent').value, ownership: $('suggestOwnership').value, favorites: $('suggestFavorites').checked, hidden: $('suggestHidden').checked });
    history.pushState({}, '', `${location.pathname}?${query}`); drawn = null; onRouteChange();
  };
  $('tonightChips').onclick = event => {
    const button = event.target.closest('[data-tonight-key]'); if (!button) return;
    const query = new URLSearchParams(location.search);
    writeSuggestionFilters(query, { ...suggestionFilters(query), [button.dataset.tonightKey]: button.dataset.tonightValue });
    history.pushState({}, '', `${location.pathname}?${query}`); drawn = null; onRouteChange();
  };
  $('suggestionReset').onclick = () => {
    const query = new URLSearchParams(location.search);
    for (const key of [...query.keys()]) if (key.startsWith('suggest')) query.delete(key);
    history.pushState({}, '', `${location.pathname}?${query}`); drawn = null; onRouteChange();
  };
  $('rouletteRoll').onclick = () => {
    // Re-evaluate eligibility against the current store before every draw.
    render();
    drawn = drawSuggestion(selected, { recent, excludeRecent: $('rouletteRecent').checked,
      random: () => crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000 });
    if (drawn) { recent = rememberOffer(recent, drawn); saveRecent(); }
    renderDraw();
  };
  $('rouletteClear').onclick = () => { recent = []; saveRecent(); renderDraw(); };
  $('rouletteRecent').onchange = renderDraw;
  $('playSuggestions').onclick = event => {
    const skip = event.target.closest('[data-not-tonight]');
    if (skip) { dismissTonight(skip.dataset.notTonight); render(); return; }
    const button = event.target.closest('[data-suggest-open]'); if (!button) return;
    render();
    const choice = selected.find(choice => choice.id === button.dataset.suggestOpen);
    if (choice) openChoice(choice);
  };
  return { render };
}

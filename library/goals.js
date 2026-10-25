// List goals on the Play page's Challenges tab: finish a list (tracking/lists.js). Ready-made
// lists (genres, decades, iconic series, the games that shaped a genre) are one click away;
// a custom goal picks a system, genre, year or decade and a size. Goals follow the current
// lists; each game counts once, whichever version you finish, including past finishes.
import { escapeHtml as esc } from '../lib.js';
import { GOAL_SIZES, goalEntries, goalProgress, goalTitle, goalYears, validListAward, LIST_XP_PER_GAME, LIST_XP_LIMIT } from '../tracking/goals.js';
import { GENRES, DECADES, featuredLists } from '../tracking/lists.js';

const PREVIEW = 12;
const percent = (value, max) => max ? Math.min(100, Math.round(value / max * 100)) : 0;
const SPEC_KEYS = ['size', 'system', 'year', 'decade', 'genre', 'series', 'shaped'];
const sameSpec = (a, b) => SPEC_KEYS.every(key => (a[key] ?? null) === (b[key] ?? null));
const GROUP_KEY = 'retro-library.goal-gallery.v1';

export function setupGoals(client, openTarget) {
  const host = document.getElementById('playGoals');
  const systems = new Map(client.catalog.systems.map(system => [system.id, system.name ?? system.id]));
  const systemName = id => systems.get(id) ?? id;
  const ranked = client.catalog.systems.filter(system => client.catalog.games.some(game => game.systemId === system.id && game.rank != null && !game.unlisted))
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { sensitivity: 'base' }));
  const featured = featuredLists(client.catalog);
  const open = new Set();
  // XP and badges, when progress rewards are shown.
  const rewardsShown = state => Boolean(state.settings.gamificationVisible && state.progression.profile);
  const listXp = total => Math.min(LIST_XP_LIMIT, LIST_XP_PER_GAME * total);
  function rewardLine(state, goal, progress) {
    if (!rewardsShown(state)) return '';
    const award = state.listAwards?.[`list:${goal.id}`], earned = award && validListAward(state, award);
    if (earned) return `<p class="goal-reward is-earned">${award.xp ? `+${award.xp} XP earned` : 'Badge earned · no XP, since the list was already finished when you set it'}</p>`;
    return `<p class="goal-reward">Complete it for <strong>+${listXp(progress.total)} XP</strong>${goal.shaped ? ' and the Historian badge' : goal.series ? ' and the Series master badge' : goal.decade != null ? ' and the Decade explorer badge' : goal.genre ? ' and the Genre expert badge' : ''}</p>`;
  }
  let group = (() => { try { return sessionStorage.getItem(GROUP_KEY) ?? featured[0]?.group; } catch { return featured[0]?.group; } })();
  const titleOf = goal => goalTitle(goal, systemName, goalEntries(client.catalog, goal).length);
  // The Game Atlas view of a goal's list, when the Atlas can show it.
  function atlasLink(goal) {
    if (goal.series || goal.shaped || goal.genre) return null;
    const query = new URLSearchParams();
    if (goal.system) query.set('systems', goal.system);
    if (goal.system && goal.year === null && goal.decade == null) query.set('sort', 'curated');
    if (goal.year !== null) { query.set('yearFrom', goal.year); query.set('yearTo', goal.year); }
    if (goal.decade != null) { query.set('yearFrom', goal.decade); query.set('yearTo', goal.decade + 9); }
    if (client.namespace === 'sample') query.set('workspace', 'sample');
    return `../index.html${query.size ? `?${query}` : ''}`;
  }
  function targetsByCatalog(state) {
    const map = new Map();
    for (const target of Object.values(state.targets)) for (const ref of target.refs) if (ref.provider === 'catalog') map.set(ref.id, target.id);
    return map;
  }
  function card(goal, finishedIds, targets, state) {
    const progress = goalProgress(client.catalog, goal, finishedIds), expanded = open.has(goal.id), title = titleOf(goal);
    const next = progress.entries.find(entry => !entry.done), atlas = atlasLink(goal);
    const row = entry => {
      const game = entry.games.find(item => finishedIds.has(item.id)) ?? entry.games[0];
      const systemsOf = goal.system && goal.year === null && goal.decade == null && !goal.genre ? '' : entry.games.map(item => systemName(item.systemId)).filter((name, index, all) => all.indexOf(name) === index).join(' · ');
      const detail = goal.shaped ? `${entry.year} · ${entry.why}` : [systemsOf, entry.score].filter(Boolean).join(' · ');
      return `<li class="${entry.done ? 'is-done' : ''}${entry === next ? ' is-next' : ''}"><button type="button" data-goal-game="${esc(game.id)}" data-goal-target="${esc(targets.get(game.id) ?? '')}" title="${esc(goal.shaped ? `${entry.title} (${entry.year}): ${entry.why}` : entry.title)}"><b>${entry.position}</b><span>${esc(entry.title)}${detail ? `<small>${esc(detail)}</small>` : ''}</span><i aria-label="${entry.done ? 'Finished' : 'Not finished yet'}">${entry.done ? '✓' : ''}</i></button></li>`;
    };
    const shown = expanded ? progress.entries : progress.entries.slice(0, PREVIEW);
    return `<article class="goal-card${progress.complete ? ' is-complete' : ''}${goal.shaped ? ' is-history' : ''}" data-goal="${esc(goal.id)}">
      <header><div><p class="eyebrow">${progress.complete ? 'Goal complete' : goal.shaped ? 'Genre history · in release order' : goal.series ? 'Series' : 'List goal'}</p><h3>${esc(title)}</h3></div><span class="challenge-count">${progress.finished} / ${progress.total} finished</span></header>
      <span class="xp-bar" role="progressbar" aria-label="${esc(title)}" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.finished}"><span class="xp-fill" style="--xp:${percent(progress.finished, progress.total)}%"></span></span>
      ${next ? `<p class="challenge-meta">Next up: <strong>#${next.position} ${esc(next.title)}</strong>${!goal.series && !goal.shaped && progress.total < goal.size ? ` · this list has ${progress.total} games` : ''}</p>` : `<p class="challenge-meta">Every game on this list is finished.</p>`}
      ${rewardLine(state, goal, progress)}
      <ol class="goal-games">${shown.map(row).join('')}</ol>
      <div class="tracking-actions">${progress.entries.length > PREVIEW ? `<button type="button" data-goal-more="${esc(goal.id)}" aria-expanded="${expanded}">${expanded ? 'Show fewer' : `Show all ${progress.entries.length}`}</button>` : ''}${atlas ? `<a class="button-link" href="${esc(atlas)}">Open in Game Atlas</a>` : ''}<button type="button" class="is-quiet" data-goal-remove="${esc(goal.id)}">Remove goal</button></div>
    </article>`;
  }
  // Ready-made lists, one group at a time; each shows how far along you already are.
  function gallery(goals, finishedIds, xpShown) {
    const current = featured.find(item => item.group === group) ?? featured[0];
    if (!current) return '';
    const tile = spec => {
      const progress = goalProgress(client.catalog, spec, finishedIds), added = goals.some(goal => sameSpec(goal, spec));
      const preview = progress.entries.slice(0, 3).map(entry => entry.title).join(' · ');
      return `<li class="goal-tile${added ? ' is-added' : ''}"><div><strong>${esc(goalTitle(spec, systemName, progress.total))}</strong><small>${progress.total} games${progress.finished ? ` · ${progress.finished} finished` : ''}${xpShown ? ` · +${listXp(progress.total)} XP` : ''}</small><span>${esc(preview)}</span></div>
        <button type="button" data-goal-add="${esc(JSON.stringify(spec))}"${added ? ' disabled' : ''}>${added ? 'Added ✓' : 'Add'}</button></li>`;
    };
    return `<section class="goal-gallery" aria-labelledby="goalGalleryTitle"><h3 id="goalGalleryTitle">Ready-made lists</h3>
      <div class="segmented goal-groups" role="group" aria-label="List groups">${featured.map(item => `<button type="button"${item === current ? ' class="active"' : ''} data-goal-group="${esc(item.group)}" aria-pressed="${item === current}">${esc(item.group)}</button>`).join('')}</div>
      <ul class="goal-tiles">${current.lists.map(tile).join('')}</ul></section>`;
  }
  function editor() {
    const opener = document.activeElement, node = document.createElement('dialog');
    node.className = 'tracking-dialog challenge-editor goal-editor'; node.setAttribute('aria-labelledby', 'goalEditorTitle');
    node.innerHTML = `<header><h2 id="goalEditorTitle">Set a list goal</h2><button type="button" data-close>Cancel</button></header>
      <p>Finish the best games of a list. Each game counts once, whichever version you finish, and games you already finished count straight away.</p>
      <form data-goal-form><div class="challenge-fields">
        <label>List<select name="system"><option value="">All systems</option>${ranked.map(system => `<option value="${esc(system.id)}">${esc(system.name ?? system.id)}</option>`).join('')}</select></label>
        <label>Genre<select name="genre"><option value="">Any genre</option>${Object.entries(GENRES).map(([id, genre]) => `<option value="${esc(id)}">${esc(genre.name[0].toUpperCase() + genre.name.slice(1))}</option>`).join('')}</select></label>
        <label>Released<select name="when"></select></label></div>
        <fieldset class="goal-sizes"><legend>How many</legend>${GOAL_SIZES.map(size => `<label><input type="radio" name="size" value="${size}"${size === 10 ? ' checked' : ''}><span>Top ${size}</span></label>`).join('')}</fieldset>
        <p class="challenge-meta" data-goal-summary role="status"></p>
        <button type="submit">Add goal</button></form>`;
    document.body.append(node);
    const form = node.querySelector('form'), summary = node.querySelector('[data-goal-summary]');
    const close = () => node.close();
    node.querySelector('[data-close]').onclick = close;
    node.addEventListener('close', () => { node.remove(); if (opener?.isConnected) opener.focus(); }, { once: true });
    const goal = () => {
      const [kind, value] = form.elements.when.value.split(':');
      return { system: form.elements.system.value, year: kind === 'year' ? Number(value) : null, ...(kind === 'decade' ? { decade: Number(value) } : {}),
        ...(form.elements.genre.value ? { genre: form.elements.genre.value } : {}), size: Number(form.elements.size.value) };
    };
    function when() {
      const current = form.elements.when.value, list = goalYears(client.catalog, form.elements.system.value);
      const ordered = form.elements.system.value && !form.elements.genre.value;
      form.elements.when.innerHTML = `<option value="">Any time · ${ordered ? 'the list order' : 'best rated'}</option><optgroup label="Decades">${DECADES.map(decade => `<option value="decade:${decade}">The ${decade}s</option>`).join('')}</optgroup><optgroup label="Years">${list.map(item => `<option value="year:${item.year}">${item.year} (${item.count} games)</option>`).join('')}</optgroup>`;
      form.elements.when.value = [...form.elements.when.options].some(option => option.value === current) ? current : '';
    }
    function update() {
      const draft = goal(), all = goalEntries(client.catalog, { ...draft, size: Infinity }).length;
      // Sizes a list can't fill are disabled (a 30-game list has no top 50).
      for (const input of form.elements.size) input.disabled = Number(input.value) > 10 && all < Number(input.value) * 0.9;
      if (form.elements.size.value === '' || [...form.elements.size].find(input => input.checked)?.disabled) form.elements.size.value = '10';
      const final = goal(), progress = goalProgress(client.catalog, final, client.finishedCatalogIds());
      const taken = (client.snapshot().settings.listGoals ?? []).some(other => sameSpec(other, final));
      summary.textContent = taken ? 'You already have this goal.' : progress.total ? `${goalTitle(final, systemName)}: ${progress.total} games${progress.finished ? `, ${progress.finished} already finished` : ''}. ${final.system && final.year === null && final.decade == null && !final.genre ? 'Follows the system’s list order.' : 'Ranked by critic and player reviews.'}` : 'No games match. Try another genre or time.';
      form.querySelector('[type=submit]').disabled = taken || !progress.total;
    }
    form.onchange = event => { if (['system', 'genre'].includes(event.target.name)) when(); update(); };
    form.onsubmit = async event => {
      event.preventDefault();
      const result = await client.run(() => client.addListGoal(goal()));
      if (result) close();
    };
    when(); update(); node.showModal();
  }
  function render() {
    const state = client.snapshot(), goals = state.settings.listGoals ?? [];
    const finishedIds = client.finishedCatalogIds(), targets = targetsByCatalog(state);
    host.innerHTML = `<header><p class="eyebrow">Work through the classics</p><h2 id="goalsTitle">List goals</h2><p>Finish the best games of a list: a genre, a decade, an iconic series, the games that shaped a genre, or any system’s top 100. Each game counts once, whichever version you play. Owned or not, any finish counts.</p><button id="newGoal" type="button">Set a custom goal</button></header>
      ${goals.length ? `<div class="goal-list">${goals.map(goal => card(goal, finishedIds, targets, state)).join('')}</div>` : '<p class="challenge-empty">Add a ready-made list below, or set a custom goal.</p>'}
      ${gallery(goals, finishedIds, rewardsShown(state))}`;
  }
  host.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.id === 'newGoal') editor();
    else if (button.dataset.goalGroup) { group = button.dataset.goalGroup; try { sessionStorage.setItem(GROUP_KEY, group); } catch {} render(); host.querySelector(`[data-goal-group="${CSS.escape(group)}"]`)?.focus(); }
    else if (button.dataset.goalAdd) { button.disabled = true; await client.run(() => client.addListGoal(JSON.parse(button.dataset.goalAdd))); }
    else if (button.dataset.goalMore) { const id = button.dataset.goalMore; if (open.has(id)) open.delete(id); else open.add(id); render(); host.querySelector(`[data-goal-more="${CSS.escape(id)}"]`)?.focus(); }
    else if (button.dataset.goalRemove) { const goal = client.snapshot().settings.listGoals?.find(item => item.id === button.dataset.goalRemove); if (goal && confirm(`Remove the goal “${titleOf(goal)}”? Your finishes stay recorded.`)) await client.run(() => client.removeListGoal(goal.id)); }
    else if (button.dataset.goalGame) openTarget(button.dataset.goalTarget || `catalog:${button.dataset.goalGame}`, button.dataset.goalTarget ? [] : [client.descriptor('catalog', button.dataset.goalGame)]);
  });
  return { render };
}

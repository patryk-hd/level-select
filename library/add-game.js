// "Add a game": search the Game Atlas, IGDB (with your own keys) or Steam's store, check the
// details, and save. The same dialog edits games you added, and fixes the title, year,
// platform or cover of imported ones. Talks to the local server (scripts/games-api.mjs);
// loaded only when opened.
import { escapeHtml as esc, demoHome, demoNote, onPhone, phoneNote } from '../lib.js';
import { platformKey, ownedMatches } from './core.js';

const HEADERS = { 'X-Retro-Library': '1' };
// Store names match the ones imports use, so the Store filter puts them together.
const OWNED_ON = [['Physical', 'Physical copy (cartridge, disc, box)'], ['Steam', 'Steam'], ['GOG', 'GOG'], ['Epic', 'Epic Games Store'], ['Nintendo', 'Nintendo eShop'],
  ['PlayStation', 'PlayStation Store'], ['Xbox', 'Xbox / Microsoft Store'], ['EA app', 'EA app'], ['Ubisoft Connect', 'Ubisoft Connect'], ['Battle.net', 'Battle.net'],
  ['itch.io', 'itch.io'], ['Humble', 'Humble'], ['Amazon', 'Amazon / Prime Gaming'], ['Other', 'Somewhere else']];
const SOURCE_NAMES = { atlas: 'Game Atlas', igdb: 'IGDB', steam: 'Steam' };
const LIBRARY_PAGE = new URL('./index.html', import.meta.url);
const COVER_ROUTE = '/__retro_library/cover/';
export const FLASH_KEY = 'level-select-flash';

let stylesheet;
const loadStyles = () => stylesheet ??= new Promise(resolve => {
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./add-game.css', import.meta.url).href });
  link.onload = link.onerror = resolve; document.head.append(link);
});

async function request(url, options) {
  let response;
  try { response = await fetch(url, options); }
  catch { throw new Error('The local Level Select server isn’t running. Open the Level Select app (or run npm run dev) and try again.'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong. Try again.');
  return body;
}
const api = (action, body = {}, signal) => request('/__retro_library/games', { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }), signal });
// A picture for a game you added (id) or for an imported one (copy); no file clears it.
const uploadCover = (target, file) => request(`/__retro_library/games/cover?${new URLSearchParams(target)}`, { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/octet-stream' }, body: file ?? new Blob([]) });
const coverOf = game => game?.coverFile ? COVER_ROUTE + game.coverFile : game?.cover || '';
const flash = message => { try { sessionStorage.setItem(FLASH_KEY, message); } catch { /* the page still reloads */ } };
const copyLabel = copy => `${(copy.platforms ?? []).join(', ') || 'Unknown platform'} (${(copy.sources ?? []).join(', ') || 'imported'})`;

// openGameEditor({ library, group, id }): with nothing, add a game; with a library game
// (group), edit or fix one of its copies; with id, edit the game you added with that id.
// `library` (the Library's games) names platforms the way your library already does and
// spots games you already own.
export async function openGameEditor({ library = [], group = null, id = null } = {}) {
  await loadStyles();
  const opener = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'add-game';
  dialog.setAttribute('aria-labelledby', 'addGameTitle');
  dialog.innerHTML = `<header class="add-game-head"><h2 id="addGameTitle"></h2><button type="button" class="add-game-close" data-close>Close</button></header><div class="add-game-body"></div>`;
  document.body.append(dialog);
  const body = dialog.querySelector('.add-game-body'), heading = dialog.querySelector('h2');
  const title = text => { heading.textContent = text; };
  dialog.addEventListener('close', () => { dialog.remove(); opener?.focus?.(); });
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.showModal();
  if (demoHome()) { title('Add a game'); body.innerHTML = `<p class="add-game-message">${demoNote('Adding games')}</p>`; return; }
  if (onPhone()) { title(id || group ? 'Edit details' : 'Add a game'); body.innerHTML = `<p class="add-game-message">${esc(phoneNote(id || group ? 'Editing a game’s details' : 'Adding games'))}</p>`; return; }

  // Platform names as your library writes them ("Sony PlayStation 4" if Playnite says so).
  const known = new Map();
  for (const game of library) for (const name of game.platforms ?? []) if (!known.has(platformKey(name))) known.set(platformKey(name), name);
  const libraryName = name => known.get(platformKey(name)) ?? name;
  let options = { platforms: [], igdb: false };
  api('options').then(value => { options = value; renderPlatformList(); }).catch(() => {});
  const renderPlatformList = () => {
    const list = dialog.querySelector('#addGamePlatforms');
    if (list) list.innerHTML = [...new Set([...known.values(), ...options.platforms.map(libraryName)])].sort((a, b) => a.localeCompare(b)).map(name => `<option value="${esc(name)}"></option>`).join('');
  };
  const status = text => { const node = body.querySelector('.add-game-status'); if (node) node.textContent = text; };
  const message = text => { const node = body.querySelector('.add-game-message'); if (node) node.textContent = text; };

  // ---------- search ----------
  // onPick(result, platforms, years, query) decides what a picked result does.
  let results = [], searching = null, timer = null, onPick = null;
  function showSearch(query = '', { pick: handler = addFromResult, back = null } = {}) {
    onPick = handler;
    body.innerHTML = `<label class="field field-search add-game-search"><span>Search for a game</span><input type="search" placeholder="Search by title…" autocomplete="off" spellcheck="false" value="${esc(query)}"></label>
      <p class="add-game-status" role="status"></p>
      <ul class="add-game-results"></ul>
      <div class="add-game-foot">${back ? '<button type="button" class="add-game-manual" data-search-back>Back</button>' : '<button type="button" class="add-game-manual" data-manual>Can’t find it? Add it yourself</button>'}</div>`;
    const input = body.querySelector('input');
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(input.value), 250); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); if (results.length) pick(0); }
      if (event.key === 'ArrowDown') { event.preventDefault(); body.querySelector('[data-pick]')?.focus(); }
    });
    body.querySelector('[data-manual]')?.addEventListener('click', () => showForm({ name: input.value.trim() }));
    body.querySelector('[data-search-back]')?.addEventListener('click', back);
    input.focus();
    results = [];
    if (query) search(query); else hint();
  }
  const hint = () => status(options.igdb ? 'Searches IGDB and the Game Atlas.' : 'Searches the Game Atlas and Steam. Add your IGDB keys (Import games → Scores) to search every game on every platform.');
  async function search(query) {
    searching?.abort();
    if (query.trim().length < 2) { results = []; renderResults(); hint(); return; }
    const controller = searching = new AbortController();
    status('Searching…');
    try {
      const answer = await api('search', { query }, controller.signal);
      if (controller !== searching) return;
      options.igdb = answer.igdb;
      results = answer.results;
      renderResults();
      status(answer.note ?? (results.length ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}.` : 'No matches. Try fewer words.'));
    } catch (error) { if (error.name !== 'AbortError' && controller === searching) status(error.message); }
  }
  function renderResults() {
    const list = body.querySelector('.add-game-results');
    if (!list) return;
    list.innerHTML = results.map((result, index) => `<li><button type="button" data-pick="${index}">
      <span class="add-game-thumb">${result.cover ? `<img src="${esc(result.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>
      <span class="add-game-result"><strong>${esc(result.title)}</strong><small>${esc([result.year, result.platforms.map(libraryName).slice(0, 4).join(', ') + (result.platforms.length > 4 ? ` +${result.platforms.length - 4}` : '')].filter(Boolean).join(' · '))}</small></span>
      <span class="add-game-badge">${SOURCE_NAMES[result.source]}</span></button></li>`).join('');
  }
  body.addEventListener('click', event => { const button = event.target.closest('[data-pick]'); if (button) pick(Number(button.dataset.pick)); });
  body.addEventListener('keydown', event => {
    const button = event.target.closest('[data-pick]'); if (!button) return;
    const items = [...body.querySelectorAll('[data-pick]')], index = items.indexOf(button);
    if (event.key === 'ArrowDown') { event.preventDefault(); items[index + 1]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); (items[index - 1] ?? body.querySelector('input[type="search"]')).focus(); }
  });
  function pick(index) {
    const result = results[index];
    const years = Object.fromEntries(Object.entries(result.years ?? {}).map(([name, year]) => [libraryName(name), year]));
    // Oldest release first: usually the original platform.
    const platforms = [...new Set(result.platforms.map(libraryName))].sort((a, b) => (years[a] ?? 9999) - (years[b] ?? 9999) || a.localeCompare(b));
    onPick(result, platforms, years, body.querySelector('input[type="search"]')?.value ?? '');
  }
  const addFromResult = (result, platforms, years, query) => showForm({
    name: result.title, year: platforms.length === 1 ? years[platforms[0]] ?? result.year : result.year, platform: platforms.length === 1 ? platforms[0] : '',
    igdbId: result.igdbId, steamAppId: result.steamAppId, atlasId: result.atlasId, genres: result.genres, developers: result.developers, publishers: result.publishers, summary: result.summary,
    ownedOn: result.source === 'steam' ? 'Steam' : 'Physical' }, { from: { result, platforms, years, query } });

  // ---------- the form: add, edit a game you added, or fix an imported one ----------
  // context: { from (a picked search result), fix: { copyId, imported, correction } }
  let cover = {};
  function showForm(game, { from = null, fix = null } = {}) {
    const mode = fix ? 'fix' : game.id ? 'manual' : 'add';
    title({ add: 'Add a game', manual: 'Edit game', fix: 'Fix game details' }[mode]);
    const importedCover = fix?.imported.cover ?? '';
    cover = { url: from?.result.cover ?? (fix ? game.cover ?? importedCover : coverOf(game)), picked: from?.result.cover ?? null, file: null, clear: false };
    const chips = mode !== 'fix' && from?.platforms.length > 1;
    body.innerHTML = `<form class="add-game-form" novalidate>
      <div class="add-game-cover"><div class="add-game-art"></div>
        <label class="add-game-upload"><input type="file" accept="image/png,image/jpeg,image/webp">Use your own picture</label>
        <button type="button" data-cover-clear>${mode === 'fix' ? 'Use the imported picture' : 'Remove picture'}</button></div>
      <div class="add-game-fields">
        ${mode === 'fix' ? `<p class="add-game-imported">Imported as <strong>${esc(fix.imported.name)}</strong> · ${esc([fix.imported.year, fix.imported.platform, fix.imported.sources.join(', ')].filter(Boolean).join(' · '))}. Your changes stay through every import and update.</p>` : ''}
        ${chips ? `<div class="add-game-choose"><span>Which one do you own?</span><div class="add-game-chips">${from.platforms.map(name => `<button type="button" data-platform="${esc(name)}" aria-pressed="false">${esc(name)}${from.years[name] ? ` <small>${from.years[name]}</small>` : ''}</button>`).join('')}</div></div>` : ''}
        <label class="field"><span>Title</span><input name="name" required maxlength="200" value="${esc(game.name ?? '')}"></label>
        <div class="add-game-row">
          <label class="field"><span>Platform</span><input name="platform" list="addGamePlatforms" required maxlength="60" autocomplete="off" placeholder="${chips ? 'Choose one above, or type it' : 'Type or choose a platform'}" value="${esc(game.platform ?? '')}"></label>
          <label class="field add-game-year"><span>Year</span><input name="year" type="number" inputmode="numeric" min="1950" max="${new Date().getFullYear() + 5}" value="${esc(game.year ?? '')}"></label>
        </div>
        <datalist id="addGamePlatforms"></datalist>
        ${mode === 'fix' ? '<button type="button" class="add-game-find" data-find>Search for the right title, year and cover</button>'
          : `<label class="field"><span>Where you own it</span><select name="ownedOn">${OWNED_ON.map(([value, label]) => `<option value="${esc(value)}"${value === (game.ownedOn ?? 'Physical') ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
        <div class="add-game-dupe" hidden></div>`}
        <p class="add-game-from">${mode === 'fix' ? from ? `Title, year and cover from ${SOURCE_NAMES[from.result.source]}. A new title or year may bring other scores with the next update.` : '' : from ? from.result.source === 'igdb' ? 'From IGDB: scores and time to beat arrive with the next update.' : from.result.source === 'steam' ? 'From Steam: Steam reviews and scores arrive with the next update.' : 'From the Game Atlas.' : mode === 'manual' && game.igdbId ? 'Linked to IGDB: scores and time to beat stay with it.' : ''}</p>
      </div>
      <p class="add-game-message" role="status"></p>
      <div class="add-game-actions">
        ${mode === 'manual' ? '<button type="button" class="add-game-danger" data-remove>Remove from library</button>' : mode === 'fix' ? (fix.correction ? '<button type="button" data-reset>Undo all my changes</button>' : '') : '<button type="button" data-back>Back to search</button>'}
        <button type="submit" class="is-primary">${mode === 'add' ? 'Add to library' : 'Save changes'}</button>
      </div></form>`;
    renderPlatformList(); renderCover(importedCover, mode);
    const form = body.querySelector('form'), field = name => form.elements[name], submit = form.querySelector('[type="submit"]');

    // Already own it? The same platform and store (or both physical) can't be added twice;
    // the same platform from elsewhere needs a yes; another platform is just mentioned.
    let blocked = false;
    const checkDupe = () => {
      const node = body.querySelector('.add-game-dupe');
      if (!node) return;
      const want = { name: field('name').value, platform: field('platform').value, ownedOn: field('ownedOn').value, year: field('year').value || null, igdbId: game.igdbId, steamAppId: game.steamAppId };
      const matches = ownedMatches(library, want, { except: game.id }), level = name => matches.filter(match => match.level === name);
      const same = level('same'), platform = level('platform'), other = level('other');
      const list = items => [...new Set(items.map(match => copyLabel(match.copy)))].join(', ');
      const open = match => `<a href="${esc(`${LIBRARY_PAGE.href}?game=${encodeURIComponent(match.group.id)}`)}">Open it in your Library</a>`;
      node.hidden = !matches.length; node.className = `add-game-dupe${same.length ? ' is-blocking' : ''}`;
      if (same.length) node.innerHTML = `<strong>Already in your library:</strong> ${esc(same[0].copy.name ?? same[0].group.name)} on ${esc(list(same))}. ${open(same[0])}`;
      else if (platform.length) node.innerHTML = `You already have it on ${esc(list(platform))}.<label class="add-game-confirm"><input type="checkbox" data-confirm> Yes, I own this copy too</label>`;
      else if (other.length) node.innerHTML = `Also in your library on ${esc(list(other))}. Adding it keeps both copies under one game.`;
      blocked = Boolean(same.length) || (Boolean(platform.length) && !node.querySelector('[data-confirm]')?.checked);
      submit.disabled = blocked;
      node.querySelector('[data-confirm]')?.addEventListener('change', event => { blocked = !event.target.checked; submit.disabled = blocked; });
    };
    if (mode !== 'fix') { for (const name of ['name', 'platform', 'year']) field(name).addEventListener('input', checkDupe); field('ownedOn').addEventListener('change', checkDupe); checkDupe(); }

    form.querySelectorAll('[data-platform]').forEach(button => button.addEventListener('click', () => {
      form.querySelectorAll('[data-platform]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
      field('platform').value = button.dataset.platform;
      if (from.years[button.dataset.platform]) field('year').value = from.years[button.dataset.platform];
      checkDupe();
    }));
    form.querySelector('input[type="file"]').addEventListener('change', event => {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 8e6) { message('That picture is too large (8 MB at most).'); return; }
      cover = { url: URL.createObjectURL(file), picked: null, file, clear: false }; renderCover(importedCover, mode);
    });
    form.querySelector('[data-cover-clear]').addEventListener('click', () => { cover = { url: mode === 'fix' ? importedCover : '', picked: null, file: null, clear: true }; renderCover(importedCover, mode); });
    form.querySelector('[data-back]')?.addEventListener('click', () => showSearch(from?.query ?? ''));
    // Fixing: a search result brings its title, year (on this platform, if listed) and cover.
    form.querySelector('[data-find]')?.addEventListener('click', () => {
      const current = { name: field('name').value, year: field('year').value, platform: field('platform').value, cover: cover.url };
      showSearch(current.name, { back: () => showForm(current, { fix }), pick: (result, platforms, years) => {
        showForm({ name: result.title, year: years[libraryName(current.platform)] ?? result.year ?? current.year, platform: current.platform }, { fix, from: { result, platforms, years, query: current.name } });
      } });
    });
    form.querySelector('[data-remove]')?.addEventListener('click', async () => {
      if (!confirm(`Remove ${game.name} from your library? Notes and play history saved in this browser stay.`)) return;
      try { await api('remove', { id: game.id }); flash(`Removed ${game.name}.`); location.href = LIBRARY_PAGE.href; }
      catch (error) { message(error.message); }
    });
    form.querySelector('[data-reset]')?.addEventListener('click', async () => {
      if (!confirm('Undo all your changes to this game? It goes back to what the import says.')) return;
      try { await api('correction-reset', { copyId: fix.copyId }); flash('Back to the imported details.'); location.reload(); }
      catch (error) { message(error.message); }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (blocked) return;
      if (!field('platform').value.trim()) { message(chips ? 'Choose the platform you own it on (above).' : 'Type the platform you own it on.'); field('platform').focus(); return; }
      const values = { name: field('name').value, platform: field('platform').value, year: field('year').value };
      submit.disabled = true; message(mode === 'add' ? 'Adding…' : 'Saving…');
      try {
        if (mode === 'fix') {
          await api('correct', { copyId: fix.copyId, correction: { ...values, coverUrl: cover.picked } });
          if (cover.file || cover.clear) await uploadCover({ copy: fix.copyId }, cover.file);
          flash('Saved. Your changes stay through every import.'); location.reload(); return;
        }
        const details = { ...game, ...values, ownedOn: field('ownedOn').value };
        if (mode === 'manual') {
          const saved = (await api('edit', { id: game.id, game: details })).game;
          if (cover.file || cover.clear) await uploadCover({ id: saved.id }, cover.file);
          flash(`Saved ${saved.name}.`); location.reload(); return;
        }
        const saved = (await api('add', { game: { ...details, coverUrl: cover.file || cover.clear ? null : cover.picked } })).game;
        if (cover.file) await uploadCover({ id: saved.id }, cover.file);
        flash(`Added ${saved.name} to your library.`);
        location.href = `${LIBRARY_PAGE.href}?q=${encodeURIComponent(saved.name)}`;
      } catch (error) { message(error.message); submit.disabled = false; }
    });
    // Straight to what's left to decide; with everything filled in, Enter adds it.
    (mode !== 'add' ? field('name') : chips ? form.querySelector('[data-platform]') : !field('platform').value ? field('platform') : submit).focus();
  }
  function renderCover(importedCover, mode) {
    const art = body.querySelector('.add-game-art');
    if (!art) return;
    art.innerHTML = cover.url ? `<img src="${esc(cover.url)}" alt="Cover" referrerpolicy="no-referrer">` : '<span>No picture</span>';
    body.querySelector('[data-cover-clear]').hidden = mode === 'fix' ? cover.url === importedCover : !cover.url;
  }

  // ---------- which copy, and loading it ----------
  async function editCopy(copy) {
    body.innerHTML = '<p class="add-game-status" role="status">Loading…</p>';
    try {
      if (copy.manual) { showForm((await api('get', { id: copy.id })).game); return; }
      const { imported, correction } = await api('correction', { copyId: copy.id });
      const coverNow = correction?.coverFile ? COVER_ROUTE + correction.coverFile : correction?.cover || imported.cover;
      showForm({ name: correction?.name ?? imported.name, year: correction?.year ?? imported.year, platform: correction?.platform ?? imported.platform, cover: coverNow }, { fix: { copyId: copy.id, imported, correction } });
    } catch (error) { body.innerHTML = `<p class="add-game-status" role="status">${esc(error.message)}</p>`; }
  }
  function showChooser(game) {
    title('Edit details');
    body.innerHTML = `<p class="add-game-status">${esc(game.name)} is in your library more than once. Which copy?</p>
      <ul class="add-game-results">${game.copies.map((copy, index) => `<li><button type="button" data-copy="${index}"><span class="add-game-result"><strong>${esc(copyLabel(copy))}</strong><small>${esc([copy.name ?? game.name, copy.year].filter(Boolean).join(' · '))}</small></span><span class="add-game-badge">${copy.manual ? 'Added by hand' : 'Imported'}</span></button></li>`).join('')}</ul>`;
    body.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => editCopy(game.copies[Number(button.dataset.copy)])));
    body.querySelector('[data-copy]')?.focus();
  }

  if (group) { if (group.copies.length === 1) editCopy(group.copies[0]); else showChooser(group); }
  else if (id) editCopy({ id, manual: true });
  else { title('Add a game'); showSearch(); }
}

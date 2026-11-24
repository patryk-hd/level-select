// "Add a list of games": a CSV file, or rows copied from Excel or Google Sheets. Every game
// goes on one system (or the one its row names) and is owned where you say: by default a
// Local backup. Shows what will be added, and what's left out and why, before anything is
// saved. Talks to the local server (scripts/games-api.mjs, game-list.mjs); loaded when opened.
import { escapeHtml as esc } from '../lib.js';
import { OWNED_ON } from './add-game.js';

const HEADERS = { 'X-Retro-Library': '1', 'Content-Type': 'application/json' };
const n = value => Number(value).toLocaleString();
const REASONS = { owned: 'Already yours', repeat: 'Repeated', invalid: 'Needs a fix' };

let stylesheet;
const loadStyles = () => stylesheet ??= new Promise(resolve => {
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./add-game.css', import.meta.url).href });
  link.onload = link.onerror = resolve; document.head.append(link);
});
async function api(action, body = {}) {
  let response;
  try { response = await fetch('/__retro_library/games', { method: 'POST', headers: HEADERS, body: JSON.stringify({ action, ...body }) }); }
  catch { throw new Error('The local Level Select server isn’t running. Open the Level Select app (or run npm run dev) and try again.'); }
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(answer.error ?? 'Something went wrong. Try again.');
  return answer;
}

// Resolves with { added, skipped, update } once games are added, or null when closed.
export async function openGameList() {
  await loadStyles();
  const opener = document.activeElement, dialog = document.createElement('dialog');
  dialog.className = 'add-game add-list';
  dialog.setAttribute('aria-labelledby', 'addListTitle');
  dialog.innerHTML = `<header class="add-game-head"><h2 id="addListTitle">Add a list of games</h2><button type="button" class="add-game-close" data-close>Close</button></header><div class="add-game-body"></div>`;
  document.body.append(dialog);
  const body = dialog.querySelector('.add-game-body');
  let done = null;
  const closed = new Promise(resolve => dialog.addEventListener('close', () => { dialog.remove(); opener?.focus?.(); resolve(done); }));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.showModal();

  const form = { text: '', platform: '', ownedOn: 'Local backup' };
  let platforms = [];
  api('options').then(answer => { platforms = answer.platforms ?? []; const list = dialog.querySelector('#addListPlatforms'); if (list) list.innerHTML = options(); }).catch(() => {});
  const options = () => platforms.map(name => `<option value="${esc(name)}"></option>`).join('');
  const message = text => { const node = body.querySelector('.add-game-message'); if (node) node.textContent = text; };

  function showForm() {
    body.innerHTML = `<form class="add-list-form">
      <label class="field"><span>Your games</span><textarea name="text" rows="9" spellcheck="false" placeholder="One game per line. Or select the cells in Excel or Google Sheets, copy and paste them here.">${esc(form.text)}</textarea></label>
      <div class="add-list-file"><label class="add-game-upload">Or choose a CSV file<input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"></label>
        <small>A heading row (Title, System, Year) is optional. From Excel or Numbers, save as CSV first, or copy and paste the cells.</small></div>
      <div class="add-game-row">
        <label class="field"><span>System</span><input name="platform" list="addListPlatforms" placeholder="e.g. PC (Windows), Super Nintendo" autocomplete="off" value="${esc(form.platform)}"><datalist id="addListPlatforms">${options()}</datalist><small>For games whose row doesn’t name one.</small></label>
        <label class="field"><span>Where you own them</span><select name="ownedOn">${OWNED_ON.map(([value, label]) => `<option value="${esc(value)}"${value === form.ownedOn ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select><small>Filter by it later: Library → Store.</small></label>
      </div>
      <p class="add-game-message" role="status"></p>
      <div class="add-game-actions"><button type="submit" class="is-primary">Check the list</button></div></form>`;
    const element = body.querySelector('form'), field = name => element.elements[name];
    element.addEventListener('input', () => { form.text = field('text').value; form.platform = field('platform').value; form.ownedOn = field('ownedOn').value; });
    element.querySelector('input[type="file"]').addEventListener('change', async event => {
      const file = event.target.files[0]; event.target.value = '';
      if (!file) return;
      if (/\.(?:xlsx?|numbers|ods)$/i.test(file.name)) { message('That’s a spreadsheet file. Save it as CSV first (File → Save As, or Download → CSV), or copy the cells and paste them above.'); return; }
      if (file.size > 1.5e6) { message('That file is too large for a list of games.'); return; }
      field('text').value = form.text = await file.text();
      message(`Read ${file.name}.`);
    });
    element.addEventListener('submit', async event => {
      event.preventDefault();
      const button = element.querySelector('[type="submit"]'); button.disabled = true; message('Checking…');
      try { showPreview(await api('list-preview', form)); }
      catch (error) { message(error.message); button.disabled = false; }
    });
    field('text').focus();
  }

  function showPreview({ rows, counts }) {
    const fresh = rows.filter(row => row.status === 'new'), other = rows.filter(row => row.status !== 'new');
    const thumb = row => `<span class="add-game-thumb">${row.atlas?.cover ? `<img src="${esc(row.atlas.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
    const meta = row => [row.platform, row.year, row.atlas ? 'Game Atlas' : 'added by its name', row.also?.length ? `you also have it from ${row.also.join(', ')}` : ''].filter(Boolean).map(esc).join(' · ');
    const summary = [`${n(counts.new)} to add`, counts.owned && `${n(counts.owned)} already yours`, counts.repeat && `${n(counts.repeat)} repeated`, counts.invalid && `${n(counts.invalid)} need a fix`].filter(Boolean).join(' · ');
    body.innerHTML = `<p class="add-list-summary"><strong>${summary}</strong>${fresh.length ? ` · as ${esc(form.ownedOn)}` : ''}</p>
      ${fresh.length ? `<label class="add-list-all"><input type="checkbox" data-all checked> All ${n(fresh.length)}</label>
      <ul class="add-game-results add-list-rows">${fresh.map(row => `<li><label><input type="checkbox" data-line="${row.line}" checked>${thumb(row)}<span class="add-game-result"><strong>${esc(row.name)}</strong><small>${meta(row)}</small></span></label></li>`).join('')}</ul>` : '<p class="add-game-message">Nothing new to add from this list.</p>'}
      ${other.length ? `<details class="add-list-left"${fresh.length ? '' : ' open'}><summary>Left out (${n(other.length)})</summary><ul>${other.map(row => `<li><strong>${esc(row.name)}</strong> <small>line ${row.line} · ${esc(REASONS[row.status])}: ${esc(row.reason)}</small></li>`).join('')}</ul></details>` : ''}
      <p class="add-game-message" role="status"></p>
      <div class="add-game-actions"><button type="button" data-back>Back</button>${fresh.length ? '<button type="button" class="is-primary" data-add></button>' : ''}</div>`;
    const boxes = [...body.querySelectorAll('[data-line]')], all = body.querySelector('[data-all]'), add = body.querySelector('[data-add]');
    const picked = () => boxes.filter(box => box.checked);
    const sync = () => { if (!add) return; const count = picked().length; add.textContent = `Add ${n(count)} ${count === 1 ? 'game' : 'games'}`; add.disabled = !count; all.checked = count === boxes.length; all.indeterminate = count > 0 && count < boxes.length; };
    all?.addEventListener('change', () => { for (const box of boxes) box.checked = all.checked; sync(); });
    body.querySelector('.add-list-rows')?.addEventListener('change', sync);
    body.querySelector('[data-back]').addEventListener('click', showForm);
    add?.addEventListener('click', async () => {
      add.disabled = true; message('Adding…');
      try { done = await api('list-add', { ...form, skip: boxes.filter(box => !box.checked).map(box => Number(box.dataset.line)) }); dialog.close(); }
      catch (error) { message(error.message); sync(); }
    });
    sync();
    (add ?? body.querySelector('[data-back]')).focus();
  }

  showForm();
  return closed;
}

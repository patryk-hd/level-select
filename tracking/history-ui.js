import { escapeHtml as esc } from '../lib.js';
import { objectiveLabel } from './history.js';

const localInstant = value => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
// Keep the original precision when a displayed minute was not edited.
const utcInstant = (value, original) => value === localInstant(original) ? original ?? null : value ? new Date(value).toISOString() : null;
const today = () => localInstant(new Date().toISOString()).slice(0, 10);
const labels = { 'not-started': 'Not started', playing: 'Playing', paused: 'Paused', finished: 'Finished', retired: 'Retired' };
function createDialog(id, title) {
  const previous = document.getElementById(id); if (previous) previous.close();
  const opener = document.activeElement, dialog = document.createElement('dialog');
  dialog.id = id; dialog.className = 'tracking-dialog history-editor'; dialog.setAttribute('aria-labelledby', `${id}Title`);
  dialog.innerHTML = `<header><h2 id="${id}Title">${esc(title)}</h2><button type="button" data-close>Cancel</button></header>`;
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { dialog.remove(); if (opener?.isConnected) opener.focus(); }, { once: true });
  document.body.append(dialog); return dialog;
}

export function openPlaythroughEditor(client, playthroughId, { finish = false, onSaved = () => {} } = {}) {
  const state = client.snapshot(); let expected = state.playthroughs[playthroughId]; if (!expected) return;
  const target = state.targets[expected.targetId], initial = { ...expected, ...(finish ? { status: 'finished', finishedAt: new Date().toISOString() } : {}) };
  const dialog = createDialog('playthroughEditor', finish ? `Finish ${target.title}` : `Edit ${target.title}`);
  dialog.insertAdjacentHTML('beforeend', `<p>${finish ? 'Record the objective you achieved. Time, rating and reflection are optional.' : 'Correct this playthrough in place. Its card and statistics will update together.'}</p>
    ${state.progression.profile && state.settings.gamificationVisible ? '<p class="tracking-meta">For finish rewards, choose Main game or write a personal objective and record a known finish date. Existing history and replays do not repeat first-finish XP.</p>' : ''}
    <form data-play-form><div class="history-fields">
      ${finish ? '<input type="hidden" name="status" value="finished">' : `<label>Status<select name="status">${Object.entries(labels).map(([key, label]) => `<option value="${key}"${key === initial.status ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`}
      <label>Objective achieved<select name="objective">${[['unspecified','Unspecified finish'],['main-game','Main game'],['personal','Personal objective']].map(([key,label])=>`<option value="${key}"${key===initial.objective?' selected':''}>${label}</option>`).join('')}</select></label>
      <label>Personal objective (optional)<input name="objectiveText" maxlength="1000" value="${esc(initial.objectiveText)}" placeholder="For example, finish my island design"></label></div>
      ${finish ? '<details data-finish-details><summary>Dates, time, rating &amp; reflection (optional)</summary>' : ''}
      <div class="history-fields"><label>Started (optional)<input name="startedAt" type="datetime-local" value="${localInstant(initial.startedAt)}"></label>
      <label data-end-label>${initial.status === 'retired' ? 'Retired' : 'Finished'} (optional)<input name="ended" type="datetime-local" value="${localInstant(initial.status === 'retired' ? initial.endedAt : initial.finishedAt)}"></label>
      <label>Minutes in this playthrough<input name="minutesPlayed" type="number" min="0" max="6000000" step="1" value="${initial.minutesPlayed ?? ''}" placeholder="Unknown"></label>
      <label>Your rating<select name="rating"><option value="">Not rated</option>${Array.from({length:11},(_,i)=>i/2).map(rating=>`<option value="${rating}"${initial.rating===rating?' selected':''}>${rating} / 5</option>`).join('')}</select></label>
    </div>
    <p class="tracking-meta">Dates use your local timezone. Clear a date if unknown. Time is your total for this playthrough; imported lifetime hours stay separate.</p>
    <label>Reflection (optional)<textarea name="reflection" rows="4" maxlength="10000" placeholder="What will you remember?">${esc(initial.reflection ?? '')}</textarea></label>
    ${finish ? '</details>' : ''}
    <button type="submit" data-save-play>${finish ? 'Save finish' : 'Save corrections'}</button><p data-editor-status role="status"></p></form>`);
  const form = dialog.querySelector('form'), status = dialog.querySelector('[data-editor-status]');
  const updateEnd = () => {
    const closed = ['finished','retired'].includes(form.elements.status.value);
    dialog.querySelector('[data-end-label]').hidden = !closed;
    dialog.querySelector('[data-end-label]').firstChild.textContent = `${form.elements.status.value === 'retired' ? 'Retired' : 'Finished'} (optional)`;
  };
  form.elements.status.onchange = updateEnd; updateEnd();
  form.onsubmit = async event => {
    event.preventDefault(); const values = new FormData(form), button = form.querySelector('button'); button.disabled = true; status.textContent = 'Saving…';
    try {
      const playStatus = values.get('status'), end = utcInstant(values.get('ended'), initial.status === 'retired' ? initial.endedAt : initial.finishedAt);
      const result = await client.editPlaythrough(playthroughId, { expected, fields: {
        status: playStatus, objective: values.get('objective'), objectiveText: values.get('objectiveText'),
        startedAt: utcInstant(values.get('startedAt'), initial.startedAt), finishedAt: playStatus === 'finished' ? end : null, endedAt: playStatus === 'retired' ? end : null,
        minutesPlayed: values.get('minutesPlayed') === '' ? null : Number(values.get('minutesPlayed')),
        rating: values.get('rating') === '' ? null : Number(values.get('rating')), reflection: values.get('reflection'),
      } });
      expected = client.snapshot().playthroughs[playthroughId]; onSaved();
      if (result.saved) dialog.close(); else status.textContent = 'Session only — export a tracking backup before leaving.';
    } catch (error) { status.textContent = error.message; }
    if (button.isConnected) button.disabled = false;
  };
  dialog.showModal();
}

export function openJournal(client, playthroughId) {
  const state = client.snapshot(), play = state.playthroughs[playthroughId]; if (!play) return;
  const dialog = createDialog('playJournal', `${state.targets[play.targetId].title} · Journal`);
  let expected = null, entryId = crypto.randomUUID();
  dialog.insertAdjacentHTML('beforeend', `<p>${esc(objectiveLabel(play))} · Notes and milestones belong to this playthrough.</p><p class="tracking-meta">Mastery is a written additional objective beyond a recorded main-game finish.${state.progression.profile && state.settings.gamificationVisible ? ' One achieved, dated mastery objective per game earns 50 XP.' : ''} Ordinary milestones remain useful steps along the way.</p><div data-journal-list></div><h3 data-journal-title>Add an entry</h3>
    <form data-journal-form><div class="history-fields"><label>Entry type<select name="kind"><option value="note">Session note</option><option value="milestone">Milestone</option><option value="mastery">Additional mastery objective</option></select></label>
    <label>Date (clear if unknown)<input name="occurredOn" type="date" value="${today()}"></label></div>
    <label>Note or milestone<textarea name="text" rows="3" maxlength="5000" required></textarea></label>
    <label class="history-check"><input type="checkbox" name="achieved"> Objective achieved</label>
    <div class="tracking-actions"><button type="submit">Save entry</button><button type="button" data-new-entry>New entry</button></div><p data-journal-status role="status"></p></form>`);
  const form = dialog.querySelector('form'), status = dialog.querySelector('[data-journal-status]');
  function showEntry(entry) {
    expected = entry; entryId = entry?.id ?? crypto.randomUUID(); form.reset();
    form.elements.kind.value = entry?.kind ?? 'note'; form.elements.text.value = entry?.text ?? '';
    form.elements.occurredOn.value = entry ? entry.occurredOn ?? '' : today(); form.elements.achieved.checked = entry?.achieved ?? false;
    dialog.querySelector('[data-journal-title]').textContent = entry ? 'Edit entry' : 'Add an entry'; updateKind();
  }
  function updateKind() { const milestone = form.elements.kind.value !== 'note'; form.elements.achieved.disabled = !milestone; if (!milestone) form.elements.achieved.checked = false; }
  function renderEntries() {
    const entries = Object.values(client.snapshot().journalEntries).filter(entry => entry.playthroughId === playthroughId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
    dialog.querySelector('[data-journal-list]').innerHTML = entries.length ? entries.map(entry=>`<article class="journal-entry${entry.deletedAt?' journal-hidden':''}"><p><strong>${entry.kind==='note' ? 'Session note' : `${entry.kind==='mastery'?'Mastery':'Milestone'} ${entry.achieved?'achieved':'planned'}`}</strong> · ${esc(entry.occurredOn ?? 'Date unknown')}${entry.deletedAt?' · Hidden':''}</p><p class="history-reflection">${esc(entry.text)}</p><div class="tracking-actions"><button type="button" data-entry-edit="${esc(entry.id)}">Edit</button><button type="button" data-entry-hide="${esc(entry.id)}">${entry.deletedAt?'Restore':'Hide'}</button></div></article>`).join('') : '<p class="tracking-meta">No entries yet. Capture a session or a small milestone along the way.</p>';
    dialog.querySelectorAll('[data-entry-edit]').forEach(button=>button.onclick=()=>showEntry(client.snapshot().journalEntries[button.dataset.entryEdit]));
    dialog.querySelectorAll('[data-entry-hide]').forEach(button=>button.onclick=async()=>{
      const entry = client.snapshot().journalEntries[button.dataset.entryHide];
      await save({ ...entry, entryId: entry.id, expected: entry, deleted: !entry.deletedAt });
    });
  }
  async function save(options) {
    const button = form.querySelector('button[type=submit]'); button.disabled = true;
    try {
      const result = await client.writeJournal(playthroughId, options); renderEntries(); showEntry(null);
      status.textContent = result.saved ? 'Entry saved.' : 'Session only — export a tracking backup before leaving.';
    } catch (error) { status.textContent = error.message; }
    button.disabled = false;
  }
  form.onsubmit = event => {
    event.preventDefault(); const values = new FormData(form);
    save({ entryId, expected, kind: values.get('kind'), text: values.get('text'), occurredOn: values.get('occurredOn') || null, achieved: values.get('achieved') === 'on', deleted: Boolean(expected?.deletedAt) });
  };
  form.elements.kind.onchange = updateKind; dialog.querySelector('[data-new-entry]').onclick = () => showEntry(null);
  const unsubscribe = client.subscribe(change => { if (change.type === 'refresh') { renderEntries(); status.textContent = 'Saved entries refreshed. Your form is kept.'; } });
  dialog.addEventListener('close', unsubscribe, { once: true }); renderEntries(); updateKind(); dialog.showModal();
}

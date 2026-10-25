import { escapeHtml as esc } from '../lib.js';
import { findTarget, latestEvent } from './domain.js';
import { playHistory, progress } from './compat.js';
import { openPlaythroughEditor, openJournal } from './history-ui.js';
import { REWARD_LABELS, nextTitle } from './rewards.js';

const LABELS = { untracked: 'Not planned', backlog: 'Backlog', 'not-started': 'Not started', playing: 'Playing', paused: 'Paused', finished: 'Finished', retired: 'Retired' };
export const progressLabel = status => LABELS[status] ?? status;
export function downloadTracking(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function setupTracking(client) {
  if (!document.querySelector('[data-tracking-style]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./styles.css', import.meta.url); link.dataset.trackingStyle = ''; document.head.append(link);
  }
  let banner = document.getElementById('trackingBanner');
  if (!banner) { banner = document.createElement('section'); banner.id = 'trackingBanner'; banner.className = 'tracking-banner'; banner.setAttribute('aria-label', 'Tracking storage'); document.getElementById('main').prepend(banner); }
  const update = () => {
    const status = client.status();
    banner.hidden = status.ready && !status.sessionOnly;
    const message = status.migrationError || (status.ready ? 'Changes are kept for this session. Export a backup before leaving.' : 'Your saved tracking is ready to upgrade. Review it before making changes.');
    banner.innerHTML = `<p>${esc(message)}</p><button type="button">${status.ready ? 'Export & recovery' : 'Review saved tracking'}</button>`;
    banner.querySelector('button').onclick = () => openTrackingBackup(client);
    document.querySelectorAll('[data-section="backlog"]').forEach(link => { const url = new URL(link.href); url.searchParams.set('workspace', client.namespace); link.href = url; });
    if (client.namespace === 'sample') document.querySelectorAll('a[data-view]').forEach(link => { const url = new URL(link.href); url.searchParams.set('workspace', 'sample'); link.href = url; });
  };
  client.subscribe(update); update();
  document.addEventListener('tracking-notice', event => {
    let toast = document.getElementById('trackingNotice');
    if (!toast) { toast = document.createElement('p'); toast.id = 'trackingNotice'; toast.className = 'tracking-notice'; toast.setAttribute('role', 'status'); document.body.append(toast); }
    toast.textContent = event.detail; clearTimeout(toast.timer); toast.hidden = false;
    toast.timer = setTimeout(() => { toast.hidden = true; }, 8000);
  });
}

function previewMarkup(preview) {
  return `<p>${preview.additions.length} records to add; ${preview.conflicts.length} conflicts to review.${preview.legacy ? ' This older backup has no workspace label. Confirm that it belongs to this workspace.' : ''}</p>
    ${preview.unresolved.length ? `<details><summary>${preview.unresolved.length} unresolved games will be kept</summary><ul>${preview.unresolved.map(item => `<li>${esc(item.title)}</li>`).join('')}</ul></details>` : ''}
    ${preview.conflicts.map((conflict, index) => `<fieldset class="tracking-conflict"><legend>${esc(conflict.section)} · ${esc(conflict.current.title ?? conflict.current.id ?? conflict.id)}</legend><details><summary>Compare values</summary><p>Current</p><pre>${esc(JSON.stringify(conflict.current, null, 2))}</pre><p>Backup</p><pre>${esc(JSON.stringify(conflict.incoming, null, 2))}</pre></details><label>Keep<select data-conflict="${index}"><option value="">Choose a value</option><option value="current">Current</option>${!['events','rewardEvidence','rewardAdjustments','challengeRevisions','challengeEvidence','challengeAwards'].includes(conflict.section) ? '<option value="incoming">Backup</option>' : ''}</select></label></fieldset>`).join('')}
    ${preview.legacy ? '<label><input type="checkbox" data-legacy-confirm> This backup belongs to this workspace.</label>' : ''}`;
}
export function openTrackingBackup(client) {
  let dialog = document.getElementById('trackingBackup');
  if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'trackingBackup'; dialog.className = 'tracking-dialog'; dialog.setAttribute('aria-labelledby', 'trackingBackupTitle'); document.body.append(dialog); }
  dialog.innerHTML = `<header><h2 id="trackingBackupTitle">Backup &amp; import</h2><button type="button" data-close>Close</button></header><p><strong>${client.namespace === 'sample' ? 'Sample' : 'Personal'} workspace</strong> · Shared tracking, notes and play history.</p><p>Keep the original exports and artwork separately. This backup contains saved tracking, not the full imported library.</p><div class="tracking-actions"><button type="button" data-export>Export tracking backup</button>${client.exportableRecovery() ? '<button type="button" data-recovery>Download recovery copy</button>' : ''}${client.earlierBackup?.() ? '<button type="button" data-earlier>Download this browser’s earlier tracking</button>' : ''}</div><section data-migration></section><label>Import a tracking backup, old collection backup, or overrides.json<input type="file" accept=".json,application/json" data-file></label><section data-preview></section><p role="status" data-status></p>`;
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.querySelector('[data-export]').onclick = () => { try { downloadTracking(`retro-tracking-${client.namespace}.json`, client.backup()); } catch (error) { dialog.querySelector('[data-status]').textContent = error.message; } };
  dialog.querySelector('[data-recovery]')?.addEventListener('click', () => downloadTracking('retro-tracking-recovery.json', client.recovery()));
  // Then import it here to merge it, choosing what to keep where it differs.
  dialog.querySelector('[data-earlier]')?.addEventListener('click', () => downloadTracking(`retro-tracking-${client.namespace}-this-browser.json`, client.earlierBackup()));
  const status = dialog.querySelector('[data-status]');
  function showPreview(host, preview, apply, label) {
    host.innerHTML = previewMarkup(preview) + `<button type="button" data-apply>${label}</button>`;
    host.querySelector('[data-apply]').onclick = async event => {
      const resolutions = {};
      for (const select of host.querySelectorAll('[data-conflict]')) {
        if (!select.value) { status.textContent = 'Choose a value for each conflict.'; select.focus(); return; }
        const conflict = preview.conflicts[Number(select.dataset.conflict)]; resolutions[`${conflict.section}/${conflict.id}`] = select.value;
      }
      if (preview.legacy && !host.querySelector('[data-legacy-confirm]').checked) { status.textContent = 'Confirm which workspace this older backup belongs to.'; return; }
      event.target.disabled = true;
      try {
        const result = await apply(resolutions);
        status.textContent = result.saved ? 'Tracking saved. The other views now use these records.' : 'Session only. Export the merged tracking before leaving.';
        host.replaceChildren();
      } catch (error) { status.textContent = `${error.message} Reopen this dialog to refresh the preview.`; if (event.target.isConnected) event.target.disabled = false; }
    };
  }
  if (client.status().pending) showPreview(dialog.querySelector('[data-migration]'), client.status().pending, choices => client.commitMigration(choices), 'Upgrade saved tracking');
  if (client.status().migrationError) {
    const host = dialog.querySelector('[data-migration]'); host.innerHTML = `<p>${esc(client.status().migrationError)}</p><button type="button">Retry reading saved tracking</button>`;
    host.querySelector('button').onclick = () => { client.refreshMigration(); openTrackingBackup(client); };
  }
  dialog.querySelector('[data-file]').onchange = async event => {
    const host = dialog.querySelector('[data-preview]'); host.replaceChildren(); status.textContent = '';
    const file = event.target.files[0]; if (!file) return;
    try {
      if (!client.status().ready) throw new Error('Upgrade or recover existing tracking before importing another backup.');
      if (file.size > 5_000_000) throw new Error('Choose a backup smaller than 5 MB.');
      const preview = client.previewBackup(await file.text());
      showPreview(host, preview, choices => client.importBackup(preview, choices), 'Merge backup');
    } catch (error) { status.textContent = error.message; }
  };
  if (!dialog.open) dialog.showModal();
}

export function mountTracking(host, client, descriptors) {
  if (!host || !descriptors.length) return;
  const selected = host.dataset.copy ?? descriptors[0].ref.id;
  const desc = descriptors.find(item => item.ref.id === selected) ?? descriptors[0]; host.dataset.copy = desc.ref.id;
  const state = client.snapshot(), target = findTarget(state, desc.ref), targetId = target?.id;
  const history = target ? playHistory(state, targetId) : [], active = history.find(play => ['playing', 'paused', 'not-started'].includes(play.status));
  const entry = state.backlog[targetId], status = target ? progress(state, targetId) : 'untracked';
  const latest = latestEvent(state, targetId);
  const candidates = client.linkCandidates(desc).filter(candidate => findTarget(state, candidate.ref)?.id !== targetId || !targetId);
  host.className = 'tracking-panel';
  host.innerHTML = `<h3>Play plan</h3>${descriptors.length > 1 ? `<label>Copy to track<select data-copy>${descriptors.map(item => `<option value="${esc(item.ref.id)}"${item.ref.id === desc.ref.id ? ' selected' : ''}>${esc(item.platforms.join(', ') || 'Unknown platform')} · ${esc(item.sources?.join(', ') || item.ref.id)}</option>`).join('')}</select></label>` : `<p class="tracking-meta">${esc(desc.platforms.join(' · ') || 'Platform not recorded')}</p>`}<p data-progress><strong>${esc(progressLabel(status))}</strong>${entry?.upNext ? ' · In Up Next' : ''}</p>
    <div class="tracking-actions"><button type="button" data-queue>${entry ? 'Remove backlog commitment' : 'Add to backlog'}</button><button type="button" data-next>${entry?.upNext ? 'Remove from Up Next' : 'Add to Up Next'}</button></div>
    ${entry ? `<label>Priority<select data-priority>${['Normal', 'Interested', 'Want soon', 'Highest'].map((label, value) => `<option value="${value}"${entry.priority === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>` : ''}
    ${!active || active.status === 'not-started' ? '<label>Objective<select data-objective><option value="unspecified">Unspecified finish</option><option value="main-game">Finish the main game</option><option value="personal">My own objective</option></select></label><label>Optional objective<input data-objective-text maxlength="1000" placeholder="For example, reach the third island"></label>' : ''}
    <div class="tracking-actions">${!active || active.status === 'not-started' ? `<button type="button" data-start>${history.length ? 'Start a replay' : 'Start playing'}</button>${status === 'finished' ? '' : '<button type="button" data-mark-finished aria-expanded="false">Mark finished</button>'}` : `${active.status !== 'playing' ? '<button type="button" data-status="playing">Resume playing</button>' : '<button type="button" data-status="paused">Pause</button>'}<button type="button" data-status="finished">Finish</button><button type="button" data-status="retired">Retire</button>`}</div>
    <div class="tracking-finish" data-finish-choices hidden><p>When did you finish it?</p><div class="tracking-actions"><button type="button" data-finish-when="today">Today</button><button type="button" data-finish-when="before">Some time ago</button></div><p class="tracking-meta">Today counts as a dated main-game finish. Some time ago is recorded without dates. Either way, add a rating or dates later under Play history.</p></div>
    ${candidates.length ? `<details><summary>Connect matching tracking</summary><p>Confirm the same edition and platform. Different releases keep separate progress.</p>${candidates.map((candidate, index) => `<button type="button" data-link="${index}">Link to ${esc(candidate.title)} · ${esc(candidate.platforms.join(', '))}</button>`).join('')}</details>` : ''}
    ${active ? '<button type="button" data-active-journal>Session notes &amp; milestones</button>' : ''}
    ${history.length ? `<details><summary>Play history (${history.length})</summary><ul>${history.map((play,index) => `<li>${esc(progressLabel(play.status))} · ${esc(play.objectiveText || ({ 'main-game': 'Main game', personal: 'Personal objective', unspecified: 'Unspecified objective' })[play.objective])}<br><small>${play.historical ? 'Imported history · ' : ''}Started: ${esc(play.startedAt ? new Date(play.startedAt).toLocaleDateString() : 'unknown')}${play.status === 'finished' ? ` · Finished: ${esc(play.finishedAt ? new Date(play.finishedAt).toLocaleDateString() : 'unknown')}` : ''}</small><div class="tracking-actions"><button type="button" data-history-edit="${index}">Edit playthrough</button><button type="button" data-history-journal="${index}">Journal</button></div></li>`).join('')}</ul></details>` : ''}
    ${latest && ['queue', 'unqueue', 'wishlist', 'status', 'play-edit'].includes(latest.type) ? '<button type="button" data-undo>Undo last progress change</button>' : ''}
    <a href="${new URL(`../library/backlog.html?workspace=${client.namespace}`, import.meta.url)}">Open Play Plan</a>`;
  const perform = async operation => { await client.run(operation); if (host.isConnected) mountTracking(host, client, descriptors); };
  host.querySelector('[data-copy]')?.addEventListener('change', event => { host.dataset.copy = event.target.value; mountTracking(host, client, descriptors); });
  host.querySelector('[data-queue]').onclick = () => perform(() => client.action(desc, entry ? 'unqueue' : 'queue'));
  host.querySelector('[data-next]').onclick = () => perform(() => client.upNext(desc, !entry?.upNext));
  host.querySelector('[data-priority]')?.addEventListener('change', event => perform(() => client.action(desc, 'queue', { priority: Number(event.target.value) })));
  host.querySelector('[data-start]')?.addEventListener('click', () => {
    const objective = host.querySelector('[data-objective]').value, objectiveText = host.querySelector('[data-objective-text]').value;
    perform(() => client.action(desc, active ? 'status' : 'start', { playthroughId: active?.id ?? crypto.randomUUID(), status: 'playing', objective, objectiveText }));
  });
  host.querySelector('[data-mark-finished]')?.addEventListener('click', event => {
    const choices = host.querySelector('[data-finish-choices]'); choices.hidden = !choices.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!choices.hidden));
    if (!choices.hidden) choices.querySelector('button').focus();
  });
  host.querySelectorAll('[data-finish-when]').forEach(button => { button.onclick = () => perform(() => client.markFinished(desc, { dated: button.dataset.finishWhen === 'today' })); });
  const refresh = () => { if (host.isConnected) mountTracking(host, client, descriptors); };
  host.querySelectorAll('[data-status]').forEach(button => { button.onclick = () => button.dataset.status === 'finished'
    ? openPlaythroughEditor(client, active.id, { finish: true, onSaved: refresh })
    : perform(() => client.action(desc, 'status', { playthroughId: active.id, status: button.dataset.status })); });
  host.querySelector('[data-active-journal]')?.addEventListener('click', () => openJournal(client, active.id));
  host.querySelectorAll('[data-history-edit]').forEach(button => button.onclick = () => openPlaythroughEditor(client, history[Number(button.dataset.historyEdit)].id, { onSaved: refresh }));
  host.querySelectorAll('[data-history-journal]').forEach(button => button.onclick = () => openJournal(client, history[Number(button.dataset.historyJournal)].id));
  host.querySelectorAll('[data-link]').forEach(button => { button.onclick = () => perform(() => client.link(desc, candidates[Number(button.dataset.link)])); });
  host.querySelector('[data-undo]')?.addEventListener('click', () => perform(() => client.action(desc, 'undo', { undoEventId: latest.id })));
}

// "+XP" and level-up moments, shown on every page after an action earns rewards.
let rewardToastTimer;
const BURST_COLOURS = ['var(--accent)', 'var(--xp)', 'var(--success)', 'var(--text)'];
function celebrate(levelUp) {
  let dialog = document.getElementById('levelUp');
  if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'levelUp'; dialog.className = 'level-up'; dialog.setAttribute('aria-labelledby', 'levelUpTitle'); document.body.append(dialog); }
  const next = nextTitle(levelUp.total, levelUp.step), titled = levelUp.title !== levelUp.previousTitle;
  const burst = Array.from({ length: 22 }, (_, index) => {
    const angle = index / 22 * Math.PI * 2, distance = 90 + (index % 4) * 28;
    return `<i style="--x:${Math.round(Math.cos(angle) * distance)}px;--y:${Math.round(Math.sin(angle) * distance)}px;--d:${(index % 5) * 30}ms;--c:${BURST_COLOURS[index % BURST_COLOURS.length]}"></i>`;
  }).join('');
  dialog.innerHTML = `<div class="burst" aria-hidden="true">${burst}</div><p class="eyebrow">Level up</p><div class="level-up-number" aria-hidden="true">${levelUp.level}</div>
    <h2 id="levelUpTitle">You reached level ${levelUp.level}</h2>
    ${titled ? `<span class="new-title">New title: ${esc(levelUp.title)}</span>` : `<p>${esc(levelUp.title)} · ${levelUp.total.toLocaleString()} XP</p>`}
    <p>${next ? `${esc(next.title)} at level ${next.level} · ${next.xp.toLocaleString()} XP to go` : 'You hold the highest title.'}</p>
    <form method="dialog"><button type="submit" autofocus>Keep playing</button></form>`;
  if (!dialog.open) dialog.showModal();
}
document.addEventListener('tracking-reward', event => {
  const { gained, levelUp, reasons = [] } = event.detail ?? {};
  if (!gained) return;
  let toast = document.getElementById('rewardToast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'rewardToast'; toast.className = 'reward-toast'; toast.setAttribute('role', 'status'); document.body.append(toast); }
  const why = [...new Set(reasons.filter(reason => Math.sign(reason.amount) === Math.sign(gained)).map(reason => REWARD_LABELS[reason.type] ?? reason.type))];
  toast.classList.toggle('is-loss', gained < 0);
  toast.innerHTML = `<b>${gained > 0 ? '+' : '−'}${Math.abs(gained).toLocaleString()} XP</b><span>${esc(gained < 0 ? 'Undone' : why.join(' · ') || 'Progress')}</span>`;
  toast.hidden = false; toast.classList.remove('show'); void toast.offsetWidth; toast.classList.add('show');
  clearTimeout(rewardToastTimer); rewardToastTimer = setTimeout(() => { toast.hidden = true; }, 1700);
  if (levelUp) setTimeout(() => celebrate(levelUp), 500);
});

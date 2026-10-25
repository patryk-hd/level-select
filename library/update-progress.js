// Live progress of "Update data", shared by the Update dialog and the Import games page.
// The panel is built once and then updated in place (only text and classes that changed),
// so nothing flickers while it checks for news every second.
import { escapeHtml as esc } from '../lib.js';

const HEADERS = { 'Content-Type': 'application/json', 'X-Retro-Library': '1' };
const FINISHED = new Set(['done', 'skipped', 'failed', 'stopped']);
const MARK = { pending: '', running: '', done: '✓', skipped: '–', failed: '✗', stopped: '■', interrupted: '!' };
// What each step does, in plain words: shown under the step being worked on.
export const STEP_HELP = {
  sources: 'Re-reads Steam, GOG Galaxy and ES-DE, so new purchases and wishlist changes come in.',
  library: 'Merges Playnite, GOG Galaxy and Steam into one library. A game you own in the same store appears once.',
  wishlist: 'Builds the Wishlist page: genres, release dates and store details for newly wishlisted games.',
  prices: 'Checks today’s Steam prices for your wishlist (100 games per request), so sales show up.',
  roms: 'Looks for new games in your ROM folders.',
  igdb: 'Looks up new games on IGDB, a large game database, for critic and player scores, genres and how long they take to beat. The first run after a big import takes a while; later runs only check new games.',
  steam: 'Checks Steam user reviews (for example “92% positive of 48,000”) for wishlist and owned Steam games, 100 games a request: new games always, wishlist games and recent releases weekly, everything else monthly.',
  awards: 'Checks Wikidata for Game of the Year and other awards. Runs once a week.',
  vgc: 'Fetches VideoGamesCritic scores (they follow patches and recent player reviews) for your games, wishlist and the Game Atlas PC list, and Steam reviews for that list.',
};
// The update writes a heartbeat every 10 s; this long without one means it may be stuck.
const STALE_AFTER = 45000;
const when = iso => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
const count = value => Number(value ?? 0).toLocaleString();
const duration = ms => { const seconds = Math.max(0, Math.round(ms / 1000)); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`; };

// Overall progress, 0–100: finished steps count fully, the running one by its own count.
export function overallProgress(steps = []) {
  if (!steps.length) return 0;
  const done = steps.reduce((sum, step) => sum + (FINISHED.has(step.state) ? 1 : step.state === 'running' && step.progress?.total ? step.progress.done / step.progress.total : 0), 0);
  return Math.min(100, Math.round(done / steps.length * 100));
}

// What to tell you, from the status the server reports.
export function describeStatus({ status, running, queued } = {}, now = Date.now()) {
  const steps = status?.steps ?? [], current = steps.find(step => step.state === 'running');
  const index = current ? steps.indexOf(current) + 1 : 0, s = status?.summary;
  const stale = running && status?.updatedAt && now - Date.parse(status.updatedAt) > STALE_AFTER;
  let headline;
  if (running) headline = current ? `Updating · step ${index} of ${steps.length}: ${current.label}` : 'Starting the update…';
  else if (status?.state === 'done') headline = `Updated ${when(status.finishedAt)}.${s ? ` Library: ${count(s.owned)} games${s.addedCount ? ` (+${count(s.addedCount)} new)` : ''}${s.removedCount ? `, ${count(s.removedCount)} gone` : ''}. Wishlist: ${count(s.wishlist)}${s.newWishCount ? ` (+${count(s.newWishCount)})` : ''}.` : ''}`;
  else if (status?.state === 'partial') headline = 'Finished with a problem: see the steps marked ✗. Your previous data is still used for those parts.';
  else if (status?.state === 'stopped') headline = `You stopped the update ${when(status.finishedAt)}. Finished steps are kept; choose Update data to continue.`;
  else if (status?.state === 'failed') headline = `The update couldn’t start: ${status.error}`;
  else if (status?.state === 'interrupted') headline = status.leftover ? 'The app closed during the last update, but its current step is still finishing in the background. Stop it, or let it finish and then choose Update data.' : 'The last update was interrupted (the app closed while it ran). Choose Update data to finish it; finished steps are skipped quickly.';
  else headline = 'Choose Update data to bring in your games and their scores.';
  const detail = current ? [current.progress ? `${count(current.progress.done)} of ${count(current.progress.total)}` : null, current.progress?.detail && !/^\d[\d,]* of /.test(current.progress.detail) ? current.progress.detail : null,
    current.startedAt ? `${duration(now - Date.parse(current.startedAt))} on this step` : null].filter(Boolean).join(' · ') : '';
  return { headline, detail, percent: running ? Math.min(99, overallProgress(steps)) : overallProgress(steps), current, stale, queued: Boolean(queued) };
}

const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node.hidden !== hidden) node.hidden = hidden; };
const setAttr = (node, name, value) => { if (value == null) { if (node.hasAttribute(name)) node.removeAttribute(name); } else if (node.getAttribute(name) !== value) node.setAttribute(name, value); };

export function mountProgress(host, { links = true } = {}) {
  host.classList.add('update-progress');
  host.innerHTML = `
    <div class="progress-head"><p class="progress-headline" data-p="headline" role="status"></p>
      <div class="progress-actions"><button type="button" class="is-primary" data-p="start">Update data</button><button type="button" class="progress-stop" data-p="stop" hidden>Stop</button>
        ${links ? `<a class="button-link" data-p="library" href="${esc(new URL('./index.html', import.meta.url).href)}" hidden>Open Library</a>` : ''}<button type="button" data-p="reload" hidden>Reload</button></div></div>
    <div class="progress-bar" data-p="bar" role="progressbar" aria-label="Update progress" aria-valuemin="0" aria-valuemax="100" hidden><span></span></div>
    <p class="progress-detail" data-p="detail" hidden></p>
    <p class="progress-alert" data-p="alert" role="alert" hidden></p>
    <details class="progress-details" data-p="details" hidden><summary>Steps</summary><ol class="progress-steps" data-p="steps"></ol></details>`;
  const part = name => host.querySelector(`[data-p="${name}"]`);
  const items = new Map();
  let timer = null, failures = 0, wasRunning = false, shownRunning = false, stopping = false, alive = true, message = '';

  function renderSteps(steps) {
    const list = part('steps');
    for (const step of steps) {
      let item = items.get(step.id);
      if (!item) {
        item = document.createElement('li');
        item.innerHTML = '<span class="step-dot" aria-hidden="true"></span><span class="step-text"><span class="step-label"></span><small class="step-note"></small><small class="step-help"></small></span>';
        items.set(step.id, item); list.append(item);
      }
      const state = `is-${step.state}`;
      if (item.className !== state) item.className = state;
      setAttr(item, 'aria-current', step.state === 'running' ? 'step' : null);
      setText(item.querySelector('.step-dot'), MARK[step.state] ?? '');
      setText(item.querySelector('.step-label'), step.label);
      setAttr(item, 'title', STEP_HELP[step.id] ?? null);
      const help = ['running', 'interrupted'].includes(step.state) ? STEP_HELP[step.id] ?? '' : '';
      setText(item.querySelector('.step-help'), help); setHidden(item.querySelector('.step-help'), !help);
      const note = step.state === 'running' && step.progress ? `${count(step.progress.done)} of ${count(step.progress.total)}` : step.note ?? '';
      setText(item.querySelector('.step-note'), note);
      setHidden(item.querySelector('.step-note'), !note);
    }
    for (const [id, item] of items) if (!steps.some(step => step.id === id)) { item.remove(); items.delete(id); }
  }

  function render(data) {
    const view = describeStatus(data), steps = data.status?.steps ?? [], running = Boolean(data.running);
    if (!running) stopping = false;
    setText(part('headline'), message || (stopping ? 'Stopping… letting the current step save what it has.' : view.headline));
    const bar = part('bar');
    setHidden(bar, !running && !steps.length);
    if (bar.firstElementChild.style.width !== `${view.percent}%`) bar.firstElementChild.style.width = `${view.percent}%`;
    setAttr(bar, 'aria-valuenow', String(view.percent));
    bar.classList.toggle('is-waiting', running && Boolean(view.current) && !view.current.progress);
    // Green only for an update that finished; stopped, interrupted or partial runs stay neutral.
    bar.classList.toggle('is-finished', !running && data.status?.state === 'done');
    bar.classList.toggle('is-halted', !running && data.status?.state !== 'done');
    setText(part('detail'), view.detail + (view.queued ? `${view.detail ? ' · ' : ''}another update follows to include your latest import` : ''));
    setHidden(part('detail'), !running || (!view.detail && !view.queued));
    const alert = view.stale ? `No word from the update for ${duration(Date.now() - Date.parse(data.status.updatedAt))}. It may be waiting on a slow connection; you can keep waiting or stop it.` : '';
    setText(part('alert'), alert); setHidden(part('alert'), !alert);
    const details = part('details');
    setHidden(details, !steps.length);
    // The step list opens once when an update starts; after that it's yours to fold.
    if (running && !shownRunning) details.open = true;
    shownRunning = running;
    renderSteps(steps);
    // A leftover step still finishing after an interrupted update can be stopped too.
    const stoppable = running || Boolean(data.status?.leftover);
    setHidden(part('start'), stoppable); setHidden(part('stop'), !stoppable);
    part('stop').disabled = stopping;
    if (part('library')) setHidden(part('library'), running || !data.status?.finishedAt);
    // Finished while you watched: the new data shows after a reload.
    setHidden(part('reload'), running || !wasRunning);
    wasRunning = wasRunning || running;
  }

  async function poll() {
    clearTimeout(timer);
    if (!alive || !host.isConnected) return;
    try {
      const data = await (await fetch('/__retro_library/update-status', { cache: 'no-store' })).json();
      failures = 0; render(data);
      if (data.running || data.status?.leftover) timer = setTimeout(poll, data.running ? 1000 : 3000);
    } catch {
      failures++;
      const alert = part('alert');
      setText(alert, failures > 2 ? 'Can’t reach the Level Select app. Is it still open? Retrying…' : 'Checking on the update…');
      setHidden(alert, false);
      timer = setTimeout(poll, Math.min(15000, 1000 * 2 ** Math.min(failures, 4)));
    }
  }
  async function post(url) {
    const response = await fetch(url, { method: 'POST', headers: HEADERS, body: '{}' }).catch(() => null);
    if (!response) throw new Error('Can’t reach the Level Select app. Open it (or run npm run dev) and try again.');
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Something went wrong. Try again.');
    return body;
  }
  host.addEventListener('click', async event => {
    const target = event.target.closest('[data-p]'); if (!target) return;
    if (target.dataset.p === 'reload') { location.reload(); return; }
    if (target.dataset.p === 'start') { message = ''; try { await post('/__retro_library/update'); } catch (error) { message = error.message; } wasRunning = true; setTimeout(poll, 250); }
    if (target.dataset.p === 'stop') {
      if (!confirm('Stop the update?\n\nSteps that already finished are kept, and the step in progress saves what it has so far. Your library keeps working with its current data. Choose Update data again any time to continue.')) return;
      stopping = true; target.disabled = true; setText(part('headline'), 'Stopping… letting the current step save what it has.');
      try { await post('/__retro_library/update-stop'); } catch (error) { message = error.message; stopping = false; target.disabled = false; }
      setTimeout(poll, 500);
    }
  });
  poll();
  return { refresh: () => { message = ''; wasRunning = true; poll(); }, destroy: () => { alive = false; clearTimeout(timer); } };
}

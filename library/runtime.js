import { mountUpdate } from './update-ui.js';
import { copyApp, demoHome, escapeHtml } from '../lib.js';
import { setupTracking, openTrackingBackup } from '../tracking/ui.js';

export async function loadConnections() {
  try {
    const response = await fetch(new URL('./data/connections.json', import.meta.url));
    if (!response.ok) throw new Error('Connections unavailable');
    return await response.json();
  } catch { return { byOwned: {}, byRelease: {}, owned: [] }; }
}

const memory = new Map(), damaged = new Map();
let toastTimer;
export function notify(message) {
  let toast = document.getElementById('libraryToast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'libraryToast'; toast.className = 'toast'; toast.setAttribute('role', 'status'); document.body.append(toast); }
  toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 6500);
}
export function readStore(key, fallback = {}) {
  key = storageKey(key);
  if (memory.has(key)) return memory.get(key);
  let raw;
  try {
    raw = localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : fallback;
    if (typeof fallback === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('Invalid saved data');
    memory.set(key, value); return value;
  } catch {
    if (raw) damaged.set(key, raw);
    memory.set(key, fallback);
    queueMicrotask(() => notify(raw ? 'Saved edits could not be read. Export a recovery copy from Backup & import.' : 'Browser storage is unavailable. Export a backup to keep your edits.'));
    return fallback;
  }
}
export function writeStore(key, value) {
  key = storageKey(key);
  memory.set(key, value);
  try {
    if (damaged.has(key)) throw new Error('Preserve recovery data');
    localStorage.setItem(key, JSON.stringify(value)); return true;
  } catch { notify('Changes are kept for this session. Export a backup to keep them.'); return false; }
}
export function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createRoute({ controls, state, enums, numeric = {}, render, showDetails, syncControls }) {
  const defaults = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value]));
  const stateDefaults = { ...state };
  function restore() {
    const params = new URLSearchParams(location.search);
    for (const [key, control] of Object.entries(controls)) {
      const value = (params.get(key) ?? defaults[key]).slice(0, 300);
      control.value = control.tagName === 'SELECT' && ![...control.options].some(option => option.value === value) ? defaults[key] : value;
    }
    for (const [key, values] of Object.entries(enums)) {
      const value = params.get(key); state[key] = values.includes(value) ? value : stateDefaults[key];
    }
    for (const [key, values] of Object.entries(numeric)) {
      const value = Number(params.get(key)); state[key] = values.includes(value) ? value : stateDefaults[key];
    }
    state.page = Math.max(1, Math.min(10000, Number.parseInt(params.get('page'), 10) || 1));
    syncControls();
  }
  function sync() {
    const params = new URLSearchParams();
    for (const [key, control] of Object.entries(controls)) if (control.value !== defaults[key]) params.set(key, control.value);
    for (const key of Object.keys(enums)) if (state[key] !== stateDefaults[key]) params.set(key, state[key]);
    for (const key of Object.keys(numeric)) params.set(key, state[key]);
    if (state.page > 1) params.set('page', state.page);
    const game = new URLSearchParams(location.search).get('game');
    if (game) params.set('game', game);
    const query = params.toString();
    history.replaceState({}, '', location.pathname + (query ? `?${query}` : ''));
  }
  window.addEventListener('popstate', () => {
    restore(); render();
    const id = new URLSearchParams(location.search).get('game');
    if (id) showDetails(id); else document.getElementById('detailsPanel').close();
  });
  return { restore, sync, openInitial() { const id = new URLSearchParams(location.search).get('game'); if (id) showDetails(id); } };
}

let detailOpener;
export function openDetails(panel, id) {
  if (!panel.open) { detailOpener = document.activeElement; panel.showModal(); }
  const url = new URL(location.href); url.searchParams.set('game', id); history.replaceState({}, '', url);
}
export function closeDetails(panel) {
  panel.close();
  const url = new URL(location.href); url.searchParams.delete('game'); history.replaceState({}, '', url);
  if (detailOpener?.isConnected) detailOpener.focus({ preventScroll: true });
}

export function setupCommon() {
  const client = window.retroTracking;
  if (client.namespace === 'sample') {
    const note = document.createElement('p');
    note.className = 'sample-notice';
    const home = demoHome();
    note.innerHTML = home ? `Live demo: real games in a made-up library. <a href="${escapeHtml(home)}">Get Level Select</a>, free, to bring in your own.`
      : copyApp() ? 'Sample library: these games are examples. <a href="phone.html">Open your copy</a> to see your own.'
      : 'Sample library: these games are examples. <a href="sources.html">Import games</a> to see your own.';
    document.getElementById('main').prepend(note);
  }
  const panel = document.getElementById('detailsPanel');
  panel.addEventListener('cancel', event => { event.preventDefault(); closeDetails(panel); });
  document.addEventListener('error', event => {
    if (!(event.target instanceof HTMLImageElement)) return;
    const image = event.target, parent = image.parentElement;
    image.remove();
    if (!parent.querySelector('.cover-fallback')) { const fallback = document.createElement('span'); fallback.className = 'cover-fallback'; fallback.textContent = 'No cover'; parent.prepend(fallback); }
  }, true);
  setupTracking(client);
  document.getElementById('backupLibrary').addEventListener('click', () => openTrackingBackup(client));
  const update = document.getElementById('updateLibrary');
  update?.addEventListener('click', () => {
    const dialog = document.getElementById('updateDialog'); dialog.showModal(); mountUpdate(dialog);
  });
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
}

function storageKey(key) {
  return window.retroTracking?.namespace === 'sample' ? `sample:${key}` : key;
}

import { escapeHtml as esc, demoHome, demoNote, onPhone, phoneNote } from '../lib.js';
import { mountProgress } from './update-progress.js';

const when = iso => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
const count = value => Number(value ?? 0).toLocaleString();

// "Update your data": your connected sources and a one-click update with live progress
// (update-progress.js). Connecting sources happens on the Import games page.
export function mountUpdate(dialog) {
  const body = dialog.querySelector('[data-update-body]') ?? (() => {
    dialog.querySelectorAll(':scope > :not(.utility-heading)').forEach(node => node.remove());
    dialog.querySelector('h2').textContent = 'Update your data';
    dialog.insertAdjacentHTML('beforeend', '<div data-update-body class="update-body"><div data-update-sources></div><div data-update-progress></div></div>');
    return dialog.querySelector('[data-update-body]');
  })();
  const sourcesHost = body.querySelector('[data-update-sources]'), importPage = new URL('./sources.html', import.meta.url).href;
  const progress = mountProgress(body.querySelector('[data-update-progress]'), { links: false });

  // One line per source: what it brings and when it last synced.
  async function showSources() {
    let data = null, status = null;
    try { [data, status] = await Promise.all([fetch('/__retro_library/sources', { cache: 'no-store' }).then(response => response.json()), fetch('/__retro_library/update-status', { cache: 'no-store' }).then(response => response.json())]); }
    catch { sourcesHost.innerHTML = demoHome() ? `<p>${demoNote('Updating your data')}</p>` : onPhone() ? `<p>${esc(phoneNote('Updating your games and scores'))}</p>` : '<p>Updates need the local Level Select app (or <code>npm run dev</code>). From a terminal: <code>npm run update</code>.</p>'; return; }
    const { inputs, roms } = status, folders = data.romFolders ?? [];
    const lines = [
      data.steam.wishlist && ['Steam wishlist', `${count(data.steam.wishlist.count)} games · synced ${when(data.steam.wishlist.syncedAt)}`],
      data.steam.owned && data.steam.hasKey && ['Steam games', `${count(data.steam.owned.count)} games · synced ${when(data.steam.owned.syncedAt)}`],
      data.galaxy.connected && ['GOG Galaxy', `${count(data.galaxy.connected.count)} games · synced ${when(data.galaxy.connected.syncedAt)}`],
      data.playnite.file && ['Playnite export', `saved ${when(data.playnite.file.modified)}`],
      !data.steam.wishlist && inputs.wishlist && !inputs.wishlist.missing && ['Wishlist file', `saved ${when(inputs.wishlist.modified)}`],
      data.esde.connected && ['ES-DE', `${count(data.esde.connected.count)} games · synced ${when(data.esde.connected.syncedAt)}`],
      folders.length && ['ROM folders', `${folders.length} folder${folders.length === 1 ? '' : 's'}${roms ? ` · ${count(roms.games)} games` : ''}`],
    ].filter(Boolean);
    sourcesHost.innerHTML = `<p>${lines.length ? 'Update data re-reads everything you’ve connected and fetches scores for new games.' : 'Nothing is connected yet. Import your games from Steam, GOG Galaxy, Playnite, ES-DE or ROM folders first.'}</p>
      ${lines.length ? `<ul class="update-files">${lines.map(([label, note]) => `<li><strong>${esc(label)}</strong><small>${esc(note)}</small></li>`).join('')}</ul>` : ''}
      <p><a class="update-import-link" href="${esc(importPage)}">${lines.length ? 'Connect or change sources' : 'Import your games'} →</a></p>`;
  }
  dialog.addEventListener('close', () => progress.destroy(), { once: true });
  showSources();
}

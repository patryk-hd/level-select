// Your copy, in the Level Select phone app (the On your phone page there): open the copy your
// computer keeps (library/copy.js does the opening), see which one this phone has, update or
// remove it, and how to get it onto the phone in the first place.
import { escapeHtml as esc } from '../lib.js';
import { copyInfo, readCopyFile, openCopy, removeCopy, rememberedPassphrase } from './copy.js';

const when = iso => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const iphone = /iPhone|iPad/.test(navigator.userAgent);

export async function mountCopyApp(host) {
  // In the phone app this page is Your copy.
  document.title = 'Your copy — Level Select';
  const top = document.querySelector('.topbar');
  if (top) top.innerHTML = '<div><p class="eyebrow">Your games, anywhere</p><h1>Your copy<span class="title-dot">.</span></h1><p class="section-summary">Your library on this phone, even offline. Your computer makes the copy; it’s opened right here, and nothing is uploaded.</p></div>';
  let info = copyInfo(), pending = null, busy = false, error = '', done = '';
  const render = () => {
    const have = info ? `<p class="source-status">Your copy from <strong>${esc(when(info.createdAt))}</strong>${info.games ? `, ${info.games.toLocaleString()} games` : ''}. Opened here ${esc(when(info.openedAt))}.${info.plan?.startsWith('plan not merged') ? `<br><span class="warn">Your plan didn’t join this phone’s (${esc(info.plan.replace('plan not merged: ', ''))}). Backup &amp; import can merge it by hand.</span>` : ''}</p>` : '';
    const unlock = pending ? `<form class="source-form" data-unlock><label>Passphrase (the one you set on your computer)<input name="passphrase" type="password" autocomplete="current-password" required></label>
      <label class="copy-remember"><input type="checkbox" name="remember" checked> Remember it on this phone</label><button type="submit" class="is-primary"${busy ? ' disabled' : ''}>Open</button></form>` : '';
    host.innerHTML = `<div class="source-grid phone-grid">
      <section class="source-card${info ? ' is-connected' : ''}"><header><span class="source-icon" aria-hidden="true">📚</span><div><h3>Your library on this phone</h3><p class="source-tagline">${info ? 'Open a newer copy whenever your computer has updated it.' : 'Open the copy your computer keeps, and Level Select shows your own games here, even offline.'}</p></div><span class="source-state">${info ? 'Your copy' : 'Sample'}</span></header>
        ${have}${error ? `<p class="source-status"><span class="warn">${esc(error)}</span></p>` : ''}${done ? `<p class="copy-done">${esc(done)} <a href="backlog.html">See tonight’s picks →</a></p>` : ''}${unlock}
        <div class="source-actions"><label class="button-like"><input class="copy-file" type="file" accept=".json,application/json" data-file><button type="button" class="is-primary" data-pick${busy ? ' disabled' : ''}>${info ? 'Open a newer copy' : 'Open your copy'}</button></label>${info ? `<button type="button" data-remove${busy ? ' disabled' : ''}>Remove from this phone</button>` : ''}</div>
        <p class="source-blocked">Your copy is read right here: nothing is uploaded.</p></section>
      <section class="source-card"><header><span class="source-icon" aria-hidden="true">?</span><div><h3>Where’s the copy?</h3></div></header>
        <ul class="source-steps phone-notes">
          <li><span class="step-mark">1</span><span>On your computer, open <strong>Level Select → On your phone → Away from home</strong> and choose your cloud folder (or download the copy and ${iphone ? 'AirDrop it' : 'send it to this phone'}).</span></li>
          <li><span class="step-mark">2</span><span>Here, choose <strong>Open your copy</strong>, then ${iphone ? '<strong>Browse → iCloud Drive</strong> (or Google Drive, Dropbox, OneDrive)' : 'your cloud app in the file picker (<strong>Drive</strong>, Dropbox, OneDrive)'} → <strong>Level Select</strong> → <strong>level-select-copy.json</strong>.</span></li>
          <li><span class="step-mark">3</span><span>Your computer keeps that file up to date. Open it here again for the newest games and plan.</span></li>
          ${installed() ? '' : `<li><span class="step-mark">★</span><span>Put Level Select on your home screen: ${iphone ? '<strong>Share → Add to Home Screen</strong>' : '<strong>⋮ → Add to Home screen</strong>'}. It then opens like an app and works offline.</span></li>`}
        </ul></section>
    </div>`;
  };
  async function open(text, passphrase, remember) {
    busy = true; error = ''; done = ''; render();
    try {
      info = await openCopy(text, passphrase, { remember });
      pending = null;
      done = `Opened: ${info.games ? `${info.games.toLocaleString()} games` : 'your library'}${info.plan === 'plan updated' ? ', and your plan' : ''}.`;
    } catch (failure) { error = failure.message; }
    busy = false; render();
  }
  host.addEventListener('click', event => {
    if (event.target.closest('[data-pick]')) host.querySelector('[data-file]').click();
    if (event.target.closest('[data-remove]') && confirm('Take your library off this phone? The app shows the sample again. Your plan here stays.')) removeCopy().then(() => { info = null; done = ''; render(); });
  });
  host.addEventListener('change', async event => {
    const file = event.target.closest('[data-file]')?.files?.[0];
    if (!file) return;
    error = ''; done = '';
    try {
      const text = await file.text(), head = readCopyFile(text);
      if (!head.encrypted) return open(text, '', false);
      const saved = rememberedPassphrase();
      if (saved) { await open(text, saved, true); if (!error) return; error = 'The remembered passphrase doesn’t open this copy (was it changed on your computer?). Type it again.'; }
      pending = text; render();
    } catch (failure) { error = failure.message; render(); }
  });
  host.addEventListener('submit', event => {
    event.preventDefault();
    if (!event.target.matches('[data-unlock]') || !pending) return;
    const value = new FormData(event.target);
    open(pending, String(value.get('passphrase')), value.get('remember') === 'on');
  });
  render();
}

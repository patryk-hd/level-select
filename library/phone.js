// On your phone. On your computer: at home, turn phone access on or off, pair a phone with a
// QR code, see and forget paired phones (scripts/phone-access.mjs); away from home, keep a
// copy of your library where your phone can reach it (scripts/phone-copy.mjs) and set up the
// phone app. In the phone app itself, this page is Your copy (copy-app.js).
import { escapeHtml as esc, copyApp } from '../lib.js';
import { pageReady } from '../navigation.js';

const $ = id => document.getElementById(id);
const body = $('phoneBody');
let status = null, pairing = null, copy = null, busy = false, error = '', copyError = '', guide = /Android/.test(navigator.userAgent) ? 'android' : 'iphone';

async function api(action, extra = {}) {
  const response = await fetch('/__retro_library/phone', action ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Retro-Library': '1' }, body: JSON.stringify({ action, ...extra }) } : { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Something went wrong. Try again.');
  return data;
}
const when = iso => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const ago = iso => { const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000); return minutes < 2 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : when(iso); };
const left = () => { const seconds = Math.max(0, Math.round((Date.parse(pairing.expiresAt) - Date.now()) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };

function render() {
  if (!status) return;
  const on = status.enabled, running = status.running;
  const toggle = `<section class="source-card phone-switch${on && running ? ' is-connected' : ''}">
    <header><span class="source-icon" aria-hidden="true">📱</span><div><h3>Phone access</h3><p class="source-tagline">${on ? 'Phones you pair can open Level Select while this computer is on and Level Select is open.' : 'Off. Nothing on your network can reach Level Select.'}</p></div><span class="source-state">${on ? running ? 'On' : 'Not running' : 'Off'}</span></header>
    ${on && !running ? `<p class="source-status"><span class="warn">${esc(status.error ?? 'Phone access couldn’t start.')}</span> Turn it off and on again, or restart Level Select.</p>` : ''}
    ${error ? `<p class="source-status"><span class="warn">${esc(error)}</span></p>` : ''}
    <div class="source-actions"><button type="button" data-action="${on ? 'disable' : 'enable'}"${busy ? ' disabled' : ''}${on ? '' : ' class="is-primary"'}>${on ? 'Turn off' : 'Turn on phone access'}</button></div>
  </section>`;
  const pair = on && running ? `<section class="source-card phone-pair">
    <header><span class="source-icon" aria-hidden="true">⌁</span><div><h3>Pair a phone</h3><p class="source-tagline">Scan with your phone’s camera, and open the link it shows.</p></div></header>
    ${!status.addresses.length ? '<p class="source-status"><span class="warn">This computer isn’t on a home network right now.</span> Connect it to your Wi-Fi (or Ethernet) to pair a phone.</p>'
      : pairing ? `<div class="phone-qr">${pairing.svg}</div>
        <p class="phone-expiry" id="phoneExpiry">Works once, for <strong>${left()}</strong> more.</p>
        <details class="phone-link"><summary>Can’t scan it?</summary><p>Open this link on your phone instead (it’s the same one-time code):</p><p><code>${esc(pairing.url)}</code></p></details>`
      : '<p class="source-status">Codes work once, for 10 minutes.</p>'}
    ${status.addresses.length ? `<div class="source-actions"><button type="button" data-action="pair"${busy ? ' disabled' : ''} class="is-primary">${pairing ? 'New code' : 'Show a code'}</button></div>` : ''}
  </section>` : '';
  const devices = on ? `<section class="source-card">
    <header><span class="source-icon" aria-hidden="true">✓</span><div><h3>Paired phones</h3><p class="source-tagline">Forget a phone you no longer use, and it can’t open Level Select again until you pair it anew.</p></div><span class="source-state">${status.devices.length}</span></header>
    ${status.devices.length ? `<ul class="phone-devices">${status.devices.map(device => `<li><div><strong>${esc(device.name)}</strong><small>Paired ${esc(when(device.pairedAt))} · last seen ${esc(ago(device.lastSeen))}</small></div><button type="button" data-forget="${esc(device.id)}"${busy ? ' disabled' : ''}>Forget</button></li>`).join('')}</ul>`
      : '<p class="source-status">No phones yet. Show a code and scan it.</p>'}
  </section>` : '';
  const help = `<section class="source-card phone-help">
    <header><span class="source-icon" aria-hidden="true">?</span><div><h3>Good to know</h3></div></header>
    <ul class="source-steps phone-notes">
      <li><span class="step-mark">1</span><span>Your phone and this computer need to be on the <strong>same Wi-Fi</strong>, with Level Select open here.</span></li>
      <li><span class="step-mark">2</span><span>The first time, this computer may ask whether to <strong>allow incoming connections</strong> (macOS) or to let it through the <strong>firewall on private networks</strong> (Windows). Allow it, or phones can’t connect.</span></li>
      <li><span class="step-mark">3</span><span>On the phone you can browse, get tonight’s picks and plan: your plan, progress and XP are the same on both. Importing, updating and adding games stay on this computer.</span></li>
      <li><span class="step-mark">4</span><span>Put it on your home screen: on iPhone, <strong>Share → Add to Home Screen</strong>; on Android, <strong>⋮ → Add to Home screen</strong>.</span></li>
    </ul>
  </section>`;
  body.innerHTML = `<section class="source-group"><header><h2>At home</h2><p>Over your home Wi-Fi, your phone uses Level Select on this computer, live: your plan and progress are the same on both.</p></header>
    <div class="source-grid phone-grid">${toggle}${pair}${devices}${help}</div></section>${away()}`;
}

// ---------- away from home: your copy
const cloudName = folder => copy.clouds.find(cloud => cloud.path === folder)?.name;
function away() {
  if (!copy) return '';
  const where = copy.folder ? `<p class="source-status">Kept in <strong>${esc(cloudName(copy.folder) ?? copy.folder)}</strong>, in a <strong>Level Select</strong> folder${copy.lastWritten ? `, updated ${esc(ago(copy.lastWritten))}` : ''}${copy.size ? ` · ${copy.size >= 1e6 ? `${(copy.size / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(copy.size / 1e3))} KB`}` : ''}.<br><small>Level Select updates it after every Update data, and a minute after your plan changes.</small></p>
      ${copy.error ? `<p class="source-status"><span class="warn">The copy couldn’t be written: ${esc(copy.error)}</span></p>` : ''}
      <div class="source-actions"><button type="button" data-copy="write"${busy ? ' disabled' : ''}>Update it now</button><button type="button" data-copy="stop"${busy ? ' disabled' : ''}>Stop keeping it there</button></div>`
    : `<p class="source-tagline">Pick a folder your phone can reach: one your cloud app keeps in sync.</p>
      ${copy.clouds.length ? `<div class="source-actions">${copy.clouds.map(cloud => `<button type="button" class="is-primary" data-cloud="${esc(cloud.path)}"${busy ? ' disabled' : ''}>${esc(cloud.name)}</button>`).join('')}</div>` : '<p class="source-status">No iCloud Drive, Google Drive, Dropbox or OneDrive folder found on this computer. Choose another folder, or download the copy.</p>'}
      <details class="phone-link"><summary>Another folder</summary><form class="source-form" data-folder><label>Folder (its full path)<input name="folder" autocomplete="off" spellcheck="false" placeholder="${navigator.platform.startsWith('Win') ? 'D:\\Sync' : '/Users/you/Sync'}"></label><button type="submit"${busy ? ' disabled' : ''}>Keep it there</button></form></details>`;
  const lock = copy.passphrase ? '<p class="source-status">Set. The copy is encrypted: your phone asks for the passphrase once.</p><div class="source-actions"><button type="button" data-copy="unlock"' + (busy ? ' disabled' : '') + '>Remove the passphrase</button></div>'
    : `<p class="source-status"><span class="warn">Not set.</span> Anyone who gets the file can read your library${copy.folder ? ', and your cloud company keeps a copy' : ''}.</p>`;
  const steps = guide === 'android'
    ? ['Scan this code with your phone, and open the link in <strong>Chrome</strong>.', 'Choose <strong>⋮ → Add to Home screen</strong> (or <strong>Install app</strong>).', 'Open <strong>Level Select</strong> from your home screen, then <strong>Your copy → Open your copy</strong>.', 'In the file picker, open <strong>Drive</strong> (or Dropbox, OneDrive) → <strong>Level Select</strong> → <strong>level-select-copy.json</strong>. Downloaded it instead? It’s in <strong>Downloads</strong>.', 'Type your passphrase. Next time, <strong>Open your copy</strong> again picks up the newer file.']
    : ['Scan this code with your iPhone’s camera, and open the link in <strong>Safari</strong>.', 'Tap <strong>Share → Add to Home Screen</strong>.', 'Open <strong>Level Select</strong> from your Home Screen, then <strong>Your copy → Open your copy</strong>.', 'In Files, go to <strong>iCloud Drive</strong> (or Google Drive, Dropbox, OneDrive under Browse) → <strong>Level Select</strong> → <strong>level-select-copy.json</strong>. AirDropped it instead? It’s in <strong>Downloads</strong>.', 'Type your passphrase. Next time, <strong>Open your copy</strong> again picks up the newer file.'];
  return `<section class="source-group"><header><h2>Away from home</h2><p>Take a copy of your library along: it works on your phone anywhere, even offline. It’s a file in your own cloud folder (or one you send yourself), opened by the Level Select phone app. No account, and nothing is uploaded to us.</p></header>
    ${copyError ? `<p class="source-status"><span class="warn">${esc(copyError)}</span></p>` : ''}
    <div class="source-grid phone-grid">
      <section class="source-card${copy.folder ? ' is-connected' : ''}"><header><span class="source-icon" aria-hidden="true">☁</span><div><h3>1 · Where your copy lives</h3></div><span class="source-state">${copy.folder ? 'Kept up to date' : 'Not set'}</span></header>${where}
        <p class="source-blocked">No cloud? <a href="/__retro_library/phone-copy/download" download>Download the copy</a> and AirDrop it, or send it to yourself.</p></section>
      <section class="source-card${copy.passphrase ? ' is-connected' : ''}"><header><span class="source-icon" aria-hidden="true">🔑</span><div><h3>2 · A passphrase</h3><p class="source-tagline">Encrypts the copy, so only you can open it. Saved on this computer only.</p></div><span class="source-state">${copy.passphrase ? 'Set' : 'Recommended'}</span></header>${lock}
        <form class="source-form" data-passphrase><label>${copy.passphrase ? 'New passphrase' : 'Passphrase'} (8 characters or more, or a few words)<input name="passphrase" type="password" autocomplete="new-password" minlength="8"></label><button type="submit"${busy ? ' disabled' : ''} class="is-primary">${copy.passphrase ? 'Change it' : 'Encrypt the copy'}</button></form></section>
      <section class="source-card phone-pair"><header><span class="source-icon" aria-hidden="true">📲</span><div><h3>3 · On your phone</h3><p class="source-tagline">Install the Level Select phone app, then open your copy in it.</p></div></header>
        <div class="phone-qr">${copy.app.svg}</div><p class="phone-expiry"><code>${esc(copy.app.url)}</code></p>
        <div class="phone-tabs" role="tablist">${['iphone', 'android'].map(id => `<button type="button" role="tab" aria-selected="${guide === id}" data-guide="${id}">${id === 'iphone' ? 'iPhone' : 'Android'}</button>`).join('')}</div>
        <ol class="source-steps">${steps.map(step => `<li><span class="step-mark"></span><span>${step}</span></li>`).join('')}</ol></section>
      <section class="source-card"><header><span class="source-icon" aria-hidden="true">⇄</span><div><h3>Changes on your phone</h3></div></header>
        <ul class="source-steps phone-notes">
          <li><span class="step-mark">✓</span><span>Each newer copy brings this computer’s plan to the phone. What you change on the phone stays there, and its finished games and rewards are never overwritten.</span></li>
          <li><span class="step-mark">↩</span><span>To bring the phone’s changes here: on the phone, <strong>Backup &amp; import → Export</strong> and save the file to your cloud folder; here, <strong>Backup &amp; import</strong> and choose that file.</span></li>
          <li><span class="step-mark">⌂</span><span>At home, phone access (above) shares changes live, with nothing to send.</span></li>
        </ul></section>
    </div></section>`;
}
async function copyApi(action, extra = {}) {
  const response = await fetch('/__retro_library/phone-copy', action ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Retro-Library': '1' }, body: JSON.stringify({ action, ...extra }) } : { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Something went wrong. Try again.');
  return data;
}
async function runCopy(work) {
  busy = true; copyError = ''; render();
  try { copy = await work(); } catch (failure) { copyError = failure.message; }
  busy = false; render();
}
body.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target, value = new FormData(form);
  if (form.matches('[data-folder]')) runCopy(() => copyApi('folder', { folder: String(value.get('folder')).trim() }));
  if (form.matches('[data-passphrase]')) runCopy(() => copyApi('passphrase', { passphrase: String(value.get('passphrase')) }));
});

async function run(work) {
  busy = true; error = ''; render();
  try { await work(); } catch (failure) { error = failure.message; }
  busy = false; render();
}
body.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action, forget = event.target.closest('[data-forget]')?.dataset.forget;
  if (action === 'enable') run(async () => { status = await api('enable'); if (status.running) pairing = await api('pair'); });
  else if (action === 'disable') run(async () => { status = await api('disable'); pairing = null; });
  else if (action === 'pair') run(async () => { pairing = await api('pair'); });
  else if (forget) run(async () => { status = await api('forget', { id: forget }); });
  const cloud = event.target.closest('[data-cloud]')?.dataset.cloud, act = event.target.closest('[data-copy]')?.dataset.copy, tab = event.target.closest('[data-guide]')?.dataset.guide;
  if (cloud) runCopy(() => copyApi('folder', { folder: cloud }));
  else if (act === 'write') runCopy(() => copyApi('write'));
  else if (act === 'stop') runCopy(() => copyApi('folder', { folder: null }));
  else if (act === 'unlock' && confirm('Remove the passphrase? The copy is then written without encryption.')) runCopy(() => copyApi('passphrase', { passphrase: null }));
  else if (tab) { guide = tab; render(); }
});

// The countdown every second, and every few seconds a fresh look at paired phones (a phone
// appears as soon as it pairs, and its code is put away).
let tick = 0;
setInterval(async () => {
  if (pairing && Date.parse(pairing.expiresAt) <= Date.now()) { pairing = null; render(); }
  else if (pairing) { const node = $('phoneExpiry'); if (node) node.innerHTML = `Works once, for <strong>${left()}</strong> more.`; }
  if (copyApp() || ++tick % 5 || document.visibilityState !== 'visible' || busy) return;
  copyApi().then(next => { if (JSON.stringify(next) !== JSON.stringify(copy)) { copy = next; render(); } }).catch(() => {});
  try {
    const next = await api();
    const paired = next.devices.length > (status?.devices.length ?? 0);
    if (JSON.stringify(next) !== JSON.stringify(status)) { status = next; if (paired) pairing = null; render(); }
  } catch {}
}, 1000);

if (copyApp()) { const { mountCopyApp } = await import('./copy-app.js'); await mountCopyApp(body); }
else {
  try {
    [status, copy] = await Promise.all([api(), copyApi().catch(() => null)]);
    if (status.enabled && status.running && status.addresses.length) pairing = await api('pair');
    render();
  } catch { body.innerHTML = '<p class="source-blocked">Phone access works in the Level Select app on your computer.</p>'; }
}
pageReady();

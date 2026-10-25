// Import games: connect Steam, GOG Galaxy, Playnite, ES-DE and ROM folders, with
// step-by-step instructions on each card. Talks to the local server (scripts/sources-api.mjs).
import { escapeHtml as esc, demoHome, demoNote, onPhone, phoneNote } from '../lib.js';
import { mountProgress } from './update-progress.js';
import { pageReady } from '../navigation.js';

const $ = id => document.getElementById(id);
const HEADERS = { 'X-Retro-Library': '1' };
const when = iso => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
const n = value => Number(value ?? 0).toLocaleString();
const SYSTEM_NAMES = { ps1: 'PS1', ps2: 'PS2', psp: 'PSP', snes: 'SNES', nes: 'NES', n64: 'N64', gc: 'GameCube', wii: 'Wii', wiiu: 'Wii U', gb: 'Game Boy', gbc: 'GB Color', gba: 'GBA', ds: 'DS', '3ds': '3DS', md: 'Mega Drive', ms: 'Master System', gg: 'Game Gear', saturn: 'Saturn', dc: 'Dreamcast', amiga: 'Amiga' };
let state = null, busy = null;
const windows = () => state?.platform === 'win32';
// The demo and a paired phone have no app updates to follow (see render): the box would only wait.
if (demoHome() || onPhone()) $('sourcesSync').hidden = true;
const progress = demoHome() || onPhone() ? { destroy() {}, refresh() {} } : mountProgress($('sourcesSync'));
const messages = {};

async function request(url, options) {
  let response;
  try { response = await fetch(url, options); }
  catch { throw new Error('The local Level Select server isn’t running. Open the Level Select app (or run npm run dev) and try again.'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong. Try again.');
  return body;
}
const api = (action, body = {}) => request('/__retro_library/sources', { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
const upload = (kind, file) => request(`/__retro_library/upload?kind=${kind}`, { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/octet-stream' }, body: file });

// ---------- building blocks ----------
const step = (done, html) => `<li class="${done ? 'is-done' : ''}"><span class="step-mark" aria-hidden="true">${done ? '✓' : ''}</span><div>${html}</div></li>`;
const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`;
const button = (action, label, { primary = false, data = '', disabled = false } = {}) =>
  `<button type="button" class="${primary ? 'is-primary' : ''}" data-action="${action}"${data}${disabled || busy ? ' disabled' : ''}>${busy === action ? 'Working…' : label}</button>`;
const dropZone = (kind, label, accept) => `<label class="drop-zone" data-drop="${kind}"><input type="file" data-upload="${kind}" accept="${accept}"><span class="drop-icon" aria-hidden="true">⇪</span><span><strong>${label}</strong><small>Drop the file here, or click to choose it.</small></span></label>`;
// "How did Level Select find this?": the file it read, what it took from it, and that it
// never changes it.
const howFound = (file, text) => `<details class="source-how"><summary>How did Level Select find this?</summary><p>${text}</p>${file ? `<p class="source-path"><code>${esc(file)}</code></p>` : ''}</details>`;
function card({ id, icon, title, tagline, status, connected, body, label }) {
  return `<article class="source-card${connected ? ' is-connected' : ''}" id="card-${id}">
    <header><span class="source-icon" aria-hidden="true">${icon}</span><div><h3>${title}</h3>${tagline ? `<p class="source-tagline">${tagline}</p>` : ''}</div>
      <span class="source-state">${label ?? (connected ? 'Connected' : 'Not connected')}</span></header>
    ${status ? `<p class="source-status">${status}</p>` : ''}
    ${body}
    <p class="source-message" role="status">${esc(messages[id] ?? '')}</p>
  </article>`;
}

// ---------- Steam ----------
function steamCards(steam) {
  const account = steam.account, wishlist = steam.wishlist, owned = steam.owned;
  const detected = steam.accounts.filter(found => found.steamId !== account?.steamId);
  const accountCard = card({ id: 'steam-account', icon: '👤', title: 'Step 1 · Your Steam account', connected: Boolean(account),
    tagline: 'Which Steam profile to read. Nothing is posted to it.',
    status: account ? `Connected as <strong>${esc(account.persona)}</strong> <small>(${esc(account.steamId)})</small>${account.public === false ? ' · <span class="warn">profile is private, see step 2 below</span>' : ''}` : '',
    body: `${detected.length ? `<div class="source-found"><p>Found on this computer:</p><div class="source-actions">${detected.map(user => button('steam-account', `Use ${esc(user.persona)}`, { primary: !account, data: ` data-input="${esc(user.steamId)}"` })).join('')}</div></div>` : ''}
      ${steam.file ? howFound(steam.file, 'Steam keeps a list of the accounts that have signed in on this computer. Level Select reads only the account names and Steam IDs from it. There are no passwords or sign-in tokens in that file, and it’s never changed.') : ''}
      <details class="source-more"${account || detected.length ? '' : ' open'}><summary>${account ? 'Use a different account' : detected.length ? 'Or paste a profile link' : 'Connect with your profile link'}</summary>
        <ol class="source-steps">${step(false, 'Open Steam and click your account name at the top, then <strong>Profile</strong>.')}
          ${step(false, 'Copy the page’s address. In the Steam app: right-click anywhere on the page → <strong>Copy Page URL</strong>. In a browser: copy it from the address bar. It looks like <code>steamcommunity.com/id/yourname</code>.')}
          ${step(false, 'Paste it here and choose <strong>Connect</strong>. Your wishlist link or 17-digit Steam ID work too.')}</ol>
        <form class="source-form" data-form="steam-account"><label>Steam profile link<input name="input" placeholder="https://steamcommunity.com/id/yourname" autocomplete="off" required></label>${button('submit-steam-account', 'Connect', { primary: true }).replace('type="button"', 'type="submit"')}</form>
      </details>` });

  const needsAccount = !account ? '<p class="source-blocked">Connect your Steam account first (step 1).</p>' : '';
  const wishlistCard = card({ id: 'steam-wishlist', icon: '☆', title: 'Step 2 · Wishlist', connected: Boolean(wishlist),
    tagline: 'Your Steam wishlist with prices, release dates and reviews. No browser extension or export needed.',
    status: wishlist ? `<strong>${n(wishlist.count)} games</strong> · synced ${esc(when(wishlist.syncedAt))}. <strong>Update data</strong> keeps it current.` : '',
    body: `${needsAccount}<ol class="source-steps">
      ${step(Boolean(wishlist || owned), 'Make your game details public, or Steam keeps the wishlist private: in Steam, open your <strong>Profile → Edit Profile → Privacy Settings</strong> and set <strong>Game details</strong> to <strong>Public</strong>. (Your wishlist follows that setting.)')}
      ${step(Boolean(wishlist), 'Choose <strong>Import wishlist</strong>. It takes a few seconds.')}
      ${step(Boolean(wishlist), 'That’s it: every <strong>Update data</strong> refreshes your wishlist and its prices.')}</ol>
      <div class="source-actions">${button('steam-wishlist', wishlist ? 'Sync now' : 'Import wishlist', { primary: !wishlist, disabled: !account })}${wishlist ? button('steam-disconnect', 'Stop syncing', { data: ' data-part="wishlist"' }) : ''}</div>
      <details class="source-more"><summary>Prefer a file instead?</summary><p class="data-note">A wishlist exported with the Augmented Steam browser extension (JSON) works too.</p>${dropZone('wishlist', 'Upload a wishlist file', '.json,application/json')}</details>` });

  const ownedCard = card({ id: 'steam-owned', icon: '🔑', title: 'Step 3 · Games you own (Web API key)', connected: Boolean(owned && steam.hasKey),
    tagline: 'Steam only shares the list of games you own with a personal key. It’s free and takes about a minute. (Using GOG Galaxy below? It needs no key.)',
    status: owned && steam.hasKey ? `<strong>${n(owned.count)} games</strong> with play time · synced ${esc(when(owned.syncedAt))}.` : '',
    body: `${needsAccount}<ol class="source-steps">
      ${step(steam.hasKey, `Open ${link('https://steamcommunity.com/dev/apikey', 'steamcommunity.com/dev/apikey')} and sign in with your Steam account. Steam may ask you to confirm in the Steam Mobile app.`)}
      ${step(steam.hasKey, 'In <strong>Domain Name</strong>, type <code>localhost</code> (Steam asks every key for one; Level Select doesn’t use it). Tick the agreement and choose <strong>Register</strong>.')}
      ${step(steam.hasKey, 'Copy the <strong>Key</strong>: 32 letters and numbers.')}
      ${step(Boolean(wishlist || owned), 'Check <strong>Game details</strong> are <strong>Public</strong> (the same setting as the wishlist, step 2).')}
      ${step(steam.hasKey, 'Paste the key here and choose <strong>Connect</strong>.')}</ol>
      ${steam.hasKey ? `<div class="source-actions">${button('steam-key', 'Sync now', { disabled: !account })}${button('steam-disconnect', 'Forget key', { data: ' data-part="owned"' })}</div>`
        : `<form class="source-form" data-form="steam-key"><label>Steam Web API key<input name="key" type="password" placeholder="32 letters and numbers" autocomplete="off" spellcheck="false" required${account ? '' : ' disabled'}></label>${button('submit-steam-key', 'Connect', { primary: true, disabled: !account }).replace('type="button"', 'type="submit"')}</form>`}
      <p class="data-note">🔒 The key is saved only on this computer (<code>library/data/secrets.json</code>), never shown again and never included in backups. <strong>Forget key</strong> removes it; you can also revoke it on the same Steam page.</p>` });
  // Installed games need no account or key, and bring Family Sharing games too.
  const installed = steam.installed ?? { folders: [] }, here = installed.connected;
  const installedCard = card({ id: 'steam-installed', icon: '💾', title: 'Installed on this computer', connected: Boolean(here),
    tagline: 'The Steam games installed here, on any drive, including Family Sharing games someone shares with you. Steam leaves those out of the games you own. No key needed.',
    status: here ? `<strong>${n(here.count)} games</strong>${here.shared ? `, ${n(here.shared)} shared with you through Family Sharing` : ''} · synced ${esc(when(here.syncedAt))}.`
      : installed.folders.length ? `Found Steam on this computer${installed.folders.length > 1 ? `, with games in ${installed.folders.length} folders` : ''}.` : '',
    body: installed.folders.length || here ? `<div class="source-actions">${button('steam-installed', here ? 'Sync now' : 'Import installed games', { primary: !here })}${here ? button('steam-installed-disconnect', 'Disconnect') : ''}</div>
      ${installed.folders.length ? howFound(installed.folders.join(' · '), 'Steam lists its game folders (one per drive) and keeps a small file for each installed game. Level Select reads each game’s id and name, when you last played it, and whether your account or a family member’s installed it. It never changes them.') : ''}
      <p class="data-note">Only installed games: Steam doesn’t show other apps a family member’s whole library. A game you own appears once, whichever source has it.</p>`
      : '<p class="source-blocked">Steam isn’t installed on this computer.</p>' });
  return accountCard + wishlistCard + ownedCard + installedCard;
}

// ---------- GOG Galaxy and Playnite ----------
function launcherCards(galaxy, playnite) {
  const connected = galaxy.connected, found = galaxy.found.find(file => !file.replace(/\\/g, '/').endsWith('library/data/sources/galaxy-2.0.db'));
  const stores = connected?.stores ? Object.entries(connected.stores).sort((a, b) => b[1] - a[1]).map(([store, count]) => `${esc(store)} ${n(count)}`).join(' · ') : '';
  const galaxyCard = card({ id: 'galaxy', icon: '🌌', title: 'GOG Galaxy', connected: Boolean(connected),
    tagline: 'Galaxy brings Steam, Epic, GOG, EA, Ubisoft, Xbox, PlayStation and more into one library. If you use it, this is the quickest way to bring in your whole PC library, with no keys.',
    status: connected ? `<strong>${n(connected.count)} games</strong>${stores ? ` (${stores})` : ''} · synced ${esc(when(connected.syncedAt))}${connected.uploaded ? ' · from an uploaded file' : ''}.` : found ? 'Found GOG Galaxy’s library on this computer.' : '',
    body: `<ol class="source-steps">
      ${step(Boolean(found || connected), `Install ${link('https://www.gog.com/galaxy', 'GOG Galaxy 2.0')} and sign in.`)}
      ${step(Boolean(connected), 'In Galaxy, open <strong>Settings (gear) → Integrations</strong> and connect the stores you use. Wait until your library has finished syncing.')}
      ${step(Boolean(connected), found ? 'Choose <strong>Import from GOG Galaxy</strong>.' : 'Galaxy isn’t on this computer: upload its library file below.')}</ol>
      <div class="source-actions">${found || connected ? button('galaxy', connected ? 'Sync now' : 'Import from GOG Galaxy', { primary: !connected }) : ''}${connected ? button('galaxy-disconnect', 'Disconnect') : ''}</div>
      <details class="source-more"${found || connected ? '' : ' open'}><summary>Galaxy is on another computer?</summary>
        <ol class="source-steps">${step(false, 'On that computer, quit GOG Galaxy (right-click its icon → Quit).')}
          ${step(false, 'Copy the file <code>galaxy-2.0.db</code>. On Windows it’s in <code>C:\\ProgramData\\GOG.com\\Galaxy\\storage</code> (paste that into File Explorer’s address bar). On a Mac it’s in <code>/Users/Shared/GOG.com/Galaxy/Storage</code>.')}
          ${step(false, 'Upload it here. Upload it again whenever you’d like to refresh.')}</ol>
        ${dropZone('galaxy', 'Upload galaxy-2.0.db', '.db')}</details>
      ${found ? howFound(found, 'GOG Galaxy keeps your whole library, including the stores you linked in it, in this database file. Level Select copies it to a temporary folder and reads the copy, so Galaxy can stay open and is never changed.') : ''}
      <p class="data-note">Galaxy only knows play time for games you started from Galaxy. Games you also have in Playnite appear once.</p>` });

  const csv = playnite.file;
  const playniteCard = card({ id: 'playnite', icon: '🎮', title: 'Playnite', connected: Boolean(csv),
    tagline: 'Organise everything in Playnite on Windows? Bring its library, including emulated games, play time and Playnite’s artwork.',
    status: csv ? `Library export saved ${esc(when(csv.modified))}. Drop a newer export any time.` : playnite.found?.length ? 'Found Playnite on this computer. Export its library (below) to bring your games in.' : '',
    body: `<ol class="source-steps">
      ${step(Boolean(csv), 'In Playnite, open the main menu (☰) → <strong>Add-ons… → Browse</strong>, search for <strong>Library Exporter Advanced</strong>, install it and restart Playnite.')}
      ${step(Boolean(csv), 'Main menu → <strong>Extensions → Library Exporter Advanced → Open export window</strong>.')}
      ${step(Boolean(csv), 'Export as <strong>CSV</strong> with at least <strong>Id, Name, Platforms</strong> and <strong>Sources</strong>. For the best results add Game Id, Release Date, Developers, Publishers, Genres, Description, Play Count and Time Played.')}
      ${step(Boolean(csv), 'Drop the CSV file below. Next time, export again and drop the new file the same way.')}</ol>
      ${dropZone('playnite', csv ? 'Upload a newer Playnite export' : 'Upload your Playnite export (CSV)', '.csv,text/csv')}
      ${csv ? `<div class="source-actions">${button('playnite-disconnect', 'Remove Playnite library')}</div>` : ''}
      <p class="data-note">Using Playnite and GOG Galaxy together is fine: a game you own in the same store appears once (Playnite’s copy wins).</p>` });
  return galaxyCard + playniteCard;
}

// ---------- ROMs ----------
function romCards(esde, folders, esdeRomDirectory, esdeRomsAvailable) {
  const connected = esde.connected, found = esde.found[0];
  const systems = connected?.systems ? Object.entries(connected.systems).sort((a, b) => b[1] - a[1]).map(([system, count]) => `${esc(SYSTEM_NAMES[system] ?? system.toUpperCase())} ${n(count)}`).join(' · ') : '';
  const romFolderAdded = esdeRomDirectory && folders.includes(esdeRomDirectory);
  const esdeCard = card({ id: 'esde', icon: '🕹️', title: 'ES-DE (EmulationStation)', connected: Boolean(connected),
    tagline: 'Play your ROMs through ES-DE? Bring in the names, descriptions and box art it already scraped, even when your ROM drive is unplugged.',
    status: connected ? `<strong>${n(connected.count)} games</strong>${connected.files > connected.count ? ` (${n(connected.files)} files)` : ''} on ${n(Object.keys(connected.systems ?? {}).length)} systems${systems ? ` (${systems})` : ''} · synced ${esc(when(connected.syncedAt))}.` : found ? `Found ES-DE in <code>${esc(found)}</code>.` : '',
    body: `<ol class="source-steps">
      ${step(Boolean(connected), 'In ES-DE, scrape your games if you haven’t: <strong>Main menu → Scraper → Start</strong>. (Games that show box art in ES-DE are already scraped.)')}
      ${step(Boolean(connected), found ? 'Choose <strong>Import from ES-DE</strong>.' : `Choose <strong>Find ES-DE folder</strong> and pick the <code>ES-DE</code> folder ${windows() ? 'in your user folder, or the <code>ES-DE</code> folder inside the one you unpacked ES-DE to (the portable release)' : 'in your home folder'}.`)}
      ${step(romFolderAdded, `Optional: also scan ES-DE’s ROM folder${esdeRomDirectory ? ` (<code>${esc(esdeRomDirectory)}</code>)` : ''} to add games ES-DE hasn’t scraped.${esdeRomDirectory && !esdeRomsAvailable ? ' Connect that drive first.' : ''}`)}</ol>
      <div class="source-actions">${found || connected ? button('esde', connected ? 'Sync now' : 'Import from ES-DE', { primary: !connected }) : button('esde-pick', 'Find ES-DE folder', { primary: true })}
        ${connected && esdeRomsAvailable && !romFolderAdded ? button('rom-add-esde', 'Scan ES-DE’s ROM folder too') : ''}${connected ? button('esde-disconnect', 'Disconnect') : ''}</div>
      ${found ? howFound(found, `ES-DE keeps a game list for each system (<code>gamelists/&lt;system&gt;/gamelist.xml</code>) and the box art it downloaded (<code>downloaded_media</code>) in this folder, and its settings say where your ROMs are. Level Select reads those files and never edits them.`) : ''}
      <p class="data-note">Play counts and favourites come along once ES-DE has recorded them. A game that’s also in your Playnite library appears once.</p>` });

  const foldersCard = card({ id: 'roms', icon: '📁', title: 'ROM folders', connected: folders.length > 0,
    tagline: 'No ES-DE? Point Level Select at the folders where your ROMs are. Games are recognised by file name; nothing is uploaded, copied or changed.',
    status: folders.length ? `${n(folders.length)} folder${folders.length === 1 ? '' : 's'} scanned.` : '',
    body: `<ol class="source-steps">
      ${step(folders.length > 0, 'Choose <strong>Choose folder</strong> and pick the folder with your ROMs (subfolders are included), or paste its full path.')}
      ${step(false, 'Name files like <code>Super Metroid (USA).sfc</code>. Disc images and zips (<code>.iso .chd .cue .zip</code>…) need to sit in a folder named after their system, like <code>PS1</code>, <code>Mega Drive</code> or <code>Dreamcast</code>.')}
      ${step(false, 'Added games later? Choose <strong>Rescan</strong>, or just <strong>Update data</strong>.')}</ol>
      <ul class="source-folders">${folders.map(folder => `<li><code>${esc(folder)}</code><button type="button" class="text-button" data-action="rom-remove" data-folder="${esc(folder)}">Remove</button></li>`).join('')}</ul>
      <div class="source-actions">${button('rom-pick', 'Choose folder…', { primary: !folders.length })}${folders.length ? button('rom-scan', 'Rescan') : ''}</div>
      <form class="source-form" data-form="rom-add"><label>Or paste a folder’s full path<input name="folder" placeholder="${windows() ? 'D:\\Games\\ROMs' : '/Users/you/ROMs'}" autocomplete="off" required></label>${button('submit-rom-add', 'Add & scan').replace('type="button"', 'type="submit"')}</form>` });
  return esdeCard + foldersCard;
}

// ---------- Scores: your own IGDB and VideoGamesCritic keys ----------
const secretNote = service => `<p class="data-note">🔒 Saved only on this computer (<code>library/data/secrets.json</code>), never shown again and never in backups. Only game names and ids go to ${service}.</p>`;
function scoreCards(scores = {}) {
  const igdb = scores.igdb, vgc = scores.vgc, last = scores.vgcLastRun, waiting = last && !last.keyed ? last.waiting : 0;
  const igdbSteps = `<ol class="source-steps">
      ${step(false, `Sign in at ${link('https://dev.twitch.tv/console', 'dev.twitch.tv/console')} with a Twitch account (IGDB belongs to Twitch). No account? ${link('https://www.twitch.tv/signup', 'Make one')}: it’s free.`)}
      ${step(false, `Twitch asks for two-factor sign-in before it gives out keys: open ${link('https://www.twitch.tv/settings/security', 'twitch.tv → Settings → Security and Privacy')}, choose <strong>Set Up Two-Factor Authentication</strong> and follow the steps (your phone number or an authenticator app).`)}
      ${step(false, 'Back in the console, open <strong>Applications → Register Your Application</strong> and fill in: <strong>Name</strong> something only you would use, like <code>Level Select – yournickname</code> · <strong>OAuth Redirect URLs</strong> <code>http://localhost</code> (then <strong>Add</strong>) · <strong>Category</strong> Application Integration · <strong>Client Type</strong> Confidential. Choose <strong>Create</strong>.')}
      ${step(false, 'Choose <strong>Manage</strong> next to the new application. Copy the <strong>Client ID</strong>, then choose <strong>New Secret</strong> and copy the <strong>Client Secret</strong>: Twitch shows it only once.')}
      ${step(false, 'Paste both here and choose <strong>Connect</strong>. Level Select checks them with Twitch, then fetches scores for your games.')}</ol>`;
  const igdbCard = card({ id: 'igdb', icon: '★', title: 'IGDB scores for your games', connected: Boolean(igdb),
    tagline: 'Critic and player ratings and time to beat for the games you own, from IGDB, the biggest games database. It’s free, but each person needs their own key: about five minutes, once.',
    status: igdb === 'saved' ? 'Your keys are saved. <strong>Update data</strong> fetches scores for new games.' : igdb === 'environment' ? 'Using IGDB keys from the environment (IGDB_CLIENT_ID and IGDB_CLIENT_SECRET).' : '',
    body: `${igdb ? `<details class="source-more"><summary>How these keys are made</summary>${igdbSteps}</details>` : igdbSteps}
      ${igdb === 'saved' ? `<div class="source-actions">${button('igdb-forget', 'Forget keys')}</div>`
        : igdb ? '' : `<form class="source-form" data-form="igdb-keys"><label>Client ID<input name="clientId" autocomplete="off" spellcheck="false" required></label><label>Client Secret<input name="clientSecret" type="password" autocomplete="off" spellcheck="false" required></label>${button('submit-igdb-keys', 'Connect', { primary: true }).replace('type="button"', 'type="submit"')}</form>`}
      ${secretNote('IGDB')}` });
  const vgcSteps = `<ol class="source-steps">
      ${step(false, `Open ${link('https://videogamescritic.com/developers', 'videogamescritic.com/developers')} and choose <strong>Get a free key</strong>.`)}
      ${step(false, 'In <strong>What is it for?</strong>, write something like <em>Level Select, my game library</em>. The contact address is optional (they use it only for outage notices).')}
      ${step(false, 'Copy the key (it starts with <code>vgc_</code>), paste it here and choose <strong>Connect</strong>.')}</ol>`;
  const vgcCard = card({ id: 'vgc', icon: '◎', title: 'VideoGamesCritic scores', connected: Boolean(vgc), label: vgc ? 'Free key' : 'No key needed',
    tagline: 'The VGC Score (critics and Steam players, kept current after patches) for your Steam games and wishlist. It works without a key at 60 lookups an hour; a free key allows 5,000 a day.',
    status: vgc === 'environment' ? 'Using the key from the environment (VGC_API_KEY): 5,000 lookups a day.' : vgc ? 'Using your free key: 5,000 lookups a day.' : waiting ? `<strong>${n(waiting)} games</strong> are waiting for a VGC score. Without a key that’s about ${n(Math.ceil(waiting / 55))} more updates, an hour apart; with a free key, the next update does them all.` : scores.vgcGames ? `${n(scores.vgcGames)} of your games have a VGC score.` : '',
    body: `${vgc ? `<details class="source-more"><summary>How the key is made</summary>${vgcSteps}</details>` : `<details class="source-more"${waiting > 55 ? ' open' : ''}><summary>Get a free key (two minutes)</summary>${vgcSteps}</details>`}
      ${vgc === 'saved' ? `<div class="source-actions">${button('vgc-forget', 'Forget key')}</div>`
        : vgc ? '' : `<form class="source-form" data-form="vgc-key"><label>VideoGamesCritic key<input name="key" type="password" placeholder="vgc_…" autocomplete="off" spellcheck="false" required></label>${button('submit-vgc-key', 'Connect', { primary: true }).replace('type="button"', 'type="submit"')}</form>`}
      ${secretNote('VideoGamesCritic')}<p class="data-note">Wherever a VGC number appears, Level Select says “Powered by VideoGamesCritic” and links to the game, as their terms ask.</p>` });
  return igdbCard + vgcCard;
}

// ---------- Python (a Mac without it) ----------
// Level Select builds your library with Python. The Windows installer brings its own; a Mac
// needs it installed once. Shown only when it's missing.
function pythonCard() {
  if (state.python !== false) return '';
  const mac = state.platform === 'darwin';
  const body = mac ? `<ol class="source-steps">
      ${step(false, `Open ${link('https://www.python.org/downloads/', 'python.org/downloads')} and choose the yellow <strong>Download Python 3…</strong> button. The site picks the Mac version for you.`)}
      ${step(false, 'Open the file you downloaded (it ends in <code>.pkg</code> and is in your <strong>Downloads</strong> folder). Choose <strong>Continue</strong> and <strong>Agree</strong>, then <strong>Install</strong>, and enter your Mac’s password when asked.')}
      ${step(false, 'When it says the installation was successful, close the installer (it’s fine to delete it) and choose <strong>Check again</strong> below.')}</ol>
      <details class="source-more"><summary>Other ways to install it</summary>
        <p class="data-note"><strong>Apple’s developer tools</strong> include Python too (a bigger download): open <strong>Terminal</strong> (Applications → Utilities), type <code>xcode-select --install</code>, press Return and choose <strong>Install</strong>.</p>
        <p class="data-note"><strong>Homebrew</strong> users: <code>brew install python</code>.</p></details>`
    : `<ol class="source-steps">${step(false, state.platform === 'win32'
      ? `Install Python 3 from ${link('https://www.python.org/downloads/', 'python.org/downloads')} and tick <strong>Add python.exe to PATH</strong> on the installer’s first screen. (The Level Select installer includes Python; this is only for a copy run from its project folder.)`
      : 'Install Python 3 with your system’s package manager, for example <code>sudo apt install python3</code>.')}
      ${step(false, 'Choose <strong>Check again</strong> below.')}</ol>`;
  return `<section id="python" class="source-group"><header><h2>One more thing</h2><p>Do this once before importing: it takes about two minutes.</p></header><div class="source-grid">${card({ id: 'python', icon: '🐍', title: mac ? 'Python 3 · a one-time install on your Mac' : 'Python 3',
    tagline: mac ? 'Level Select uses Python, a free tool, to turn the games you import into your library. Macs don’t come with it.' : 'Level Select uses Python, a free tool, to turn the games you import into your library.',
    label: 'Not installed', status: '<span class="warn">Not installed yet.</span>',
    body: `${body}<div class="source-actions">${button('python-check', 'Check again', { primary: true })}</div>` })}</div></section>`;
}

// ---------- By hand ----------
function handCard(count) {
  return card({ id: 'by-hand', icon: '✍️', title: 'Add games by hand', connected: count > 0, label: count ? `${n(count)} added` : 'None yet',
    tagline: 'Cartridges and discs on your shelf, Switch or PlayStation games, a game from a store Level Select can’t read: search for it, check the details and add it, with your own cover picture if you like.',
    body: `<ol class="source-steps">${step(count > 0, 'Choose <strong>Add a game</strong> (or <strong>+ Add game</strong> at the top of your Library) and type its title.')}
      ${step(count > 0, 'Pick the right game and the platform you own it on, and say whether it’s a physical copy or which store it’s from.')}
      ${step(count > 0, 'Choose <strong>Add to library</strong>. To change or remove it later, open it in your Library and choose <strong>Edit</strong>.')}</ol>
      <div class="source-actions">${button('add-game', 'Add a game', { primary: true })}</div>
      <p class="data-note">Search covers the Game Atlas, and IGDB once your IGDB keys are set (Scores, below); without them, Steam’s store. Games you add stay on this computer, in <code>library/data/manual-games.json</code>.</p>` });
}

async function render() {
  if (demoHome()) { $('sourcesBody').innerHTML = `<p class="source-blocked">${demoNote('Importing your games')} It reads Steam, GOG Galaxy (with Epic, Xbox, PlayStation and more), Playnite, ES-DE and your ROM folders, all on your own computer.</p>`; return; }
  if (onPhone()) { $('sourcesBody').innerHTML = `<p class="source-blocked">${esc(phoneNote('Importing games'))}</p>`; return; }
  try { state = await request('/__retro_library/sources'); }
  catch (error) { $('sourcesBody').innerHTML = `<p class="source-blocked">${esc(error.message)}</p>`; return; }
  $('sourcesBody').innerHTML = `${pythonCard()}
    <section id="steam" class="source-group"><header><h2>Steam</h2><p>Three short steps for your account, plus the games installed on this computer. Already use GOG Galaxy? It covers your Steam games too, but the wishlist only comes from here.</p></header><div class="source-grid">${steamCards(state.steam)}</div></section>
    <section id="launchers" class="source-group"><header><h2>GOG Galaxy &amp; Playnite</h2><p>Your whole PC library (and linked consoles) from an app you may already use. Pick either, or both.</p></header><div class="source-grid">${launcherCards(state.galaxy, state.playnite)}</div></section>
    <section id="roms" class="source-group"><header><h2>ROMs</h2><p>Retro games you play on emulators. Use ES-DE’s game lists, folders on your drive, or both.</p></header><div class="source-grid">${romCards(state.esde, state.romFolders ?? [], state.esdeRomDirectory, state.esdeRomsAvailable)}</div></section>
    <section id="by-hand" class="source-group"><header><h2>By hand</h2><p>Physical copies, consoles no import reaches, or anything else you own.</p></header><div class="source-grid">${handCard(state.manualGames ?? 0)}</div></section>
    <section id="scores" class="source-group"><header><h2>Scores for your games</h2><p>The Game Atlas comes with its scores, and Steam reviews need nothing. These two add scores for more of the games you own.</p></header><div class="source-grid">${scoreCards(state.scores)}</div></section>`;
}

// ---------- actions ----------
async function run(id, action, work) {
  busy = action; messages[id] = ''; await render();
  try {
    const result = await work();
    messages[id] = describe(action, result);
    if (result?.update) progress.refresh();
  } catch (error) { messages[id] = error.message; }
  busy = null; await render();
}
function describe(action, result) {
  const updating = result?.update === 'started' || result?.update === 'queued' ? ' Updating your library now; see the progress at the top.' : '';
  if (action === 'steam-account') return `Connected as ${result.account.persona}.${result.account.public ? '' : ' This profile is private, so make game details public (step 2).'}`;
  if (action === 'steam-wishlist') return `Imported ${n(result.count)} wishlist games.${updating}`;
  if (action === 'steam-key') return `Found ${n(result.count)} games you own on Steam.${updating}`;
  if (action === 'steam-installed') return `Found ${n(result.count)} installed games${result.shared ? `, ${n(result.shared)} of them shared with you through Family Sharing` : ''}.${updating}`;
  if (action === 'galaxy') return `Imported ${n(result.count)} games from GOG Galaxy.${updating}`;
  if (action === 'esde') return `Imported ${n(result.count)} games from ES-DE${result.romsAvailable === false ? ' (its ROM drive isn’t connected, which is fine)' : ''}.${updating}`;
  if (action.startsWith('rom-')) return result.message ?? `Found ${n(result.games)} games${result.unrecognised ? `; ${n(result.unrecognised)} disc images or zips need a folder named after their system` : ''}${result.missing?.length ? `; not available right now: ${result.missing.join(', ')}` : ''}.${updating}`;
  if (action === 'python-check') return result.message;
  if (action === 'igdb-keys') return `Connected: Twitch accepted your keys.${updating.replace('Updating your library', 'Fetching IGDB scores for your games')}`;
  if (action === 'vgc-key') return `Connected: 5,000 lookups a day.${updating.replace('Updating your library', 'Fetching VGC scores')}`;
  if (action === 'igdb-forget' || action === 'vgc-forget') return 'Forgotten. Scores already fetched stay.';
  if (action.startsWith('upload-')) return result.count != null ? `Imported ${n(result.count)} games.${updating}` : `Saved.${updating}`;
  if (action.endsWith('disconnect')) return `Disconnected.${updating}`;
  return 'Done.';
}
const pick = async prompt => (await api('pick-folder', { prompt })).path;

document.addEventListener('click', async event => {
  const control = event.target.closest('[data-action]'); if (!control || control.disabled) return;
  const action = control.dataset.action, cardId = control.closest('.source-card')?.id.replace(/^card-/, '');
  if (action.startsWith('submit-')) return;
  if (action === 'add-game') { location.href = 'index.html#add-game'; return; }
  if (action === 'steam-disconnect' && control.dataset.part === 'owned' && !confirm('Forget your Steam Web API key and the games it found? Games from other sources stay.')) return;
  if (action === 'igdb-forget' && !confirm('Forget your IGDB keys? Scores already fetched stay. You can delete the application on dev.twitch.tv too.')) return;
  if (action === 'vgc-forget' && !confirm('Forget your VideoGamesCritic key? Scores already fetched stay, and lookups go back to 60 an hour.')) return;
  if (['steam-installed-disconnect', 'galaxy-disconnect', 'playnite-disconnect', 'esde-disconnect'].includes(action) && !confirm('Disconnect this source? Its games leave your library at the next update; your play history and notes are kept.')) return;
  const work = {
    'steam-account': () => api('steam-account', { input: control.dataset.input }),
    'steam-wishlist': () => api('steam-wishlist'), 'steam-key': () => api('steam-key'),
    'steam-disconnect': () => api('steam-disconnect', { part: control.dataset.part }),
    'steam-installed': () => api('steam-installed'), 'steam-installed-disconnect': () => api('steam-installed-disconnect'),
    galaxy: () => api('galaxy'), 'galaxy-disconnect': () => api('galaxy-disconnect'), 'playnite-disconnect': () => api('playnite-disconnect'),
    esde: () => api('esde'), 'esde-disconnect': () => api('esde-disconnect'),
    'esde-pick': async () => api('esde', { path: await pick(windows() ? 'Choose the ES-DE folder (in your user folder, or inside the portable ES-DE folder)' : 'Choose the ES-DE folder (usually in your home folder)') }),
    'rom-pick': async () => api('rom-folder', { mode: 'add', folder: await pick('Choose a folder with your ROMs') }),
    'rom-add-esde': () => api('rom-folder', { mode: 'add', folder: state.esdeRomDirectory }),
    'rom-scan': () => api('rom-folder', { mode: 'scan' }),
    'rom-remove': () => api('rom-folder', { mode: 'remove', folder: control.dataset.folder }),
    'igdb-forget': () => api('igdb-forget'), 'vgc-forget': () => api('vgc-forget'),
    'python-check': async () => { const found = (await request('/__retro_library/sources')).python; if (!found) throw new Error('Python isn’t found yet. If the installer is still running, wait until it says the installation was successful, then check again.'); return { message: 'Python is installed. You’re ready to import your games.' }; },
  }[action];
  if (work) run(cardId, action, work);
});
document.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]'); if (!form) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form)), kind = form.dataset.form, cardId = form.closest('.source-card').id.replace(/^card-/, '');
  if (kind === 'steam-account') run(cardId, 'steam-account', () => api('steam-account', { input: values.input }));
  if (kind === 'steam-key') run(cardId, 'steam-key', () => api('steam-key', { key: values.key }));
  if (kind === 'rom-add') run(cardId, 'rom-add', () => api('rom-folder', { mode: 'add', folder: values.folder.trim() }));
  if (kind === 'igdb-keys') run(cardId, 'igdb-keys', () => api('igdb-keys', { clientId: values.clientId, clientSecret: values.clientSecret }));
  if (kind === 'vgc-key') run(cardId, 'vgc-key', () => api('vgc-key', { key: values.key }));
});
// Uploads: choose a file or drop it on the zone.
const uploadFile = (kind, file) => { const cardId = { wishlist: 'steam-wishlist', galaxy: 'galaxy', playnite: 'playnite' }[kind]; if (file) run(cardId, `upload-${kind}`, () => upload(kind, file)); };
document.addEventListener('change', event => { const input = event.target.closest('[data-upload]'); if (input) uploadFile(input.dataset.upload, input.files[0]); });
document.addEventListener('dragover', event => { const zone = event.target.closest('[data-drop]'); if (!zone) return; event.preventDefault(); zone.classList.add('is-over'); });
document.addEventListener('dragleave', event => event.target.closest?.('[data-drop]')?.classList.remove('is-over'));
document.addEventListener('drop', event => { const zone = event.target.closest('[data-drop]'); if (!zone) return; event.preventDefault(); zone.classList.remove('is-over'); uploadFile(zone.dataset.drop, event.dataTransfer.files[0]); });

// Arriving at a section (the first-run guide links to #steam, #launchers or #roms) scrolls to
// it once the cards are drawn.
render().finally(() => { pageReady(); if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView(); });

// First-run guide: a one-minute setup the first time Level Select opens in a browser, in
// five steps (welcome, theme, where your games are, a map of the app, where to start).
// navigation.js loads it only when it's needed; "Setup guide" in the sidebar reopens it.
import { chooseTheme, currentTheme, GUIDE_KEY } from './navigation.js';

const page = path => new URL(path, import.meta.url).href;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// Where each kind of library is connected on the Import games page.
const SOURCES = [
  { id: 'steam', icon: '🛒', title: 'Steam', about: 'Your wishlist and your games with play time, Family Sharing ones too.', group: 'steam' },
  { id: 'galaxy', icon: '🌌', title: 'GOG Galaxy', about: 'One import for Steam, Epic, GOG, EA, Ubisoft, Xbox and PlayStation.', group: 'launchers' },
  { id: 'playnite', icon: '🎮', title: 'Playnite', about: 'Your Playnite library from Windows, emulated games included.', group: 'launchers' },
  { id: 'roms', icon: '🕹️', title: 'Emulators & ROMs', about: 'ES-DE’s game lists, or the folders where your ROMs live.', group: 'roms' },
];
const PLACES = {
  backlog: 'What you’re playing, Up Next, suggestions and a roulette for undecided nights. Challenges, lists and your progress live here too.',
  owned: 'Every game you own across stores, systems and ROM folders, each game shown once.',
  wishlist: 'Your Steam wishlist with prices and reviews. Set target prices and review ten at a time.',
  recommendations: 'The best games of 51 systems, ranked by critics and players. Save favourites as you go.',
  saved: 'Every Atlas game you’ve saved, own or have played, in one collection.',
  sources: 'Connect Steam, GOG Galaxy, Playnite and ROMs. Update data keeps them current.',
};
const STEPS = ['Welcome', 'Pick your look', 'Your games', 'The map', 'Ready'];

let dialog, opener = null, stylesheet = null, step = 0, chosen = new Set(), found = null;

const save = value => { try { localStorage.setItem(GUIDE_KEY, JSON.stringify(value)); } catch {} };
function load() { try { const saved = JSON.parse(localStorage.getItem(GUIDE_KEY)); return saved && typeof saved === 'object' ? saved : {}; } catch { return {}; } }

// What's already on this computer or connected. Only the local app server knows; a shared
// copy of the site has no server, so the step simply shows no "found" notes.
async function detect() {
  try {
    const response = await fetch(page('__retro_library/sources'), { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const state = await response.json();
    const steamName = state.steam?.account?.persona ?? state.steam?.accounts?.[0]?.persona;
    return {
      // A Mac without Python needs it installed before importing (Import games shows how).
      needsPython: state.python === false && state.platform === 'darwin',
      steam: state.steam?.wishlist || state.steam?.owned || state.steam?.installed?.connected ? { connected: true } : steamName ? { note: `Found on this computer: ${steamName}` } : null,
      galaxy: state.galaxy?.connected ? { connected: true } : state.galaxy?.found?.length ? { note: 'Found on this computer' } : null,
      playnite: state.playnite?.file ? { connected: true } : state.playnite?.found?.length ? { note: 'Found on this computer' } : null,
      roms: state.esde?.connected || state.romFolders?.length ? { connected: true } : state.esde?.found?.length ? { note: 'ES-DE found on this computer' } : null,
    };
  } catch { return null; }
}
const connectedAny = () => Object.values(found ?? {}).some(source => source?.connected);

// ---------- steps ----------
function welcome() {
  return `<div class="welcome-hero"><span class="welcome-mark" aria-hidden="true">L</span>
      <div><p class="welcome-eyebrow">Welcome to Level Select</p><h2 tabindex="-1">Every game you own, in one place.</h2></div></div>
    <p class="welcome-lead">Steam, GOG, Epic, consoles and the ROMs on your drive: Level Select brings them together, ranks them by critics and players, and helps you pick what to play next.</p>
    <ul class="welcome-promises">
      <li><span aria-hidden="true">🔒</span><strong>Yours, on this computer</strong><small>No account, no cloud. Your library and notes stay here.</small></li>
      <li><span aria-hidden="true">★</span><strong>Scores you can trust</strong><small>Critic and player ratings, always with their source.</small></li>
      <li><span aria-hidden="true">▷</span><strong>Less browsing, more playing</strong><small>Up Next, suggestions, challenges and XP for finishing games.</small></li>
    </ul>`;
}
// Themes, like a character select: a tile each, and a line about the one you're on.
const themeButtons = () => [...document.querySelectorAll('.theme-menu [data-theme-choice]')];
const aboutTheme = id => { const button = themeButtons().find(item => item.dataset.themeChoice === id); return button ? `<strong>${esc(button.title)}</strong> · ${esc(button.querySelector('small')?.textContent)}` : ''; };
function themes() {
  const options = themeButtons().map(button => {
    const id = button.dataset.themeChoice, swatch = button.querySelector('.theme-chip')?.getAttribute('style') ?? '';
    return `<button type="button" class="welcome-theme" data-guide-theme="${esc(id)}" aria-pressed="${id === currentTheme()}" aria-describedby="welcomeThemeAbout">
      <span class="welcome-swatch" aria-hidden="true" style="${esc(swatch)}"><i></i><i></i><i></i><i></i><i></i></span><strong>${esc(button.title)}</strong></button>`;
  });
  return `<h2 tabindex="-1">Pick your look</h2>
    <p class="welcome-lead">Ten themes, from calm to full CRT. The whole app changes as you choose. Switch any time from <strong>Theme</strong> in the sidebar.</p>
    <div class="welcome-themes" role="group" aria-label="Themes">${options.join('')}</div>
    <p class="welcome-theme-about" id="welcomeThemeAbout">${aboutTheme(currentTheme())}</p>`;
}
function sources() {
  const cards = SOURCES.map(source => {
    const state = found?.[source.id];
    // Only the local app server can tell; without it (a shared copy) cards show no status.
    const note = !found ? '' : state?.connected ? '<em class="is-connected">✓ Connected</em>' : state?.note ? `<em>${esc(state.note)}</em>` : '<em class="is-missing">Not connected</em>';
    return `<button type="button" class="welcome-source" data-guide-source="${source.id}" aria-pressed="${chosen.has(source.id)}">
      <span class="welcome-source-icon" aria-hidden="true">${source.icon}</span>
      <span><strong>${source.title}</strong><small>${source.about}</small>${note}</span><span class="welcome-check" aria-hidden="true"></span></button>`;
  });
  return `<h2 tabindex="-1">Where do your games live?</h2>
    <p class="welcome-lead">Choose everything you use. Next, Import games walks you through connecting each one; it takes a few minutes.</p>
    <div class="welcome-sources" role="group" aria-label="Game libraries">${cards.join('')}</div>
    <p class="welcome-note">🔒 Your library stays on this computer. Only game names and ids go out, to look up scores and prices. Just browsing? Skip this: the Game Atlas needs no library.</p>`;
}
function map() {
  const places = [...document.querySelectorAll('.site-primary-nav .site-nav-link')].filter(link => PLACES[link.dataset.section]).map(link =>
    `<li><span class="welcome-place-icon" aria-hidden="true">${esc(link.querySelector('.site-nav-symbol')?.textContent)}</span><span><strong>${esc(link.querySelector('span:last-child')?.textContent)}</strong><small>${PLACES[link.dataset.section]}</small></span></li>`);
  return `<h2 tabindex="-1">Your map</h2>
    <p class="welcome-lead">Six places, always in the sidebar${matchMedia('(max-width: 900px)').matches ? ' (open it with ☰)' : ''}.</p>
    <ul class="welcome-places">${places.join('')}</ul>
    <p class="welcome-levelup"><span class="welcome-level" aria-hidden="true">1</span><span><strong>Level up as you play</strong><small>Finishing games, lists and challenges earns XP, levels and badges. Your player card sits under the menu.</small></span></p>`;
}
const names = sources => { const titles = sources.map(source => source.title); return titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}` : titles[0]; };
function ready() {
  const picked = SOURCES.filter(source => chosen.has(source.id));
  const linked = picked.filter(source => found?.[source.id]?.connected), toConnect = picked.filter(source => !linked.includes(source));
  // Steam is the page's first section, right under its introduction, so it needs no jump.
  const jump = toConnect[0] && toConnect[0].group !== 'steam' ? `#${toConnect[0].group}` : '';
  const link = (href, label, primary) => `<a class="${primary ? 'welcome-primary' : 'welcome-secondary'}" href="${page(href)}" data-guide-finish>${label}${primary ? ' <span aria-hidden="true">→</span>' : ''}</a>`;
  const already = linked.length ? ` ${esc(names(linked))} ${linked.length > 1 ? 'are' : 'is'} already connected.` : '';
  let lead, actions;
  if (toConnect.length) {
    lead = `Next: connect ${esc(names(toConnect))}. The Import games page has each step, and <strong>Update data</strong> keeps everything current afterwards.${already}`;
    if (found?.needsPython) lead += ' Your Mac also needs <strong>Python</strong>, a free tool Level Select uses to build your library; Import games shows how to install it (about two minutes).';
    actions = link(`library/sources.html${jump}`, 'Import my games', true) + link('index.html', 'Explore the Game Atlas');
  } else if (linked.length) {
    lead = `${already.trim()} <strong>Update data</strong> keeps your games, prices and scores current.`;
    actions = link('library/index.html', 'Open my library', true) + link('index.html', 'Explore the Game Atlas');
  } else {
    lead = connectedAny() ? 'Your games are already connected. Open your library, or browse the best games of every system in the Game Atlas.'
      : 'Start with the Game Atlas: the best games of every system, with critic and player scores. Import your own games whenever you like.';
    actions = link('index.html', 'Explore the Game Atlas', true) + link('library/index.html', connectedAny() ? 'Open my library' : 'See the example library');
  }
  return `<div class="welcome-hero"><span class="welcome-mark is-ready" aria-hidden="true">✓</span>
      <div><p class="welcome-eyebrow">Setup complete</p><h2 tabindex="-1">Ready to play.</h2></div></div>
    <p class="welcome-lead">${lead}</p>
    <div class="welcome-finish">${actions}</div>
    <p class="welcome-note">Reopen this guide any time from <strong>Setup guide</strong> at the bottom of the sidebar.</p>`;
}
const VIEWS = [welcome, themes, sources, map, ready];

// ---------- dialog ----------
function frame() {
  const last = step === STEPS.length - 1;
  dialog.querySelector('.welcome-progress').innerHTML = `<span class="welcome-stage">Level 1-${step + 1}<span> · ${STEPS[step]}</span></span>
    <span class="welcome-bar" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="${STEPS.length}" aria-valuenow="${step + 1}" aria-valuetext="Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}"><span style="--done:${(step + 1) / STEPS.length * 100}%"></span></span>`;
  const body = dialog.querySelector('.welcome-body');
  body.innerHTML = VIEWS[step]();
  body.dataset.step = step;
  body.scrollTop = 0;
  dialog.querySelector('[data-guide-skip]').textContent = last ? 'Close' : 'Skip setup';
  dialog.querySelector('[data-guide-back]').hidden = step === 0;
  const next = dialog.querySelector('[data-guide-next]');
  next.hidden = last;
  next.innerHTML = step === 0 ? 'Press start <span aria-hidden="true">→</span>' : step === 2 && !chosen.size ? 'Skip for now <span aria-hidden="true">→</span>' : 'Next <span aria-hidden="true">→</span>';
  if (!reduced.matches) { body.classList.remove('is-entering'); void body.offsetWidth; body.classList.add('is-entering'); }
}
// Until it's finished, the guide remembers its step, so closing the browser half-way
// brings it back where it stopped. Reopened later from the sidebar, it stays finished.
const FINISHED = ['done', 'skipped', 'existing'];
function go(to) {
  step = Math.max(0, Math.min(STEPS.length - 1, to));
  const saved = load();
  save({ ...saved, state: FINISHED.includes(saved.state) ? saved.state : 'open', step, sources: [...chosen] });
  frame();
  (step === 0 ? dialog.querySelector('[data-guide-next]') : dialog.querySelector('.welcome-body h2')).focus({ preventScroll: true });
}
function finish(state) {
  save({ state, at: new Date().toISOString(), sources: [...chosen] });
  teardown();
}
// Closes and removes the guide straight away (not on the dialog's later "close" event), so
// the page is back to normal and "Setup guide" can open it again at once.
function teardown() {
  if (!dialog) return;
  const closing = dialog; dialog = null;
  if (closing.open) closing.close();
  closing.remove();
  document.documentElement.classList.remove('welcome-open');
  // Back to where it was opened from (the sidebar's "Setup guide"), if anywhere.
  if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
}

function build() {
  dialog = document.createElement('dialog');
  dialog.className = 'welcome';
  dialog.setAttribute('aria-label', 'Set up Level Select');
  dialog.innerHTML = `<header class="welcome-top"><div class="welcome-progress"></div><button type="button" class="welcome-skip" data-guide-skip>Skip setup</button></header>
    <div class="welcome-body"></div>
    <footer class="welcome-nav"><button type="button" class="welcome-back" data-guide-back><span aria-hidden="true">←</span> Back</button><button type="button" class="welcome-next" data-guide-next></button></footer>`;
  dialog.addEventListener('click', event => {
    const target = event.target.closest('button, a'); if (!target) return;
    if (target.matches('[data-guide-next]')) go(step + 1);
    else if (target.matches('[data-guide-back]')) go(step - 1);
    else if (target.matches('[data-guide-skip]')) finish(step === STEPS.length - 1 ? 'done' : 'skipped');
    else if (target.matches('[data-guide-finish]')) finish('done');
    else if (target.dataset.guideTheme) {
      chooseTheme(target.dataset.guideTheme);
      dialog.querySelectorAll('[data-guide-theme]').forEach(item => item.setAttribute('aria-pressed', String(item === target)));
      dialog.querySelector('.welcome-theme-about').innerHTML = aboutTheme(target.dataset.guideTheme);
    } else if (target.dataset.guideSource) {
      const id = target.dataset.guideSource;
      if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
      target.setAttribute('aria-pressed', String(chosen.has(id)));
      save({ ...load(), sources: [...chosen] });
      dialog.querySelector('[data-guide-next]').innerHTML = `${chosen.size ? 'Next' : 'Skip for now'} <span aria-hidden="true">→</span>`;
    }
  });
  // Escape (or the browser's back gesture on a phone) skips; closing it any way ends the guide.
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish('skipped'); });
  dialog.addEventListener('close', teardown);
  // Pointing at (or tabbing to) a theme tells you about it; leaving goes back to your choice.
  const describe = id => { const about = dialog.querySelector('.welcome-theme-about'); if (about) about.innerHTML = aboutTheme(id); };
  dialog.addEventListener('pointerover', event => { const tile = event.target.closest('[data-guide-theme]'); if (tile) describe(tile.dataset.guideTheme); });
  dialog.addEventListener('focusin', event => { const tile = event.target.closest('[data-guide-theme]'); if (tile) describe(tile.dataset.guideTheme); });
  dialog.addEventListener('pointerout', event => { if (event.target.closest('[data-guide-theme]') && !event.relatedTarget?.closest?.('[data-guide-theme]')) describe(currentTheme()); });
  // The choices move with the arrow keys, like the sidebar's menu.
  dialog.addEventListener('keydown', event => {
    const items = [...dialog.querySelectorAll('[data-guide-theme], [data-guide-source]')], index = items.indexOf(document.activeElement);
    if (index < 0) return;
    const columns = getComputedStyle(items[0].parentElement).gridTemplateColumns.split(' ').length;
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, ArrowDown: index + columns, ArrowUp: index - columns }[event.key];
    if (next != null && items[next]) { event.preventDefault(); items[next].focus(); }
  });
}

export async function openGuide() {
  if (dialog?.open) return;
  teardown();
  opener = document.activeElement;
  await (stylesheet ??= new Promise(resolve => {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: page('welcome.css') });
    css.onload = css.onerror = resolve; document.head.append(css);
  }));
  // A second click while the stylesheet loaded has nothing left to open.
  if (dialog?.open) return;
  const detection = detect();
  const saved = load();
  // Coming back to a guide left half-way picks up where it stopped.
  step = saved.state === 'open' ? Math.min(Number(saved.step) || 0, STEPS.length - 1) : 0;
  chosen = new Set((saved.sources ?? []).filter(id => SOURCES.some(source => source.id === id)));
  build();
  document.body.append(dialog);
  document.documentElement.classList.add('welcome-open');
  dialog.showModal();
  go(step);
  found = await detection;
  if (!found || !dialog) return;
  // Libraries found on this computer start ticked, until you choose for yourself.
  if (!chosen.size && !load().sources?.length) for (const source of SOURCES) if (found[source.id]?.note) chosen.add(source.id);
  if (step !== 2) return;
  const focused = document.activeElement?.dataset?.guideSource;
  frame();
  dialog.querySelector(focused ? `[data-guide-source="${focused}"]` : '.welcome-body h2')?.focus({ preventScroll: true });
}

const sidebar = document.getElementById('sidebar');
const toggle = document.getElementById('open-navigation');
const close = document.getElementById('close-navigation');
const scrim = document.getElementById('nav-scrim');
const mobile = matchMedia('(max-width: 900px)');
const content = document.querySelector('.workspace') || document.getElementById('main');

export function syncNavigation() {
  const ownPage = location.pathname.endsWith('/library/index.html') || location.pathname.endsWith('/library/');
  const wishPage = location.pathname.endsWith('/library/wishlist.html');
  const view = new URLSearchParams(location.search).get('view');
  const active = location.pathname.endsWith('/library/phone.html') ? 'phone' : location.pathname.endsWith('/library/backlog.html') ? 'backlog' : location.pathname.endsWith('/library/sources.html') ? 'sources' : location.pathname.endsWith('/library/mods.html') ? 'mods' : ownPage ? 'owned' : wishPage ? 'wishlist' : view === 'collection' ? 'saved' : 'recommendations';
  document.querySelectorAll('.site-nav-link').forEach(link => {
    if (link.dataset.section === active) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
}

export function setNavigation(open) {
  const wasOpen = sidebar.classList.contains('is-open');
  const expanded = mobile.matches && open;
  sidebar.classList.toggle('is-open', expanded);
  sidebar.inert = mobile.matches && !expanded;
  content.inert = expanded;
  scrim.hidden = !expanded;
  toggle.setAttribute('aria-expanded', String(expanded));
  document.body.classList.toggle('navigation-open', expanded);
  if (expanded) close.focus();
  else if (wasOpen) toggle.focus({preventScroll:true});
}

toggle.addEventListener('click', () => setNavigation(true));
close.addEventListener('click', () => setNavigation(false));
scrim.addEventListener('click', () => setNavigation(false));
mobile.addEventListener('change', () => setNavigation(false));
document.addEventListener('keydown', event => {
  if (!sidebar.classList.contains('is-open')) return;
  if (event.key === 'Escape') { event.preventDefault(); setNavigation(false); }
  if (event.key === 'Tab') {
    const items = [...sidebar.querySelectorAll('a[href],button')].filter(item => item.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
// Ordinary links preserve native history, modifier-click and open-in-new-tab behavior.
sidebar.addEventListener('click', event => {
  if (event.target.closest('a') && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) setNavigation(false);
});
window.addEventListener('pageshow', () => { setNavigation(false); syncNavigation(); });
window.addEventListener('popstate', syncNavigation);
syncNavigation();
setNavigation(false);

// Theme picker. theme.js applies the saved choice before the first paint; pointing at (or
// tabbing to) a theme previews it, choosing saves it, and leaving the menu puts the saved one back.
const THEME_KEY = 'retro-library-theme';
const root = document.documentElement, picker = document.querySelector('.theme-picker'), menu = picker?.querySelector('.theme-menu');
const savedTheme = () => root.dataset.theme ?? 'modern';
let chosenTheme = savedTheme();
function setTheme(theme) {
  const button = document.querySelector(`[data-theme-choice="${theme}"]`);
  if (theme === 'modern' || !button) { delete root.dataset.theme; delete root.dataset.tone; }
  else { root.dataset.theme = theme; root.dataset.tone = button.dataset.tone; }
}
function showTheme() {
  const theme = savedTheme(), button = document.querySelector(`[data-theme-choice="${theme}"]`);
  document.querySelectorAll('[data-theme-choice]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.themeChoice === chosenTheme)));
  if (button) {
    document.querySelectorAll('[data-theme-name]').forEach(node => { node.textContent = button.title; });
    document.querySelectorAll('[data-theme-chip]').forEach(node => { node.innerHTML = button.querySelector('.theme-chip').outerHTML; });
  }
  // The browser chrome (mobile address bar) follows the page colour.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim());
}
const preview = theme => { if (theme !== savedTheme()) { setTheme(theme); showTheme(); } };
const restore = () => { if (savedTheme() !== chosenTheme) { setTheme(chosenTheme); showTheme(); } };
// While open, the menu sits on the page itself, pinned above the picker: the sidebar is a
// sliding layer on phones (which would trap and clip it), and a previewed theme's fonts
// reflowing the sidebar mustn't move it under the pointer.
function placeMenu() {
  const at = picker.querySelector('summary').getBoundingClientRect();
  menu.style.maxHeight = `${Math.max(180, Math.min(600, at.top - 18))}px`;
  menu.style.width = `${Math.min(296, innerWidth - 24)}px`;
  menu.style.left = `${Math.max(12, Math.min(at.left, innerWidth - 12 - menu.offsetWidth))}px`;
  menu.style.bottom = `${innerHeight - at.top + 6}px`;
}
function openMenu() { document.body.append(menu); menu.hidden = false; placeMenu(); }
function closeMenu() { menu.hidden = true; picker.append(menu); restore(); }
// A page loaded ahead of time, or restored with Back, takes the theme chosen since.
function catchUpTheme() {
  let saved;
  try { saved = localStorage.getItem(THEME_KEY) ?? 'modern'; } catch { return; }
  if (saved !== chosenTheme) { chosenTheme = saved; setTheme(saved); showTheme(); }
}
window.addEventListener('pageshow', event => { if (event.persisted) catchUpTheme(); });
document.addEventListener('prerenderingchange', catchUpTheme);
// Saves a theme and switches to it (from the menu, or the first-run guide).
export const currentTheme = () => chosenTheme;
export function chooseTheme(choice) {
  chosenTheme = choice;
  try { localStorage.setItem(THEME_KEY, choice); } catch {}
  const apply = () => { setTheme(choice); showTheme(); };
  // A crossfade between themes; skipped (not an error) when the browser can't run one.
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(apply).ready.catch(() => {}); else apply();
}
menu?.addEventListener('click', event => {
  const choice = event.target.closest('[data-theme-choice]')?.dataset.themeChoice; if (!choice) return;
  restore();
  chooseTheme(choice);
  picker.open = false;
  picker.querySelector('summary').focus();
});
menu?.addEventListener('pointerover', event => { const item = event.target.closest('[data-theme-choice]'); if (item && event.pointerType === 'mouse') preview(item.dataset.themeChoice); });
menu?.addEventListener('focusin', event => { const item = event.target.closest('[data-theme-choice]'); if (item) preview(item.dataset.themeChoice); });
menu?.addEventListener('pointerleave', restore);
picker?.addEventListener('toggle', () => { if (picker.open) openMenu(); else closeMenu(); });
addEventListener('resize', () => { if (picker?.open) placeMenu(); });
const escape = event => { if (event.key === 'Escape' && picker.open) { picker.open = false; picker.querySelector('summary').focus(); } };
picker?.addEventListener('keydown', escape); menu?.addEventListener('keydown', escape);
// Tab from the picker goes into the menu (it's elsewhere on the page while open).
picker?.querySelector('summary').addEventListener('keydown', event => { if (picker.open && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab' && !event.shiftKey)) { event.preventDefault(); menu.querySelector('[aria-pressed="true"]')?.focus(); } });
menu?.addEventListener('keydown', event => {
  const items = [...menu.querySelectorAll('[data-theme-choice]')], index = items.indexOf(document.activeElement);
  const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key];
  if (next != null) { event.preventDefault(); items[(next + items.length) % items.length].focus(); }
  if (event.key === 'Tab') { event.preventDefault(); picker.open = false; picker.querySelector('summary').focus(); }
});
document.addEventListener('pointerdown', event => { if (picker?.open && !picker.contains(event.target) && !menu.contains(event.target)) picker.open = false; });
if (menu) menu.hidden = true;
showTheme();

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// First-run guide (welcome.js, loaded only when needed): it opens the first time Level Select
// runs in this browser, until it's finished or skipped. A browser that has used Level Select
// before (anything saved) counts as finished. "Setup guide" in the sidebar reopens it.
export const GUIDE_KEY = 'level-select-guide';
export const openGuide = () => import('./welcome.js').then(guide => guide.openGuide());
// A phone never opens it: setting up (a theme, your games) happens on the computer, and a
// phone (in its browser, or added to the home screen, which has storage of its own) would
// otherwise always look like a first visit.
const onPhone = Boolean(document.querySelector('meta[name="level-select-phone"]'));
function guideDue() {
  if (onPhone) return false;
  try {
    const saved = localStorage.getItem(GUIDE_KEY);
    if (saved) return JSON.parse(saved)?.state === 'open';
    if (localStorage.length) localStorage.setItem(GUIDE_KEY, JSON.stringify({ state: 'existing' }));
    return !localStorage.length;
  } catch { return false; }
}
document.querySelector('[data-open-guide]')?.addEventListener('click', () => { setNavigation(false); openGuide(); });
// On a paired phone, pairing, the setup guide and the buttons for what only the computer does
// (updating, adding games) are left out (navigation.css .on-phone).
if (onPhone) {
  document.documentElement.classList.add('on-phone');
  document.querySelector('[data-open-guide]')?.remove();
  const link = document.querySelector('[data-phone-link]');
  // The phone app keeps the page, as Your copy (open or update the copy of your library).
  if (document.querySelector('meta[name="level-select-copy-app"]')) { if (link) link.textContent = 'Your copy'; }
  else link?.remove();
}
// The phone app works offline: its service worker keeps the app and your copy on the phone.
if (document.querySelector('meta[name="level-select-copy-app"]') && 'serviceWorker' in navigator) navigator.serviceWorker.register(new URL('./sw.js', import.meta.url)).catch(() => {});
// A page loaded ahead of time (see the speculation rules below) waits until it's shown.
if (document.prerendering) document.addEventListener('prerenderingchange', () => { if (guideDue()) openGuide(); }, { once: true });
else if (guideDue()) openGuide();

// Shows the page's content after its first full render (see navigation.css): it stays hidden
// while data fills it in, so nothing jumps into place.
export function pageReady() { document.getElementById('main')?.removeAttribute('data-loading'); }
// A page whose script fails still shows its content (navigation.css has the same fallback).
setTimeout(pageReady, 3000);
// Numbers roll up to their new value rather than jumping.
function countUp(node, from, to, format) {
  const start = performance.now();
  const step = now => { const t = Math.min(1, (now - start) / 700); node.textContent = format(Math.round(from + (to - from) * (1 - (1 - t) ** 3))); if (t < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// Player card: level, title and XP, kept in step by the tracking client ('tracking-progress').
// The last summary is remembered so the card is filled in before the library loads.
const PLAYER_KEY = 'retro-library-player';
const card = document.getElementById('player-card');
function showPlayer(player, gained = 0) {
  if (!card) return;
  card.hidden = !player?.visible;
  if (card.hidden) return;
  const percent = player.span ? Math.min(100, Math.round(player.within / player.span * 100)) : 0;
  card.querySelector('.player-level').textContent = player.level;
  card.querySelector('strong').textContent = player.title;
  const line = total => `${total.toLocaleString()} XP · ${(player.span - player.within).toLocaleString()} to level ${player.level + 1}`;
  if (gained > 0 && !reduced.matches) countUp(card.querySelector('small'), player.total - gained, player.total, line);
  else card.querySelector('small').textContent = line(player.total);
  card.querySelector('.xp-fill').style.setProperty('--xp', `${percent}%`);
  card.setAttribute('aria-label', `Level ${player.level} ${player.title}, ${player.total} XP. Open Progress`);
  if (gained > 0) {
    card.classList.remove('is-gaining'); void card.offsetWidth; card.classList.add('is-gaining');
    const float = document.createElement('span'); float.className = 'xp-float'; float.textContent = `+${gained}`;
    float.addEventListener('animationend', () => float.remove()); card.append(float);
  }
}
try { showPlayer(JSON.parse(localStorage.getItem(PLAYER_KEY) ?? 'null')); } catch {}
document.addEventListener('tracking-progress', event => {
  const { player, gained } = event.detail ?? {};
  try { localStorage.setItem(PLAYER_KEY, JSON.stringify(player)); } catch {}
  showPlayer(player, gained);
});

// Result lists animate in when what they show changes (a filter, a sort, a new page),
// not when the same games are redrawn after a small edit.
const signatures = new WeakMap();
const signature = list => `${list.children.length}|${[...list.children].slice(0, 24).map(item => item.querySelector('[data-game],[data-id],[data-target],h3,strong')?.textContent ?? '').join('|')}`;
const lists = document.querySelectorAll('#results, #continueCards, #suggestionCards, #planResults, #historyCards, #rouletteResult');
const watcher = new MutationObserver(records => {
  for (const list of new Set(records.map(record => record.target))) {
    const next = signature(list), changed = signatures.get(list) !== next;
    signatures.set(list, next);
    list.classList.toggle('is-entering', changed);
  }
});
lists.forEach(list => { signatures.set(list, signature(list)); watcher.observe(list, { childList: true }); });

// A small burst where you press: a ring (Modern), pixels (Arcade), face-button colours
// (Console) or sakura petals (Anime). Inside an open dialog it's drawn in the dialog, above the page.
let presses = 0;
document.addEventListener('pointerdown', event => {
  if (reduced.matches || event.button !== 0) return;
  const target = event.target.closest('button, .triage-start, .site-nav-link, .player-card, .play-sections a, .continue-card');
  if (!target || target.disabled) return;
  const spark = document.createElement('span');
  spark.className = 'click-spark'; spark.dataset.pad = 'axby'[presses++ % 4]; spark.setAttribute('aria-hidden', 'true');
  spark.style.left = `${event.clientX}px`; spark.style.top = `${event.clientY}px`;
  spark.innerHTML = '<i></i><i></i><i></i><i></i>';
  (target.closest('dialog[open]') ?? document.body).append(spark);
  setTimeout(() => spark.remove(), 1200);
});

// Instant page switches: pointing at a sidebar link (or pressing it) loads that page in the
// background, so it is ready when you click. Chromium browsers (Chrome, Edge, Brave, Arc)
// do this; others ignore it and load on click as before. The Atlas switches Game Atlas and
// My Atlas in place, so it doesn't load those again.
if (HTMLScriptElement.supports?.('speculationrules')) {
  const atlas = !location.pathname.includes('/library/') && /\/(?:index\.html)?$/.test(location.pathname);
  const rules = document.createElement('script');
  rules.type = 'speculationrules';
  rules.textContent = JSON.stringify({ prerender: [{ source: 'document', where: { selector_matches: `.site-nav-link:not([aria-current="page"])${atlas ? ':not([data-view])' : ''}` }, eagerness: 'moderate' }] });
  document.head.append(rules);
}

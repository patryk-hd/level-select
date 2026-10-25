export const sections = [
  { id:'backlog', label:'Play', route:'library/backlog.html', icon:'▷' },
  { id:'owned', label:'Library', route:'library/index.html', icon:'▣' },
  { id:'wishlist', label:'Wishlist', route:'library/wishlist.html', icon:'☆' },
  { id:'recommendations', label:'Game Atlas', route:'index.html', view:'games', icon:'▦' },
  { id:'saved', label:'My Atlas', route:'index.html?view=collection', view:'collection', icon:'◈' },
  { id:'mods', label:'Mods', route:'library/mods.html', icon:'✦' },
  { id:'sources', label:'Import games', route:'library/sources.html', icon:'⊕' },
];

// Themes in the sidebar picker: light or dark, the colours its chip shows (background,
// panel, accent) and a line about it. theme.js lists the same ids and tones.
export const THEMES = [
  { id: 'modern', label: 'Modern', tone: 'dark', colors: ['#13120f', '#26231e', '#e8b96f'], about: 'Calm dark gold. The default.' },
  { id: 'midnight', label: 'Midnight', tone: 'dark', colors: ['#000000', '#2a2d34', '#8ab4ff'], about: 'Pure black with hairlines only, for OLED screens and late nights.' },
  { id: 'arcade', label: 'Arcade', tone: 'dark', colors: ['#140a30', '#2b1b62', '#ff5cad'], about: 'Synthwave cabinet: neon purple, pixel type and a CRT glow.' },
  { id: 'cyberpunk', label: 'Cyberpunk', tone: 'dark', colors: ['#050b0d', '#0f1f23', '#fcee0a'], about: 'A 2077 HUD: teal screens, hazard yellow, cut corners.' },
  { id: 'y2k', label: 'Y2K', tone: 'dark', colors: ['#06122b', '#16336a', '#39c4ff'], about: 'Millennium dashboards: glass, chrome and aqua glow.' },
  { id: 'console', label: 'Console', tone: 'light', colors: ['#e3e1e9', '#ffffff', '#5a45b3'], about: 'A 16-bit living room: lilac plastic and face buttons.' },
  { id: 'handheld', label: 'Handheld', tone: 'light', colors: ['#c4cfa1', '#306230', '#8e2a52'], about: 'The pocket classic: four greens and a dot-matrix screen.' },
  { id: 'retro-pc', label: 'Retro PC', tone: 'light', colors: ['#c3c3c3', '#000080', '#008080'], about: '90s desktop: bevelled grey windows and navy title bars.' },
  { id: 'anime', label: 'Anime', tone: 'light', colors: ['#f6f0e4', '#1f1a17', '#c8301f'], about: 'A manga page: ink, vermilion seals and sakura.' },
  { id: 'fantasy', label: 'Fantasy', tone: 'light', colors: ['#efe3c8', '#2b1d10', '#b8862b'], about: 'An adventurer’s tome: parchment, gold leaf and wax seals.' },
];
const chip = theme => `<span class="theme-chip" aria-hidden="true" style="--c1:${theme.colors[0]};--c2:${theme.colors[1]};--c3:${theme.colors[2]}"></span>`;

export function navigationMarkup(prefix, active) {
  const brand = `<span class="site-brand-mark" aria-hidden="true">L</span><span>Level Select<small>Games across every era</small></span>`;
  return `<!-- shared-navigation:start -->
<header class="site-mobile-header"><a class="site-brand" href="${prefix}library/backlog.html">${brand}</a><button id="open-navigation" class="site-menu-button" type="button" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">☰</button></header>
<aside class="site-sidebar" id="sidebar" aria-label="Library navigation">
<a class="site-brand" href="${prefix}library/backlog.html">${brand}</a>
<button id="close-navigation" class="site-menu-close" type="button" aria-label="Close navigation">×</button>
<nav class="site-primary-nav" aria-label="Main">${sections.map(item => `
<a class="site-nav-link" data-section="${item.id}"${item.view ? ` data-view="${item.view}"` : ''} href="${prefix}${item.route}"${item.id === active ? ' aria-current="page"' : ''}><span class="site-nav-symbol" aria-hidden="true">${item.icon}</span><span>${item.label}</span></a>`).join('')}
</nav>
<a class="player-card" id="player-card" href="${prefix}library/backlog.html?section=progress" hidden><span class="player-level" aria-hidden="true">1</span><span class="player-copy"><strong>Explorer</strong><small>0 XP</small><span class="xp-bar"><span class="xp-fill"></span></span></span></a>
<details class="theme-picker"><summary><span data-theme-chip>${chip(THEMES[0])}</span><span class="theme-picker-label">Theme</span><b data-theme-name>Modern</b><span class="theme-picker-caret" aria-hidden="true">▾</span></summary><div class="theme-menu" role="group" aria-label="Theme">${THEMES.map(theme => `<button type="button" data-theme-choice="${theme.id}" data-tone="${theme.tone}" aria-pressed="${theme.id === 'modern'}" title="${theme.label}">${chip(theme)}<span><strong>${theme.label}</strong><small>${theme.about}</small></span></button>`).join('')}</div></details>
<p class="site-nav-footer">Your library, your next game.<a class="site-nav-guide" data-phone-link href="${prefix}library/phone.html">On your phone</a><button type="button" class="site-nav-guide" data-open-guide>Setup guide</button></p>
</aside>
<button id="nav-scrim" class="site-nav-scrim" type="button" aria-label="Close navigation" hidden></button>
<!-- shared-navigation:end -->`;
}

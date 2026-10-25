// Runs before the page paints, so a saved theme never flashes the default first.
// The picker lives in the sidebar (navigation.js). The themes and whether each is light or
// dark are navigation-template.js's THEMES; tests/themes.test.js keeps this list in step.
(() => {
  const TONES = { modern: 'dark', arcade: 'dark', console: 'light', anime: 'light', handheld: 'light', fantasy: 'light', y2k: 'dark', cyberpunk: 'dark', 'retro-pc': 'light', midnight: 'dark' };
  try {
    const theme = localStorage.getItem('retro-library-theme');
    if (theme && theme !== 'modern' && Object.hasOwn(TONES, theme)) { document.documentElement.dataset.theme = theme; document.documentElement.dataset.tone = TONES[theme]; }
  } catch {}
})();

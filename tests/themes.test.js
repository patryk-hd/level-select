import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { THEMES } from '../navigation-template.js';

test('every theme in the picker is known to theme.js, with the same tone, and has its palette in theme.css', async () => {
  const script = await readFile(new URL('../theme.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../theme.css', import.meta.url), 'utf8');
  const tones = Function(`return ${/const TONES = (\{[^}]+\})/.exec(script)[1]}`)();
  assert.equal(THEMES.length, 10);
  assert.deepEqual(Object.keys(tones).sort(), THEMES.map(theme => theme.id).sort());
  for (const theme of THEMES) {
    assert.equal(tones[theme.id], theme.tone, theme.id);
    if (theme.id !== 'modern') assert.match(css, new RegExp(`:root\\[data-theme="${theme.id}"\\] \\{\\n`), theme.id);
    // Light themes say so, so form controls and scrollbars match.
    if (theme.tone === 'light') assert.match(css, new RegExp(`:root\\[data-theme="${theme.id}"\\] \\{\\n  color-scheme: light;`), theme.id);
  }
});

test('browser-only scripts parse (nothing else loads them in tests)', async () => {
  const { execFileSync } = await import('node:child_process');
  for (const file of ['navigation.js', 'theme.js', 'welcome.js']) execFileSync(process.execPath, ['--check', new URL(`../${file}`, import.meta.url).pathname]);
});

test('every page can reopen the first-run guide from the sidebar', async () => {
  for (const file of ['index.html', 'library/index.html', 'library/wishlist.html', 'library/backlog.html', 'library/sources.html']) {
    const page = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(page, /<button type="button" class="site-nav-guide" data-open-guide>Setup guide<\/button>/, file);
  }
});

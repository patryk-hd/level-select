import { cp, mkdir, rm, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import path from 'node:path';
import { readSnapshot, readCatalog } from './snapshot.mjs';
import { readRatingsSnapshot } from './ratings-snapshot.mjs';
import './sync-navigation.mjs';

const local = process.argv.includes('--local');
// --demo: the public showcase (GitHub Pages). Every page then uses the sample workspace, so the
// demo library fills Play, the Game Atlas and Mods too, and each page says it's a demo.
const demo = process.argv.includes('--demo');
// --phone: the Level Select phone app (installable, offline), which opens the copy of your
// library your computer makes (scripts/phone-copy.mjs). It starts with the sample library.
const phone = process.argv.includes('--phone');
if (process.argv.slice(2).some(arg => !['--local', '--demo', '--phone'].includes(arg)) || [local, demo, phone].filter(Boolean).length > 1) throw new Error('Usage: npm run build [-- --local | --demo | --phone]');
const output = local ? 'dist-local' : phone ? 'dist-phone' : 'dist';
const htmlFiles = async dir => (await readdir(dir, { recursive: true })).filter(name => name.endsWith('.html')).map(name => path.join(dir, name));
const snapshot = await readSnapshot(process.cwd(), { local });
const ratings = await readRatingsSnapshot(process.cwd(), { local });
const catalog = JSON.parse(await readFile('data/catalog.json'));
if (!catalog.games.length || !catalog.systems.length) throw new Error('Catalog is empty');
await rm(output, { recursive: true, force: true });
await mkdir(`${output}/data`, { recursive: true });
const copy = (source, target) => cp(source, target, {
  recursive: true, mode: constants.COPYFILE_FICLONE,
  filter: source => !['.DS_Store', '__pycache__'].includes(path.basename(source)),
});
for (const file of ['index.html', 'styles.css', 'app.js', 'lib.js', 'navigation.js', 'navigation.css', 'controls.css', 'theme.css', 'theme.js', 'welcome.js', 'welcome.css', 'assets', 'pages']) await copy(file, `${output}/${file}`);
await writeFile(`${output}/data/catalog.json`, JSON.stringify(await readCatalog(process.cwd(), { local })));
// Spotlight descriptions and screenshots (loaded on demand) and system facts: public data.
for (const file of ['atlas-details.json', 'system-facts.json', 'mods.json']) await cp(`data/${file}`, `${output}/data/${file}`).catch(error => { if (error.code !== 'ENOENT') throw error; });
await mkdir(`${output}/library/data`, { recursive: true });
// Export runtime files only. Raw exports, metadata caches and tools stay local.
for (const file of ['index.html', 'wishlist.html', 'backlog.html', 'backlog.js', 'backlog.css', 'sources.html', 'sources.js', 'sources.css', 'add-game.js', 'add-game.css', 'mods.html', 'mods.js', 'mods.css', 'phone.html', 'phone.js', 'phone.css', 'copy.js', 'copy-app.js', 'suggestions.js', 'score-ui.js', 'browse-ui.js', 'triage.js', 'home.js', 'progress.js', 'update-ui.js', 'update-progress.js', 'motion.js', 'history.js', 'rewards.js', 'rewards.css', 'challenges.js', 'challenges.css', 'goals.js', 'hovercard.js', 'wishlist-planning.js', 'wishlist-planning.css', 'styles.css', 'app.js', 'wishlist.js', 'core.js', 'search-ui.js', 'runtime.js', 'icons.js', 'README.md']) {
  await copy(`library/${file}`, `${output}/library/${file}`);
}
await mkdir(`${output}/tracking`, { recursive: true });
for (const file of ['awards.js','gameplay.js','group-notes.js','products.js','products-ui.js','atlas.js','domain.js','legacy.js','backup.js','persistence.js','browser.js','compat.js','client.js','suggestions.js','score.js','triage.js','home.js','plan.js','owned.js','badges.js','anchors.js','wishlist.js','history.js','history-ui.js','rewards.js','identity.js','matches.js','matches-ui.js','challenges.js','goals.js','families.js','lists.js','ui.js','styles.css']) await copy(`tracking/${file}`, `${output}/tracking/${file}`);
await mkdir(`${output}/ranking`, { recursive: true });
for (const file of ['evidence.js', 'ui.js', 'snapshot.js', 'panels.js', 'modes.js', 'mode-ui.js', 'mods.js', 'methodology.html', 'styles.css']) await copy(`ranking/${file}`, `${output}/ranking/${file}`);
if (local) {
  let artwork;
  try { artwork = await stat('library/assets'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (artwork?.isDirectory()) await copy('library/assets', `${output}/library/assets`);
}
if (demo && snapshot.owned.local) throw new Error('A demo build shows the sample library only.');
await writeFile(`${output}/library/data/library-data.js`, snapshot.owned.source);
// Every page of the demo says so (lib.js demoHome): the mark is the home page's address from it.
if (demo) for (const file of await htmlFiles(output)) {
  const depth = path.relative(output, file).split(path.sep).length - 1, html = await readFile(file, 'utf8');
  if (!html.includes('<head>')) throw new Error(`${file} has no <head>`);
  await writeFile(file, html.replace('<head>', `<head>\n<meta name="level-select-demo" content="${'../'.repeat(depth + 1)}">`));
}
await writeFile(`${output}/library/data/wishlist-data.js`, snapshot.wishlist.source);
await writeFile(`${output}/library/data/connections.json`, JSON.stringify(snapshot.connections));
await writeFile(`${output}/library/data/ratings.json`, JSON.stringify(ratings));
if (phone) await phoneApp(output);
console.log(local ? 'Local build ready in dist-local/. Treat this folder as private.' : phone ? 'Phone app ready in dist-phone/ (it needs https: the showcase site serves it at phone/).' : `Shareable ${demo ? 'demo ' : ''}build ready in dist/. Personal snapshots and artwork excluded.`);

// Every page says it's the phone app, links its manifest and icon; the service worker
// (phone-sw.js) gets the list of files to keep offline, and a version from their contents.
async function phoneApp(dir) {
  const files = (await readdir(dir, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => path.relative(dir, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/')).sort();
  // The icons' addresses carry a version from their contents (as on the phone's Wi-Fi address).
  const iconHash = createHash('sha256');
  for (const file of ['app-icon-180.png', 'app-icon-192.png', 'app-icon-512.png', 'app-icon-maskable-512.png', 'app-icon-monochrome-512.png']) iconHash.update(await readFile(path.join('assets', file)).catch(() => Buffer.alloc(0)));
  const icons = iconHash.digest('hex').slice(0, 8);
  for (const file of files.filter(name => name.endsWith('.html'))) {
    const prefix = '../'.repeat(file.split('/').length - 1) || './', html = await readFile(path.join(dir, file), 'utf8');
    if (!html.includes('<head>')) throw new Error(`${file} has no <head>`);
    await writeFile(path.join(dir, file), html.replace('<head>', `<head>\n<meta name="level-select-phone" content="1"><meta name="level-select-copy-app" content="1"><link rel="manifest" href="${prefix}manifest.webmanifest"><link rel="apple-touch-icon" href="${prefix}assets/app-icon-180.png?v=${icons}"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Level Select"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`));
  }
  await writeFile(path.join(dir, 'manifest.webmanifest'), JSON.stringify({
    name: 'Level Select', short_name: 'Level Select', description: 'Your game library, on your phone.', start_url: './library/backlog.html', scope: './', display: 'standalone',
    background_color: '#13120f', theme_color: '#13120f',
    icons: [{ src: `assets/app-icon-192.png?v=${icons}`, sizes: '192x192', type: 'image/png' }, { src: `assets/app-icon-512.png?v=${icons}`, sizes: '512x512', type: 'image/png' }, { src: `assets/app-icon-maskable-512.png?v=${icons}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }, { src: `assets/app-icon-monochrome-512.png?v=${icons}`, sizes: '512x512', type: 'image/png', purpose: 'monochrome' }],
  }, null, 1));
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update(await readFile(path.join(dir, file)));
  const offline = [...files, 'manifest.webmanifest'];
  await writeFile(path.join(dir, 'sw.js'), `const VERSION = ${JSON.stringify(hash.digest('hex').slice(0, 12))};\nconst FILES = ${JSON.stringify(offline)};\n${await readFile('phone-sw.js', 'utf8')}`);
}

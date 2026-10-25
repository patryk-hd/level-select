// Fictional history in fresh browser contexts. No personal profile or imports are opened.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { emptyState, ensureTarget, applyCommand } from '../tracking/domain.js';
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--playwright' || args[2] !== '--browser') throw Error('Provide --playwright <module> --browser <Chromium executable>.');
const module = await import(pathToFileURL(args[1]).href), { chromium } = module.default ?? module;
const browser = await chromium.launch({ executablePath: args[3], headless: true });
const origin = 'http://127.0.0.1:18892/retro', passed = [], errors = [];
const catalog = JSON.parse(await readFile(new URL('../dist/data/catalog.json', import.meta.url), 'utf8')), catalogId = catalog.games[0].id;
async function context() {
  const context = await browser.newContext({ acceptDownloads: true, timezoneId: 'Pacific/Tahiti' });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', async route => {
    const url = route.request().url(); if (!url.startsWith(`${origin}/`)) return route.abort();
    const path = new URL(url).pathname.slice('/retro/'.length); if (path.includes('..')) return route.abort();
    if (path === 'seed.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fictional history seed</title>' });
    if (path === 'assets/history-fixture.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#213d36"/><circle cx="150" cy="150" r="70" fill="#cca46b"/><text x="150" y="300" text-anchor="middle" fill="white" font-size="24">FICTIONAL QUEST</text></svg>' });
    try {
      let body = await readFile(new URL(`../dist/${path}`, import.meta.url));
      if (path === 'library/data/library-data.js') body = Buffer.from(body.toString().replace('window.PLAYNITE_SAMPLE = true', 'window.PLAYNITE_SAMPLE = false'));
      if (path === 'library/data/wishlist-data.js') body = Buffer.from(body.toString().replace('window.WISHLIST_SAMPLE = true', 'window.WISHLIST_SAMPLE = false'));
      if (path === 'data/catalog.json') { const data = JSON.parse(body); data.games[0].cover = { local: 'assets/history-fixture.svg' }; body = Buffer.from(JSON.stringify(data)); }
      return route.fulfill({ body, contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.html') ? 'text/html' : path.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
    } catch { return route.fulfill({ status: 404, body: 'Not found' }); }
  }); return context;
}
async function state(page) { return page.evaluate(async () => (await (await import(new URL('../tracking/client.js', location.href))).trackingClient()).snapshot()); }
async function ready(page) { await page.locator('#planStatistics h2').waitFor(); }
async function stats(page, text) { await page.locator('#planStatistics').filter({ hasText: text }).waitFor(); }
async function savePlay(page) { await page.locator('#playthroughEditor [data-save-play]').click(); await page.locator('#playthroughEditor').waitFor({ state: 'detached' }); }
async function track(page, title) { await page.locator('.plan-row').filter({ has: page.locator('h2', { hasText: title }) }).locator('[data-open]').click(); }
try {
  const c = await context(), page = await c.newPage(); await page.goto(`${origin}/seed.html`);
  const at = '2026-01-01T12:00:00.000Z', finishedAt = '2026-06-01T12:00:00.000Z';
  let seed = emptyState();
  for (let i = 1; i <= 6; i++) {
    const desc = { ref: i === 1 ? { provider: 'catalog', id: catalogId } : { provider: 'manual', id: `fixture-${i}` }, title: `History Fixture ${i}`, platforms: [i === 6 ? 'PC' : 'snes'] };
    const target = ensureTarget(seed, desc);
    seed = applyCommand(seed, { type: 'queue', targetId: target.id, at, eventId: `queue-${i}` });
    seed = applyCommand(seed, { type: 'start', targetId: target.id, at, eventId: `start-${i}`, playthroughId: `play-${i}`, playedSource: desc.ref, playedPlatforms: desc.platforms });
    if (i <= 4) seed = applyCommand(seed, { type: 'status', targetId: target.id, at: finishedAt, eventId: `close-${i}`, playthroughId: `play-${i}`, status: i === 4 ? 'retired' : 'finished' });
  }
  seed.playthroughs['play-3'].historical = true; seed.playthroughs['play-3'].startedAt = null; seed.playthroughs['play-3'].finishedAt = null;
  seed.schemaVersion = 2; delete seed.journalEntries; for (const section of ['progression','rewardEvidence','rewardLedger','rewardAdjustments','rewardLinks','weeklyGoals','challenges','challengeRevisions','challengeEvidence','challengeAwards','matchReviews','productReviews']) delete seed[section]; seed.revision = 10; seed.migrations['legacy-v1'] = { id: 'legacy-v1', recordedAt: at };
  await page.evaluate(async seed => new Promise((resolve,reject) => { const request = indexedDB.open('retro-library-tracking',1); request.onupgradeneeded = () => request.result.createObjectStore('workspaces'); request.onsuccess = () => { const db = request.result, tx = db.transaction('workspaces','readwrite'); tx.objectStore('workspaces').put(seed,'personal'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); }; request.onerror = () => reject(request.error); }),seed);
  await page.goto(`${origin}/library/backlog.html?view=all`); await ready(page);
  await stats(page,'3 / 6 · 50%'); assert.match(await page.locator('#planStatistics').innerText(),/3 finished · 1 retired · 2 remaining/);
  assert.equal(await page.locator('.completion-card').count(),3);
  await page.locator('[data-playthrough="play-1"]').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('[data-playthrough="play-1"] img')?.naturalWidth > 0);
  assert.match(await page.locator('[data-playthrough="play-2"]').innerText(),/Time not recorded/);
  assert.match(await page.locator('[data-playthrough="play-3"]').innerText(),/Date unknown/);
  assert.equal((await state(page)).schemaVersion,7);
  passed.push('Version-two history upgrades with 3/6 plan completion, honest retirements, working covers and useful fallbacks');

  await page.locator('#historyYear').selectOption('unknown'); assert.equal(await page.locator('.completion-card').count(),1);
  await page.reload(); await ready(page); assert.equal(await page.locator('#historyYear').inputValue(),'unknown');
  await page.locator('#historyYear').selectOption('all'); await page.locator('#historyPlatform').selectOption('dos'); assert.equal(await page.locator('.completion-card').count(),0);
  await page.locator('#historyPlatform').selectOption('');
  passed.push('Year/platform album filters survive reload and keep unknown dates separate');

  await track(page,'History Fixture 5'); await page.locator('#planTracking [data-status="finished"]').click();
  await page.locator('#playthroughEditor [name="objective"]').selectOption('personal');
  await page.locator('#playthroughEditor [name="objectiveText"]').fill('Finish my island');
  await page.locator('#playthroughEditor [data-finish-details] summary').click();
  await page.locator('#playthroughEditor [name="minutesPlayed"]').fill('120');
  await page.locator('#playthroughEditor [name="rating"]').selectOption('4.5');
  await page.locator('#playthroughEditor [name="reflection"]').fill('A quiet adventure. <strong>Literal text</strong>');
  await savePlay(page); await page.locator('#planDetails [data-close]').click(); await stats(page,'4 / 6');
  const card = page.locator('[data-playthrough="play-5"]'); await card.waitFor();
  assert.match(await card.innerText(),/2 h · this playthrough/); assert.match(await card.innerText(),/4.5 \/ 5/);
  assert.equal(await card.locator('.history-reflection strong').count(),0);
  passed.push('Finishing from the shared panel saves objective, personal time, rating and escaped reflection into one card');

  await card.locator('[data-edit-play]').click(); await page.locator('#playthroughEditor [name="status"]').selectOption('retired');
  await page.locator('#playthroughEditor [name="ended"]').fill(''); await savePlay(page); await stats(page,'3 / 6');
  assert.match(await page.locator('#planStatistics').innerText(),/3 finished · 2 retired · 1 remaining/);
  await page.locator('#historyStatus').selectOption('retired'); assert.equal(await page.locator('.completion-card').count(),2);
  await page.locator('[data-playthrough="play-5"] [data-edit-play]').click(); await page.locator('#playthroughEditor [name="status"]').selectOption('finished'); await savePlay(page);
  await page.locator('#historyStatus').selectOption('finished'); await stats(page,'4 / 6');
  assert.equal(Object.keys((await state(page)).playthroughs).length,6);
  assert.match(await page.locator('[data-playthrough="play-5"]').innerText(),/Date unknown/);
  passed.push('Completion corrections update cards and the denominator calculation without duplicate playthroughs or invented dates');

  await track(page,'History Fixture 1'); await page.locator('#planTracking [data-start]').click();
  await page.locator('#planTracking [data-progress]').filter({hasText:'Playing'}).waitFor(); await stats(page,'3 / 6');
  const replay = Object.values((await state(page)).playthroughs).find(play => play.id !== 'play-1' && play.status === 'playing' && play.targetId === seed.playthroughs['play-1'].targetId);
  assert.ok(replay); assert.equal((await state(page)).playthroughs['play-1'].status,'finished');
  await page.locator('#planTracking [data-active-journal]').click();
  await page.locator('#playJournal [name="text"]').fill('Found the hidden garden');
  await page.locator('#playJournal [name="occurredOn"]').fill(''); await page.locator('#playJournal button[type=submit]').click();
  await page.locator('#playJournal .journal-entry').filter({hasText:'Found the hidden garden'}).waitFor();
  await page.locator('#playJournal [name="kind"]').selectOption('milestone');
  await page.locator('#playJournal [name="text"]').fill('Garden restored'); await page.locator('#playJournal [name="achieved"]').check();
  await page.locator('#playJournal button[type=submit]').click(); await page.locator('#playJournal .journal-entry').filter({hasText:'Milestone achieved'}).waitFor();
  assert.equal(Object.values((await state(page)).journalEntries).filter(entry => entry.playthroughId === replay.id).length,2);
  await page.locator('#playJournal [data-close]').click(); await page.locator('#planDetails [data-close]').click();
  passed.push('A replay retains its earlier card while session notes and achieved milestones stay on the new playthrough');

  await page.locator('[data-playthrough="play-2"] [data-edit-play]').click(); await page.locator('#playthroughEditor [name="reflection"]').fill('Unsaved first-tab draft');
  const other = await c.newPage(); await other.goto(`${origin}/library/backlog.html`); await ready(other);
  await other.locator('[data-playthrough="play-2"] [data-edit-play]').click(); await other.locator('#playthroughEditor [name="reflection"]').fill('Newer second-tab reflection'); await savePlay(other);
  await page.waitForFunction(async () => (await (await import(new URL('../tracking/client.js',location.href))).trackingClient()).snapshot().playthroughs['play-2'].reflection === 'Newer second-tab reflection');
  await page.locator('#playthroughEditor [data-save-play]').click(); await page.locator('#playthroughEditor [data-editor-status]').filter({hasText:'changed in another tab'}).waitFor();
  assert.equal(await page.locator('#playthroughEditor [name="reflection"]').inputValue(),'Unsaved first-tab draft');
  await page.locator('#playthroughEditor [data-close]').click(); await other.close();
  passed.push('A stale completion editor retains its draft and cannot overwrite another tab’s saved reflection');

  await page.locator('#planBackup').click(); const pending = page.waitForEvent('download'); await page.locator('#trackingBackup [data-export]').click();
  const backup = JSON.parse(await readFile(await (await pending).path(),'utf8')); assert.equal(backup.version,7);
  const clean = await context(), restore = await clean.newPage(); await restore.goto(`${origin}/library/backlog.html`); await ready(restore);
  for (let pass=0;pass<2;pass++) {
    await restore.locator('#planBackup').click(); await restore.locator('#trackingBackup [data-file]').setInputFiles({name:'tracking.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await restore.locator('#trackingBackup [data-preview] [data-apply]').waitFor();
    for (const select of await restore.locator('#trackingBackup [data-conflict]').all()) await select.selectOption('current');
    await restore.locator('#trackingBackup [data-preview] [data-apply]').click(); await restore.locator('#trackingBackup [data-status]').filter({hasText:'Tracking saved'}).waitFor();
    await restore.locator('#trackingBackup [data-close]').click();
  }
  const restored = await state(restore); assert.deepEqual(restored.playthroughs,backup.state.playthroughs); assert.deepEqual(restored.journalEntries,backup.state.journalEntries); assert.deepEqual(restored.events,backup.state.events);
  await stats(restore,'3 / 6');
  passed.push('A current backup restores history, journal entries and plan statistics repeatedly without duplication');

  if (process.env.HISTORY_SCREENSHOT_DIR) await restore.locator('#playHistoryAlbum').screenshot({path:`${process.env.HISTORY_SCREENSHOT_DIR}/album.png`,animations:'disabled'});
  await restore.setViewportSize({width:390,height:844}); assert.equal(await restore.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await restore.locator('[data-playthrough="play-2"] [data-edit-play]').click();
  assert.equal(await restore.locator('#playthroughEditor').evaluate(node => node.scrollWidth <= node.clientWidth),true);
  if (process.env.HISTORY_SCREENSHOT_DIR) await restore.locator('#playthroughEditor').screenshot({path:`${process.env.HISTORY_SCREENSHOT_DIR}/mobile-editor.png`,animations:'disabled'});
  await restore.keyboard.press('Escape'); await restore.locator('#playthroughEditor').waitFor({state:'detached'});
  passed.push('Albums and completion editors fit mobile widths and preserve Escape navigation');
  await clean.close(); await c.close(); assert.deepEqual(errors,[]);
  for (const label of passed) console.log(`PASS ${label}`);
} finally { await browser.close(); }

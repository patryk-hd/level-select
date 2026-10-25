// Isolated fictional challenge fixtures; no personal browser or imports are opened.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { emptyState, ensureTarget, applyCommand } from '../tracking/domain.js';
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--playwright' || args[2] !== '--browser') throw Error('Provide --playwright <module> --browser <Chromium executable>.');
const module = await import(pathToFileURL(args[1]).href), { chromium } = module.default ?? module;
const browser = await chromium.launch({ executablePath: args[3], headless: true });
const origin = 'http://127.0.0.1:18894/retro', passed = [], errors = [];
let ranksChanged = false;
const catalog = JSON.parse(await readFile(new URL('../dist/data/catalog.json', import.meta.url), 'utf8')), catalogId = catalog.games[0].id;
async function context(timezoneId = 'Pacific/Tahiti') {
  const context = await browser.newContext({ acceptDownloads: true, timezoneId });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', async route => {
    const url = route.request().url(); if (!url.startsWith(`${origin}/`)) return route.abort();
    const path = new URL(url).pathname.slice('/retro/'.length); if (path.includes('..')) return route.abort();
    if (path === 'seed.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fictional rewards seed</title>' });
    if (path === 'assets/history-fixture.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#213d36"/><circle cx="150" cy="150" r="70" fill="#cca46b"/><text x="150" y="300" text-anchor="middle" fill="white" font-size="24">FICTIONAL QUEST</text></svg>' });
    try {
      let body = await readFile(new URL(`../dist/${path}`, import.meta.url));
      if (path === 'library/data/library-data.js') body = Buffer.from(body.toString().replace('window.PLAYNITE_SAMPLE = true', 'window.PLAYNITE_SAMPLE = false') + '\nwindow.PLAYNITE_LIBRARY=Array.from({length:4},(_,i)=>({...window.PLAYNITE_LIBRARY[0],id:`challenge-game-${i}`,name:`Challenge Fixture ${i}`,year:1985+i*10,genres:i%2?["Action"]:["Action","RPG"],notes:"",favorite:false,copies:[{id:`challenge-copy-${i}`,platforms:["SNES"],sources:["Fictional store"],year:1985+i*10}]}));');
      if (path === 'library/data/wishlist-data.js') body = Buffer.from(body.toString().replace('window.WISHLIST_SAMPLE = true', 'window.WISHLIST_SAMPLE = false') + '\nwindow.STEAM_WISHLIST = Array.from({length:10}, (_,i)=>({...window.STEAM_WISHLIST[0],appid:990000001+i,title:`Wishlist Reward Fixture ${i+1}`}));');
      if (path === 'data/catalog.json') { const data = JSON.parse(body); data.games=Array.from({length:4},(_,i)=>({...data.games[0],id:`challenge-catalog-${i}`,title:`Challenge Fixture ${i}`,systemId:'snes',rank:ranksChanged?99:i+1,year:1985+i*10,genres:i%2?['Action']:['Action','RPG'],cover:null}));data.updatedAt=ranksChanged?'2027-01-01':'2026-09-15';body=Buffer.from(JSON.stringify(data)); }
      return route.fulfill({ body, contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.html') ? 'text/html' : path.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
    } catch { return route.fulfill({ status: 404, body: 'Not found' }); }
  }); return context;
}
const state=page=>page.evaluate(async()=>(await(await import(new URL('../tracking/client.js',location.href))).trackingClient()).snapshot());
const ready=page=>page.locator('#newChallenge').waitFor();
const waitXP=(page,total)=>page.locator('.reward-level h3').filter({hasText:`· ${total} XP`}).waitFor();
async function generate(page,type='top') {
  await page.locator('#newChallenge').click();await page.locator('#challengeEditor [name=templateId]').selectOption(type);
  if(type==='top')await page.locator('#challengeEditor [name=system]').selectOption('snes');
  await page.locator('#challengeEditor [data-generate-button]').click();await page.locator('#challengeEditor [data-accept]').waitFor();
}
async function confirm(page) {await page.locator('#challengeEditor [name=confirmed]').check();await page.locator('#challengeEditor [data-accept] button').click();await page.locator('#challengeEditor').waitFor({state:'detached'});}
async function finishCell(page,cellId) {
  await page.locator(`.challenge-card:not(details *) [data-track][data-cell="${cellId}"]`).click();
  const start=page.locator('#planTracking [data-start]');if(await start.count())await start.click();
  await page.locator('#planTracking [data-status=finished]').click();await page.locator('#playthroughEditor [name=objective]').selectOption('main-game');
  await page.locator('#playthroughEditor [data-save-play]').click();await page.locator('#playthroughEditor').waitFor({state:'detached'});await page.locator('#planDetails [data-close]').click();
}
try {
  const c=await context(),page=await c.newPage();await page.goto(`${origin}/seed.html`);
  const seed=emptyState();seed.schemaVersion=4;for(const section of ['challenges','challengeRevisions','challengeEvidence','challengeAwards','matchReviews','productReviews'])delete seed[section];seed.migrations['legacy-v1']={id:'legacy-v1',recordedAt:'2026-09-01T12:00:00.000Z'};
  await page.evaluate(async seed=>new Promise((resolve,reject)=>{const request=indexedDB.open('retro-library-tracking',1);request.onupgradeneeded=()=>request.result.createObjectStore('workspaces');request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put(seed,'personal');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};}),seed);
  await page.goto(`${origin}/library/backlog.html?view=all`);await ready(page);assert.equal((await state(page)).schemaVersion,7);
  await page.evaluate(async()=>{const client=await(await import(new URL('../tracking/client.js',location.href))).trackingClient();for(let i=0;i<4;i++)await client.reviewMatch({catalogId:`challenge-catalog-${i}`,copyId:`challenge-copy-${i}`,decision:'accepted',expected:null});});
  await page.locator('#enableRewards').click();await waitXP(page,0);await generate(page);
  assert.equal(await page.locator('#challengeEditor [name=templateId] option').count(),6);assert.equal(await page.locator('.challenge-preview-cells article').count(),3);assert.equal(Object.keys((await state(page)).challenges).length,0);
  await page.locator('#challengeEditor [data-accept] button').click();assert.equal(await page.locator('#challengeEditor').isVisible(),true);await confirm(page);
  await page.locator('.challenge-count').filter({hasText:'0 / 3'}).waitFor();assert.equal(Object.keys((await state(page)).backlog).length,0);
  passed.push('Schema-four history upgrades; all six templates are offered and an owned top-ten preview requires confirmation without adding backlog commitments');

  const initial=await state(page),instance=Object.values(initial.challenges)[0],original=initial.challengeRevisions[instance.currentRevision];
  await generate(page,'passport');const other=await c.newPage();await other.goto(`${origin}/library/backlog.html?view=all`);await ready(other);
  await other.evaluate(async()=>{const client=await(await import(new URL('../tracking/client.js',location.href))).trackingClient();await client.setLimits(7,2);});
  await page.waitForFunction(async()=>(await(await import(new URL('../tracking/client.js',location.href))).trackingClient()).snapshot().settings.upNextLimit===7);
  await page.locator('#challengeEditor [name=confirmed]').check();await page.locator('#challengeEditor [data-accept] button').click();await page.locator('[data-challenge-status]').filter({hasText:'Tracking changed'}).waitFor();assert.equal(Object.keys((await state(page)).challenges).length,1);await page.locator('#challengeEditor [data-close]').click();await other.close();
  passed.push('A second tab invalidates an old acceptance preview and cannot overwrite the saved challenge');

  const first=original.cells[0].id;await page.locator(`[data-track][data-cell="${first}"]`).click();await page.locator('#planTracking [data-start]').click();await page.locator('#planTracking [data-active-journal]').click();
  await page.locator('#playJournal [name=kind]').selectOption('milestone');await page.locator('#playJournal [name=text]').fill('Reached the first island');await page.locator('#playJournal [name=achieved]').check();await page.locator('#playJournal button[type=submit]').click();await page.locator('#playJournal .journal-entry').waitFor();await page.locator('#playJournal [data-close]').click();await page.locator('#planDetails [data-close]').click();
  await page.locator('.challenge-cell-status').filter({hasText:'1 achieved milestone'}).waitFor();await waitXP(page,0);await finishCell(page,first);await waitXP(page,100);await page.locator('.challenge-count').filter({hasText:'1 / 3'}).waitFor();
  passed.push('A declared milestone shows partial challenge progress before a selected-copy finish fills its cell');

  const second=original.cells[1].id;await page.locator(`[data-substitute][data-cell="${second}"]`).click();
  const select=page.locator(`#challengeEditor [data-cell="${second}"]`),options=await select.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value));const selected=await select.inputValue();
  await select.selectOption(options.find(value=>value!==selected));await confirm(page);await page.locator('.challenge-count').filter({hasText:'1 / 3'}).waitFor();
  const substituted=await state(page),current=substituted.challengeRevisions[substituted.challenges[instance.id].currentRevision];assert.equal(Object.keys(substituted.challengeRevisions).length,2);assert.deepEqual(current.cells[0].boundary,original.cells[0].boundary);assert.notEqual(current.cells[1].member.key,original.cells[1].member.key);
  await page.locator('[data-challenge-history]').click();assert.match(await page.locator('#challengeEditor').innerText(),/substitution/);assert.match(await page.locator('#challengeEditor').innerText(),/editorial-system-rank v1/);await page.locator('#challengeEditor [data-close]').click();
  passed.push('Substitutions preserve unchanged progress and show both the old membership and frozen ranking basis in revision history');

  ranksChanged=true;await page.reload();await ready(page);await page.locator('.challenge-count').filter({hasText:'1 / 3'}).waitFor();assert.deepEqual((await state(page)).challengeRevisions[current.id],current);
  await page.locator('[data-regenerate]').click();await page.locator('#challengeEditor [data-generate-button]').click();await page.locator('[data-challenge-preview]').filter({hasText:'No achievable board'}).waitFor();assert.equal(await page.locator('#challengeEditor [data-accept]').count(),0);await page.locator('#challengeEditor [data-close]').click();
  passed.push('A catalog refresh changing every rank to 99 leaves accepted membership intact; regeneration exposes the empty new top-ten pool');

  await finishCell(page,current.cells[1].id);await waitXP(page,200);await finishCell(page,current.cells[2].id);await waitXP(page,375);await page.locator('.challenge-count').filter({hasText:'3 / 3'}).waitFor();await page.locator('.challenge-badge').filter({hasText:'Badge earned'}).waitFor();
  await page.locator(`[data-track][data-cell="${current.cells[2].id}"]`).click();await page.locator('#planTracking [data-undo]').click();await waitXP(page,200);await page.locator('#planDetails [data-close]').click();await page.locator('.challenge-count').filter({hasText:'2 / 3'}).waitFor();
  await finishCell(page,current.cells[2].id);await waitXP(page,375);assert.equal(Object.keys((await state(page)).challengeAwards).length,1);
  passed.push('Completing the board grants one badge and 75 XP; Undo and refinish reverse and restore that same bonus');

  if(process.env.CHALLENGE_SCREENSHOT_DIR)await page.locator('#playChallenges').screenshot({path:`${process.env.CHALLENGE_SCREENSHOT_DIR}/board.png`,animations:'disabled'});
  await page.locator('#planBackup').click();const download=page.waitForEvent('download');await page.locator('#trackingBackup [data-export]').click();const backup=JSON.parse(await readFile(await(await download).path(),'utf8'));assert.equal(backup.version,7);await page.locator('#trackingBackup [data-close]').click();
  const clean=await context('Asia/Tokyo'),restore=await clean.newPage();await restore.goto(`${origin}/library/backlog.html?view=all`);await ready(restore);
  for(let pass=0;pass<2;pass++){
    await restore.locator('#planBackup').click();await restore.locator('#trackingBackup [data-file]').setInputFiles({name:'fictional-challenges.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await restore.locator('#trackingBackup [data-apply]').waitFor();for(const select of await restore.locator('#trackingBackup [data-conflict]').all())await select.selectOption('current');await restore.locator('#trackingBackup [data-apply]').click();await restore.locator('#trackingBackup [data-status]').filter({hasText:'Tracking saved'}).waitFor();await restore.locator('#trackingBackup [data-close]').click();await waitXP(restore,375);
  }
  const restored=await state(restore);assert.deepEqual(restored.challengeRevisions,backup.state.challengeRevisions);assert.deepEqual(restored.challengeAwards,backup.state.challengeAwards);assert.equal(restored.challengeRevisions[current.id].rules.timeZone,'Pacific/Tahiti');
  await restore.reload();await ready(restore);await waitXP(restore,375);
  passed.push('Repeated clean-profile restore and reload preserve challenges, badge proofs, revisions and the original timezone');

  await restore.setViewportSize({width:390,height:844});assert.equal(await restore.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.CHALLENGE_SCREENSHOT_DIR){await restore.locator('#newChallenge').focus();await restore.evaluate(()=>window.scrollTo(0,document.getElementById('playChallenges').getBoundingClientRect().top+scrollY-85));await restore.screenshot({path:`${process.env.CHALLENGE_SCREENSHOT_DIR}/mobile-board.png`,animations:'disabled'});}
  await restore.locator('#newChallenge').click();assert.equal(await restore.locator('#challengeEditor').evaluate(node=>node.scrollWidth<=node.clientWidth),true);await restore.keyboard.press('Escape');await restore.locator('#challengeEditor').waitFor({state:'detached'});
  await restore.locator('#rewardVisibility').click();await restore.locator('#rewardBody').waitFor({state:'hidden'});assert.equal(await restore.locator('#playChallenges .challenge-badge').count(),0);assert.equal(await restore.locator('#playChallenges [data-track]').count(),3);
  await restore.locator('[data-archive]').click();await restore.locator('[data-archived] summary').filter({hasText:'1'}).waitFor();await restore.locator('[data-archived] summary').click();await restore.locator('[data-archived] .challenge-count').filter({hasText:'3 / 3'}).waitFor();
  passed.push('Mobile layouts and keyboard dismissal work; hidden gamification leaves plans usable and archiving preserves history');
  await clean.close();await c.close();assert.deepEqual(errors,[]);for(const label of passed)console.log(`PASS ${label}`);
} finally {await browser.close();}

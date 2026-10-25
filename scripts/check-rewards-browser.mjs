// Isolated fictional progression fixtures; no personal browser or imports are opened.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { emptyState, ensureTarget, applyCommand } from '../tracking/domain.js';
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--playwright' || args[2] !== '--browser') throw Error('Provide --playwright <module> --browser <Chromium executable>.');
const module = await import(pathToFileURL(args[1]).href), { chromium } = module.default ?? module;
const browser = await chromium.launch({ executablePath: args[3], headless: true });
const origin = 'http://127.0.0.1:18893/retro', passed = [], errors = [];
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
      if (path === 'library/data/library-data.js') body = Buffer.from(body.toString().replace('window.PLAYNITE_SAMPLE = true', 'window.PLAYNITE_SAMPLE = false'));
      if (path === 'library/data/wishlist-data.js') body = Buffer.from(body.toString().replace('window.WISHLIST_SAMPLE = true', 'window.WISHLIST_SAMPLE = false') + '\nwindow.STEAM_WISHLIST = Array.from({length:10}, (_,i)=>({...window.STEAM_WISHLIST[0],appid:990000001+i,title:`Wishlist Reward Fixture ${i+1}`}));');
      if (path === 'data/catalog.json') { const data = JSON.parse(body); data.games[0].cover = { local: 'assets/history-fixture.svg' }; body = Buffer.from(JSON.stringify(data)); }
      return route.fulfill({ body, contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.html') ? 'text/html' : path.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
    } catch { return route.fulfill({ status: 404, body: 'Not found' }); }
  }); return context;
}
const state = page => page.evaluate(async()=> (await (await import(new URL('../tracking/client.js',location.href))).trackingClient()).snapshot());
const xp = page => page.evaluate(async()=>{const c=await(await import(new URL('../tracking/client.js',location.href))).trackingClient();const r=await import(new URL('../tracking/rewards.js',location.href));return r.rewardTotal(c.snapshot());});
const ready = page => page.locator('#planStatistics h2').waitFor();
const waitXP = (page,value) => page.locator('.reward-level h3').filter({hasText:`· ${value} XP`}).waitFor();
const track = (page,title) => page.locator('.plan-row').filter({has:page.locator('h2',{hasText:title})}).locator('[data-open]').click();
async function savePlay(page) {await page.locator('#playthroughEditor [data-save-play]').click();await page.locator('#playthroughEditor').waitFor({state:'detached'});}
async function finish(page,title,reflection) {
  await track(page,title);await page.locator('#planTracking [data-status=finished]').click();
  await page.locator('#playthroughEditor [name=objective]').selectOption('main-game');
  if(reflection){await page.locator('#playthroughEditor [data-finish-details] summary').click();await page.locator('#playthroughEditor [name=reflection]').fill(reflection);}
  await savePlay(page);await page.locator('#planDetails [data-close]').click();
}
async function goal(page,slot,type,targetId) {
  await page.locator(`#editGoal${slot}`).click();await page.locator('#rewardEditor [name=type]').selectOption(type);
  if(targetId)await page.locator('#rewardEditor [name=targetId]').selectOption(targetId);
  await page.locator('#rewardEditor button[type=submit]').click();await page.locator('#rewardEditor').waitFor({state:'detached'});
}
try {
  const c=await context(),page=await c.newPage();await page.goto(`${origin}/seed.html`);
  let seed=emptyState();const at='2026-01-01T12:00:00.000Z';
  for(let i=1;i<=3;i++){
    const target=ensureTarget(seed,{ref:{provider:'manual',id:`reward-${i}`},title:`Reward Fixture ${i}`,platforms:['PC']});
    seed=applyCommand(seed,{type:'queue',targetId:target.id,at,eventId:`queue-${i}`});
    seed=applyCommand(seed,{type:'start',targetId:target.id,at,eventId:`start-${i}`,playthroughId:`play-${i}`,objective:'main-game'});
    if(i===3)seed=applyCommand(seed,{type:'status',targetId:target.id,at,eventId:'old-finish',playthroughId:'play-3',status:'finished'});
  }
  seed.migrations['legacy-v1']={id:'legacy-v1',recordedAt:at};
  await page.evaluate(async seed=>new Promise((resolve,reject)=>{const request=indexedDB.open('retro-library-tracking',1);request.onupgradeneeded=()=>request.result.createObjectStore('workspaces');request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put(seed,'personal');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};}),seed);
  await page.goto(`${origin}/library/backlog.html?view=all`);await ready(page);await page.locator('#enableRewards').click();await waitXP(page,0);
  assert.equal((await state(page)).progression.profile.timeZone,'Pacific/Tahiti');
  assert.equal(await page.locator('[data-goal-slot]').count(),3);assert.equal(await page.locator('.completion-card').count(),1);
  passed.push('Enabling optional rewards preserves old history at zero XP and fixes the workspace calendar');

  await goal(page,0,'continue','target:manual:reward-1');
  await track(page,'Reward Fixture 1');await page.locator('#planTracking [data-active-journal]').click();
  await page.locator('#playJournal [name=text]').fill('A short, enjoyable session');await page.locator('#playJournal button[type=submit]').click();
  await page.locator('#playJournal .journal-entry').waitFor();await page.locator('#playJournal [data-close]').click();await page.locator('#planDetails [data-close]').click();
  await page.locator('[data-goal-slot="0"] .goal-status').filter({hasText:'Complete'}).waitFor();assert.equal(await xp(page),0);
  passed.push('A newly chosen continue goal completes through a dated session note without extra XP');

  await finish(page,'Reward Fixture 1','A thoughtful ending');await waitXP(page,110);
  await track(page,'Reward Fixture 1');await page.locator('#planTracking [data-undo]').click();await waitXP(page,0);await page.locator('#planDetails [data-close]').click();
  await finish(page,'Reward Fixture 1','A thoughtful ending');await waitXP(page,110);
  assert.equal(Object.values((await state(page)).rewardLedger).filter(entry=>entry.type==='finish'&&entry.amount).length,1);
  passed.push('Finish, reflection and Undo update cards and XP together; correcting and refinish cannot duplicate the reward');

  await goal(page,1,'milestone','target:manual:reward-1');
  await page.locator('[data-playthrough="play-1"] [data-open-journal]').click();
  await page.locator('#playJournal [name=kind]').selectOption('mastery');await page.locator('#playJournal [name=text]').fill('Restore every optional garden');await page.locator('#playJournal [name=achieved]').check();
  await page.locator('#playJournal button[type=submit]').click();await page.locator('#playJournal .journal-entry').filter({hasText:'Mastery achieved'}).waitFor();
  await page.locator('#playJournal [data-close]').click();await waitXP(page,160);
  await page.locator('[data-goal-slot="1"] .goal-status').filter({hasText:'Complete'}).waitFor();
  await goal(page,2,'review');await page.locator('#editGoal2').click();await page.locator('#rewardEditor [data-skip]').click();await page.locator('#rewardEditor').waitFor({state:'detached'});
  await page.locator('[data-goal-slot="2"] .goal-status').filter({hasText:'Skipped'}).waitFor();assert.equal(await xp(page),160);
  passed.push('Additional mastery earns one 50-XP tier; milestone goals and skipped weeks remain independent');

  await page.locator('#rewardPreferences').click();await page.locator('#rewardEditor [name=frame]').selectOption('brass');await page.locator('#rewardEditor button[type=submit]').click();await page.locator('#rewardEditor').waitFor({state:'detached'});
  assert.equal(await page.locator('#historyCards').getAttribute('data-reward-frame'),'brass');
  await page.locator('#rewardVisibility').click();await page.locator('#rewardBody').waitFor({state:'hidden'});assert.equal(await page.locator('#rewardBody').isVisible(),false);assert.equal(await page.locator('#historyCards').getAttribute('data-reward-frame'),'plain');
  await finish(page,'Reward Fixture 2','Another perspective');assert.equal(await xp(page),270);
  await page.locator('#rewardVisibility').click();await waitXP(page,270);assert.equal(await page.locator('#historyCards').getAttribute('data-reward-frame'),'brass');
  passed.push('Hiding gamification keeps tracking usable and rewards correct, restoring the chosen cosmetic frame when shown');

  await page.locator('[data-details=links] summary').click();await page.locator('#rewardLink').click();
  await page.locator('#rewardEditor [name=first]').selectOption('target:manual:reward-1');await page.locator('#rewardEditor [name=second]').selectOption('target:manual:reward-2');await page.locator('#rewardEditor [data-preview-link]').click();
  assert.match(await page.locator('#rewardEditor [data-impact]').innerText(),/270 XP → 170 XP/);
  const other=await c.newPage();await other.goto(`${origin}/library/backlog.html?view=all`);await ready(other);
  await other.evaluate(async()=>{const client=await(await import(new URL('../tracking/client.js',location.href))).trackingClient();await client.setLimits(6,2);});
  await page.waitForFunction(async()=> (await(await import(new URL('../tracking/client.js',location.href))).trackingClient()).snapshot().settings.upNextLimit===6);
  await page.locator('#rewardEditor [name=confirmed]').check();await page.locator('#rewardEditor [data-confirm-link]').click();await page.locator('#rewardEditor [role=status]').filter({hasText:'Preview the XP adjustment again'}).waitFor();assert.equal(await xp(page),270);
  await page.locator('#rewardEditor [data-preview-link]').click();await page.locator('#rewardEditor [data-confirm-link]').click();await page.locator('#rewardEditor').waitFor({state:'detached'});await waitXP(page,170);await waitXP(other,170);
  assert.equal(Object.keys((await state(page)).playthroughs).length,3);await other.close();
  passed.push('Duplicate reward links show their XP adjustment, reject stale previews and synchronize across tabs without merging play history');

  await page.locator('#planBackup').click();const download=page.waitForEvent('download');await page.locator('#trackingBackup [data-export]').click();
  const backup=JSON.parse(await readFile(await(await download).path(),'utf8'));assert.equal(backup.version,7);
  const clean=await context('Asia/Tokyo'),restore=await clean.newPage();await restore.goto(`${origin}/library/backlog.html?view=all`);await ready(restore);
  for(let pass=0;pass<2;pass++){
    await restore.locator('#planBackup').click();await restore.locator('#trackingBackup [data-file]').setInputFiles({name:'fictional-rewards.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await restore.locator('#trackingBackup [data-preview] [data-apply]').waitFor();for(const select of await restore.locator('#trackingBackup [data-conflict]').all())await select.selectOption(pass?'current':'incoming');
    await restore.locator('#trackingBackup [data-preview] [data-apply]').click();await restore.locator('#trackingBackup [data-status]').filter({hasText:'Tracking saved'}).waitFor();await restore.locator('#trackingBackup [data-close]').click();await waitXP(restore,170);
  }
  const restored=await state(restore);assert.deepEqual(restored.rewardLedger,backup.state.rewardLedger);assert.deepEqual(restored.rewardAdjustments,backup.state.rewardAdjustments);assert.deepEqual(restored.weeklyGoals,backup.state.weeklyGoals);assert.equal(restored.progression.profile.timeZone,'Pacific/Tahiti');
  await restore.reload();await ready(restore);await waitXP(restore,170);
  passed.push('Current schema export and repeated restore preserve rewards, goals, audit and the original calendar on a device in another timezone');

  if(process.env.REWARDS_SCREENSHOT_DIR)await restore.locator('#progressRewards').screenshot({path:`${process.env.REWARDS_SCREENSHOT_DIR}/progress.png`,animations:'disabled'});
  await restore.setViewportSize({width:390,height:844});assert.equal(await restore.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.REWARDS_SCREENSHOT_DIR)await restore.locator('#progressRewards').screenshot({path:`${process.env.REWARDS_SCREENSHOT_DIR}/mobile-progress.png`,animations:'disabled'});
  await restore.locator('#editGoal0').click();assert.equal(await restore.locator('#rewardEditor').evaluate(node=>node.scrollWidth<=node.clientWidth),true);await restore.keyboard.press('Escape');await restore.locator('#rewardEditor').waitFor({state:'detached'});
  passed.push('Progress cards and goal editors fit a mobile viewport and support keyboard dismissal');

  await restore.setViewportSize({width:1280,height:900});await goal(restore,2,'review');
  await restore.locator('[data-goal-slot="2"] a').click();await restore.locator('#reviewStart').click();
  for(let i=1;i<=10;i++){
    await restore.locator('[data-review-action=keep]').click();
    if(i<10)await restore.locator('#reviewBody').filter({hasText:`${i} / 10`}).waitFor();
    else await restore.locator('#reviewBody').filter({hasText:'Review complete'}).waitFor();
  }
  assert.equal(await xp(restore),190);await restore.locator('#reviewUndo').click();await restore.locator('#reviewBody').filter({hasText:'9 / 10'}).waitFor();assert.equal(await xp(restore),170);
  await restore.locator('[data-review-action=keep]').click();await restore.locator('#reviewBody').filter({hasText:'Review complete'}).waitFor();assert.equal(await xp(restore),190);
  await restore.goto(`${origin}/library/backlog.html?view=all`);await ready(restore);await waitXP(restore,190);await restore.locator('[data-goal-slot="2"] .goal-status').filter({hasText:'Complete'}).waitFor();
  passed.push('Ten actual wishlist keeps award one weekly bonus and complete the goal; Undo reverses both without duplicate XP');
  await clean.close();await c.close();assert.deepEqual(errors,[]);for(const label of passed)console.log(`PASS ${label}`);
} finally {await browser.close();}

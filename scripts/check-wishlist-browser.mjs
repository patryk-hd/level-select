// Uses authored samples and synthetic storage in fresh browser contexts only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { emptyState } from '../tracking/domain.js';
import { patchAnnotation } from '../tracking/compat.js';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--playwright'||args[2]!=='--browser')throw Error('Provide --playwright <module> --browser <Chromium executable>.');
const module=await import(pathToFileURL(args[1]).href),{chromium}=module.default??module;
const browser=await chromium.launch({executablePath:args[3],headless:true}), origin='http://127.0.0.1:18891/retro';
const passed=[],errors=[];
async function context(){
  const context=await browser.newContext({acceptDownloads:true});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/*',async route=>{
    const url=route.request().url();if(!url.startsWith(`${origin}/`))return route.abort();
    const path=new URL(url).pathname.slice('/retro/'.length);if(path.includes('..'))return route.abort();
    if(path==='seed.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic storage fixture</title>'});
    try{
      let body=await readFile(new URL(`../dist/${path}`,import.meta.url));
      if(path==='library/data/library-data.js')body=Buffer.from(body.toString().replace('window.PLAYNITE_SAMPLE = true','window.PLAYNITE_SAMPLE = false'));
      if(path==='library/data/wishlist-data.js')body=Buffer.from(body.toString().replace('window.WISHLIST_SAMPLE = true','window.WISHLIST_SAMPLE = false')+`\nwindow.STEAM_WISHLIST[0].genres=['RPG'];window.STEAM_WISHLIST[0].priceSnapshot={amountMinor:1499,currency:'GBP',observedAt:new Date().toISOString()};window.STEAM_WISHLIST[1].priceSnapshot={amountMinor:1999,currency:'USD',observedAt:new Date().toISOString()};window.STEAM_WISHLIST[2].priceSnapshot={amountMinor:799,currency:'GBP',observedAt:'2020-01-01T00:00:00.000Z'};`);
      return route.fulfill({body,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':path.endsWith('.html')?'text/html':'application/octet-stream'});
    }catch{return route.fulfill({status:404,body:'Not found'});}
  });return context;
}
const state=page=>page.evaluate(async()=>(await(await import(new URL('../tracking/client.js',location.href))).trackingClient()).snapshot());
async function ready(page){await page.waitForFunction(()=>window.retroTracking?.status().ready);await page.locator('#reviewStart').waitFor();}
async function openGame(page,id){await page.goto(`${origin}/library/wishlist.html?game=${id}`);await page.locator('#wishlistDecisionTracking [data-wish-form]').waitFor();}
async function reviewProgress(page,pattern){await page.locator('#reviewBody').filter({hasText:pattern}).waitFor();assert.match(await page.locator('#reviewBody').innerText(),pattern);}
async function download(page,selector){const promise=page.waitForEvent('download');await page.locator(selector).click();return JSON.parse(await readFile(await(await promise).path(),'utf8'));}
try{
  const c=await context(),page=await c.newPage();await page.goto(`${origin}/seed.html`);
  let old=patchAnnotation(emptyState(),{ref:{provider:'steam',id:'900000001'},title:'Sample Space Adventure',platforms:['PC']},{notes:'Preserved fixture note'});
  old.schemaVersion=1;delete old.reviewSessions;delete old.journalEntries; for (const section of ['progression','rewardEvidence','rewardLedger','rewardAdjustments','rewardLinks','weeklyGoals','challenges','challengeRevisions','challengeEvidence','challengeAwards','matchReviews','productReviews']) delete old[section];old.revision=7;old.migrations['legacy-v1']={id:'legacy-v1',recordedAt:'2026-09-14T00:00:00.000Z'};
  await page.evaluate(async old=>{localStorage.setItem('steam-wishlist-notes','{"900000001":"Preserved fixture note"}');await new Promise((resolve,reject)=>{const request=indexedDB.open('retro-library-tracking',1);request.onupgradeneeded=()=>request.result.createObjectStore('workspaces');request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put(old,'personal');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};request.onerror=()=>reject(request.error);});},old);
  await openGame(page,'900000001');assert.equal(await page.locator('#notesInput').inputValue(),'Preserved fixture note');
  assert.equal((await state(page)).schemaVersion,7);
  async function saveTarget(id,amount){
    await openGame(page,id);const form=page.locator('[data-wish-form]');await form.locator('[name="amount"]').fill(amount);await form.locator('[name="currency"]').selectOption('GBP');
    await form.locator('[name="reason"]').fill('Fixture price decision');await form.locator('[name="priority"]').selectOption('3');await form.locator('button').click();
    await page.waitForFunction(id=>Object.values(window.retroTracking.snapshot().wishlist).some(entry=>entry.targetId.endsWith(id)&&entry.targetPrice?.currency==='GBP'),id);
  }
  await saveTarget('900000001','15.00');
  assert.equal((await state(page)).annotations['steam:900000001'].notes,'Preserved fixture note');
  await saveTarget('900000002','30.00');await saveTarget('900000003','10.00');
  passed.push('A version-one IndexedDB workspace upgrades and retains notes while saving structured decisions');
  await page.locator('#closeDetails').click();await page.locator('.filter-panel summary').click();
  for(const [filter,title] of [['met','Sample Space Adventure'],['currency','Sample City Builder'],['stale','Sample Puzzle Quest']]){
    await page.locator('#targetPriceFilter').selectOption(filter);assert.equal(await page.locator('#results .game-card').count(),1);assert.match(await page.locator('#results').innerText(),new RegExp(title));
  }
  await page.reload();await ready(page);assert.equal(await page.locator('#targetPriceFilter').inputValue(),'stale');
  await page.locator('.filter-panel summary').click();await page.locator('#resetFilters').click();
  passed.push('Bookmarkable target-price filters separate recent matches, currency mismatches and stale observations');
  await page.locator('#reviewStart').click();
  if(process.env.WISHLIST_SCREENSHOT_DIR)await page.locator('#wishlistReview').screenshot({path:`${process.env.WISHLIST_SCREENSHOT_DIR}/review-active.png`,animations:'disabled'});
  await page.locator('[data-review-action="keep"]').click();
  await reviewProgress(page,/1 \/ 3/);
  await page.reload();await ready(page);await page.locator('#reviewStart').click();await reviewProgress(page,/1 \/ 3/);
  await page.locator('[data-review-action="wait-for-price"]').click();await reviewProgress(page,/2 \/ 3/);
  await page.locator('#reviewUndo').click();await reviewProgress(page,/1 \/ 3/);
  await page.locator('[data-review-action="snooze"]').click();await reviewProgress(page,/2 \/ 3/);await page.locator('[data-review-action="archive"]').click();
  await reviewProgress(page,/Review complete/);
  if(process.env.WISHLIST_SCREENSHOT_DIR)await page.locator('#wishlistReview').screenshot({path:`${process.env.WISHLIST_SCREENSHOT_DIR}/review.png`,animations:'disabled'});
  await page.locator('#wishlistReview [data-close-wishlist-dialog]').click();
  const reviewed=await state(page);assert.equal(Object.keys(Object.values(reviewed.reviewSessions)[0].reviewed).length,3);
  passed.push('Reviews resume after reload, count keeps, undo decisions and complete without requiring removals');
  await page.locator('#wishlistCompareOpen').click();
  await page.locator('[data-compare-choice="both"]').click();await page.locator('#compareStatus').filter({hasText:'Saved'}).waitFor();
  assert.equal(Object.values((await state(page)).wishlist).filter(entry=>entry.decision==='want-soon').length,2);
  await page.locator('[data-compare-choice="neither"]').click();await page.waitForFunction(()=>Object.values(window.retroTracking.snapshot().wishlist).filter(entry=>entry.decision==='maybe').length===2);
  const beforeSkip=await state(page);await page.locator('[data-compare-choice="skip"]').click();assert.deepEqual(await state(page),beforeSkip);
  await page.locator('#wishlistCompare [data-close-wishlist-dialog]').click();
  passed.push('Pairwise comparison preserves both entries and Skip leaves tracking unchanged');
  await openGame(page,'900000001');
  await page.locator('#wishlistDecisionTracking summary').filter({hasText:'Owned alternatives'}).click();
  assert.match(await page.locator('#wishlistDecisionTracking').innerText(),/another platform; the wanted edition stays wishlisted/);
  await page.locator('#wishlistDecisionTracking summary').filter({hasText:'Record acquisition'}).click();
  await page.locator('[data-acquire-form] [name="confirmed"]').check();await page.locator('[data-acquire-form] [name="acquiredDate"]').fill('');
  await page.locator('[data-acquire-form] button').click();await page.locator('#wishlistDecisionTracking').filter({hasText:'Acquisition recorded'}).waitFor();
  const acquired=await state(page);assert.equal(Object.keys(acquired.backlog).length,0);assert.equal(acquired.annotations['steam:900000001'].notes,'Preserved fixture note');
  assert.equal(await page.locator('#toggleRemoved').isDisabled(),true);
  await page.evaluate(()=>window.retroTracking.removeWishlist(['900000001'],true));
  assert.deepEqual((await state(page)).wishlist,acquired.wishlist);
  await page.locator('#closeDetails').click();await page.locator('.section-tools summary').click();
  const removals=await download(page,'#exportRemoved'), acquisitions=await download(page,'#exportAcquired'), trimmed=await download(page,'#exportTrimmed');
  assert.ok(removals.every(game=>game.appid!=='900000001'));assert.equal(acquisitions[0].appid,'900000001');assert.equal(acquisitions[0].acquiredAt,null);
  assert.ok(trimmed.data.every(game=>game.gameid[1]!=='app/900000001'));
  passed.push('Acquisition preserves notes and unknown dates, with separate exports and no automatic backlog entry');
  await openGame(page,'900000003');await page.locator('#wishlistDecisionTracking summary').filter({hasText:'Record acquisition'}).click();
  await page.locator('[data-acquire-form] [name="confirmed"]').check();await page.locator('[data-acquire-form] [name="handoff"]').selectOption('upnext');await page.locator('[data-acquire-form] button').click();
  await page.locator('#wishlistDecisionTracking').filter({hasText:'Acquisition recorded'}).waitFor();
  await page.goto(`${origin}/library/backlog.html`);await page.locator('.plan-row').filter({hasText:'Sample Puzzle Quest'}).waitFor();
  assert.equal(Object.keys((await state(page)).playthroughs).length,0);
  passed.push('Explicit acquisition handoff reaches Up Next without starting a playthrough');
  await page.locator('#planBackup').click();const backup=await download(page,'#trackingBackup [data-export]');assert.equal(backup.version,7);
  const clean=await context(),restore=await clean.newPage();await restore.goto(`${origin}/library/wishlist.html`);await ready(restore);
  await restore.locator('.section-tools summary').click();await restore.locator('#backupLibrary').click();
  await restore.locator('#trackingBackup [data-file]').setInputFiles({name:'tracking.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await restore.locator('#trackingBackup [data-preview] [data-apply]').waitFor();
  for(const select of await restore.locator('#trackingBackup [data-conflict]').all())await select.selectOption('current');
  await restore.locator('#trackingBackup [data-preview] [data-apply]').click();await restore.locator('#trackingBackup [data-status]').filter({hasText:'Tracking saved'}).waitFor();
  const restored=await state(restore);assert.deepEqual(restored.reviewSessions,backup.state.reviewSessions);assert.deepEqual(restored.wishlist,backup.state.wishlist);assert.deepEqual(restored.ownership,backup.state.ownership);
  await restore.locator('#trackingBackup [data-close]').click();
  passed.push('A clean browser restores review sessions, decisions, acquisition records and handoff from a current backup');
  await openGame(restore,'900000001');await restore.setViewportSize({width:390,height:844});
  assert.equal(await restore.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.WISHLIST_SCREENSHOT_DIR)await restore.locator('#detailsPanel').screenshot({path:`${process.env.WISHLIST_SCREENSHOT_DIR}/mobile-detail.png`,animations:'disabled'});
  await restore.keyboard.press('Escape');assert.equal(await restore.locator('#detailsPanel').isVisible(),false);
  passed.push('Wishlist planning remains usable on mobile and dialogs close with Escape');
  await clean.close();await c.close();assert.deepEqual(errors,[]);for(const label of passed)console.log(`PASS ${label}`);
}finally{await browser.close();}

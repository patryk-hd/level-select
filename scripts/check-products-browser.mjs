// Fictional products and ratings only; every request is fulfilled locally.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--playwright'||args[2]!=='--browser')throw Error('Provide --playwright <module> --browser <Chromium executable>.');
const module=await import(pathToFileURL(args[1]).href),{chromium}=module.default??module;
const browser=await chromium.launch({executablePath:args[3],headless:true});
const origin='http://127.0.0.1:18897/retro',errors=[],passed=[];
let changed=false;
async function context() {
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  ctx.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await ctx.route('**/*',async route=>{
    if(!route.request().url().startsWith(`${origin}/`))return route.abort();
    const path=new URL(route.request().url()).pathname.slice('/retro/'.length);if(path.includes('..'))return route.abort();
    try {
      let body=await readFile(new URL(`../dist/${path}`,import.meta.url));
      if(path==='library/data/library-data.js')body=Buffer.from(body.toString()+`
        {const game=structuredClone(window.PLAYNITE_LIBRARY[0]);
        Object.assign(game,{id:'fixture-steam-group',name:'Fictional original',platforms:['Windows'],sources:['Steam','GOG'],notes:'Keep this note',steamAppId:'900000002'});
        game.copies=['Steam','GOG'].map((source,i)=>({...game.copies[0],id:'fixture-copy-'+i,name:'Fictional original',year:${changed?2026:2006},platforms:['Windows'],sources:[source],steamAppId:'900000001',steamAppIdProvenance:{origin:'title-search',trust:'candidate'}}));
        window.PLAYNITE_LIBRARY.push(game);window.PLAYNITE_STATS.platforms.push(['Windows',1]);window.PLAYNITE_STATS.sources.push(['Steam',1],['GOG',1]);}
      `);
      return route.fulfill({body,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':path.endsWith('.html')?'text/html':'application/octet-stream'});
    } catch {return route.fulfill({status:404,body:'Not found'});}
  });return ctx;
}
const ready=page=>page.waitForFunction(()=>window.retroTracking);
async function openCopy(page) {
  await page.goto(`${origin}/library/index.html?game=fixture-steam-group`);await ready(page);
  await page.evaluate(async()=>{if(!window.retroTracking.status().ready)await window.retroTracking.commitMigration();});
  await page.locator('#ratingCopy').selectOption('fixture-copy-0');
}
const reviewDialog=page=>page.locator('.product-review-dialog');
try {
  const ctx=await context(),page=await ctx.newPage();await openCopy(page);
  const before=await page.evaluate(()=>window.retroTracking.snapshot());
  await page.locator('[data-review-product]').click();
  const dialog=reviewDialog(page);
  assert.match(await dialog.innerText(),/Title-search candidate/);
  assert.equal(await dialog.locator('[data-product-decision=accepted]').isDisabled(),true);
  await dialog.locator('[data-product-input]').fill('https://store.steampowered.com.evil.test/app/900000001');
  assert.equal(await dialog.locator('[data-product-link]').isVisible(),false);
  await dialog.locator('[data-product-input]').fill('https://store.steampowered.com/app/900000001/');
  await dialog.locator('[data-product-confirm]').check();await dialog.locator('[data-product-decision=accepted]').click();
  await dialog.locator('[data-product-status]').filter({hasText:'saved'}).waitFor();
  await dialog.locator('[data-close]').click();
  await page.locator('[data-copy-provider-ratings]').filter({hasText:'95% positive'}).waitFor();
  assert.equal(await page.locator('#notesInput').inputValue(),'Keep this note');
  const after=await page.evaluate(()=>window.retroTracking.snapshot());
  for(const key of ['targets','playthroughs','annotations','backlog','ownership','rewardLedger'])assert.deepEqual(after[key],before[key],key);
  const backup=await page.evaluate(()=>window.retroTracking.backup());assert.equal(backup.version,7);
  await page.locator('#ratingCopy').selectOption('fixture-copy-1');
  await page.locator('[data-copy-provider-ratings]').filter({hasText:'No verified provider snapshot'}).waitFor();
  passed.push('Copy review validates store URLs and requires explicit edition confirmation; Steam scores appear only for the confirmed copy, preserving notes/history');

  await page.goto(`${origin}/library/index.html?rating=steam-raw&platform=pc&source=store:steam`);await ready(page);
  await page.locator('.game-card').filter({hasText:'95%'}).waitFor();
  await page.reload();await ready(page);assert.match(await page.locator('#results').innerText(),/95%/);
  await page.locator('.section-tools > summary').click();await page.locator('#reviewSteamProducts').click();
  await dialog.locator('[data-filter]').selectOption('accepted');
  assert.match(await dialog.locator('[data-product-body]').innerText(),/Fictional original/);
  await page.screenshot({path:'/tmp/retro-product-review-desktop.png'});
  const other=await ctx.newPage();await other.goto(`${origin}/library/index.html`);await ready(other);
  await other.evaluate(async()=>{
    const c=window.retroTracking,state=c.snapshot(),review=state.productReviews['fixture-copy-0'];
    await c.reviewProduct({copyId:'fixture-copy-0',product:review.productId,decision:'rejected',expected:review,expectedIdentity:review.fingerprint});
  });
  await dialog.locator('[data-product-status]').filter({hasText:'another tab'}).waitFor();
  await dialog.locator('[data-product-confirm]').check();await dialog.locator('[data-product-decision=accepted]').click();
  await dialog.locator('[data-product-status]').filter({hasText:'changed in another tab'}).waitFor();
  assert.equal(await page.evaluate(()=>window.retroTracking.snapshot().productReviews['fixture-copy-0'].decision),'rejected');
  await dialog.locator('[data-close]').click();await page.reload();await ready(page);
  assert.doesNotMatch(await page.locator('#results').innerText(),/95%/);
  passed.push('Confirmed score sorting survives reload; the central queue filters decisions and refuses stale cross-tab confirmation');

  const clean=await context(),restored=await clean.newPage();await openCopy(restored);
  await restored.evaluate(async backup=>{
    const c=window.retroTracking,preview=c.previewBackup(JSON.stringify(backup));
    await c.importBackup(preview,Object.fromEntries(preview.conflicts.map(row=>[`${row.section}/${row.id}`,'current'])));
  },backup);
  await restored.reload();await ready(restored);await restored.locator('#ratingCopy').selectOption('fixture-copy-0');
  await restored.locator('[data-copy-provider-ratings]').filter({hasText:'95% positive'}).waitFor();
  changed=true;await restored.reload();await ready(restored);await restored.locator('#ratingCopy').selectOption('fixture-copy-0');
  assert.match(await restored.locator('[data-steam-product-review]').innerText(),/import changed/);
  await restored.locator('[data-copy-provider-ratings]').filter({hasText:'No verified provider snapshot'}).waitFor();
  await restored.locator('[data-review-product]').click();await restored.setViewportSize({width:390,height:844});
  const fields=await reviewDialog(restored).locator('input[type=text],select,input[type=search]').evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,parent:el.parentElement.getBoundingClientRect().width})));
  assert.ok(fields.every(field=>field.height===44&&field.width<=field.parent+1),JSON.stringify(fields));
  assert.equal(await restored.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await restored.screenshot({path:'/tmp/retro-product-review-mobile.png'});
  await restored.keyboard.press('Escape');await reviewDialog(restored).waitFor({state:'detached'});
  passed.push('Backup restoration restores matches; changed import metadata invalidates scores; mobile fields and keyboard dismissal work');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed},null,2));await ctx.close();await clean.close();
} finally {await browser.close();}

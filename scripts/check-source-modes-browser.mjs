// Fictional snapshots in a fresh browser profile; external requests are aborted.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--playwright'||args[2]!=='--browser')throw Error('Provide --playwright <module> --browser <Chromium executable>.');
const module=await import(pathToFileURL(args[1]).href),{chromium}=module.default??module;
const browser=await chromium.launch({executablePath:args[3],headless:true}),context=await browser.newContext();
const origin='http://127.0.0.1:18895/retro',errors=[],passed=[];
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
const snapshot=JSON.parse(await readFile(new URL('../library/sample/ratings.json',import.meta.url))),original=structuredClone(snapshot);
const catalog=JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url)));catalog.games=catalog.games.slice(0,3);
snapshot.rows=[];
function row(provider,ref,value,{count=1000,positive=value*count/100}={}){
  const record=structuredClone(original.rows.find(row=>row.provider===provider));
  record.target=ref;record.mappingId=`${provider}-${ref.provider}-${ref.id}`;
  if(provider==='steam')record.providerId=ref.id;
  for(const observation of record.observations){observation.scope.ref=ref;observation.id+=`:${ref.id}`;
    if(observation.lane==='steam-approval')Object.assign(observation.original,{value,positive,negative:count-positive,count});
    if(observation.lane==='vgc')observation.original.value=value;
  }
  snapshot.rows.push(record);return record;
}
for(const [id,value,count,vgc] of [['900000001',90,100000,90],['900000002',95,1000,80],['900000003',80,1000,50],['900000004',0,10,0],['900000006',100,10000,100]]){
  row('steam',{provider:'steam',id},value,{count});row('vgc',{provider:'steam',id},vgc);
}
row('vgc',{provider:'playnite',id:'sample-copy-super-metroid'},82);
row('vgc',{provider:'playnite',id:'port-copy'},99);
row('vgc',{provider:'playnite',id:'sample-copy-chrono-trigger'},70);
row('vgc',{provider:'catalog',id:catalog.games[0].id},70);
row('vgc',{provider:'catalog',id:catalog.games[1].id},90);
await context.route('**/*',async route=>{
  if(!route.request().url().startsWith(`${origin}/`))return route.abort();
  const pathname=new URL(route.request().url()).pathname.slice('/retro/'.length);
  try{
    let body=await readFile(new URL(`../dist/${pathname}`,import.meta.url));
    if(pathname==='library/data/ratings.json')body=Buffer.from(JSON.stringify(snapshot));
    if(pathname==='data/catalog.json')body=Buffer.from(JSON.stringify(catalog));
    if(pathname==='library/data/wishlist-data.js')body=Buffer.from(body.toString()+`\n{const base=window.STEAM_WISHLIST[0];window.STEAM_WISHLIST=${JSON.stringify(['Alpha Popular','Beta Approval','Gamma','Delta Zero','Missing','Unreleased'].map((title,i)=>({appid:`90000000${i+1}`,title,comingSoon:i===5}))) }.map(game=>({...base,...game,mainGenre:'Action',genres:['Action'],reviewPct:100,reviewCount:999999,reviewEvidence:null}));}`);
    if(pathname==='library/data/library-data.js')body=Buffer.from(body.toString()+`\nwindow.PLAYNITE_LIBRARY[0].copies.push({...window.PLAYNITE_LIBRARY[0].copies[0],id:'port-copy',platforms:['PC'],steamAppId:'900000001'});window.PLAYNITE_STATS.platforms.push(['PC',1]);`);
    await route.fulfill({body,contentType:pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.json')?'application/json':pathname.endsWith('.css')?'text/css':'text/html'});
  }catch{await route.fulfill({status:404,body:'Not found'});}
});
try{
  const page=await context.newPage();await page.goto(`${origin}/library/wishlist.html`);await page.locator('.game-title').first().waitFor();
  assert.deepEqual(await page.locator('.game-title').allTextContents(),['Beta Approval','Alpha Popular','Gamma','Delta Zero','Missing','Unreleased']);
  assert.match(await page.locator('#ratingSummary').innerText(),/4 of 6 games rated/);
  assert.match(await page.locator('[data-id="900000005"]').innerText(),/No verified rating/);
  await page.locator('[data-id="900000002"]').click();assert.match(await page.locator('.ranking-explanation').innerText(),/#1 among rated/);
  assert.match(await page.locator('.ranking-explanation').innerText(),/950 positive \/ 1,000/);
  assert.match(await page.locator('.ranking-explanation').innerText(),/93\.47%/);
  await page.locator('#closeDetails').click();
  passed.push('Default saved Steam mode uses exact counts consistently in cards, order and explanations without import fallback');

  await page.locator('.filter-panel summary').click();await page.locator('#ratingSource').selectOption('vgc');
  assert.equal(await page.locator('.game-title').first().innerText(),'Alpha Popular');
  assert.match(await page.locator('#ratingSummary').innerText(),/Work-level ordering/);
  await page.reload();await page.locator('.game-title').first().waitFor();assert.equal(await page.locator('#ratingSource').inputValue(),'vgc');
  await page.locator('#searchInput').fill('Beta Approval');
  await page.locator('[data-id="900000002"]').click();assert.match(await page.locator('.ranking-explanation').innerText(),/#2 among rated/);
  await page.locator('#closeDetails').click();await page.locator('#searchInput').fill('');
  passed.push('VGC mode survives reload and search preserves its full-cohort position');

  await page.locator('.filter-panel summary').click();await page.locator('#ratingSource').selectOption('steam');await page.locator('#topView').click();await page.locator('#topCountSelect').selectOption('3');
  assert.deepEqual(await page.locator('.game-title').allTextContents(),['Beta Approval','Alpha Popular','Gamma']);
  assert.match(await page.locator('.genre-header').innerText(),/2 unranked/);
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-trim="Action"]').click();
  await page.waitForFunction(()=>Object.values(window.retroTracking.snapshot().wishlist).some(item=>item.decision==='archived'));
  const removed=await page.evaluate(()=>window.retroTracking.edits().removed);assert.deepEqual(Object.keys(removed).filter(id=>removed[id]),['900000004']);
  passed.push('Genre cutoff uses selected evidence and preserves unreleased and unmapped wishlist entries');

  await page.goto(`${origin}/library/index.html?rating=vgc&sort=score`);await page.locator('.game-title').first().waitFor();
  assert.equal(await page.locator('.game-title').first().innerText(),'Chrono Trigger');
  await page.locator('[data-id="sample-super-metroid"]').click();await page.locator('#ratingCopy').selectOption('sample-copy-super-metroid');
  assert.match(await page.locator('#ownedRatingChip').innerText(),/82\/100 · work context/);
  await page.locator('#ratingCopy').selectOption('port-copy');assert.match(await page.locator('#ownedRatingChip').innerText(),/99\/100 · work context/);
  await page.locator('#closeDetails').click();await page.locator('.filter-panel summary').click();await page.locator('#platformFilter').selectOption('PC');
  assert.equal(await page.locator('.game-title').first().innerText(),'Super Metroid');
  assert.match(await page.locator('[data-id="sample-super-metroid"]').innerText(),/99\/100/);
  passed.push('Owned source sorting requires one matching copy and never uses another copy’s maximum');

  await page.goto(`${origin}/index.html?sort=vgc&rank=10&workspace=sample`);await page.locator('.game-row').first().waitFor();
  assert.equal(await page.locator('[data-game]').first().getAttribute('data-game'),catalog.games[1].id);
  assert.equal(await page.locator('#rank-filter').isDisabled(),true);assert.equal(await page.locator('#rank-filter').inputValue(),'all');
  await page.locator('#search').fill(catalog.games[0].title);await page.waitForFunction(()=>new URLSearchParams(location.search).get('q'));
  await page.locator(`[data-game="${catalog.games[0].id}"]`).click();assert.match(await page.locator('.ranking-explanation').innerText(),/#1 among rated/);
  assert.match(await page.locator('.ranking-explanation').innerText(),/does not establish a platform-specific rank/);
  passed.push('Catalog provider order ignores legacy positions and system cutoffs while catalog positions update within the filtered selection');

  await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/library/wishlist.html?rating=vgc&game=900000001`);await page.locator('.ranking-explanation').waitFor();
  assert.equal(await page.locator('#detailsPanel').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
  if(process.env.RANKING_SCREENSHOT_DIR){await mkdir(process.env.RANKING_SCREENSHOT_DIR,{recursive:true});await page.locator('.ranking-explanation').evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:`${process.env.RANKING_SCREENSHOT_DIR}/source-mode-mobile.png`});}
  await page.keyboard.press('Escape');assert.equal(await page.locator('#detailsPanel').isVisible(),false);
  await page.goto(`${origin}/ranking/methodology.html`);assert.equal(await page.locator('h1').innerText(),'How ratings work');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  passed.push('Mobile explanations fit the dialog; keyboard dismissal and the standalone methodology page work');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
}finally{await context.close();await browser.close();}

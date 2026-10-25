// Fictional data and isolated browser storage only; never opens personal imports.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const args=process.argv.slice(2);
if(args.length!==4 || args[0]!=='--playwright' || args[2]!=='--browser')throw Error('Provide --playwright <module> --browser <Chromium executable>.');
const module=await import(pathToFileURL(args[1]).href),{chromium}=module.default??module;
const browser=await chromium.launch({executablePath:args[3],headless:true});
const origin='http://127.0.0.1:18897/retro',passed=[],errors=[];
const context=await browser.newContext({acceptDownloads:true});
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
const copy=(id,criticScore,userScore,platform='SNES',source='Local')=>({id,criticScore,userScore,communityScore:0,platforms:[platform],sources:[source],releaseDate:'1994',year:1994,played:false});
await context.route('**/*',async route=>{
  if(!route.request().url().startsWith(`${origin}/`))return route.abort();
  const path=new URL(route.request().url()).pathname.slice('/retro/'.length);
  if(path.includes('..'))return route.abort();
  if(path==='fixture.svg')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#537b66"/></svg>'});
  try{
    let body=await readFile(new URL(`../dist/${path}`,import.meta.url));
    if(path==='library/data/library-data.js')body=Buffer.from(body.toString()+`\n{
      const base=window.PLAYNITE_LIBRARY[0];
      window.PLAYNITE_LIBRARY=${JSON.stringify([
        {id:'legacy',name:'Alpha Legacy',copies:[{id:'legacy-copy',platforms:['SNES'],sources:['Local'],bestScore:91}]},
        {id:'split',name:'Beta Split',copies:[copy('original',70,100),copy('port',98,20,'PC','Steam')]},
        {id:'known',name:'Gamma Known',copies:[copy('known',80,10)]},
        {id:'covered',name:'Zeta Covered',cover:`${origin}/fixture.svg`,copies:[copy('covered',75,40)]},
      ])}.map(game=>({...base,...game,platforms:[...new Set(game.copies.flatMap(c=>c.platforms))],sources:[...new Set(game.copies.flatMap(c=>c.sources))],duplicate:game.copies.length>1}));
      window.PLAYNITE_STATS={...window.PLAYNITE_STATS,total:4,platforms:[['SNES',4],['PC',1]],sources:[['Local',4],['Steam',1]]};
    }`);
    if(path==='library/data/wishlist-data.js')body=Buffer.from(body.toString()+`\n{
      const base=window.STEAM_WISHLIST[0];
      window.STEAM_WISHLIST=${JSON.stringify([
        {appid:'910000001',title:'Better Approval',reviewPct:95,reviewCount:1000,pickScore:.8045},
        {appid:'910000002',title:'Popular',reviewPct:90,reviewCount:100000,pickScore:.8787},
        {appid:'910000003',title:'Zero',reviewEvidence:{percentage:0,total:10,positive:0,negative:10}},
        {appid:'910000004',title:'Missing',reviewEvidence:{percentage:null,total:null}},
        {appid:'910000005',title:'Upcoming',reviewPct:100,reviewCount:999999,comingSoon:true},
        {appid:'910000006',title:'Moderate',reviewPct:70,reviewCount:400},
      ])}.map(game=>({...base,reviewEvidence:null,reviewPct:null,reviewCount:null,comingSoon:false,mainGenre:'Action',genres:['Action'],...game}));
    }`);
    return route.fulfill({body,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'text/html'});
  }catch{return route.fulfill({status:404,body:'Not found'});}
});
try{
  const page=await context.newPage();await page.goto(`${origin}/library/index.html`);await page.locator('.game-title').first().waitFor();
  assert.deepEqual(await page.locator('.game-title').allTextContents(),['Alpha Legacy','Beta Split','Gamma Known','Zeta Covered']);
  await page.locator('.filter-panel summary').click();await page.locator('#sortMode').selectOption('score');
  assert.deepEqual(await page.locator('.game-title').allTextContents(),['Gamma Known','Zeta Covered','Alpha Legacy','Beta Split']);
  passed.push('Default title order and selected-rating sort ignore artwork, personal maxima and mixed copies');

  await page.locator('#platformFilter').selectOption('SNES');
  assert.deepEqual(await page.locator('.game-title').allTextContents(),['Gamma Known','Zeta Covered','Beta Split','Alpha Legacy']);
  await page.locator('#ratingMode').selectOption('personal');assert.equal(await page.locator('.game-title').first().textContent(),'Beta Split');
  await page.reload();await page.locator('.game-title').first().waitFor();assert.equal(await page.locator('#ratingMode').inputValue(),'personal');assert.equal(await page.locator('#platformFilter').inputValue(),'SNES');
  passed.push('Platform-scoped ratings and personal sorting survive bookmarked URLs');

  await page.locator('[data-id="split"]').click();await page.locator('#copyRatingEvidence').waitFor();
  assert.match(await page.locator('#copyRatingEvidence').innerText(),/70\/100/);assert.doesNotMatch(await page.locator('#copyRatingEvidence').innerText(),/98\/100/);
  await page.locator('#ratingCopy').selectOption('port');assert.match(await page.locator('#copyRatingEvidence').innerText(),/98\/100/);
  assert.match(await page.locator('#ownedRatingChip').innerText(),/20\/100 · PC/);
  assert.match(await page.locator('#copyRatingEvidence').innerText(),/original rating providers, review counts and observation dates/);
  if(process.env.RANKING_SCREENSHOT_DIR){await mkdir(process.env.RANKING_SCREENSHOT_DIR,{recursive:true});await page.locator('#ownedRatingEvidence').screenshot({path:`${process.env.RANKING_SCREENSHOT_DIR}/owned.png`});}
  await page.locator('#closeDetails').click();await page.locator('[data-id="legacy"]').click();
  assert.match(await page.locator('#copyRatingEvidence').innerText(),/Legacy score[\s\S]*91\/100/);
  assert.match(await page.locator('#copyRatingEvidence').innerText(),/Reimport the original Playnite CSV/);
  passed.push('Detail copy selection reveals separate evidence and labels unrecoverable legacy maxima');

  await page.goto(`${origin}/library/index.html?platform=SNES&rating=critic&score=80&sort=score`);await page.locator('.game-title').first().waitFor();
  assert.deepEqual(await page.locator('.game-title').allTextContents(),['Gamma Known']);
  passed.push('A higher-rated port or personal rating cannot satisfy the selected-copy critic threshold');

  await page.goto(`${origin}/library/wishlist.html?rating=imported`);await page.locator('.game-title').first().waitFor();
  assert.equal(await page.locator('.game-title').first().textContent(),'Better Approval');
  assert.match(await page.locator('[data-id="910000004"]').innerText(),/Approval not recorded/);
  assert.match(await page.locator('[data-id="910000003"]').innerText(),/0% positive/);
  await page.locator('.filter-panel summary').click();await page.locator('#sortMode').selectOption('reviewCount');
  assert.equal(await page.locator('.game-title').first().textContent(),'Upcoming');
  await page.locator('#sortMode').selectOption('pick');
  await page.locator('[data-id="910000001"]').click();assert.match(await page.locator('#detailsContent').innerText(),/93\.5% \(approximate\)/);
  assert.match(await page.locator('#detailsContent').innerText(),/Query settings not recorded/);
  if(process.env.RANKING_SCREENSHOT_DIR)await page.locator('.rating-evidence').screenshot({path:`${process.env.RANKING_SCREENSHOT_DIR}/wishlist.png`});
  await page.locator('#closeDetails').click();
  passed.push('Conservative approval, separate volume ordering, genuine zero and missing evidence render correctly');

  await page.locator('#topView').click();await page.locator('.genre-block').first().waitFor();
  await page.locator('#topCountSelect').selectOption('3');
  assert.match(await page.locator('.genre-header').innerText(),/2 unranked/);
  assert.deepEqual(await page.locator('.game-title').allTextContents(),['Better Approval','Popular','Moderate']);
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-trim="Action"]').click();
  await page.waitForFunction(()=>Object.values(window.retroTracking.snapshot().wishlist).some(item=>item.decision==='archived'));
  const decisions=await page.evaluate(()=>{const state=window.retroTracking.snapshot();return Object.values(state.targets).map(target=>({id:target.refs.find(ref=>ref.provider==='steam')?.id,decision:state.wishlist[target.id]?.decision}));});
  assert.deepEqual(decisions.filter(item=>item.decision==='archived').map(item=>item.id),['910000003']);
  passed.push('Genre cutoffs use the same order and preserve missing-evidence and unreleased games');

  await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/library/wishlist.html?rating=imported&game=910000001`);await page.locator('#detailsPanel').waitFor();
  await page.locator('.rating-evidence').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('#detailsPanel').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
  if(process.env.RANKING_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.RANKING_SCREENSHOT_DIR}/mobile.png`});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#detailsPanel').isVisible(),false);
  passed.push('Mobile evidence fits the dialog and keyboard dismissal works');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
}finally{await context.close();await browser.close();}

// Isolated fictional data only. Every request is intercepted; no provider calls.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const args=process.argv.slice(2);
if(args.length!==4 || args[0]!=='--playwright' || args[2]!=='--browser')throw Error('Provide --playwright <module> --browser <Chromium executable>.');
const module=await import(pathToFileURL(args[1]).href),{chromium}=module.default??module;
const browser=await chromium.launch({executablePath:args[3],headless:true});
const origin='http://127.0.0.1:18896/retro',passed=[],errors=[],external=[];
const sample=JSON.parse(await readFile(new URL('../library/sample/ratings.json',import.meta.url),'utf8'));
async function setup({personal=false,broken=false,mismatch=false,failed=false}={}){
  const context=await browser.newContext();
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/*',async route=>{
    if(!route.request().url().startsWith(`${origin}/`)){external.push(route.request().url());return route.abort();}
    const pathname=new URL(route.request().url()).pathname.slice('/retro/'.length);
    if(pathname.includes('..'))return route.abort();
    try{
      let body=await readFile(new URL(`../dist/${pathname}`,import.meta.url));
      if(pathname==='library/data/ratings.json'){
        if(broken)return route.fulfill({status:200,contentType:'application/json',body:'{"rows":null}'});
        const snapshot=structuredClone(sample);snapshot.workspace=personal&&!mismatch?'personal':'sample';
        if(failed)for(const row of snapshot.rows){row.error='throttled';row.nextAttemptAt='2099-01-01T00:00:00Z';}
        body=Buffer.from(JSON.stringify(snapshot));
      }
      if(pathname==='library/data/library-data.js')body=Buffer.from(body.toString()+`\nwindow.PLAYNITE_SAMPLE=${!personal};window.PLAYNITE_LIBRARY[0].copies.push({...window.PLAYNITE_LIBRARY[0].copies[0],id:'unmapped-copy',platforms:['PC']});`);
      if(pathname==='library/data/wishlist-data.js'&&personal)body=Buffer.from(body.toString()+'\nwindow.WISHLIST_SAMPLE=false;');
      return route.fulfill({body,contentType:pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':pathname.endsWith('.json')?'application/json':'text/html'});
    }catch{return route.fulfill({status:404,body:'Not found'});}
  });
  return context;
}
try{
  const context=await setup(),page=await context.newPage();
  await page.goto(`${origin}/library/wishlist.html?game=900000001`);
  const wish=page.locator('#wishlistProviderRatings');await wish.locator('.provider-rating').first().waitFor();
  assert.match(await wish.innerText(),/Illustrative ratings/);assert.match(await wish.innerText(),/95% positive · 1,000 reviews/);
  assert.match(await wish.innerText(),/VGC Score[\s\S]*82\/100/);assert.match(await wish.innerText(),/Work-level context/);
  assert.match(await wish.innerText(),/all-time query totals/);assert.equal(await wish.locator('a').count(),0);
  passed.push('Sample provider panels show fictional labels, exact approval counts and separate VGC context');

  await page.goto(`${origin}/library/index.html?game=sample-super-metroid`);
  await page.locator('#ratingCopy').selectOption('sample-copy-super-metroid');
  const owned=page.locator('[data-copy-provider-ratings]');await owned.locator('.provider-rating').first().waitFor();
  assert.match(await owned.innerText(),/IGDB community[\s\S]*75\/100/);
  await page.locator('#ratingCopy').selectOption('unmapped-copy');
  await page.waitForFunction(()=>document.querySelector('[data-copy-provider-ratings]')?.textContent.includes('No verified provider snapshot'));
  assert.doesNotMatch(await owned.innerText(),/82\/100|75\/100/);
  await page.locator('#ratingCopy').selectOption('sample-copy-super-metroid');await owned.locator('.provider-rating').first().waitFor();
  passed.push('Owned copy switching never transfers a provider rating to an unmapped copy');

  await page.goto(`${origin}/index.html?game=ps5-1e772489c042f49a&workspace=sample`);
  await page.locator('#catalogProviderRatings .provider-rating').waitFor();
  assert.match(await page.locator('#catalogProviderRatings').innerText(),/excluded from system rankings/);
  passed.push('Catalog detail shows work context without claiming a platform-specific system score');

  await page.setViewportSize({width:390,height:844});
  await page.goto(`${origin}/library/wishlist.html?game=900000001`);await wish.locator('.provider-rating').first().waitFor();
  await wish.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('#detailsPanel').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
  if(process.env.RANKING_SCREENSHOT_DIR){
    await mkdir(process.env.RANKING_SCREENSHOT_DIR,{recursive:true});
    await wish.evaluate(node=>node.scrollIntoView({block:'start'}));
    await page.screenshot({path:`${process.env.RANKING_SCREENSHOT_DIR}/providers-mobile.png`});
  }
  await page.keyboard.press('Escape');assert.equal(await page.locator('#detailsPanel').isVisible(),false);
  passed.push('Provider panels fit a mobile dialog and preserve keyboard dismissal');
  await context.close();

  const privateContext=await setup({personal:true,failed:true}),privatePage=await privateContext.newPage();
  await privatePage.goto(`${origin}/library/wishlist.html?game=900000001`);
  const panel=privatePage.locator('#wishlistProviderRatings');await panel.locator('.provider-rating').first().waitFor();
  assert.match(await panel.innerText(),/Refresh failed — showing last saved ratings/);
  assert.match(await panel.innerText(),/Next permitted retry/);
  assert.equal(await panel.getByRole('link',{name:/Powered by VideoGamesCritic/}).getAttribute('href'),'https://videogamescritic.com/game/fictional-quest-990001');
  assert.doesNotMatch(await panel.innerText(),/Illustrative ratings/);
  passed.push('Personal-mode fixture renders VGC attribution, retained data and retry timing');
  await privateContext.close();

  for(const options of [{personal:true,mismatch:true},{broken:true}]){
    const isolated=await setup(options),p=await isolated.newPage();await p.goto(`${origin}/library/wishlist.html?game=900000001`);
    await p.waitForFunction(()=>document.querySelector('#wishlistProviderRatings')?.textContent.includes('unavailable'));
    assert.match(await p.locator('#detailsContent').innerText(),/Why this order/);
    await p.keyboard.press('Escape');await p.locator('.filter-panel summary').click();await p.locator('#ratingSource').selectOption('imported');await p.locator('[data-id="900000001"]').click();
    assert.match(await p.locator('#detailsContent').innerText(),/Conservative approval/);
    assert.doesNotMatch(await p.locator('#wishlistProviderRatings').innerText(),/82\/100|95%/);
    await isolated.close();
  }
  passed.push('Malformed snapshots and workspace mismatches fail closed while imported evidence remains usable');
  // Existing artwork/font requests are unrelated to provider fetching and are aborted too.
  assert.deepEqual(external.filter(url=>!['fonts.googleapis.com','raw.githubusercontent.com'].includes(new URL(url).hostname)),[]);
  assert.deepEqual(errors,[]);
  passed.push('Provider panels make no external rating requests and produce no page errors');
  console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
}finally{await browser.close();}

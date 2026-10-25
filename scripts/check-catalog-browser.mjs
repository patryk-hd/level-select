// Isolated UI checks. All requests use local sample/fictional data; no live ratings.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--playwright'||args[2]!=='--browser')throw Error('Provide --playwright <module> --browser <Chromium executable>.');
const module=await import(pathToFileURL(args[1]).href),{chromium}=module.default??module;
const browser=await chromium.launch({executablePath:args[3],headless:true});
const origin='http://127.0.0.1:18896/retro',errors=[],passed=[];
const catalog=JSON.parse(await readFile(new URL('../dist/data/catalog.json',import.meta.url),'utf8'));
const ratedGames=['nes','snes','ps1'].map(id=>catalog.games.find(g=>g.systemId===id));
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/*',async route=>{
    const url=route.request().url();if(!url.startsWith(`${origin}/`))return route.abort();
    const path=new URL(url).pathname.slice('/retro/'.length);if(path.includes('..'))return route.abort();
    try {
      let body=await readFile(new URL(`../dist/${path}`,import.meta.url));
      if(path==='library/data/library-data.js')body=Buffer.from(body.toString()+`
        {const game=structuredClone(window.PLAYNITE_LIBRARY[0]);
        Object.assign(game,{id:'fictional-pc',name:'Fictional PC adventure',platforms:['Windows'],sources:['Steam','GOG','Epic Games Store'],played:false,timePlayed:0});
        game.copies=['Steam','GOG','Epic Games Store'].map((source,i)=>({...game.copies[0],id:'fictional-pc-'+i,platforms:['Windows'],sources:[source],played:false,timePlayed:0}));
        window.PLAYNITE_LIBRARY.push(game);}
      `);
      if(path==='library/data/ratings.json') {
        const data=JSON.parse(body),template=data.rows.find(row=>row.target.provider==='catalog'&&row.provider==='vgc');
        data.rows=ratedGames.map((game,index)=>{const row=structuredClone(template);row.mappingId=`fictional-${index}`;row.target.id=game.id;row.observations.forEach(observation=>{observation.scope.ref.id=game.id;observation.original.value=[75,95,99][index];observation.original.raw=observation.original.value;});return row;});
        body=Buffer.from(JSON.stringify(data));
      }
      return route.fulfill({body,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':path.endsWith('.html')?'text/html':'application/octet-stream'});
    }catch{return route.fulfill({status:404,body:'Not found'});}
  });
  const page=await context.newPage();
  const ready=()=>page.locator('#results[aria-busy=false]').waitFor();
  await page.goto(`${origin}/index.html?workspace=sample`);await ready();
  assert.equal(await page.locator('.system-card[data-system]').count(),50);
  assert.equal(await page.locator('.game-row').count(),0);
  assert.equal(await page.locator('#sidebar [data-section=recommendations]').innerText(),'▦\nGame Atlas');
  assert.equal(await page.locator('#family-nav').count(),0);
  assert.equal(await page.locator('#sidebar [data-section=systems]').count(),0);
  assert.equal(await page.locator('.platform-card').count(),4);
  assert.equal(await page.locator('#backup-button').isVisible(),true);
  assert.equal(await page.locator('#about-button').isVisible(),true);
  assert.equal(await page.locator('#pinned-section').isVisible(),false);
  assert.equal(await page.locator('#selection-info').count(),0);
  assert.equal(await page.locator('.destination-counts').count(),4);
  await page.screenshot({path:'/tmp/retro-atlas-desktop.png'});
  await page.locator('.pc-destinations').scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/retro-atlas-pc-desktop.png'});
  await page.goto(`${origin}/index.html?view=systems&workspace=sample`);await ready();
  assert.equal(await page.locator('#sidebar [data-section=recommendations]').getAttribute('aria-current'),'page');
  assert.match(await page.locator('#page-title').innerText(),/Game Atlas/);
  await page.evaluate(async()=>{const client=await(await import('./tracking/client.js')).trackingClient();if(!client.status().ready)await client.commitMigration();});
  await page.locator('[data-pin=nes]').click();await page.locator('#pinned-section').waitFor();
  assert.equal(await page.locator('#pinned-section').locator('xpath=ancestor::details').count(),0);
  await page.locator('[data-pin="destination:gog"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-pin="destination:gog"]')?.getAttribute('aria-pressed')==='true');
  await page.reload();await ready();
  await page.locator('[data-favorites-catalog]').click();
  assert.equal(await page.locator('.system-card[data-system]').count(),1);
  assert.equal(await page.locator('.platform-card').count(),1);
  assert.match(await page.locator('#page-title').innerText(),/Favorites catalog/);
  await page.reload();await ready();assert.equal(await page.locator('#catalog-scope').inputValue(),'favorites');
  await page.locator('[data-pin=nes]').click();
  await page.locator('[data-pin=nes]').waitFor({state:'detached'});
  assert.equal(await page.locator('.empty-state').count(),0); // A storefront is still pinned.
  await page.locator('[data-pin="destination:gog"]').click();
  await page.locator('.empty-state').waitFor();
  assert.match(await page.locator('.empty-state').innerText(),/Pin systems/);
  await page.locator('#catalog-scope').selectOption('all');
  assert.equal(await page.locator('.system-card[data-system]').count(),50);
  assert.equal(await page.locator('.platform-card').count(),4);
  const counts=await page.evaluate(async()=>{
    const c=await(await import('./tracking/client.js')).trackingClient();
    const {copyMatchesFilters}=await import('./library/core.js');
    const summaries={};
    for(const id of ['pc','steam','gog','epic'])summaries[id]=c.library.filter(g=>g.copies.some(copy=>copyMatchesFilters(copy,{platform:'pc',...(id==='pc'?{}:{source:`store:${id}`})}))).length;
    return summaries;
  });
  for(const [id,total] of Object.entries(counts))assert.match(await page.locator(`[data-destination="${id}"] .destination-counts`).innerText(),new RegExp(`${total} game`));
  const completedStore=await page.evaluate(async()=>{
    const c=await(await import('./tracking/client.js')).trackingClient();
    const {copyMatchesFilters}=await import('./library/core.js');
    const copy=c.library.flatMap(g=>g.copies).find(copy=>copyMatchesFilters(copy,{platform:'pc',source:'store:steam'}));
    if(!copy)return null;
    const desc=c.descriptor('playnite',copy.id),playthroughId=crypto.randomUUID();
    await c.action(desc,'start',{playthroughId});await c.action(desc,'status',{playthroughId,status:'finished'});
    return 'steam';
  });
  assert.equal(completedStore,'steam');
  assert.match(await page.locator('[data-destination=steam] .destination-counts').innerText(),/1 completed/);
  assert.match(await page.locator('[data-destination=pc] .destination-counts').innerText(),/1 completed/);
  passed.push('All 50 systems are the default; console/store favorites persist, bookmark and unpin to an actionable empty state; PC totals match filtered games');

  await page.locator('#system-filter').click();await page.locator('#scope-family').selectOption('nintendo');
  await page.locator('#scope-options [data-browse-system=nes]').click();
  assert.equal(await page.locator('#sort').inputValue(),'curated');
  assert.deepEqual((await page.locator('.game-row .rank').allTextContents()).map(Number),Array.from({length:36},(_,i)=>i+1));
  await page.locator('[data-page="2"]').click();
  assert.equal(await page.locator('.game-row .rank').first().innerText(),'37');
  await page.locator('#system-filter').click();await page.locator('#scope-family').selectOption('nintendo');await page.locator('#browse-family').click();
  assert.equal(await page.locator('#sort').inputValue(),'vgc');
  assert.deepEqual((await page.locator('.game-row .rank').allTextContents()).slice(0,3),['1','2','—']);
  assert.match(await page.locator('.game-row').first().innerText(),new RegExp(ratedGames[1].title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(await page.locator('#rank-filter').isDisabled(),true);
  await page.screenshot({path:'/tmp/retro-catalog-family.png'});
  await page.locator('#sort').selectOption('title');
  assert.deepEqual((await page.locator('.game-row .rank').allTextContents()).map(Number),Array.from({length:36},(_,i)=>i+1));
  assert.match(await page.locator('#rank-explanation').innerText(),/List positions/);
  await page.goBack();await ready();assert.equal(await page.locator('#sort').inputValue(),'vgc');
  passed.push('Console ranks stay scoped; family scores rank within that family, missing scores stay unranked, and title lists use list positions');

  // A deep-linked game outside the active score cohort must still open safely.
  await page.goto(`${origin}/index.html?workspace=sample&family=nintendo&sort=vgc&game=${ratedGames[2].id}`);await page.locator('#catalogProviderRatings').waitFor();
  await page.locator('#close-dialog').click();
  const heights=await page.locator('#filter-toolbar select,#filter-toolbar button,#catalog-scope,#system-filter,#search').evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>el.getBoundingClientRect().height));
  assert.ok(heights.every(height=>height===44),JSON.stringify(heights));
  for(const width of [1440,1000,700,390,360]) {
    await page.setViewportSize({width,height:1000});
    const widths=await page.locator('#system-filter,#catalog-scope,#genre-filter,#rank-filter,#more-filters,#ownership-filter,#sort').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().width));
    assert.ok(Math.max(...widths)-Math.min(...widths)<1,`${width}: ${widths}`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#more-filters').click();
  const dialogFields=await page.locator('#dialog-body select,#dialog-body input[type=number]').evaluateAll(els=>els.map(el=>({h:el.getBoundingClientRect().height,w:el.getBoundingClientRect().width,parent:el.parentElement.getBoundingClientRect().width})));
  assert.ok(dialogFields.length>0);assert.ok(dialogFields.every(d=>d.h===44&&d.w<=d.parent+1),JSON.stringify(dialogFields));
  await page.keyboard.press('Escape');
  await page.locator('#system-filter').click();await page.locator('#scope-family').selectOption('pc');
  const scopeWidths=await page.locator('#scope-family,#scope-range').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().width));
  assert.ok(Math.abs(scopeWidths[0]-scopeWidths[1])<1);
  await page.locator('#scope-options a').filter({hasText:'GOG'}).click();await page.waitForFunction(()=>document.querySelector('#platformFilter')?.value==='pc');
  assert.equal(await page.locator('#platformFilter').inputValue(),'pc');
  assert.equal(await page.locator('#sourceFilter').inputValue(),'store:gog');
  await page.locator('.filter-panel > summary').click();
  passed.push('PC/store deep links preserve both copy filters and score views tolerate out-of-cohort detail links');

  for(const path of ['library/index.html','library/wishlist.html','library/backlog.html']) {
    await page.goto(`${origin}/${path}`);await page.locator('#trackingBanner').waitFor({state:'attached'});
    const toggle=page.locator('.filter-panel > summary');if(await toggle.count())await toggle.click();
    const dimensions=await page.locator('main select,main input[type=search],.filter-panel > summary').evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>({id:el.id,height:el.getBoundingClientRect().height})));
    assert.ok(dimensions.length>0);assert.ok(dimensions.every(item=>item.height===44),`${path}: ${JSON.stringify(dimensions)}`);
    const fitting=await page.locator('main select').evaluateAll(els=>els.filter(el=>el.getClientRects().length).every(el=>el.getBoundingClientRect().width<=el.parentElement.getBoundingClientRect().width+1));
    assert.equal(fitting,true,path);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,path);
    await page.setViewportSize({width:1440,height:1000});
  }
  const longest=catalog.systems.reduce((a,b)=>a.name.length>b.name.length?a:b);
  await page.goto(`${origin}/index.html?workspace=sample&systems=${longest.id}`);await ready();
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    const arrow=await page.locator('#system-filter').evaluate(el=>{const b=el.getBoundingClientRect(),a=el.querySelector('.control-chevron').getBoundingClientRect();return {right:b.right-a.right,center:Math.abs((b.top+b.bottom-a.top-a.bottom)/2)};});
    assert.ok(arrow.right>=10&&arrow.right<20&&arrow.center<2,JSON.stringify(arrow));
  }
  await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/index.html?workspace=sample`);await ready();
  await page.locator('.pc-destinations').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/retro-atlas-pc-mobile.png'});
  await page.locator('#system-filter').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/retro-atlas-tools-mobile.png'});
  await page.locator('#system-filter').click();await page.locator('#scope-family').selectOption('nintendo');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'/tmp/retro-catalog-mobile.png'});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#dialog').isVisible(),false);
  passed.push('Catalog, library, wishlist and play-plan filters share 44px controls; mobile layout and Escape work');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed},null,2));await context.close();
}finally{await browser.close();}

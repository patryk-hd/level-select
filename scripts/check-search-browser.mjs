// Authored examples only. The browser never requests external services.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--playwright'||args[2]!=='--browser')throw Error('Provide --playwright <module> --browser <Chromium executable>.');
const module=await import(pathToFileURL(args[1]).href),{chromium}=module.default??module;
const browser=await chromium.launch({executablePath:args[3],headless:true});
const origin='http://127.0.0.1:18898/retro',errors=[],passed=[];
let catalogSystem;
const names=['Super Mario World','New Super Mario Bros. U Deluxe','Mario Party Superstars','Mario and Luigi: Superstar Saga',"Tom Clancy’s The Division","Tom Clancy's The Division 2",'Subdivision Infinity DX','Unrelated platformer','Super Mario','Super Paper Mario'];
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/*',async route=>{
    if(!route.request().url().startsWith(`${origin}/`))return route.abort();
    const file=new URL(route.request().url()).pathname.slice('/retro/'.length);if(file.includes('..'))return route.abort();
    try {
      let body=await readFile(new URL(`../dist/${file}`,import.meta.url));
      if(file==='library/data/library-data.js')body=Buffer.from(body.toString()+`
        window.PLAYNITE_LIBRARY=${JSON.stringify(names)}.map((name,i)=>{const game=structuredClone(window.PLAYNITE_LIBRARY[0]);
          return {...game,id:'search-'+i,name,search:'Super Mario platformer by Private Division',copies:[{...game.copies[0],id:'search-copy-'+i,name}]};});
      `);
      if(file==='library/data/wishlist-data.js')body=Buffer.from(body.toString()+`
        window.STEAM_WISHLIST=${JSON.stringify(names)}.map((title,i)=>({...structuredClone(window.STEAM_WISHLIST[0]),appid:String(900100000+i),title,search:'Super Mario platformer by Private Division'}));
      `);
      if(file==='data/catalog.json'){
        const catalog=JSON.parse(body);catalogSystem=catalog.games[0].systemId;
        catalog.games=names.map((title,i)=>({...catalog.games[0],id:'search-catalog-'+i,title,aliases:[],rank:i+1}));
        body=Buffer.from(JSON.stringify(catalog));
      }
      return route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.html')?'text/html':'application/octet-stream'});
    }catch{return route.fulfill({status:404,body:'Not found'});}
  });
  const page=await context.newPage();
  for(const file of ['index.html','library/index.html','library/wishlist.html']){
    const catalog=file==='index.html',input=catalog?'#search':'#searchInput',titles=catalog?'.game-row .game-title':'#results .game-title';
    await page.goto(`${origin}/${file}?workspace=sample&q=super%20mario`);
    await page.waitForFunction(({selector})=>document.querySelectorAll(selector).length===4,{selector:titles});
    assert.deepEqual((await page.locator(titles).allTextContents()).sort(),[...names.slice(0,2),...names.slice(8)].sort(),file);
    assert.equal(await page.locator(titles).first().innerText(),'Super Mario','exact title first');
    await page.locator(input).fill('division');
    await page.waitForFunction(({selector})=>[...document.querySelectorAll(selector)].map(el=>el.textContent).every(title=>title.includes('Division'))&&document.querySelectorAll(selector).length===2,{selector:titles});
    assert.deepEqual((await page.locator(titles).allTextContents()).sort(),names.slice(4,6).sort(),file);
    await page.reload();
    await page.waitForFunction(selector=>document.querySelector(selector)?.value==='division',input);
    assert.equal(await page.locator(input).inputValue(),'division');
    await page.waitForFunction(({selector})=>document.querySelectorAll(selector).length===2,{selector:titles});
    await page.locator(input).fill('division 2');
    await page.waitForFunction(({selector})=>document.querySelectorAll(selector).length===1,{selector:titles});
    assert.equal(await page.locator(titles).innerText(),names[5]);
    await page.locator(input).fill('super mari');
    await page.waitForFunction(({selector})=>document.querySelectorAll(selector).length===4,{selector:titles});
    await page.locator(input).fill('SUPER—MARIO');
    await page.waitForFunction(({selector})=>document.querySelectorAll(selector).length===4,{selector:titles});
    assert.deepEqual((await page.locator(titles).allTextContents()).sort(),[...names.slice(0,2),...names.slice(8)].sort());
    await page.locator(input).fill('divison');
    await page.waitForFunction(()=>document.querySelectorAll('.search-suggestions:not([hidden]) button').length===2);
    assert.equal(await page.locator(titles).count(),0,'suggestions do not silently become matches');
    const correction=await page.locator('.search-suggestions:visible button').first().innerText();
    await page.locator('.search-suggestions:visible button').first().click();
    await page.waitForFunction(({selector,value})=>document.querySelector(selector).value===value,{selector:input,value:correction});
    assert.equal(await page.locator(titles).first().innerText(),correction);
    assert.equal(await page.locator('.search-suggestions:visible').count(),0);
    await page.locator(input).fill('division 3');
    await page.waitForFunction(({selector})=>document.querySelectorAll(selector).length===0,{selector:titles});
    assert.equal(await page.locator('.search-suggestions:visible').count(),0,'no number correction');
    const sort=catalog?'#sort':'#sortMode',sortValue=catalog?'title':'name';
    if(!catalog) await page.locator('details.filter-panel > summary').click();
    await page.locator(sort).selectOption(sortValue);
    await page.locator(input).fill('super mario');
    await page.waitForFunction(({selector})=>document.querySelectorAll(selector).length===4,{selector:titles});
    assert.equal(await page.locator(titles).first().innerText(),names[1],'explicit alphabetic sort is respected');
    await page.reload();
    await page.waitForFunction(({selector})=>document.querySelectorAll(selector).length===4,{selector:titles});
    assert.equal(await page.locator(sort).inputValue(),sortValue);
    assert.equal(await page.locator(titles).first().innerText(),names[1]);
    await page.goto(`${origin}/${file}?workspace=sample&q=divison&${catalog?'yearFrom':'yearMin'}=2099`);
    await page.waitForFunction(selector=>document.querySelector(selector)?.value==='divison',input);
    assert.equal(await page.locator('.search-suggestions:visible').count(),0,'corrections respect active year filters');
    if(catalog){
      await page.goto(`${origin}/${file}?workspace=sample&systems=${catalogSystem}&rank=10&q=super+mario`);
      await page.waitForFunction(()=>document.querySelector('#search')?.value==='super mario');
      assert.equal(await page.locator('#rank-filter').inputValue(),'10');
      await page.locator('#search').fill('divi');
      await page.waitForFunction(()=>document.querySelectorAll('.game-row .game-title').length===2);
      assert.equal(await page.locator('#rank-filter').inputValue(),'10','typing preserves explicit rank cutoff');
    }
    passed.push(`${file}: prefixes, relevance, scoped typo suggestions, exact numbers, explicit sorts and bookmarked queries`);
  }
  await page.goto(`${origin}/library/backlog.html?workspace=sample&view=all`);
  await page.locator('#addGames').click();
  await page.locator('#candidateSearch').fill('division');
  const choices=page.locator('#planCandidates [data-candidate]');
  assert.equal(await choices.count(),2);
  assert.doesNotMatch(await page.locator('#planCandidates').innerText(),/Subdivision|Unrelated/);
  await page.locator('#candidateSearch').fill('super mario');
  assert.equal(await choices.count(),4);assert.doesNotMatch(await page.locator('#planCandidates').innerText(),/Superstars|Superstar Saga/);
  await page.locator('#candidateSearch').fill('divison');
  assert.equal(await choices.count(),0);
  assert.equal(await page.locator('.search-suggestions:visible button').count(),2);
  await page.locator('.search-suggestions:visible button').first().click();
  await choices.first().click();
  await page.waitForFunction(()=>document.querySelector('#planCandidates [data-candidate]')?.disabled);
  await page.locator('#addGamesDialog [data-close]').click();
  await page.locator('#planSearch').fill('divi');
  assert.equal(await page.locator('#planResults .plan-row').count(),1);
  await page.locator('#planSearch').fill('divison');
  assert.equal(await page.locator('#planResults .plan-row').count(),0);
  assert.equal(await page.locator('.search-suggestions:visible button').count(),1);
  await page.locator('.search-suggestions:visible button').first().click();
  assert.equal(await page.locator('#planResults .plan-row').count(),1);
  passed.push('Play Plan and game picker share prefix matching and selectable typo suggestions');
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${origin}/library/wishlist.html?workspace=sample&q=divison`);
  await page.waitForFunction(()=>document.querySelectorAll('.search-suggestions:not([hidden]) button').length===2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow on mobile');
  assert.equal(await page.locator('.search-suggestions:visible button').evaluateAll(buttons=>buttons.every(button=>button.getBoundingClientRect().height>=44)),true);
  await page.screenshot({path:'/tmp/retro-search-mobile.png',fullPage:true});
  passed.push('Mobile suggestions fit the viewport and maintain 44px touch targets');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed},null,2));await context.close();
}finally{await browser.close();}

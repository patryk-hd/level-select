// Isolated fictional copies only. No real server, provider, or personal storage.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--playwright'||args[2]!=='--browser')throw Error('Provide --playwright <module> --browser <Chromium executable>.');
const module=await import(pathToFileURL(args[1]).href),{chromium}=module.default??module;
const browser=await chromium.launch({executablePath:args[3],headless:true});
const origin='http://127.0.0.1:18896/retro',errors=[],passed=[];
async function context() {
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  ctx.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await ctx.route('**/*',async route=>{
    if(!route.request().url().startsWith(`${origin}/`))return route.abort();
    const path=new URL(route.request().url()).pathname.slice('/retro/'.length);if(path.includes('..'))return route.abort();
    try {
      let body=await readFile(new URL(`../dist/${path}`,import.meta.url));
      if(path==='library/data/library-data.js')body=Buffer.from(body.toString()+`
        {const template=structuredClone(window.PLAYNITE_LIBRARY[0]);
        for(const [id,year] of [['original',2006],['reboot',2017]]) {
          const game=structuredClone(template);
          Object.assign(game,{id:'release-'+id,name:'Fictional same-name game',year,releaseDate:String(year),groupingVersion:2,notes:'',favorite:false,hidden:false,platforms:['Windows'],sources:['Steam'],
            legacyGroups:[{id:'old-group',name:'Fictional same-name game',copyIds:['original','reboot'],notes:'Shared note <img src=x onerror=alert(1)>',favorite:true,hidden:true}],
            copies:[{...game.copies[0],id,name:'Fictional '+id,year,platforms:['Windows'],sources:['Steam']}]});
          window.PLAYNITE_LIBRARY.push(game);
        }}
      `);
      return route.fulfill({body,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':path.endsWith('.html')?'text/html':'application/octet-stream'});
    } catch {return route.fulfill({status:404,body:'Not found'});}
  });return ctx;
}
const ready=page=>page.waitForFunction(()=>window.retroTracking);
async function open(page,id='old-group') {
  await page.goto(`${origin}/library/index.html?game=${id}`);await ready(page);
  await page.evaluate(async()=>{if(!window.retroTracking.status().ready)await window.retroTracking.commitMigration();});
}
try {
  const ctx=await context(),page=await ctx.newPage();await open(page);
  assert.equal(await page.locator('[data-release-id]').count(),2);
  await page.locator('[data-release-id=release-original]').click();
  assert.equal(await page.locator('#notesInput').inputValue(),'');
  assert.match(await page.locator('.preserved-group').innerText(),/Fictional same-name/);
  await page.locator('.preserved-group summary').click();
  assert.match(await page.locator('.preserved-note').innerText(),/Shared note <img/);
  assert.equal(await page.locator('.preserved-note img').count(),0);
  assert.equal(await page.locator('#toggleHidden').innerText(),'Hide game');
  const before=await page.evaluate(()=>window.retroTracking.snapshot());
  await page.locator('[data-copy-group-notes]').click();
  await page.locator('[data-group-note-status]').filter({hasText:'Notes copied'}).waitFor();
  assert.match(await page.locator('#notesInput').inputValue(),/Shared note/);
  const after=await page.evaluate(()=>window.retroTracking.snapshot());
  for(const field of ['playthroughs','events','backlog','ownership','matchReviews','productReviews','rewardLedger'])assert.deepEqual(after[field],before[field],field);
  assert.deepEqual(after.annotations['owned:old-group'],before.annotations['owned:old-group']);
  await open(page,'release-reboot');assert.equal(await page.locator('#notesInput').inputValue(),'');
  await open(page,'release-original');assert.match(await page.locator('#notesInput').inputValue(),/Shared note/);
  passed.push('Old bookmarks offer both releases; scoped notes are escaped, explicitly copied, isolated and persistent');

  const other=await ctx.newPage();await open(other,'release-original');
  await page.locator('.preserved-group summary').click();
  await page.locator('#notesInput').focus();
  await other.evaluate(async()=>window.retroTracking.annotate('legacy-owned','old-group',{notes:'Changed in another tab'}));
  await page.waitForFunction(()=>window.retroTracking.snapshot().annotations['owned:old-group'].notes==='Changed in another tab');
  await page.locator('[data-copy-group-notes]').click();
  await page.locator('[data-group-note-status]').filter({hasText:'not copied'}).waitFor();
  assert.match(await page.locator('#notesInput').inputValue(),/Shared note/);
  passed.push('Stale source notes are rejected without overwriting the destination draft');

  const backup=await page.evaluate(()=>window.retroTracking.backup());
  const clean=await context(),restored=await clean.newPage();await open(restored,'release-original');
  await restored.evaluate(async backup=>{const c=window.retroTracking,p=c.previewBackup(JSON.stringify(backup));await c.importBackup(p,Object.fromEntries(p.conflicts.map(r=>[`${r.section}/${r.id}`,'incoming'])));},backup);
  await restored.reload();await ready(restored);
  assert.match(await restored.locator('#notesInput').inputValue(),/Shared note/);
  await restored.locator('.preserved-group summary').click();
  assert.equal(await restored.locator('.preserved-note').innerText(),'Changed in another tab');
  await restored.locator('.preserved-group').scrollIntoViewIfNeeded();
  await restored.screenshot({path:'/tmp/retro-group-notes-desktop.png'});
  await restored.setViewportSize({width:390,height:844});
  await restored.locator('.preserved-group').scrollIntoViewIfNeeded();
  assert.equal(await restored.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const button=await restored.locator('[data-copy-group-notes]').boundingBox();assert.ok(button.width<390);
  await restored.screenshot({path:'/tmp/retro-group-notes-mobile.png'});
  await restored.keyboard.press('Escape');assert.equal(await restored.locator('#detailsPanel').isVisible(),false);
  passed.push('Clean-workspace backup restoration, mobile layout and keyboard dismissal work');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed},null,2));
  await clean.close();await ctx.close();
} finally {await browser.close();}

// Fictional sample data only; all browser requests are intercepted locally.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--playwright'||args[2]!=='--browser')throw Error('Provide --playwright <module> --browser <Chromium executable>.');
const module=await import(pathToFileURL(args[1]).href),{chromium}=module.default??module;
const browser=await chromium.launch({executablePath:args[3],headless:true});
const origin='http://127.0.0.1:18895/retro',errors=[],passed=[];
const catalog=JSON.parse(await readFile(new URL('../dist/data/catalog.json',import.meta.url),'utf8'));
const catalogId=catalog.games.find(game=>game.title==='Super Metroid'&&game.systemId==='snes').id;
let changed=false;
async function context() {
  const context=await browser.newContext({acceptDownloads:true});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/*',async route=>{
    const url=route.request().url();if(!url.startsWith(`${origin}/`))return route.abort();
    const path=new URL(url).pathname.slice('/retro/'.length);if(path.includes('..'))return route.abort();
    try {
      let body=await readFile(new URL(`../dist/${path}`,import.meta.url));
      if(path==='library/data/library-data.js')body=Buffer.from(body.toString().replace('window.PLAYNITE_SAMPLE = true','window.PLAYNITE_SAMPLE = false')+(changed?'\nwindow.PLAYNITE_LIBRARY[0].copies[0].year=2026;':''));
      const contentType=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':path.endsWith('.html')?'text/html':'application/octet-stream';
      return route.fulfill({body,contentType});
    }catch{return route.fulfill({status:404,body:'Not found'});}
  });return context;
}
const state=page=>page.evaluate(async()=>(await(await import(new URL('./tracking/client.js',location.origin+'/retro/index.html'))).trackingClient()).snapshot());
async function decision(page,selector,value) {
  const panel=page.locator(selector);await panel.locator('summary').click();
  await panel.locator(`[data-match-decision=${value}]`).first().click();
  await panel.locator('[data-match-status]').filter({hasText:'Match decision saved'}).waitFor();
}
try {
  const c=await context(),page=await c.newPage();
  await page.goto(`${origin}/index.html?game=${catalogId}`);await page.locator('#catalogLibraryMatches').waitFor();
  await page.evaluate(async()=>{const client=await(await import('./tracking/client.js')).trackingClient();if(!client.status().ready)await client.commitMigration();});
  const before=await state(page);
  assert.match(await page.locator('#catalogOwnership').innerText(),/Possible library match/);
  await decision(page,'#catalogLibraryMatches','accepted');
  assert.match(await page.locator('#catalogOwnership').innerText(),/In your library/);
  const after=await state(page);
  for(const key of ['targets','playthroughs','annotations','backlog','ownership','rewardLedger'])assert.deepEqual(after[key],before[key],key);
  const backup=await page.evaluate(async()=>(await(await import('./tracking/client.js')).trackingClient()).backup());
  assert.equal(backup.version,7);
  await page.reload();await page.locator('#catalogLibraryMatches').waitFor();
  assert.match(await page.locator('#catalogOwnership').innerText(),/In your library/);
  passed.push('Confirming an exact copy updates ownership and survives reload without changing progress, notes, queue or XP');

  const other=await c.newPage();await other.goto(`${origin}/library/index.html?game=sample-super-metroid`);await other.locator('#ownedLibraryMatches').waitFor();
  assert.match(await other.locator('#recommendationLinks').innerText(),/confirmed match/);
  await decision(other,'#ownedLibraryMatches','rejected');
  await page.waitForFunction(()=>document.querySelector('#catalogLibraryMatches')?.textContent.includes('Not the same edition'));
  assert.equal(await page.locator('#catalogOwnership a').count(),0);
  assert.equal(await other.locator('#recommendationLinks a').count(),0);
  await other.reload();await other.locator('#ownedLibraryMatches').waitFor();
  assert.match(await other.locator('#ownedLibraryMatches').textContent(),/Not the same edition/);
  await decision(other,'#ownedLibraryMatches','unresolved');
  await page.waitForFunction(()=>document.querySelector('#catalogOwnership')?.textContent.includes('Possible library match'));
  passed.push('Reject and reset decisions persist and propagate between owned-library and recommendation tabs');

  const restored=await context(),restore=await restored.newPage();
  await restore.goto(`${origin}/index.html?game=${catalogId}`);await restore.locator('#catalogLibraryMatches').waitFor();
  await restore.evaluate(async backup=>{
    const client=await(await import('./tracking/client.js')).trackingClient();if(!client.status().ready)await client.commitMigration();
    const preview=client.previewBackup(JSON.stringify(backup));
    const resolutions=Object.fromEntries(preview.conflicts.map(c=>[`${c.section}/${c.id}`,'current']));
    await client.importBackup(preview,resolutions);
  },backup);
  await restore.reload();await restore.locator('#catalogLibraryMatches').waitFor();
  assert.match(await restore.locator('#catalogOwnership').innerText(),/In your library/);
  changed=true;await restore.reload();await restore.locator('#catalogLibraryMatches').waitFor();
  assert.equal(await restore.locator('#catalogOwnership a').count(),0);
  assert.match(await restore.locator('#catalogLibraryMatches').textContent(),/Details changed/);
  passed.push('Fresh-workspace backup restoration restores review decisions; changed import identity requires another review');

  await restore.setViewportSize({width:390,height:844});
  await restore.locator('#catalogLibraryMatches summary').click();
  await restore.locator('#catalogLibraryMatches').scrollIntoViewIfNeeded();
  assert.equal(await restore.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await restore.screenshot({path:'/tmp/retro-match-review-mobile.png'});
  await restore.setViewportSize({width:1440,height:1000});
  await restore.locator('#catalogLibraryMatches').scrollIntoViewIfNeeded();
  await restore.screenshot({path:'/tmp/retro-match-review-desktop.png'});
  passed.push('Review controls fit mobile and desktop layouts');
  assert.deepEqual(errors,[]);await c.close();await restored.close();
  console.log(JSON.stringify({passed},null,2));
}finally{await browser.close();}

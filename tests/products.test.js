import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { emptyState, ensureTarget, applyCommand } from '../tracking/domain.js';
import { productMatch, productInventory, reviewProduct, steamProductId } from '../tracking/products.js';
import { createBackup, parseBackup, previewMerge, mergeBackup, validateState } from '../tracking/backup.js';
import { ownedSourceRating, sourceIndex } from '../ranking/modes.js';
import { providerPanelHtml } from '../ranking/panels.js';
import { enrich, options } from '../scripts/enrich-ratings.mjs';

const at='2026-09-17T12:00:00.000Z';
const sample=JSON.parse(await readFile(new URL('../library/sample/ratings.json',import.meta.url)));
const library=()=>[{id:'group',name:'Same name',steamAppId:'99',copies:[
  {id:'original',name:'Same name',year:2006,platforms:['Windows'],sources:['Steam'],steamAppId:'900000001',steamAppIdProvenance:{origin:'title-search',trust:'candidate'}},
  {id:'reboot',name:'Same name',year:2017,platforms:['Windows'],sources:['Steam'],steamAppId:'900000001'},
  {id:'gog',name:'Same name',year:2006,platforms:['Windows'],sources:['GOG'],steamAppId:'900000001'},
  {id:'console',name:'Same name',year:2006,platforms:['PS4'],sources:['Steam'],steamAppId:'900000001'},
]}];
function review(state,games,{copyId='original',product='900000001',decision='accepted',...rest}={}) {
  const game=games.find(g=>g.copies.some(c=>c.id===copyId)),copy=game.copies.find(c=>c.id===copyId);
  return reviewProduct(state,games,{copyId,product,decision,confirmed:true,expected:state.productReviews[copyId]??null,
    expectedIdentity:productMatch(game,copy,state.productReviews).fingerprint,at,...rest});
}
test('Steam input accepts only app products, not packages, bundles, hostile hosts or commands',()=>{
  for(const input of ['900000001','https://store.steampowered.com/app/900000001/Title/?x=1'])assert.equal(steamProductId(input),'900000001');
  for(const input of ['0','1e4','123abc','https://store.steampowered.com/sub/123','https://store.steampowered.com/bundle/123','https://store.steampowered.com.evil.test/app/123','https://user@store.steampowered.com/app/123','javascript:alert(1)'])assert.equal(steamProductId(input),null);
});
test('unreviewed, same-name reboot and other-store copies cannot borrow Steam ratings',()=>{
  const games=library(),state=review(emptyState(),games),index=sourceIndex(sample);
  for(const id of ['reboot','gog','console'])assert.equal(ownedSourceRating(index,games[0],'steam-raw',{copyId:id},state.productReviews).value,null);
  assert.equal(ownedSourceRating(index,games[0],'steam-raw',{copyId:'original'},state.productReviews).value,95);
  assert.equal(ownedSourceRating(index,games[0],'steam',{},state.productReviews).value,null);
  assert.equal(ownedSourceRating(index,games[0],'vgc',{copyId:'original'},state.productReviews).value,null);
  assert.throws(()=>review(state,games,{copyId:'gog'}),/Steam copy/);
  assert.throws(()=>review(state,games,{confirmed:false}),/Check the product/);
  assert.match(providerPanelHtml(sample,{provider:'playnite',id:'original'},Date.now(),{provider:'steam',id:'900000001'}),/95% positive/);
});
test('same title groups retain per-copy identity; old group IDs do not spread across copies',()=>{
  const games=library();delete games[0].copies[0].steamAppId;
  assert.equal(productMatch(games[0],games[0].copies[0]).candidateId,null);
  assert.equal(productMatch({...games[0],copies:[games[0].copies[0]]},games[0].copies[0]).candidateId,'99');
  assert.equal(productMatch(games[0],games[0].copies[1]).origin,'legacy-unknown');
});
test('refresh-safe acceptance tolerates regrouping/playtime but invalidates changed identity, origin or IDs',()=>{
  const games=library(),state=review(emptyState(),games);
  games[0].id='regrouped';games[0].copies[0].timePlayed=999;
  assert.equal(productMatch(games[0],games[0].copies[0],state.productReviews).status,'accepted');
  for(const patch of [{name:'Same name Remastered'},{year:2017},{sources:['GOG']},{platforms:['PS4']},{steamAppId:'321'},{steamAppIdProvenance:{origin:'csv-steam-id'}}]) {
    const changed={...games[0].copies[0],...patch};assert.equal(productMatch(games[0],changed,state.productReviews).ref,null);
  }
  games[0].copies[0].available=false;
  assert.equal(productMatch(games[0],games[0].copies[0],state.productReviews).status,'unavailable');
  assert.throws(()=>review(state,games),/unavailable/);
});
test('corrections, rejects and reset survive backup; stale writes cannot replace another decision',()=>{
  const games=library();let state=review(emptyState(),games,{decision:'rejected'});
  games[0].copies[0].year=2007;
  assert.equal(productMatch(games[0],games[0].copies[0],state.productReviews).status,'rejected');
  assert.throws(()=>review(state,games,{expected:null}),/another tab/);
  state=review(state,games,{product:'900000002'});
  assert.equal(productMatch(games[0],games[0].copies[0],state.productReviews).ref.id,'900000002');
  const restored=parseBackup(JSON.stringify(createBackup(state,at)),'personal');assert.deepEqual(restored,state);
  const conflict=previewMerge(restored,review(state,games,{decision:'rejected'}));assert.equal(conflict.conflicts.length,1);
  assert.throws(()=>mergeBackup(restored,review(state,games,{decision:'rejected'})),/Choose/);
  const reset=review(state,games,{decision:'unresolved',product:''});assert.equal(productInventory(games,reset.productReviews).verifiedProductIds.length,0);
  assert.deepEqual(productInventory([],state.productReviews).missingReviewedCopies,['original']);
});
test('reviewing a score association leaves tracking/history intact and schema-six upgrades add no approvals',()=>{
  const games=library();let state=emptyState();const target=ensureTarget(state,{ref:{provider:'playnite',id:'original'},title:'Original',platforms:['PC']});
  state=applyCommand(state,{type:'queue',targetId:target.id,eventId:'queue',at});
  const changed=review(state,games);assert.deepEqual({...changed,productReviews:{}},state);
  const old=structuredClone(state);old.schemaVersion=6;delete old.productReviews;delete old.listAwards;
  assert.deepEqual(validateState(old).productReviews,{});assert.equal(old.schemaVersion,6);
  const bad=structuredClone(changed);bad.productReviews.original.productId='https://bad.test/';assert.throws(()=>validateState(bad),/Steam app ID/);
});
test('owned refresh plan uses only valid reviewed copies and keeps the full backup local',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'retro-product-plan-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'library/data'),{recursive:true});await mkdir(path.join(root,'ranking'));
  await writeFile(path.join(root,'ranking/crosswalk.json'),JSON.stringify({schemaVersion:1,revision:1,mappings:[]}));
  const games=library(),state=review(emptyState(),games);
  await writeFile(path.join(root,'tracking.json'),JSON.stringify(createBackup(state,at)));
  const source=()=>`window.PLAYNITE_SAMPLE=false;window.PLAYNITE_LIBRARY=${JSON.stringify(games)};`;
  await writeFile(path.join(root,'library/data/library-data.js'),source());
  const run=()=>enrich({root,args:['--owned','--tracking','tracking.json','--provider','steam','--plan'],fetchImpl:async()=>{throw Error('must stay offline');}});
  const plan=await run();assert.equal(plan.mappings,1);assert.equal(plan.ownedIdentity.verifiedProducts,1);assert.equal(plan.ownedIdentity.counts.unresolved,1);assert.equal(plan.ownedIdentity.counts['not-applicable'],2);
  await assert.rejects(access(path.join(root,'.runtime')));
  const backupBefore=await readFile(path.join(root,'tracking.json'),'utf8');
  const requests=[];
  const report=await enrich({root,args:['--owned','--tracking','tracking.json','--provider','steam','--max-requests','1'],
    clock:()=>Date.parse(at),sleep:async()=>{},fetchImpl:async(url,init)=>{
      requests.push({url,init});return new Response(JSON.stringify({success:1,query_summary:{total_positive:95,total_negative:5,total_reviews:100}}));
    }});
  assert.equal(report.requests,1);assert.equal(requests.length,1);
  assert.match(requests[0].url,/appreviews\/900000001\?/);assert.equal(requests[0].init.body,undefined);
  assert.equal(await readFile(path.join(root,'tracking.json'),'utf8'),backupBefore);
  const saved=JSON.parse(await readFile(path.join(root,'library/data/ratings.json'),'utf8'));
  assert.equal(ownedSourceRating(sourceIndex(saved),games[0],'steam-raw',{copyId:'original'},state.productReviews).value,95);
  assert.equal(ownedSourceRating(sourceIndex(saved),games[0],'steam-raw',{copyId:'reboot'},state.productReviews).value,null);
  games[0].copies[0].year=2020;await writeFile(path.join(root,'library/data/library-data.js'),source());
  assert.equal((await run()).ownedIdentity.counts.changed,1);assert.equal((await run()).ownedIdentity.verifiedProducts,0);
  assert.equal((await run()).mappings,1); // Previously selected products remain cached independently of their copy associations.
  assert.throws(()=>options(['--owned']),/--tracking/);
  const sampleState=emptyState('sample');await writeFile(path.join(root,'tracking.json'),JSON.stringify(createBackup(sampleState,at)));
  await assert.rejects(run(),/Sample and personal/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sourceIndex, sourceRating, ownedSourceRating, rankCandidates, importedWishlistRating, ratingText } from '../ranking/modes.js';
import { rankingExplanationHtml, rankingSummaryHtml, ratingAttributionHtml } from '../ranking/mode-ui.js';
import { emptyRatings } from '../ranking/snapshot.js';
import { parseState, encodeState, freshState } from '../lib.js';
const sample=JSON.parse(await readFile(new URL('../library/sample/ratings.json',import.meta.url)));
const steam={provider:'steam',id:'900000001'},owned={provider:'playnite',id:'sample-copy-super-metroid'};
const index=sourceIndex(sample),now=Date.parse(sample.generatedAt);

test('provider modes keep VGC/IGDB unchanged and compute conservative Steam approval from exact counts',()=>{
  const approval=sourceRating(index,steam,'steam',{now});
  assert.ok(Math.abs(approval.value-93.4686452)<.0001);
  assert.equal(sourceRating(index,steam,'steam-raw',{now}).value,95);
  assert.equal(sourceRating(index,steam,'steam-volume',{now}).value,1000);
  assert.equal(sourceRating(index,steam,'vgc',{now}).value,82);
  assert.equal(sourceRating(index,owned,'igdb-community',{now}).value,75);
  assert.equal(sourceRating(index,owned,'igdb-critics',{now}).value,88);
  assert.equal(approval.snapshotId,sample.snapshotId);assert.equal(approval.evidenceIds.length,1);
});

test('missing sources and incompatible release scope never borrow another provider or a legacy value',()=>{
  assert.equal(sourceRating(index,steam,'igdb-critics').value,null);
  assert.equal(sourceRating(sourceIndex(emptyRatings('personal')),steam,'steam').value,null);
  const system=sourceRating(index,steam,'vgc',{systemRank:true});assert.equal(system.value,null);assert.match(system.reason,/system rank/);
  assert.equal(sourceRating(index,{provider:'catalog',id:steam.id},'vgc').value,null);
});

test('unreleased products cannot enter reception order; explicit volume is still labeled popularity',()=>{
  assert.equal(sourceRating(index,steam,'steam',{comingSoon:true}).value,null);
  assert.equal(sourceRating(index,steam,'vgc',{comingSoon:true}).value,null);
  const volume=sourceRating(index,steam,'steam-volume',{comingSoon:true});assert.equal(volume.value,1000);
  assert.match(rankingExplanationHtml(volume),/popularity, not quality/);
});

test('owned selection requires one reviewed copy and ignores title-derived Steam IDs',()=>{
  const game={steamAppId:steam.id,copies:[{id:owned.id,platforms:['SNES']},{id:'another-copy',platforms:['PC'],steamAppId:steam.id}]};
  assert.equal(ownedSourceRating(index,game,'vgc').value,null);
  assert.equal(ownedSourceRating(index,game,'vgc',{platform:'SNES'}).value,82);
  assert.equal(ownedSourceRating(index,game,'vgc',{platform:'PC'}).value,null);
  assert.equal(ownedSourceRating(index,{copies:[game.copies[1]]},'steam').value,null);
});

test('full cohort positions, ties and candidate IDs are deterministic and independent of filters',()=>{
  const result=sourceRating(index,steam,'vgc');
  const candidates=[{...result,targetId:'b',title:'Bravo',value:80},{...result,targetId:'a',title:'Alpha',value:80},{...result,targetId:'c',title:'Charlie',value:70},{...result,targetId:'d',title:'Unknown',value:null}];
  const ranked=rankCandidates(candidates,{cohort:'fixture'}),reverse=rankCandidates([...candidates].reverse(),{cohort:'fixture'});
  assert.deepEqual([...ranked.records.keys()],['a','b','c','d']);
  assert.deepEqual([...ranked.records.values()].map(item=>item.rank),[1,1,3,null]);
  assert.equal(ranked.candidateSetId,reverse.candidateSetId);
  const filtered=[...ranked.records.values()].filter(item=>item.title==='Charlie');assert.equal(filtered[0].rank,3);
  assert.notEqual(rankCandidates(candidates.slice(1),{cohort:'fixture'}).candidateSetId,ranked.candidateSetId);
  assert.throws(()=>rankCandidates([candidates[0],candidates[0]],{cohort:'fixture'}),/Duplicate/);
});

test('zero scores remain ranked while inconsistent or empty approval populations cannot become quality scores',()=>{
  const fixture=structuredClone(sample),row=fixture.rows.find(row=>row.provider==='steam'),original=row.observations[0].original;
  Object.assign(original,{value:0,positive:0,negative:10,count:10});
  assert.equal(sourceRating(sourceIndex(fixture),steam,'steam').value,0);
  Object.assign(original,{value:null,positive:0,negative:0,count:0});
  assert.equal(sourceRating(sourceIndex(fixture),steam,'steam').value,null);
  assert.equal(sourceRating(sourceIndex(fixture),steam,'steam-volume').value,0);
  Object.assign(original,{value:100,positive:100,negative:0,count:5});
  assert.equal(sourceRating(sourceIndex(fixture),steam,'steam').value,null);
});

test('stale or failed-refresh evidence preserves value and identity with visible freshness',()=>{
  const old=sourceRating(index,steam,'vgc',{now:now+24*3600000});assert.equal(old.freshness,'stale');
  const fixture=structuredClone(sample);fixture.rows.find(row=>row.provider==='vgc').error='throttled';
  const failed=sourceRating(sourceIndex(fixture),steam,'vgc',{now});assert.equal(failed.freshness,'refresh-failed');
  assert.equal(failed.value,old.value);assert.deepEqual(failed.evidenceIds,old.evidenceIds);
  assert.match(rankingExplanationHtml(failed),/last accepted/);
});

test('import mode remains explicit, approximate when necessary, and has separate volume/raw methods',()=>{
  const game={appid:'123',title:'Fixture',reviewPct:95,reviewCount:1000,bestScore:100,pickScore:1};
  const result=importedWishlistRating(game);assert.ok(result.approval.approximate);assert.ok(result.value<95);
  assert.equal(importedWishlistRating(game,{mode:'imported-raw'}).value,95);
  const volume=importedWishlistRating({...game,comingSoon:true},{mode:'imported-volume'});
  assert.equal(volume.value,1000);assert.match(ratingText(volume),/1000 reviews/);
  assert.notEqual(result.methodVersion,volume.methodVersion);
});

test('explanations expose cohort and evidence provenance, escape source strings and honor sample attribution',()=>{
  const result={...sourceRating(index,steam,'vgc'),title:'Fixture'};
  const ranked=rankCandidates([result],{cohort:'Fixture <scope>'});
  const html=rankingExplanationHtml([...ranked.records.values()][0]);
  assert.match(html,/Fixture &lt;scope&gt;/);assert.match(html,/vgc-score-unchanged-v1/);assert.match(html,/Evidence snapshot/);
  assert.doesNotMatch(ratingAttributionHtml(result),/<a/);
  assert.match(rankingSummaryHtml(ranked,{label:'VGC Score',context:true,sample:true}),/Fictional sample ratings/);
  const personal={...result,workspace:'personal'};
  assert.match(ratingAttributionHtml(personal),/Powered by VideoGamesCritic/);assert.match(ratingAttributionHtml(personal),/videogamescritic.com\/game\//);
});

test('the demo credits its real public ratings and marks only the fictional ones',()=>{
  const made={...sourceRating(index,steam,'steam'),title:'Fixture'};
  const real={...made,targetId:'steam:1',title:'Real',row:{...made.row,source:{...made.row.source,url:'https://store.steampowered.com/app/1/',publicData:true}}};
  assert.match(ratingAttributionHtml(real),/<a class="provider-credit" href="https:\/\/store\.steampowered\.com\/app\/1\/"/);
  assert.match(ratingAttributionHtml(made),/Fictional example/);
  assert.match(rankingSummaryHtml(rankCandidates([made,real],{cohort:'Wishlist'}),{label:'Steam reviews',sample:true}),/the fictional examples are marked/);
  assert.doesNotMatch(rankingSummaryHtml(rankCandidates([real],{cohort:'Wishlist'}),{label:'Steam reviews',sample:true}),/[Ff]ictional/);
});

test('catalog source bookmarks cannot apply a legacy system rank cutoff',()=>{
  const catalog={families:[],systems:[],games:[]};
  const parsed=parseState('?sort=vgc&rank=10',catalog);assert.equal(parsed.sort,'vgc');assert.equal(parsed.rank,'all');
  assert.equal(parseState(encodeState({...freshState(),sort:'igdb-critics'}),catalog).sort,'igdb-critics');
});

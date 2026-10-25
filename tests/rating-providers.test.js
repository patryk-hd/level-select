import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { vgc } from '../ranking/providers/vgc.mjs';
import { steam } from '../ranking/providers/steam.mjs';
import { igdb } from '../ranking/providers/igdb.mjs';
import { validateCrosswalk, verifyMapping, steamMapping } from '../ranking/crosswalk.mjs';
import { refreshRatings, emptyCache, cacheKey } from '../ranking/refresh.mjs';
import { validateRatingsSnapshot, cacheFreshness, providerRows } from '../ranking/snapshot.js';
import { providerPanelHtml } from '../ranking/panels.js';
import { atomicJSON, withRefreshLock } from '../ranking/storage.mjs';
import { enrich, options } from '../scripts/enrich-ratings.mjs';

const fixtures=JSON.parse(await readFile(new URL('../ranking/fixtures/providers.json',import.meta.url)));
const epoch=Date.parse('2026-09-16T12:00:00Z'),sleep=async()=>{},clock=()=>epoch;
const review={status:'verified',reviewedAt:new Date(epoch).toISOString(),reason:'Fictional reviewed identity for isolated source tests.'};
const vgcMap={id:'vgc-fixture',provider:'vgc',providerId:'990001',target:{provider:'steam',id:'900000001'},scope:'work-context',expected:{names:['Fictional Quest'],steamId:'900000001'},review};
const igdbMap={id:'igdb-fixture',provider:'igdb',providerId:'990002',target:{provider:'playnite',id:'fixture-copy'},scope:'work-context',expected:{names:['Fictional Quest']},review};
const map=(...mappings)=>({schemaVersion:1,revision:1,mappings});
const json=(body,headers={})=>new Response(JSON.stringify(body),{headers});
const run=(crosswalk,fetchImpl,extra={})=>refreshRatings({crosswalk,fetchImpl,sleep,clock,...extra});

test('VGC preserves branded components and tolerates documented optional gap/trend shapes',()=>{
  const source=vgc.normalize(fixtures.vgc,'990001');
  assert.equal(source.scope,'work-context');assert.equal(source.steamId,'900000001');
  assert.deepEqual(source.signals.map(s=>s.value),[82,80,90]);
  assert.ok(source.signals.every(s=>s.type==='external-composite'));
  assert.equal(vgc.normalize({...fixtures.vgc,scores:{...fixtures.vgc.scores,gap:10,confidence:null,trend:'unknown'}},'990001').details.gap,10);
  assert.throws(()=>vgc.normalize({...fixtures.vgc,id:900000001},'990001'));
  assert.throws(()=>vgc.normalize({...fixtures.vgc,scores:{vgc:101}},'990001'));
  assert.throws(()=>vgc.normalize({...fixtures.vgc,links:{page:'javascript:alert(1)'}},'990001'));
});

test('Steam uses query totals, exact counts and explicit population, excluding review text and identities',()=>{
  const source=steam.normalize(fixtures.steam,'900000001');
  assert.equal(source.signals[0].count,1000);assert.equal(source.signals[0].value,95);
  assert.equal(source.signals[0].positive,950);assert.equal(source.details.queryScope.purchase_type,'all');
  assert.doesNotMatch(JSON.stringify(source),/FICTIONAL_REVIEWER|private test marker/);
  assert.throws(()=>steam.normalize({success:1,query_summary:{total_positive:10,total_negative:2,total_reviews:10}},'900000001'));
  assert.equal(steam.normalize({success:1,query_summary:{total_positive:0,total_negative:0,total_reviews:0}},'900000001').signals[0].value,null);
});

test('IGDB keeps community and critic populations separate and needs explicit local credentials',()=>{
  assert.throws(()=>igdb.request('990002'),/credentials-missing/);
  const request=igdb.request('990002',{igdbClientId:'fixture-client',igdbAccessToken:'fixture-access'});
  assert.match(request.init.body,/where id = 990002/);assert.equal(request.init.headers.Authorization,'Bearer fixture-access');
  const source=igdb.normalize(fixtures.igdb,'990002');assert.equal(source.scope,'work-context');
  assert.deepEqual(source.signals.map(s=>[s.value,s.count]),[[75,40],[88,6]]);
  assert.throws(()=>igdb.normalize([], '990002'),/provider-not-found/);
  assert.throws(()=>igdb.normalize([{...fixtures.igdb[0],id:999}], '990002'));
});

test('crosswalk rejects search candidates, wrong editions, broad platform promotion and conflicting mappings',()=>{
  validateCrosswalk(map(vgcMap));
  assert.throws(()=>validateCrosswalk(map({...vgcMap,review:{...review,status:'candidate'}})));
  assert.throws(()=>validateCrosswalk(map({...vgcMap,scope:'ps5-release'})));
  assert.throws(()=>validateCrosswalk(map(vgcMap,{...vgcMap,id:'duplicate'})));
  const source=vgc.normalize(fixtures.vgc,'990001');
  assert.throws(()=>verifyMapping({...vgcMap,expected:{names:['Fictional Quest Remastered']}},source));
  assert.throws(()=>verifyMapping({...vgcMap,expected:{steamId:'900000002'}},source));
  assert.throws(()=>validateCrosswalk(map({...steamMapping('900000001',review.reviewedAt),target:{provider:'catalog',id:'snes-original'}})));
});

test('shared requests are deduplicated; a fresh cache makes no calls and 304 preserves evidence identity',async()=>{
  const cw=map(vgcMap,{...vgcMap,id:'catalog-context',target:{provider:'catalog',id:'fixture-release'}});let calls=0;
  const first=await run(cw,async()=>{calls++;return json(fixtures.vgc,{etag:'"fixture-v1"'});});
  assert.equal(calls,1);assert.equal(first.snapshot.rows.length,2);validateRatingsSnapshot(first.snapshot);
  const cached=await run(cw,async()=>{throw Error('must not fetch');},{cache:first.cache});
  assert.equal(cached.report.requests,0);assert.equal(cached.snapshot.snapshotId,first.snapshot.snapshotId);
  const revalidated=await run(cw,async(url,init)=>{assert.equal(init.headers['If-None-Match'],'"fixture-v1"');return new Response(null,{status:304});},{cache:first.cache,clock:()=>epoch+7*3600000});
  assert.equal(revalidated.report.requests,1);assert.equal(revalidated.snapshot.snapshotId,first.snapshot.snapshotId);
  assert.equal(revalidated.snapshot.rows[0].observedAt,first.snapshot.rows[0].observedAt);
  assert.notEqual(revalidated.snapshot.rows[0].checkedAt,first.snapshot.rows[0].checkedAt);
});

test('timeouts, malformed JSON, oversized bodies, wrong IDs and server failures retain last accepted observations',async()=>{
  const first=await run(map(vgcMap),async()=>json(fixtures.vgc));
  for(const response of [()=>new Response('broken'),()=>new Response('x'.repeat(2*1024*1024+1)),()=>json({...fixtures.vgc,id:7}),()=>json({...fixtures.vgc,name:'Fictional Quest Remastered'}),()=>new Response('',{status:503}),()=>{throw new DOMException('sensitive request detail','TimeoutError');}]){
    const result=await run(map(vgcMap),async()=>response(),{cache:first.cache,force:true});
    assert.deepEqual(result.snapshot.rows[0].observations,first.snapshot.rows[0].observations);
    assert.equal(cacheFreshness(result.snapshot.rows[0],epoch),'refresh-failed');
    assert.doesNotMatch(JSON.stringify(result),/sensitive request detail/);
  }
});

test('429 honors provider-wide retry time across new mappings and force cannot bypass it',async()=>{
  const second={...vgcMap,id:'second',providerId:'990003',target:{provider:'steam',id:'900000003'},expected:{names:['Another fixture'],steamId:'900000003'}};
  const result=await run(map(vgcMap,second),async()=>new Response('',{status:429,headers:{'Retry-After':'7200'}}));
  assert.equal(result.report.requests,1);assert.equal(result.snapshot.rows[1].status,'backoff');
  assert.equal(result.snapshot.rows[0].nextAttemptAt,new Date(epoch+7200000).toISOString());
  const retry=await run(map(vgcMap,second),async()=>{throw Error('must not fetch');},{cache:result.cache,force:true,clock:()=>epoch+60000});
  assert.equal(retry.report.requests,0);
  const oversized=await run(map(vgcMap),async()=>new Response('',{status:429,headers:{'Retry-After':'9'.repeat(400)}}));
  assert.equal(Date.parse(oversized.snapshot.rows[0].nextAttemptAt)-epoch,7*86400000);
});

test('anonymous hourly budget and provider remaining header survive repeated runs',async()=>{
  const cache=emptyCache();cache.providers.vgc={windowStart:new Date(epoch).toISOString(),used:50};
  const result=await run(map(vgcMap),async()=>{throw Error('must not fetch');},{cache,force:true});assert.equal(result.report.requests,0);
  const remaining=await run(map(vgcMap),async()=>json(fixtures.vgc,{'x-ratelimit-remaining':'1'}));
  assert.ok(Date.parse(remaining.cache.providers.vgc.nextAttemptAt)>epoch);
  assert.equal((await run(map(vgcMap),async()=>{throw Error('must not fetch');},{cache:remaining.cache,force:true})).report.requests,0);
});

test('missing credentials are optional, never leak, and can be supplied without waiting for the old missing-key state',async()=>{
  const first=await run(map(igdbMap),async()=>{throw Error('must not fetch');});
  assert.equal(first.report.requests,0);assert.equal(first.snapshot.rows[0].status,'credentials-missing');
  const next=await run(map(igdbMap),async(url,init)=>{assert.equal(init.headers.Authorization,'Bearer fixture-secret');return json(fixtures.igdb);},{cache:first.cache,credentials:{igdbClientId:'fixture-client',igdbAccessToken:'fixture-secret'}});
  assert.equal(next.report.requests,1);assert.equal(next.snapshot.rows[0].observations.length,2);
  assert.doesNotMatch(JSON.stringify(next),/fixture-secret|fixture-client/);
});

test('missing records have a bounded negative cache and cannot clear another provider',async()=>{
  const first=await run(map(steamMapping('900000001',review.reviewedAt),vgcMap),async url=>url.includes('appreviews')?json(fixtures.steam):new Response('',{status:404}));
  assert.equal(first.snapshot.rows[0].observations.length,1);assert.equal(first.snapshot.rows[1].observations.length,0);
  const next=await run(map(vgcMap),async()=>{throw Error('must not fetch');},{cache:first.cache});assert.equal(next.report.requests,0);
  assert.equal(Date.parse(next.snapshot.rows[0].nextAttemptAt)-epoch,86400000);
});

test('changed mapping expectations cannot reuse a previously accepted identity',async()=>{
  const first=await run(map(vgcMap),async()=>json(fixtures.vgc));
  const changed={...vgcMap,expected:{...vgcMap.expected,names:['Fictional Quest Remastered']}};
  assert.notEqual(cacheKey(changed),cacheKey(vgcMap));
  const next=await run(map(changed),async()=>json(fixtures.vgc),{cache:first.cache});
  assert.equal(next.snapshot.rows[0].observations.length,0);
  assert.ok(next.cache.entries[cacheKey(vgcMap)].source);
});

test('partial request budgets preserve cached data and report pending records',async()=>{
  const result=await run(map(steamMapping('900000001',review.reviewedAt),vgcMap),async()=>json(fixtures.steam),{maxRequests:1});
  assert.equal(result.report.requests,1);assert.equal(result.snapshot.rows[1].status,'budget');
  assert.equal(result.snapshot.rows[0].observations[0].original.positive,950);
});

test('runtime validates scope and links, shows attribution and exposes stale data without silently changing source',async()=>{
  const result=await run(map(vgcMap),async()=>json(fixtures.vgc)),snapshot=result.snapshot;
  const html=providerPanelHtml(snapshot,vgcMap.target,epoch+7*3600000);
  assert.match(html,/Powered by VideoGamesCritic/);assert.match(html,/Work-level context/);assert.match(html,/refresh due/);
  assert.equal(providerRows(snapshot,{provider:'steam',id:'different'}).length,0);
  assert.throws(()=>validateRatingsSnapshot({...snapshot,rows:[{...snapshot.rows[0],scope:'ps5-release'}]}));
  const unsafe=structuredClone(snapshot);unsafe.rows[0].source.url='https://evil.example/';assert.throws(()=>validateRatingsSnapshot(unsafe));
});

test('atomic persistence and refresh lock protect the previous snapshot',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'retro-ratings-storage-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'data.json');await atomicJSON(file,{good:true});
  await assert.rejects(atomicJSON(file,{bad:BigInt(1)}));assert.deepEqual(JSON.parse(await readFile(file)),{good:true});
  await withRefreshLock(dir,async()=>{await assert.rejects(withRefreshLock(dir,async()=>{}),/already running/);});
  await assert.rejects(access(path.join(dir,'refresh.lock')));
});

test('CLI persists added products, remains offline in plan mode, and never exports tokens or raw reviews',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'retro-ratings-command-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'ranking'));await atomicJSON(path.join(root,'ranking/crosswalk.json'),map(vgcMap));
  const plan=await enrich({root,args:['--plan','--steam','900000001'],fetchImpl:async()=>{throw Error('must not fetch');}});assert.equal(plan.mappings,2);
  await assert.rejects(access(path.join(root,'.runtime')));
  let ticks=epoch;
  const invoke=args=>enrich({root,args,clock:()=>ticks++,sleep,credentials:{vgcKey:'fixture-secret'},fetchImpl:async url=>url.includes('appreviews')?json(fixtures.steam):json(fixtures.vgc)});
  await invoke(['--steam','900000001']);await invoke(['--steam','900000002']);
  const snapshot=await readFile(path.join(root,'library/data/ratings.json'),'utf8');
  assert.equal(JSON.parse(snapshot).rows.length,3);assert.doesNotMatch(snapshot,/fixture-secret|FICTIONAL_REVIEWER|private test marker/);
  assert.equal((await invoke([])).requests,0);
  assert.equal(JSON.parse(await readFile(path.join(root,'library/data/ratings.json'),'utf8')).snapshotId,JSON.parse(snapshot).snapshotId);
  assert.throws(()=>options(['--max-requests','100']));assert.throws(()=>options(['--provider','unknown']));
});

test('a refresh lock left by a process that is gone is taken over; a live one still blocks',async()=>{
  const {mkdtemp,mkdir,writeFile,utimes,access}=await import('node:fs/promises'),{tmpdir}=await import('node:os');
  const dir=await mkdtemp(path.join(tmpdir(),'lock-')),lock=path.join(dir,'refresh.lock');
  await mkdir(lock);await writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:999999}));
  assert.equal(await withRefreshLock(dir,async()=>'ran',{isAlive:()=>false}),'ran');
  await assert.rejects(access(lock));
  await mkdir(lock);await writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:4242}));
  await assert.rejects(withRefreshLock(dir,async()=>'ran',{isAlive:()=>true}),/already running \(process 4242\)/);
  await writeFile(path.join(lock,'owner.json'),'');
  // An old lock without an owner (from before owners were recorded) is left behind after 30 minutes.
  const old=new Date(Date.now()-60*60*1000);await utimes(lock,old,old);
  assert.equal(await withRefreshLock(dir,async()=>'ran'),'ran');
});

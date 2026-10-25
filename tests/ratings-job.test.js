import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { enrich } from '../scripts/enrich-ratings.mjs';
import { atomicJSON } from '../ranking/storage.mjs';
import { steamMapping } from '../ranking/crosswalk.mjs';
import { refreshRatings, emptyCache, cacheKey } from '../ranking/refresh.mjs';
const now=Date.parse('2026-09-25T12:00:00Z'),clock=()=>now,sleep=async()=>{};
const mapping=id=>steamMapping(String(id),new Date(now).toISOString());
const crosswalk=ids=>({schemaVersion:1,revision:1,mappings:ids.map(mapping)});
const response=(positive=90,negative=10)=>new Response(JSON.stringify({success:1,query_summary:{num_reviews:1,total_positive:positive,total_negative:negative,total_reviews:positive+negative},reviews:[{author:'DO NOT STORE',review:'PRIVATE REVIEW TEXT'}]}));
async function setup(t,ids){const root=await mkdtemp(path.join(tmpdir(),'retro-job-'));t.after(()=>rm(root,{recursive:true,force:true}));await atomicJSON(path.join(root,'ranking/crosswalk.json'),crosswalk(ids));return root;}

test('drain completes a finite cohort across batches and distinguishes no reviews and unavailable',async t=>{
  const root=await setup(t,[101,102,103,104,105]);let calls=0;const progress=[];
  const result=await enrich({root,args:['--provider','steam','--max-requests','2','--drain'],clock,sleep,onProgress:p=>progress.push(p),fetchImpl:async url=>{calls++;return url.includes('/102?')?response(0,0):url.includes('/103?')?new Response('',{status:404}):response();}});
  assert.equal(calls,5);assert.equal(result.requests,5);assert.equal(result.job.complete,true);
  assert.deepEqual(result.job.counts,{rated:3,'no-reviews':1,unavailable:1,'retry-pending':0,'not-processed':0});
  assert.equal(progress.length,3);
  const status=await enrich({root,args:['--status'],fetchImpl:()=>{throw Error('offline status must not fetch');}});assert.deepEqual(status,result.job);
  const saved=await readFile(path.join(root,'.runtime/ratings/job.json'),'utf8');assert.doesNotMatch(saved,/PRIVATE REVIEW|DO NOT STORE/);
});

test('bounded run resumes without refetching completed products or silently completing a remainder',async t=>{
  const root=await setup(t,[101,102,103]);const urls=[];
  const invoke=args=>enrich({root,args,clock,sleep,fetchImpl:async url=>{urls.push(url);return response();}});
  const first=await invoke(['--provider','steam','--max-requests','1']);assert.equal(first.job.complete,false);assert.equal(first.job.counts['not-processed'],2);
  const second=await invoke(['--provider','steam','--drain']);assert.equal(second.job.complete,true);assert.equal(new Set(urls).size,3);assert.equal(urls.length,3);
  assert.equal((await invoke(['--provider','steam','--drain'])).requests,0);
});

test('throttling stops drain, preserves retry time and never calls a retry-pending job complete',async t=>{
  const root=await setup(t,[101,102,103]);let calls=0;
  const result=await enrich({root,args:['--provider','steam','--drain'],clock,sleep,fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'300'}});}});
  assert.equal(calls,1);assert.equal(result.job.complete,false);assert.equal(result.job.counts['retry-pending'],3);
  assert.equal(result.job.nextAttemptAt,new Date(now+300000).toISOString());
  assert.equal((await enrich({root,args:['--provider','steam','--drain'],clock,sleep,fetchImpl:()=>{throw Error('must not fetch');}})).requests,0);
});

test('checkpoint failure stops immediately; accepted responses and quota survive restart',async()=>{
  let durable=emptyCache(),writes=0,calls=0;
  await assert.rejects(refreshRatings({crosswalk:crosswalk([101,102]),clock,sleep,fetchImpl:async()=>{calls++;return response();},onCheckpoint:async cache=>{if(++writes===3)throw Error('disk failed');durable=structuredClone(cache);}}),/checkpoint could not be saved/);
  assert.equal(calls,1);assert.ok(durable.entries[cacheKey(mapping(101))].source);
  const result=await refreshRatings({crosswalk:crosswalk([101,102]),cache:durable,clock,sleep,fetchImpl:async url=>{assert.match(url,/102\?/);return response();}});
  assert.equal(result.report.requests,1);
});

test('cold products precede stale covered products under a small request budget',async()=>{
  const first=await refreshRatings({crosswalk:crosswalk([101]),clock,sleep,fetchImpl:async()=>response()});
  const next=await refreshRatings({crosswalk:crosswalk([101,102]),cache:first.cache,clock:()=>now+2*86400000,sleep,maxRequests:1,fetchImpl:async url=>{assert.match(url,/102\?/);return response();}});
  assert.equal(next.snapshot.rows[0].status,'budget');assert.equal(next.snapshot.rows[0].observations.length,1);
});

test('three consecutive transport failures stop an outage from exhausting the whole selection',async()=>{
  let calls=0;
  const result=await refreshRatings({crosswalk:crosswalk([101,102,103,104,105]),clock,sleep,fetchImpl:async()=>{calls++;throw Error('network detail must not leak');}});
  assert.equal(calls,3);assert.equal(result.snapshot.rows[3].status,'backoff');
  assert.doesNotMatch(JSON.stringify(result),/network detail/);
});

test('outage protection spans drain batches with a one-request budget',async t=>{
  const root=await setup(t,[101,102,103,104,105]);let calls=0;
  const result=await enrich({root,args:['--drain','--max-requests','1'],clock,sleep,fetchImpl:async()=>{calls++;throw Error('offline');}});
  assert.equal(calls,3);assert.equal(result.job.complete,false);assert.equal(result.job.counts['retry-pending'],5);
});

test('a failed refresh retries after backoff even when the retained observation is still within TTL',async()=>{
  const first=await refreshRatings({crosswalk:crosswalk([101]),clock,sleep,fetchImpl:async()=>response()});
  const failed=await refreshRatings({crosswalk:crosswalk([101]),cache:first.cache,force:true,clock,sleep,fetchImpl:async()=>new Response('',{status:503})});
  assert.equal(failed.snapshot.rows[0].observations[0].original.value,90);
  const recovered=await refreshRatings({crosswalk:crosswalk([101]),cache:failed.cache,clock:()=>now+61000,sleep,fetchImpl:async()=>response(95,5)});
  assert.equal(recovered.report.requests,1);assert.equal(recovered.snapshot.rows[0].error,null);assert.equal(recovered.snapshot.rows[0].observations[0].original.value,95);
});

test('graceful cancellation saves partial work, releases the lock and resumes',async t=>{
  const root=await setup(t,[101,102,103]),controller=new AbortController();let calls=0;
  const first=await enrich({root,args:['--drain','--max-requests','1'],clock,sleep,signal:controller.signal,onProgress:()=>controller.abort(),fetchImpl:async()=>{calls++;return response();}});
  assert.equal(calls,1);assert.equal(first.job.complete,false);
  await assert.rejects(access(path.join(root,'.runtime/ratings/refresh.lock')));
  const next=await enrich({root,args:['--drain'],clock,sleep,fetchImpl:async()=>{calls++;return response();}});
  assert.equal(calls,3);assert.equal(next.job.complete,true);
});

test('forced bounded refresh resumes past completed products even with a one-request budget',async t=>{
  const root=await setup(t,[101,102,103]);
  const first=await enrich({root,args:[],clock,sleep,fetchImpl:async()=>response()});assert.equal(first.job.complete,true);
  const forced=await enrich({root,args:['--force','--max-requests','1'],clock:()=>now+1000,sleep,fetchImpl:async()=>response()});
  assert.equal(forced.job.counts.rated,1);assert.equal(forced.job.complete,false);
  const second=await enrich({root,args:['--force','--max-requests','1'],clock:()=>now+2000,sleep,fetchImpl:async url=>{assert.match(url,/102\?/);return response();}});
  assert.equal(second.job.counts.rated,2);assert.equal(second.job.complete,false);
  const done=await enrich({root,args:['--force','--max-requests','1'],clock:()=>now+3000,sleep,fetchImpl:async url=>{assert.match(url,/103\?/);return response();}});assert.equal(done.job.complete,true);
});

test('failed snapshot publication remains incomplete and recovers from cache without network',async t=>{
  const root=await setup(t,[101]),file=path.join(root,'library/data/ratings.json');
  await mkdir(file,{recursive:true});
  await assert.rejects(enrich({root,args:[],clock,sleep,fetchImpl:async()=>response()}));
  const status=await enrich({root,args:['--status']});
  assert.equal(status.complete,false);assert.equal(status.publicationPending,true);assert.equal(status.processed,1);
  await rm(file,{recursive:true});
  const done=await enrich({root,args:[],clock,sleep,fetchImpl:()=>{throw Error('should publish cached data');}});
  assert.equal(done.requests,0);assert.equal(done.job.complete,true);assert.equal(done.job.publicationPending,false);
  assert.equal(JSON.parse(await readFile(file,'utf8')).rows[0].observations[0].original.value,90);
});

test('explicit product selection survives cancellation before its first request',async t=>{
  const root=await setup(t,[101]),controller=new AbortController();controller.abort();
  const first=await enrich({root,args:['--steam','102'],clock,sleep,signal:controller.signal,fetchImpl:()=>{throw Error('cancelled');}});
  assert.equal(first.job.total,2);assert.equal(first.job.complete,false);assert.equal(first.requests,0);
  const second=await enrich({root,args:['--drain'],clock,sleep,fetchImpl:async()=>response()});
  assert.equal(second.job.total,2);assert.equal(second.job.complete,true);assert.equal(second.requests,2);
});

test('expired unavailable results cannot make a budget-limited recheck appear complete',async t=>{
  const root=await setup(t,[101,102]);
  const missing=await enrich({root,args:[],clock,sleep,fetchImpl:async()=>new Response('',{status:404})});
  assert.equal(missing.job.complete,true);assert.equal(missing.job.counts.unavailable,2);
  const next=await enrich({root,args:['--max-requests','1'],clock:()=>now+86401000,sleep,fetchImpl:async()=>response()});
  assert.equal(next.job.complete,false);assert.equal(next.job.counts.rated,1);assert.equal(next.job.counts['not-processed'],1);
});

// Steam's store endpoint: one request answers up to 100 apps (review summary and release date).
const storeItems=items=>new Response(JSON.stringify({response:{store_items:items.map(([appid,count,percent,released])=>({appid,reviews:count?{summary_filtered:{review_count:count,percent_positive:percent}}:undefined,release:{steam_release_date:released}}))}}));
const daysAgo=days=>Math.floor((now-days*86400000)/1000);

test('batched Steam refresh asks once for many games, then waits weekly or monthly by release date', async t => {
  const root=await setup(t,[101,102,103,104]);const urls=[];
  // A game missing from the store's answer is asked on its own; here it's gone (404).
  const invoke=(fetchImpl,clockAt=clock)=>enrich({root,args:['--provider','steam','--batch'],clock:clockAt,sleep,fetchImpl:async url=>{urls.push(url);return url.includes('/appreviews/')?new Response('{}',{status:404}):fetchImpl(url);}});
  // 101 is old and rated, 102 came out last month, 103 has no reviews yet, 104 isn't in the store.
  const first=await invoke(()=>storeItems([[101,48000,92,daysAgo(4000)],[102,300,88,daysAgo(30)],[103,0,0,daysAgo(10)]]));
  assert.equal(urls.length,2);assert.match(urls[0],/IStoreBrowseService\/GetItems/);assert.match(urls[1],/appreviews\/104\?/);
  assert.deepEqual(first.plan,{new:4,due:0,fresh:0});
  assert.deepEqual(first.job.counts,{rated:2,'no-reviews':1,unavailable:1,'retry-pending':0,'not-processed':0});
  const ratings=JSON.parse(await readFile(path.join(root,'library/data/ratings.json'),'utf8'));
  const signal=ratings.rows.find(row=>row.providerId==='101').observations[0];
  assert.equal(signal.original.value,92);assert.equal(signal.original.count,48000);
  // Eight days later the recent releases are due again (102, 103) and the missing app is
  // retried (104); the old game stays fresh for a month.
  urls.length=0;
  const later=await invoke(()=>storeItems([[102,320,87,daysAgo(30)],[103,5,80,daysAgo(10)]]),()=>now+8*86400000);
  assert.equal(urls.length,2);
  const asked=[...decodeURIComponent(urls[0]).matchAll(/"appid":(\d+)/g)].map(match=>match[1]).sort();
  assert.deepEqual(asked,['102','103','104']);
  assert.deepEqual(later.plan,{new:1,due:2,fresh:1});
});

test('only the latest few evidence snapshots are kept', async t => {
  const root=await setup(t,[101]);const folder=path.join(root,'.runtime/ratings/snapshots');await mkdir(folder,{recursive:true});
  for(let index=0;index<8;index++)await atomicJSON(path.join(folder,`old-${index}.json`),{index});
  await enrich({root,args:['--provider','steam','--batch'],clock,sleep,fetchImpl:async()=>storeItems([[101,100,90,daysAgo(400)]])});
  const { readdir } = await import('node:fs/promises');
  assert.equal((await readdir(folder)).length,5);
});

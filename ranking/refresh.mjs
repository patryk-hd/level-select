import { vgc } from './providers/vgc.mjs';
import { steam } from './providers/steam.mjs';
import { igdb } from './providers/igdb.mjs';
import { digest, validateCrosswalk, verifyMapping } from './crosswalk.mjs';
import { object, required } from './providers/common.mjs';
import { validateEvidence } from './evidence.js';

export const PROVIDERS=Object.freeze({vgc,steam,igdb});
export const emptyCache=()=>({schemaVersion:1,entries:{},providers:{}});
const iso=value=>new Date(value).toISOString();
const time=value=>value?Date.parse(value):0;
export const cacheKey=mapping=>digest({provider:mapping.provider,id:mapping.providerId,expected:mapping.expected,version:PROVIDERS[mapping.provider].version});

export function validateCache(cache) {
  required(cache?.schemaVersion===1 && object(cache.entries) && object(cache.providers),'Invalid ratings cache; preserve it for recovery');
  for (const [key,entry] of Object.entries(cache.entries)) {
    required(/^[a-f0-9]{64}$/.test(key) && object(entry),'Invalid cache entry');
    for (const date of ['checkedAt','observedAt','nextAttemptAt']) required(entry[date]==null || Number.isFinite(Date.parse(entry[date])),'Invalid cache date');
    if (entry.source) required(object(entry.source) && Array.isArray(entry.source.signals) && typeof entry.checksum==='string','Invalid cached source');
  }
  return cache;
}

async function limitedJSON(response) {
  const limit=2*1024*1024;
  if (Number(response.headers.get('content-length'))>limit) throw Error('invalid-response');
  const reader=response.body?.getReader();if(!reader)throw Error('invalid-response');
  const chunks=[];let length=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw Error('invalid-response');chunks.push(value);} }
  catch(error){await reader.cancel();throw error;}
  const body=Buffer.concat(chunks).toString('utf8');
  return {body:JSON.parse(body),checksum:digest(body)};
}

function retryAt(response,now,fallback) {
  const value=response?.headers.get('retry-after');
  const bounded=delay=>iso(now+Math.min(7*24*3600000,Math.max(1000,delay)));
  if (value && /^\d+(?:\.\d+)?$/.test(value)) return bounded(Number(value)*1000);
  if (value && Number.isFinite(Date.parse(value))) return bounded(Date.parse(value)-now);
  return iso(now+fallback);
}

function observations(mapping,entry) {
  const source=entry.source;
  return source.signals.map(signal=>validateEvidence({schemaVersion:1,
    id:`${source.provider}:${source.id}:${signal.key}:${entry.checksum.slice(0,16)}:${digest(mapping).slice(0,12)}`,
    source:{provider:source.provider,family:source.provider==='steam'?'steam-reviewers':source.provider==='vgc'?'vgc-overlapping-composite':'igdb-aggregate',upstreamId:source.id,url:source.url,label:signal.label,lineage:source.provider==='vgc'?['vgc-components-share-underlying-evidence']:[]},
    type:signal.type,lane:signal.key,
    scope:{ref:{...mapping.target},work:null,edition:null,platforms:source.platforms,region:null,build:null,mapping:'reviewed-provider-reference',scoreScope:source.scope},
    original:{value:signal.value,raw:signal.value,scale:{min:0,max:100},positive:signal.positive??null,negative:signal.negative??null,count:signal.count??null,countMeaning:signal.type==='binary-approval'?'Reviews matching the recorded Steam query':'Provider aggregate count'},
    dates:{publishedAt:null,observedAt:entry.observedAt,sourceUpdatedAt:source.sourceUpdatedAt,windowFrom:null,windowTo:null},
    provenance:{adapterVersion:PROVIDERS[source.provider].version,checksum:entry.responseChecksum,fixture:null,extraction:signal.key,attribution:source.attribution,access:'provider-api',reviewStatus:'verified-identity-scope-limited',supersedes:null},
  }));
}

/** All IO is injected except bounded timers. Failures preserve prior observations.
 * A changed mapping changes its cache key, so a reassigned provider cannot reuse
 * another target's accepted rating. No provider response/error text is logged.
 */
// How long a provider's answer counts as current: the provider's own TTL unless the caller
// knows better (scripts/enrich-ratings.mjs ages Steam reviews by release date and wishlist).
const defaultTtl=mapping=>PROVIDERS[mapping.provider].ttlMs;
const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,index)=>items.slice(index*size,index*size+size));

/* batch: providers that can answer many ids in one request (Steam's store endpoint) are
 * fetched that way first; each batch counts as one request against the budget. */
export async function refreshRatings({crosswalk,cache=emptyCache(),fetchImpl=fetch,credentials={},clock=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),force=false,maxRequests=20,timeoutMs=15000,onlyProviders=null,onCheckpoint,skipKeys=new Set(),failuresByProvider=new Map(),signal,batch=false,ttlFor=defaultTtl}) {
  validateCrosswalk(crosswalk);validateCache(cache);
  required(Number.isInteger(maxRequests)&&maxRequests>=1&&maxRequests<=50,'Request budget must be 1–50');
  const next=structuredClone(cache),processed=new Map(),outcomes=new Map(),attemptedKeys=[];let requests=0;
  const checkpoint=async()=>{try{await onCheckpoint?.(next);}catch(cause){const error=Error('Ratings checkpoint could not be saved; refresh stopped.');error.checkpointFailure=true;error.cause=cause;throw error;}};
  // Populate missing evidence before repeatedly refreshing already-covered games.
  const ordered=[...crosswalk.mappings].sort((a,b)=>Number(Boolean(cache.entries[cacheKey(a)]?.source))-Number(Boolean(cache.entries[cacheKey(b)]?.source)));
  const fresh=(mapping,entry,now)=>!force && entry.source && !entry.error && now-time(entry.checkedAt)<ttlFor(mapping,entry);
  const failureCode=error=>{
    const allowed=['credentials-missing','quota','throttled','not-found','unauthorized','http-error','provider-not-found'];
    return allowed.includes(error.message)?error.message:error.name==='TimeoutError'||error.name==='AbortError'?'timeout':'invalid-or-unavailable';
  };
  // Games a batch didn't answer (delisted from the store) get the provider's single request.
  const singles=new Set();
  for(const provider of Object.values(PROVIDERS)){
    if(!batch || !provider.batchRequest || onlyProviders && !onlyProviders.includes(provider.id))continue;
    const due=new Map(),start=clock();
    for(const mapping of ordered){
      const key=cacheKey(mapping),old=next.entries[key]??{};
      if(mapping.provider!==provider.id || due.has(key) || skipKeys.has(key) || time(old.nextAttemptAt)>start || fresh(mapping,old,start))continue;
      due.set(key,mapping);
    }
    for(const group of chunks([...due.entries()],provider.batchSize)){
      const now=clock(),quota=next.providers[provider.id]??{};
      if(signal?.aborted || requests>=maxRequests || time(quota.nextAttemptAt)>now)break;
      let response;
      try {
        const request=provider.batchRequest(group.map(([,mapping])=>mapping.providerId));
        attemptedKeys.push(...group.map(([key])=>key));
        await sleep(provider.intervalMs);
        requests++;
        const recentWindow=now-time(quota.windowStart)<3600000;
        next.providers[provider.id]={...quota,windowStart:recentWindow?quota.windowStart:iso(now),used:(recentWindow?quota.used??0:0)+1,nextAttemptAt:null};
        await checkpoint();
        response=await fetchImpl(request.url,{...request.init,headers:{Accept:'application/json'},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});
        if(!response.ok)throw Error(response.status===429?'throttled':response.status===401||response.status===403?'unauthorized':'http-error');
        const payload=await limitedJSON(response),found=provider.normalizeBatch(payload.body,group.map(([,mapping])=>mapping.providerId));
        for(const [key,mapping] of group){
          const old=next.entries[key]??{},source=found.get(mapping.providerId);
          // Not in the store's answer (delisted, or not out): asked on its own below.
          if(!source){singles.add(key);continue;}
          verifyMapping(mapping,source);
          const checksum=digest(source);
          const result={source,checksum,responseChecksum:payload.checksum,etag:null,checkedAt:iso(now),observedAt:checksum===old.checksum?old.observedAt:iso(now),nextAttemptAt:null,failures:0,error:null};
          observations(mapping,result);
          next.entries[key]=result;processed.set(key,result);outcomes.set(key,'updated');
        }
        failuresByProvider.set(provider.id,0);
      }catch(error){
        if(error.checkpointFailure)throw error;
        if(signal?.aborted)break;
        const code=failureCode(error),streak=(failuresByProvider.get(provider.id)??0)+1;failuresByProvider.set(provider.id,streak);
        for(const [key] of group){
          const old=next.entries[key]??{},failures=(old.failures??0)+1;
          const result={...old,failures,error:code,nextAttemptAt:retryAt(response,now,Math.min(3600000,60000*2**Math.min(failures-1,6)))};
          next.entries[key]=result;processed.set(key,result);outcomes.set(key,code);
        }
        // A whole batch failing is a provider problem: back off after one throttle, or three errors.
        if(code==='throttled'||code==='unauthorized'||streak>=3)next.providers[provider.id]={...(next.providers[provider.id]??quota),nextAttemptAt:retryAt(response,now,3600000),reason:code};
      }
      await checkpoint();
    }
  }
  for(const mapping of ordered){
    const provider=PROVIDERS[mapping.provider],key=cacheKey(mapping);
    if(processed.has(key))continue;
    const now=clock(),old=next.entries[key]??{},quota=next.providers[provider.id]??{};
    let result=old,status='cached';
    const credentialsFixed=provider.id==='igdb' && credentials.igdbClientId && credentials.igdbAccessToken;
    if(onlyProviders && !onlyProviders.includes(provider.id)){status='not-selected';}
    else if(signal?.aborted){status='interrupted';}
    else if(skipKeys.has(key)){status=old.error??'cached';}
    else if((time(old.nextAttemptAt)>now && !(old.error==='credentials-missing' && credentialsFixed)) || (time(quota.nextAttemptAt)>now && !(quota.reason==='credentials-missing' && credentialsFixed))){status='backoff';}
    else if(fresh(mapping,old,now)){status='cached';}
    // Batched providers left over (budget spent or backing off) wait for the next run.
    else if(requests>=maxRequests || batch && provider.batchRequest && !singles.has(key)){status='budget';}
    else {
      let response;
      try {
        attemptedKeys.push(key);
        const request=provider.request(mapping.providerId,credentials);
        // Anonymous VGC requests have a persistent hourly cap even across runs.
        const recentWindow=now-time(quota.windowStart)<3600000;
        if(provider.id==='vgc' && recentWindow && quota.used>=50)throw Error('quota');
        await sleep(provider.intervalMs);
        const headers={Accept:'application/json',...(request.init.headers??{})};
        if(old.source && old.etag)headers['If-None-Match']=old.etag;
        requests++;
        next.providers[provider.id]={...quota,windowStart:recentWindow?quota.windowStart:iso(now),used:(recentWindow?quota.used??0:0)+1,nextAttemptAt:null};
        await checkpoint();
        response=await fetchImpl(request.url,{...request.init,headers,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});
        if(provider.id==='vgc' && response.headers.has('x-ratelimit-remaining') && Number(response.headers.get('x-ratelimit-remaining'))<=2)next.providers[provider.id].nextAttemptAt=iso(now+3600000);
        if(response.status===304){
          if(!old.source)throw Error('invalid-response');
          verifyMapping(mapping,old.source);
          result={...old,checkedAt:iso(now),nextAttemptAt:null,failures:0,error:null};status='not-modified';
        }else {
          if(!response.ok)throw Error(response.status===429?'throttled':response.status===404?'not-found':response.status===401||response.status===403?'unauthorized':'http-error');
          const payload=await limitedJSON(response),source=provider.normalize(payload.body,mapping.providerId);
          verifyMapping(mapping,source);
          const checksum=digest(source);
          result={source,checksum,responseChecksum:payload.checksum,etag:response.headers.get('etag'),checkedAt:iso(now),observedAt:checksum===old.checksum?old.observedAt:iso(now),nextAttemptAt:null,failures:0,error:null};
          // Validate normalized evidence before replacing a prior good cache entry.
          observations(mapping,result);status='updated';
        }
        failuresByProvider.set(provider.id,0);
      }catch(error){
        if(error.checkpointFailure)throw error;
        if(signal?.aborted){result=old;status='interrupted';}
        else {
          const allowed=['credentials-missing','quota','throttled','not-found','unauthorized','http-error','provider-not-found'];
          const code=allowed.includes(error.message)?error.message:error.name==='TimeoutError'||error.name==='AbortError'?'timeout':'invalid-or-unavailable';
          const failures=(old.failures??0)+1;
          const delay=code==='not-found'||code==='provider-not-found'?24*3600000:code==='quota'||code==='unauthorized'||code==='credentials-missing'?3600000:Math.min(3600000,60000*2**Math.min(failures-1,6));
          result={...old,failures,error:code,nextAttemptAt:retryAt(response,now,code==='throttled'&&provider.id==='vgc'?3600000:delay)};
          if(['throttled','quota','unauthorized','credentials-missing'].includes(code))next.providers[provider.id]={...(next.providers[provider.id]??quota),nextAttemptAt:result.nextAttemptAt,reason:code};
          if(['timeout','http-error','invalid-or-unavailable'].includes(code)){
            const streak=(failuresByProvider.get(provider.id)??0)+1;failuresByProvider.set(provider.id,streak);
            if(streak>=3)next.providers[provider.id]={...(next.providers[provider.id]??quota),nextAttemptAt:result.nextAttemptAt,reason:code};
          }
          status=code;
        }
      }
      next.entries[key]=result;
      await checkpoint();
    }
    processed.set(key,result);outcomes.set(key,status);
  }
  const now=clock(),rows=crosswalk.mappings.map(mapping=>{
    const key=cacheKey(mapping),entry=processed.get(key)??{},provider=PROVIDERS[mapping.provider];
    if(entry.source)verifyMapping(mapping,entry.source);
    return {mappingId:mapping.id,mappingRevision:crosswalk.revision,mappingFingerprint:digest(mapping),target:{...mapping.target},provider:mapping.provider,providerId:mapping.providerId,
      scope:mapping.scope,status:outcomes.get(key),error:entry.error??null,checkedAt:entry.checkedAt??null,observedAt:entry.observedAt??null,
      freshUntil:entry.checkedAt?iso(time(entry.checkedAt)+ttlFor(mapping,entry)):null,nextAttemptAt:entry.nextAttemptAt??next.providers[mapping.provider]?.nextAttemptAt??null,
      observations:entry.source?observations(mapping,entry):[],
      source:entry.source?{title:entry.source.title,url:entry.source.url,attribution:entry.source.attribution,details:entry.source.details}:null};
  });
  // Refresh metadata changes on 304, but the evidence snapshot identity does not.
  const snapshotId=digest(rows.map(row=>({mapping:row.mappingFingerprint,observations:row.observations.map(observation=>({...observation,provenance:{...observation.provenance,checksum:null}}))})));
  return {cache:next,snapshot:{schemaVersion:1,workspace:'personal',snapshotId,crosswalkRevision:crosswalk.revision,generatedAt:iso(now),rows},report:{requests,attemptedKeys,rows:rows.length,outcomes:rows.map(row=>({mappingId:row.mappingId,status:row.status,retained:row.observations.length>0,error:row.error}))}};
}

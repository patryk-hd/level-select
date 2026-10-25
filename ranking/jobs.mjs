import { cacheKey, PROVIDERS } from './refresh.mjs';
import { digest } from './crosswalk.mjs';

// One result for every requested provider product, including missing evidence.
// The private job holds IDs only, never library titles, notes or credentials.
export function refreshJob(crosswalk, cache, { providers=null, now=Date.now(), previous=null, force=false, ttlFor=mapping=>PROVIDERS[mapping.provider].ttlMs }={}) {
  const selected=[...new Map(crosswalk.mappings.filter(m=>!providers||providers.includes(m.provider)).map(m=>[cacheKey(m),m])).entries()];
  const selectionHash=digest({keys:selected.map(([key])=>key).sort(),force});
  const startedAt=previous?.selectionHash===selectionHash?previous.startedAt:new Date(now).toISOString();
  const counts={'rated':0,'no-reviews':0,'unavailable':0,'retry-pending':0,'not-processed':0};
  const rows=selected.map(([key,mapping])=>{
    const entry=cache.entries[key]??{},quota=cache.providers[mapping.provider]??{};
    const checkedAt=Date.parse(entry.checkedAt);
    const fresh=entry.source&&Number.isFinite(checkedAt)&&now-checkedAt<ttlFor(mapping,entry);
    const checkedForJob=!force||checkedAt>=Date.parse(startedAt);
    const unavailable=['not-found','provider-not-found'].includes(entry.error);
    let outcome;
    if(unavailable&&Date.parse(entry.nextAttemptAt)>now)outcome='unavailable';
    else if(unavailable)outcome='not-processed';
    else if(entry.error)outcome='retry-pending';
    else if(fresh&&checkedForJob)outcome=entry.source.signals.some(s=>s.value!==null)?'rated':'no-reviews';
    else if(Date.parse(quota.nextAttemptAt)>now)outcome='retry-pending';
    else outcome='not-processed';
    counts[outcome]++;
    return {key,provider:mapping.provider,providerId:mapping.providerId,outcome,
      retained:Boolean(entry.source),checkedAt:entry.checkedAt??null,error:entry.error??null,
      nextAttemptAt:[entry.nextAttemptAt,quota.nextAttemptAt].filter(Boolean).sort().at(-1)??null};
  });
  const complete=counts['retry-pending']===0&&counts['not-processed']===0;
  return {schemaVersion:1,selectionHash,startedAt,updatedAt:new Date(now).toISOString(),complete,total:rows.length,
    processed:counts.rated+counts['no-reviews']+counts.unavailable,counts,rows};
}

export function jobSummary(job) {
  if(!job)return {job:'not-started'};
  return {complete:job.complete&&!job.publicationPending,publicationPending:Boolean(job.publicationPending),total:job.total,processed:job.processed,counts:job.counts,
    updatedAt:job.updatedAt,nextAttemptAt:job.rows.filter(row=>row.outcome==='retry-pending').map(row=>row.nextAttemptAt).filter(Boolean).sort()[0]??null};
}

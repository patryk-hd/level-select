import { validateEvidence } from './evidence.js';
const hosts={vgc:'videogamescritic.com',steam:'store.steampowered.com',igdb:'www.igdb.com'};
export const emptyRatings=workspace=>({schemaVersion:1,workspace,snapshotId:null,generatedAt:null,crosswalkRevision:1,rows:[]});
export function validateRatingsSnapshot(snapshot) {
  const fail=()=>{throw Error('Invalid provider ratings snapshot');};
  if(snapshot?.schemaVersion!==1 || !['sample','personal'].includes(snapshot.workspace) || !Array.isArray(snapshot.rows) || snapshot.rows.length>10000)fail();
  if(snapshot.snapshotId!==null && (typeof snapshot.snapshotId!=='string' || !/^[a-f0-9]{64}$/.test(snapshot.snapshotId)))fail();
  if(!Number.isSafeInteger(snapshot.crosswalkRevision) || snapshot.crosswalkRevision<1 || (snapshot.generatedAt!==null && !Number.isFinite(Date.parse(snapshot.generatedAt))))fail();
  const ids=new Set();
  for(const row of snapshot.rows){
    if(!Object.hasOwn(hosts,row.provider) || typeof row.mappingId!=='string' || ids.has(row.mappingId) || !Array.isArray(row.observations))fail();ids.add(row.mappingId);
    if(!row.target || !['catalog','playnite','steam'].includes(row.target.provider) || typeof row.target.id!=='string')fail();
    if(typeof row.providerId!=='string' || !/^[1-9]\d{0,14}$/.test(row.providerId))fail();
    if(row.scope!==(row.provider==='steam'?'steam-product':'work-context'))fail();
    if(row.provider==='steam' && (row.target.provider!=='steam' || row.target.id!==row.providerId))fail();
    for(const field of ['checkedAt','observedAt','freshUntil','nextAttemptAt'])if(row[field]!==null && !Number.isFinite(Date.parse(row[field])))fail();
    if(row.source){
      const url=new URL(row.source.url);
      if(url.protocol!=='https:' || url.hostname!==hosts[row.provider] || url.username || url.password || url.port || typeof row.source.title!=='string' || typeof row.source.attribution!=='string')fail();
      if(!row.source.details || typeof row.source.details!=='object' || Array.isArray(row.source.details))fail();
    }else if(row.observations.length)fail();
    for(const observation of row.observations){
      validateEvidence(observation);
      if(observation.source.provider!==row.provider || observation.source.url!==row.source.url || observation.scope.ref.provider!==row.target.provider || observation.scope.ref.id!==row.target.id || observation.scope.scoreScope!==row.scope)fail();
    }
  }
  return snapshot;
}
export function providerRows(snapshot,ref) {
  return snapshot.rows.filter(row=>row.target.provider===ref.provider && row.target.id===ref.id);
}
export function cacheFreshness(row,now=Date.now()) {
  if(!row.observations.length)return 'unavailable';
  if(row.error)return 'refresh-failed';
  if(!row.freshUntil || Date.parse(row.freshUntil)<=now)return 'stale';
  return 'current';
}

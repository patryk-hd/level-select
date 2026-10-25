import { productMatch } from '../tracking/products.js';
import { compareNullableDescending, steamApproval, wilsonLowerBound, matchingCopies } from './evidence.js';
import { cacheFreshness } from './snapshot.js';

export const SOURCE_MODES = Object.freeze({
  steam: { label: 'Steam reviews', provider: 'steam', lane: 'steam-approval', method: 'steam-wilson-counts-v1', scope: 'steam-product' },
  'steam-raw': { label: 'Steam % positive', provider: 'steam', lane: 'steam-approval', method: 'steam-approval-counts-v1', scope: 'steam-product' },
  'steam-volume': { label: 'Steam review count', provider: 'steam', lane: 'steam-approval', method: 'steam-review-volume-v1', scope: 'steam-product' },
  vgc: { label: 'VGC Score', provider: 'vgc', lane: 'vgc', method: 'vgc-score-unchanged-v1', scope: 'work-context' },
  'igdb-community': { label: 'IGDB community', provider: 'igdb', lane: 'igdb-community', method: 'igdb-community-unchanged-v1', scope: 'work-context' },
  'igdb-critics': { label: 'IGDB critics', provider: 'igdb', lane: 'igdb-critics', method: 'igdb-critics-unchanged-v1', scope: 'work-context' },
});
export const CONTEXT_MODES = ['vgc', 'igdb-community', 'igdb-critics'];
export const refKey = ref => `${ref.provider}:${encodeURIComponent(ref.id)}`;
const textOrder = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export function compareResults(a,b) {
  return compareNullableDescending(a.value,b.value) || textOrder(a.title.toLowerCase(),b.title.toLowerCase()) || textOrder(a.targetId,b.targetId);
}
export function sourceIndex(snapshot) {
  return { snapshot, rows:new Map(snapshot.rows.map(row=>[`${refKey(row.target)}|${row.provider}`,row])) };
}
export function sourceRating(index,ref,mode,{now=Date.now(),comingSoon=false,systemRank=false}={}) {
  const definition=SOURCE_MODES[mode];
  if(!definition)throw Error('Unknown source rating mode');
  const row=index.rows.get(`${refKey(ref)}|${definition.provider}`);
  const evidence=row?.observations.find(item=>item.lane===definition.lane)??null;
  let value=evidence?.original.value??null,reason=value===null?'No verified rating for this source':'';
  if(evidence && definition.provider==='steam'){
    const {positive,negative,count}=evidence.original;
    const exact=positive!==null && negative!==null && count!==null && positive+negative===count;
    value=!exact?null:mode==='steam-volume'?count:!count?null:mode==='steam-raw'?100*positive/count:100*wilsonLowerBound(100*positive/count,count);
    if(value===null)reason='No usable exact review counts';
  }
  if(row && row.scope!==definition.scope){value=null;reason='Incompatible score scope';}
  if(systemRank && definition.scope==='work-context'){value=null;reason='Work context cannot establish a system rank';}
  if(comingSoon && mode!=='steam-volume'){value=null;reason='Unreleased; excluded from reception ranking';}
  return {targetId:refKey(ref),ref:{...ref},mode,label:definition.label,value,reason,scope:definition.scope,methodVersion:definition.method,
    snapshotId:index.snapshot.snapshotId,evidenceIds:evidence?[evidence.id]:[],evidence,row,
    freshness:row?cacheFreshness(row,now):'unavailable',workspace:index.snapshot.workspace,rank:null};
}
export function importedWishlistRating(game,{comingSoon=game.comingSoon,mode='imported'}={}) {
  const data=steamApproval(game),excluded=comingSoon&&mode!=='imported-volume';
  const value=excluded?null:mode==='imported-volume'?data.total:mode==='imported-raw'?data.pct:data.lowerBound===null?null:data.lowerBound*100;
  return {targetId:refKey({provider:'steam',id:String(game.appid)}),ref:{provider:'steam',id:String(game.appid)},mode,label:mode==='imported-volume'?'Imported Steam review volume':mode==='imported-raw'?'Imported Steam approval percentage':'Imported Steam conservative approval',
    value,reason:excluded?'Unreleased; excluded from reception ranking':value===null?data.reason||'No usable imported approval':'',scope:'imported-steam-product',
    methodVersion:mode==='imported'?data.method:`${mode}-v1`,snapshotId:null,evidenceIds:[],evidence:null,row:null,freshness:'imported',rank:null,approval:data};
}
export function ownedSourceRating(index,game,mode,filters={},productReviews={}) {
  const copies=matchingCopies(game,filters).filter(copy=>!filters.copyId||copy.id===filters.copyId);
  if(copies.length!==1)return {value:null,reason:copies.length?'Choose a copy':'No matching copy',mode,label:SOURCE_MODES[mode].label,rank:null};
  if (SOURCE_MODES[mode].provider === 'steam') {
    const match=productMatch(game,copies[0],productReviews);
    const result=sourceRating(index,match.ref??{provider:'playnite',id:copies[0].id},mode);
    return {...result,targetId:refKey({provider:'playnite',id:copies[0].id}),
      ...(!match.ref?{value:null,reason:match.status==='changed'?'Steam identity changed — review again':match.status==='not-applicable'?'Not a Steam PC copy':'Steam product match needs review'}:{})};
  }
  return sourceRating(index,{provider:'playnite',id:copies[0].id},mode);
}
// Stable, non-cryptographic cohort fingerprint. It identifies content, not trust.
function fingerprint(value) {
  let hash=14695981039346656037n;
  for(const byte of new TextEncoder().encode(JSON.stringify(value)))hash=BigInt.asUintN(64,(hash^BigInt(byte))*1099511628211n);
  return hash.toString(16).padStart(16,'0');
}
export function rankCandidates(candidates,{cohort,mode}={}) {
  const ids=candidates.map(item=>item.targetId);
  if(new Set(ids).size!==ids.length)throw Error('Duplicate ranking target');
  const candidateSetId=`cohort-v1:${fingerprint({cohort,ids:[...ids].sort()})}`;
  const sorted=[...candidates].sort(compareResults),records=new Map();let rank=0,last=null;
  for(let position=0;position<sorted.length;position++){
    const item=sorted[position];
    if(item.value!==null && (last===null || item.value!==last))rank=position+1;
    const record={...item,mode:mode??item.mode,cohort,candidateSetId,rank:item.value===null?null:rank};
    records.set(item.targetId,record);last=item.value;
  }
  return {records,candidateSetId,cohort,total:sorted.length,rated:sorted.filter(item=>item.value!==null).length};
}
export function ratingText(result) {
  if(result.value===null)return result.reason||'Unrated';
  const value=Number(result.value.toFixed(2));
  return `${result.label} ${value}${result.mode.endsWith('-volume')?' reviews':result.mode==='steam'||result.mode==='steam-raw'||result.mode.startsWith('imported')?'%':'/100'}`;
}

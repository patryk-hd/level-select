import { escapeHtml as esc } from '../lib.js';
import { validateRatingsSnapshot, providerRows, cacheFreshness } from './snapshot.js';
const requests=new Map(),mounted=new WeakMap();
const labels={vgc:'VideoGamesCritic',steam:'Steam',igdb:'IGDB'};
const date=value=>value?new Date(value).toLocaleString():'Unknown';

export async function loadRatings(workspace) {
  if(!requests.has(workspace))requests.set(workspace,(async()=>{
    const url=new URL('../library/data/ratings.json',import.meta.url);url.searchParams.set('workspace',workspace);
    const response=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Unavailable');
    const snapshot=validateRatingsSnapshot(await response.json());
    if(snapshot.workspace!==workspace)throw Error('Workspace mismatch');
    return snapshot;
  })());
  return requests.get(workspace);
}

export function providerPanelHtml(snapshot,ref,now=Date.now(),steamRef=null) {
  const rows=[...providerRows(snapshot,ref),...(steamRef?providerRows(snapshot,steamRef).filter(row=>row.provider==='steam'):[])];
  const empty='<p>No verified provider snapshot for this record yet. Your imported ratings and tracking remain available.</p>';
  return `<section class="provider-ratings"><h4>Provider ratings</h4>${snapshot.workspace==='sample'?'<p class="provider-notice">Illustrative ratings — fictional examples, not live provider data.</p>':''}${rows.length?rows.map(row=>{
    const freshness=cacheFreshness(row,now);
    const state=freshness==='current'?'Cache current':freshness==='stale'?'Saved ratings — refresh due':freshness==='refresh-failed'?'Refresh failed — showing last saved ratings':'No rating snapshot yet';
    const attribution=snapshot.workspace==='sample'?`Example ${labels[row.provider]} data`:row.source?.attribution??labels[row.provider];
    const link=row.source && snapshot.workspace!=='sample'?`<a href="${esc(row.source.url)}" target="_blank" rel="noopener noreferrer">${esc(attribution)} ↗</a>`:esc(attribution);
    return `<article class="provider-rating"><h5>${esc(labels[row.provider])}</h5><p class="provider-cache-status">${state}</p>
      <p>${row.scope==='steam-product'?'This Steam product; review totals use the query settings below.':'Work-level context. Platform-specific score scope is unverified; excluded from system rankings.'}</p>
      <dl>${row.observations.map(observation=>`<dt>${esc(observation.source.label)}</dt><dd>${observation.original.value===null?'Unrated':`${Number(observation.original.value.toFixed(2))}${observation.type==='binary-approval'?'% positive':'/100'}`}${observation.original.count!==null?` · ${observation.original.count.toLocaleString()} ${observation.type==='binary-approval'?'reviews':'in provider count'}`:''}</dd>`).join('')}</dl>
      <p class="provider-attribution">${link}</p>
      <dl><dt>Observed</dt><dd>${esc(date(row.observedAt))}</dd><dt>Last checked</dt><dd>${esc(date(row.checkedAt))}</dd><dt>Source updated</dt><dd>${esc(date(row.observations[0]?.dates.sourceUpdatedAt))}</dd></dl>
      ${row.provider==='steam' && row.source?'<p>All languages · all purchase types · all-time query totals · Steam off-topic filtering enabled. Returned page size is not the review population.</p>':''}
      ${row.provider==='vgc' && row.source?`<p>Provider confidence: ${esc(row.source.details.confidence??'unknown')} · trend: ${esc(row.source.details.trend??'unknown')}. VGC figures are displayed unchanged and kept separate from other sources.</p>`:''}
      ${row.error==='credentials-missing'?'<p>IGDB needs local API credentials before its first refresh.</p>':''}
      ${row.nextAttemptAt?`<p>Next permitted retry: ${esc(date(row.nextAttemptAt))}</p>`:''}
    </article>`;
  }).join(''):empty}<p class="provider-help">Refresh saved provider data with <code>npm run ratings:refresh</code>, then reload. Pages read local snapshots and do not contact rating providers.</p></section>`;
}

export async function mountProviderRatings(container,{ref,workspace,steamRef=null}) {
  const token={};mounted.set(container,token);container.textContent='Loading saved provider ratings…';
  try{
    const snapshot=await loadRatings(workspace);
    if(container.isConnected && mounted.get(container)===token)container.innerHTML=providerPanelHtml(snapshot,ref,Date.now(),steamRef);
  }catch{
    if(container.isConnected && mounted.get(container)===token)container.innerHTML='<section class="provider-ratings"><h4>Provider ratings</h4><p>Saved provider ratings are unavailable. Your imported data and play history are still available.</p></section>';
  }
}

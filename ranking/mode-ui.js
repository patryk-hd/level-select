import { escapeHtml as esc } from '../lib.js';
import { ratingText } from './modes.js';
const freshness={current:'Cache current',stale:'Saved ratings — refresh due','refresh-failed':'Refresh failed — last accepted ratings',unavailable:'No saved evidence',imported:'Saved import — freshness unknown'};
// Sample ratings are fictional, except the demo's real ones from public pages (publicData).
export const fictional = result => result?.workspace==='sample' && !result.row?.source?.publicData;
export function ratingAttributionHtml(result) {
  if(!result?.row?.source || result.value===null)return '';
  if(fictional(result))return '<span class="provider-credit">Fictional example</span>';
  return `<a class="provider-credit" href="${esc(result.row.source.url)}" target="_blank" rel="noopener noreferrer">${esc(result.row.source.attribution)} ↗</a>`;
}
export function rankingSummaryHtml(ranking,{label,context=false,sample=false,unavailable=false}={}) {
  // Only a failed refresh is worth a mention; an older saved rating is still the right one to show.
  const failed=[...ranking.records.values()].filter(row=>row.value!==null && row.freshness==='refresh-failed').length;
  const rated=[...ranking.records.values()].filter(row=>row.value!==null),made=rated.filter(row=>!row.row?.source?.publicData).length;
  const note=!sample||!made?'':made===rated.length?'Fictional sample ratings. ':'Sample ratings: the fictional examples are marked. ';
  return `<p>${note}<strong>${esc(label)}</strong> · ${ranking.rated} of ${ranking.total} games rated.${failed?` ${failed} couldn’t be refreshed last time and show their saved rating.`:''} ${unavailable?'Saved ratings are unavailable right now. ':''}Unrated games are listed after rated ones. ${context?'This rates the game overall, not a specific platform version. ':''}<a href="${new URL('./methodology.html',import.meta.url).href}">How ratings work</a></p>`;
}
export function rankingExplanationHtml(result, { filtered = false } = {}) {
  if(!result)return '';
  const evidence=result.evidence,original=evidence?.original;
  const attribution=fictional(result)?'Fictional example':result.row?.source?.attribution;
  const link=result.row?.source && !fictional(result)?`<a href="${esc(result.row.source.url)}" target="_blank" rel="noopener noreferrer">${esc(attribution)}</a>`:esc(attribution||'Saved import');
  return `<section class="ranking-explanation"><h4>Why this order?</h4><p>${esc(ratingText(result))}</p>
    <p>${result.rank?`#${result.rank} among rated records in ${esc(result.cohort)}; ${filtered?'positions update when the selection changes':'this position is preserved when filtering'}.`:esc(result.reason||'Unranked for this source.')}</p>
    <p>${result.scope==='work-context'?'Work-level context. This does not establish a platform-specific rank.':'Reception belongs to the identified product or imported record.'}</p>
    <p>${link} · ${esc(freshness[result.freshness]||'Unknown freshness')}</p>
    ${original?`<p>${original.positive!==null?`${original.positive.toLocaleString()} positive / ${original.count.toLocaleString()} reviews. `:''}${original.count!==null && original.positive===null?`Provider count: ${original.count.toLocaleString()}. `:''}${evidence.dates.observedAt?`Observed: ${esc(new Date(evidence.dates.observedAt).toLocaleString())}.`:''}</p>`:''}
    <p>${result.mode==='steam'?'Conservative approval is the Wilson lower bound (z = 1.96), using exact counts and no popularity bonus.':result.mode.endsWith('-volume')?'Volume measures popularity, not quality.':result.mode==='imported'? 'Conservative approval uses the saved import; percentages without exact counts are approximate.':result.mode==='imported-raw'?'The approval percentage comes from the saved import.':'The selected source value is unchanged; it is not blended with another score.'} Equal values share a position; title and stable ID only order ties. No personal, price or artwork bonus is applied.</p>
    <details><summary>Calculation details</summary><p>Method: ${esc(result.methodVersion)}<br>Evidence snapshot: ${esc(result.snapshotId??'Imported data')}<br>Candidate set: ${esc(result.candidateSetId??'Not ranked')}<br>Evidence: ${esc(result.evidenceIds?.join(', ')||'Imported record')}</p></details></section>`;
}

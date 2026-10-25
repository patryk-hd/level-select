import { createHash } from 'node:crypto';
import { referenceKey } from '../tracking/domain.js';
import { titleKey } from '../library/core.js';
import { object, required, numericId } from './providers/common.mjs';

export function digest(value) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validateCrosswalk(value) {
  required(value?.schemaVersion===1 && Number.isSafeInteger(value.revision) && value.revision>0 && Array.isArray(value.mappings) && value.mappings.length<=10000,'Invalid crosswalk');
  const ids=new Set(),targets=new Set();
  for (const mapping of value.mappings) {
    required(typeof mapping.id==='string' && /^[a-zA-Z0-9_-]{1,120}$/.test(mapping.id) && !ids.has(mapping.id),'Invalid or duplicate mapping ID');ids.add(mapping.id);
    const key=referenceKey(mapping.target);
    required(['catalog','playnite','steam'].includes(mapping.target.provider),'Map source records, not ambiguous title groups');
    required(['steam','vgc','igdb'].includes(mapping.provider) && numericId(mapping.providerId),'Invalid provider mapping');
    required(!targets.has(`${key}|${mapping.provider}`),'Ambiguous provider mapping for one target');targets.add(`${key}|${mapping.provider}`);
    required(mapping.review?.status==='verified' && typeof mapping.review.reason==='string' && mapping.review.reason.trim().length>10 && Number.isFinite(Date.parse(mapping.review.reviewedAt)),'Mapping needs a recorded review');
    required(object(mapping.expected),'Mapping expectations required');
    if (mapping.provider==='steam') {
      // A store ID is a product identity, not proof about an original console release.
      required(mapping.target.provider==='steam' && mapping.target.id===mapping.providerId && mapping.scope==='steam-product','Steam product evidence requires the matching Steam reference');
    } else {
      required(mapping.scope==='work-context','This adapter does not establish platform-specific score scope');
      required(Array.isArray(mapping.expected.names) && mapping.expected.names.length>0 && mapping.expected.names.every(name=>typeof name==='string' && name.trim().length>0 && name.length<=500),'Reviewed provider titles required');
      if (mapping.provider==='vgc' && mapping.target.provider==='steam') required(mapping.expected.steamId===mapping.target.id,'VGC mapping requires its explicit Steam link');
    }
  }
  return value;
}
export function verifyMapping(mapping,source) {
  required(source.provider===mapping.provider && source.id===mapping.providerId && source.scope===mapping.scope,'Provider identity or scope changed');
  if (mapping.expected.names) required(mapping.expected.names.some(name=>titleKey(name)===titleKey(source.title)),'Provider title or edition changed');
  if (mapping.expected.steamId) required(source.steamId===mapping.expected.steamId,'Linked Steam product changed');
}
export function steamMapping(id, reviewedAt) {
  required(numericId(id),'Use numeric Steam app IDs');
  return {id:`steam-${id}`,provider:'steam',providerId:id,target:{provider:'steam',id},scope:'steam-product',expected:{steamId:id},
    review:{status:'verified',reviewedAt,reason:'Explicit Steam product reference maps to the same Steam app ID; no title or platform inference.'}};
}

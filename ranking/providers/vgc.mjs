import { object, required, rating, count, date, providerURL, name, numericId } from './common.mjs';
export const vgc = {
  id: 'vgc', version: 'vgc-detail-v1', ttlMs: 6*3600000, intervalMs: 1000,
  request(id, credentials = {}) {
    required(numericId(id), 'VGC requires a reviewed numeric provider ID');
    return {url:`https://videogamescritic.com/api/v1/game/${id}`,init:{headers:credentials.vgcKey ? {Authorization:`Bearer ${credentials.vgcKey}`} : {}}};
  },
  normalize(body, id) {
    required(object(body) && String(body.id) === id && object(body.scores));
    const scores = body.scores;
    required(Object.hasOwn(scores,'vgc') && Object.hasOwn(scores,'players') && Object.hasOwn(scores,'critics'));
    const url = providerURL(body.links?.page ?? body.url, 'videogamescritic.com');
    required(url.startsWith('https://videogamescritic.com/game/'));
    const steamLink = body.links?.steam == null ? null : providerURL(body.links.steam,'store.steampowered.com');
    const steamId = steamLink ? new URL(steamLink).pathname.match(/^\/app\/(\d+)(?:\/|$)/)?.[1] : null;
    if (steamLink) required(steamId, 'Invalid linked Steam product');
    required(Array.isArray(body.platforms) && body.platforms.every(value=>typeof value==='string'));
    const rawGap = object(scores.gap) ? scores.gap.value : scores.gap;
    required(rawGap == null || (typeof rawGap === 'number' && Number.isFinite(rawGap) && Math.abs(rawGap)<=100));
    return {provider:'vgc',id,title:name(body.name),url,attribution:'Powered by VideoGamesCritic',scope:'work-context',
      platforms:body.platforms,steamId:steamId??null,sourceUpdatedAt:date(scores.updatedAt),
      // These remain VGC figures; do not pass them off as independent Steam or critic inputs.
      signals:[{key:'vgc',label:'VGC Score',value:rating(scores.vgc),count:null,type:'external-composite'},
        {key:'vgc-players',label:'VGC Players',value:rating(scores.players),count:null,type:'external-composite'},
        {key:'vgc-critics',label:'VGC Critics',value:rating(scores.critics),count:count(scores.criticCount),type:'external-composite'}],
      details:{gap:rawGap??null,confidence:typeof scores.confidence==='string'?scores.confidence:null,
        trend:typeof scores.trend==='string'?scores.trend:null}};
  },
};

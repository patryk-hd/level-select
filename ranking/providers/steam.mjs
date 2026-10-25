import { object, required, count, numericId } from './common.mjs';
export const STEAM_QUERY = Object.freeze({json:'1',language:'all',purchase_type:'all',review_type:'all',filter:'recent',filter_offtopic_activity:'1',num_per_page:'1',cursor:'*'});
export const steam = {
  id:'steam',version:'steam-review-summary-v1',ttlMs:24*3600000,intervalMs:1000,
  request(id) {
    required(numericId(id), 'Steam requires an explicit app ID');
    return {url:`https://store.steampowered.com/appreviews/${id}?${new URLSearchParams(STEAM_QUERY)}`,init:{}};
  },
  normalize(body,id) {
    required(object(body) && body.success===1 && object(body.query_summary));
    const summary=body.query_summary,positive=count(summary.total_positive),negative=count(summary.total_negative),total=count(summary.total_reviews);
    required(positive!==null && negative!==null && total!==null && positive+negative===total,'Inconsistent Steam review totals');
    return {provider:'steam',id,title:`Steam app ${id}`,url:`https://store.steampowered.com/app/${id}/`,attribution:'Steam user reviews',
      scope:'steam-product',platforms:['Steam product'],steamId:id,sourceUpdatedAt:null,
      signals:[{key:'steam-approval',label:'Steam approval',type:'binary-approval',value:total?100*positive/total:null,count:total,positive,negative}],
      details:{queryScope:{...STEAM_QUERY},countMeaning:'Total reviews matching the query; not the returned page count'}};
  },
  // Up to 100 apps a request through the store's item endpoint: the same review summary
  // (all languages, off-topic review bombs filtered out) plus the release date, which sets
  // how soon a game is checked again (scripts/enrich-ratings.mjs). Steam gives the share
  // of positive reviews as a whole percent, so positive and negative are derived from it.
  batchSize:100,
  batchRequest(ids) {
    required(Array.isArray(ids) && ids.length>0 && ids.length<=100 && ids.every(numericId), 'Steam batches need 1–100 explicit app IDs');
    const input={ids:ids.map(id=>({appid:Number(id)})),context:{language:'english',country_code:'US'},data_request:{include_reviews:true,include_release:true}};
    return {url:`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?${new URLSearchParams({input_json:JSON.stringify(input)})}`,init:{}};
  },
  normalizeBatch(body,ids) {
    required(object(body) && object(body.response), 'Unexpected Steam store response');
    const found=new Map(), wanted=new Set(ids);
    for (const item of body.response.store_items ?? []) {
      const id=String(item?.appid ?? '');
      if (!wanted.has(id) || item.success===2) continue;
      const summary=item.reviews?.summary_filtered, total=count(summary?.review_count ?? 0) ?? 0, percent=Number(summary?.percent_positive);
      const rated=total>0 && Number.isFinite(percent) && percent>=0 && percent<=100;
      const positive=rated?Math.round(total*percent/100):0;
      const released=item.release?.steam_release_date ?? item.release?.original_release_date ?? null;
      found.set(id,{provider:'steam',id,title:`Steam app ${id}`,url:`https://store.steampowered.com/app/${id}/`,attribution:'Steam user reviews',
        scope:'steam-product',platforms:['Steam product'],steamId:id,sourceUpdatedAt:null,
        signals:[{key:'steam-approval',label:'Steam approval',type:'binary-approval',value:rated?percent:null,count:rated?total:0,positive,negative:rated?total-positive:0}],
        details:{queryScope:'Steam store review summary: all languages, off-topic activity filtered',countMeaning:'Total reviews in the store summary',
          released:Number.isFinite(released)&&released>0?new Date(released*1000).toISOString().slice(0,10):null,comingSoon:Boolean(item.release?.is_coming_soon)}});
    }
    return found;
  },
};

import { object, required, rating, count, providerURL, name, numericId } from './common.mjs';
export const igdb = {
  id:'igdb',version:'igdb-game-ratings-v1',ttlMs:7*24*3600000,intervalMs:300,
  request(id,credentials={}) {
    required(numericId(id),'IGDB requires a reviewed game ID');
    if (!credentials.igdbClientId || !credentials.igdbAccessToken) throw new Error('credentials-missing');
    return {url:'https://api.igdb.com/v4/games',init:{method:'POST',headers:{'Client-ID':credentials.igdbClientId,Authorization:`Bearer ${credentials.igdbAccessToken}`,'Content-Type':'text/plain'},
      body:`fields id,name,url,platforms,rating,rating_count,aggregated_rating,aggregated_rating_count,updated_at,version_parent; where id = ${id}; limit 1;`}};
  },
  normalize(body,id) {
    required(Array.isArray(body));
    if (!body.length) throw new Error('provider-not-found');
    required(body.length===1 && object(body[0]) && String(body[0].id)===id);
    const game=body[0];
    required(game.platforms==null || (Array.isArray(game.platforms) && game.platforms.every(value=>Number.isSafeInteger(value) && value>0)));
    required(game.updated_at==null || (Number.isSafeInteger(game.updated_at) && game.updated_at>0 && game.updated_at<253402300800));
    return {provider:'igdb',id,title:name(game.name),url:providerURL(game.url,'www.igdb.com'),attribution:'IGDB',scope:'work-context',
      platforms:(game.platforms??[]).map(value=>`IGDB platform ${value}`),steamId:null,
      sourceUpdatedAt:game.updated_at?new Date(game.updated_at*1000).toISOString():null,
      signals:[{key:'igdb-community',label:'IGDB community',value:rating(game.rating),count:count(game.rating_count),type:'aggregate'},
        {key:'igdb-critics',label:'IGDB critics',value:rating(game.aggregated_rating),count:count(game.aggregated_rating_count),type:'aggregate'}],
      details:{versionParent:game.version_parent??null}};
  },
};

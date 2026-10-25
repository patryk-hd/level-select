import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { freshState, filterGames, parseState, encodeState, paginate, normalize, emptyCollection, updateEntry, validateCollection, mergeCollections, isTracked, escapeHtml, rankTier } from '../lib.js';

const catalog=JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url)));
const source=JSON.parse(await readFile(new URL('../data/source-catalog.json',import.meta.url)));
const review=JSON.parse(await readFile(new URL('../data/review-queue.json',import.meta.url)));
const lookup=(system,title)=>catalog.games.find(g=>g.systemId===system&&g.title===title);

test('migration accounts for every original entry without duplicate IDs or system titles',()=>{
  // Every entry of the original lists is still in the catalog (ranked or not) or in the review queue.
  assert.equal(catalog.games.filter(g=>g.sourceRank!=null).length+review.length,source.reduce((n,s)=>n+s.games.length,0));
  assert.equal(new Set(catalog.games.map(g=>g.id)).size,catalog.games.length);
  assert.equal(catalog.systems.length,51); // 50 original lists + PC (2000 onwards)
  for(const system of catalog.systems){
    const games=catalog.games.filter(g=>g.systemId===system.id&&!g.unlisted);
    assert.equal(games.length,system.count);
    assert.equal(new Set(games.map(g=>normalize(g.title))).size,games.length,system.id);
    assert.deepEqual(games.map(g=>g.rank),Array.from({length:games.length},(_,i)=>i+1));
    for(const g of games){assert.ok(g.title&&g.genres.length);assert.ok(Number.isInteger(g.year)&&g.year>=1970&&g.year<=2100);if(system.method==='legacy')assert.ok(g.sourceRank>=g.rank);}
    // A review-backed list leaves the rest of the original list in the catalog, unranked; so
    // do corrections that take an entry out (with the reason).
    for(const g of catalog.games.filter(g=>g.systemId===system.id&&g.unlisted))assert.ok((system.method==='reviews'||g.correction?.removed)&&g.rank===null&&g.sourceRank>0,g.id);
    // The corrected original list is numbered 1…n without gaps.
    const original=catalog.games.filter(g=>g.systemId===system.id&&g.legacyRank!=null).sort((a,b)=>a.legacyRank-b.legacyRank);
    assert.equal(original.length,system.originalCount);assert.deepEqual(original.map(g=>g.legacyRank),Array.from({length:original.length},(_,i)=>i+1));
    assert.ok(original.every(g=>!g.correction?.removed));
    assert.equal(new Set(original.map(g=>normalize(g.originalTitle))).size,original.length,`${system.id} original list has a duplicate title`);
  }
});

test('known data errors are isolated while original titles and aliases remain recoverable',()=>{
  assert.equal(catalog.games.filter(g=>/\balt\b|\bTBA\b/i.test(g.title)).length,0);
  assert.equal(catalog.games.filter(g=>g.systemId==='nes'&&g.title==='Contra Force').length,1);
  assert.equal(catalog.games.filter(g=>g.systemId==='ps1'&&g.title==='Dino Crisis').length,1);
  assert.equal(lookup('nes','Super Mario All-Stars'),undefined);
  assert.ok(lookup('snes','Super Mario All-Stars'));
  assert.ok(lookup('scd','Double Switch'),'a platform suffix must not truncate this title');
  assert.ok(source.find(s=>s.id==='nes').games.some(g=>g[0]==='Super Mario All-Stars'));
  assert.ok(review.some(r=>r.reason==='Unspecified alternate edition'));
});

test('search tolerates whitespace, accent marks, punctuation, tokens, and aliases',()=>{
  const state={...freshState(),systems:['nes'],q:' Contra Force '};
  assert.equal(filterGames(catalog,state).length,1);
  assert.deepEqual(filterGames(catalog,{...freshState(),q:'Pokémon'}).map(g=>g.id),filterGames(catalog,{...freshState(),q:'pokemon'}).map(g=>g.id));
  assert.ok(filterGames(catalog,{...freshState(),scope:'all',q:'chrono trigger'}).length>1);
  assert.ok(filterGames(catalog,{...freshState(),systems:['nes'],q:'rescue rangers 2'}).length===1);
  assert.ok(filterGames(catalog,{...freshState(),systems:['snes'],q:'yoshi island'}).some(g=>g.title.includes('Yoshi')));
});

test('multiple systems and genres use OR within facets and AND across facets',()=>{
  const state={...freshState(),systems:['snes','ps1'],genres:['RPG','Adventure'],rank:'10',yearFrom:'1991',yearTo:'1998'};
  const found=filterGames(catalog,state);
  assert.ok(found.some(g=>g.title==='Chrono Trigger'));
  assert.ok(found.some(g=>g.title==='Final Fantasy VII'));
  assert.ok(found.every(g=>state.systems.includes(g.systemId)&&g.genres.some(t=>state.genres.includes(t))&&g.year>=1991&&g.year<=1998));
  assert.equal(filterGames(catalog,{...state,family:'sega'}).length,0);
});

test('genre tags include secondary genres and major former inconsistencies',()=>{
  assert.ok(filterGames(catalog,{...freshState(),systems:['nes'],genres:['Adventure']}).some(g=>g.title==='The Legend of Zelda'));
  assert.ok(catalog.games.filter(g=>/FPS|First-Person Shooter/i.test(g.genreLabel)).every(g=>g.genres.includes('Shooter')));
  assert.ok(catalog.games.filter(g=>g.genreLabel==='MMORPG').every(g=>g.genres.includes('RPG')));
});

test('URL state round-trips all meaningful filters and game links',()=>{
  const original={...freshState(),view:'collection',family:'nintendo',systems:['nes','snes'],genres:['Action','RPG'],q:'Mario & Zelda',rank:'all',yearFrom:'1985',yearTo:'2000',kind:'Console',era:'before2000',collection:'owned',sort:'newest',layout:'grid',page:2,game:catalog.games[0].id};
  assert.deepEqual(parseState(encodeState(original),catalog),original);
});

test('malformed or unknown URL values cannot produce invalid application state',()=>{
  const state=parseState('?systems=nes,missing,nes&genres=RPG,Unknown&family=wrong&yearFrom=2000&yearTo=1980&sort=oops&page=Infinity&view=evil&game=bad',catalog);
  assert.deepEqual(state.systems,['nes']);assert.deepEqual(state.genres,['RPG']);assert.equal(state.family,'');
  assert.equal(state.yearFrom,'1980');assert.equal(state.yearTo,'2000');assert.equal(state.sort,'score');assert.equal(state.page,1);assert.equal(state.view,'games');assert.equal(state.game,'');
  assert.equal(parseState('?layout=list',catalog,'grid').layout,'list');
});

test('ownership, favorites, wishlist, and play status are independent',()=>{
  const id=lookup('snes','Chrono Trigger').id;
  let c=updateEntry(emptyCollection(),id,{owned:true,status:'backlog'});
  c=updateEntry(c,id,{favorite:true});c=updateEntry(c,id,{status:'completed'});
  assert.equal(c.entries[id].owned,true);assert.equal(c.entries[id].favorite,true);assert.equal(c.entries[id].status,'completed');
  assert.equal(filterGames(catalog,{...freshState(),view:'collection',collection:'owned'},c).length,1);
  assert.equal(filterGames(catalog,{...freshState(),view:'collection',collection:'playing'},c).length,0);
  c=updateEntry(c,id,{owned:false,favorite:false,status:'untracked'});assert.equal(isTracked(c.entries[id]),false);
});

test('backup validation rejects invalid flags/statuses and safely ignores unknown IDs',()=>{
  const id=catalog.games[0].id;
  assert.throws(()=>validateCollection({schemaVersion:2,entries:{},pinnedSystems:[]},catalog));
  assert.throws(()=>validateCollection({schemaVersion:1,entries:{[id]:{favorite:'true'}},pinnedSystems:[]},catalog));
  assert.throws(()=>validateCollection({schemaVersion:1,entries:{[id]:{status:'hacked'}},pinnedSystems:[]},catalog));
  const value=JSON.parse(`{"schemaVersion":1,"entries":{"__proto__":{"owned":true},"${id}":{"favorite":true}},"pinnedSystems":["nes","nes","missing"]}`);
  const result=validateCollection(value,catalog);assert.equal(result.skipped,1);assert.deepEqual(result.collection.pinnedSystems,['nes']);assert.equal({}.owned,undefined);
});

test('backup import merges collection entries and pinned systems without erasing unrelated games',()=>{
  const [a,b]=catalog.games;
  let current=updateEntry(emptyCollection(),a.id,{owned:true});current=updateEntry(current,b.id,{status:'playing'});current.pinnedSystems=['nes'];
  const incoming=validateCollection({schemaVersion:1,entries:{[a.id]:{owned:true,favorite:true}},pinnedSystems:['snes']},catalog).collection;
  const merged=mergeCollections(current,incoming);assert.equal(merged.entries[b.id].status,'playing');assert.equal(merged.entries[a.id].favorite,true);assert.deepEqual(merged.pinnedSystems,['nes','snes']);
  assert.deepEqual(validateCollection(JSON.parse(JSON.stringify(merged)),catalog).collection,merged);
});

test('pagination clamps oversized pages after filtering and sorting keeps platform ranks intact',()=>{
  assert.equal(paginate([],999).page,1);assert.equal(paginate(catalog.games.slice(0,37),999).items.length,1);
  const found=filterGames(catalog,{...freshState(),systems:['nes'],q:'Contra Force'});assert.equal(found[0].title,'Contra Force');assert.ok(found[0].rank===null||found[0].rank>1);
  const sorted=filterGames(catalog,{...freshState(),systems:['nes'],sort:'newest'});assert.ok(sorted.every((g,i)=>!i||sorted[i-1].year>=g.year));
});

test('rendered user-provided strings are escaped',()=>{
  assert.equal(escapeHtml('<img onerror="x"> & \'test\''),'&lt;img onerror=&quot;x&quot;&gt; &amp; &#39;test&#39;');
});

test('HTML has unique IDs and every static application lookup has a matching element',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
  for(const id of ['search','main','results','pagination','dialog','dialog-title','dialog-body','catalog-scope','pinned-nav','rank-filter','sort','collection-filter','system-filter','genre-filter','more-filters','backup-button','toast'])assert.ok(ids.includes(id),id);
});

test('the list switch shows the corrected original list on any system, and hides entries the fact check took out', async ()=>{
  const corrections=JSON.parse(await readFile(new URL('../data/legacy-corrections.json',import.meta.url))).corrections;
  const byId=new Map(catalog.games.map(g=>[g.id,g]));
  for(const fix of corrections){const game=byId.get(fix.id);assert.ok(game,fix.id);
    if(fix.remove){assert.ok(fix.remove.length>5);assert.equal(game.legacyRank,null);assert.equal(game.correction.removed,fix.remove);}
    else{assert.equal(game.originalTitle,fix.rename);assert.ok(game.aliases.includes(fix.title),fix.title);}}
  const original=filterGames(catalog,{...freshState(),systems:['snes'],sort:'curated',list:'original'});
  assert.deepEqual(original.map(g=>g.legacyRank),Array.from({length:original.length},(_,i)=>i+1));
  const reviewed=filterGames(catalog,{...freshState(),systems:['snes'],sort:'curated'});
  assert.deepEqual(reviewed.map(g=>g.rank),Array.from({length:reviewed.length},(_,i)=>i+1));
  assert.equal(parseState('?systems=snes&list=original',catalog).list,'original');assert.equal(parseState('?list=nope',catalog).list,'reviews');
  // A removed entry (Garou isn't a NAOMI game) never shows in browse or search, only when tracked.
  const garou=catalog.games.find(g=>g.systemId==='naomi'&&g.correction?.removed&&/Garou/.test(g.title));assert.ok(garou);
  assert.equal(filterGames(catalog,{...freshState(),systems:['naomi'],q:'Garou'}).length,0);
  const tracked=updateEntry(emptyCollection(),garou.id,{favorite:true});
  assert.ok(filterGames(catalog,{...freshState(),systems:['naomi'],q:'Garou'},tracked).some(g=>g.id===garou.id));
});

test('ranked lists read in tiers: the podium, the top 5, 10 and 25, then the rest', () => {
  assert.deepEqual([1,3,4,5,6,10,11,25,26,100,null].map(rank=>rankTier(rank)[0]),['podium','podium','top5','top5','top10','top10','top25','top25','rest','rest','off']);
  assert.equal(rankTier(2)[1],'Top 3');assert.equal(rankTier(7)[1],'Top 10');
});

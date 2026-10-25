import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, parseState, encodeState, filterGames, isCatalogLanding, catalogSystems } from '../lib.js';
import { copyMatchesFilters } from '../library/core.js';
import { matchingCopies } from '../ranking/evidence.js';
import { rankCandidates } from '../ranking/modes.js';
const catalog={families:[{id:'nintendo'},{id:'sony'}],systems:[{id:'nes',family:'nintendo'},{id:'snes',family:'nintendo'},{id:'ps1',family:'sony'},{id:'wiiu',family:'nintendo'}],games:[
  {id:'a',title:'Zelda',systemId:'nes',rank:1,genres:[],aliases:[]},
  {id:'b',title:'Mario',systemId:'snes',rank:1,genres:[],aliases:[]},
  {id:'c',title:'Another',systemId:'nes',rank:2,genres:[],aliases:[]},
  {id:'d',title:'Later',systemId:'wiiu',rank:1,genres:[],aliases:[]},
  {id:'e',title:'PlayStation game',systemId:'ps1',rank:1,genres:[],aliases:[]},
]};
test('all systems are the default, with bookmarkable personal favorites and legacy URL support',()=>{
  assert.equal(isCatalogLanding(freshState()),true);
  assert.equal(catalogSystems(catalog,freshState()).length,4);
  assert.equal(parseState('?scope=mvp',catalog).scope,'all');
  const favorites={...freshState(),scope:'favorites'};
  assert.deepEqual(catalogSystems(catalog,favorites,['wiiu']).map(s=>s.id),['wiiu']);
  assert.deepEqual(catalogSystems(catalog,favorites),[]);
  assert.deepEqual(filterGames(catalog,favorites,{entries:{},pinnedSystems:['wiiu']}).map(g=>g.id),['d']);
  assert.deepEqual(parseState(encodeState(favorites),catalog),favorites);
  assert.deepEqual(filterGames(catalog,parseState('?systems=wiiu',catalog)).map(g=>g.id),['d']);
});
test('family and old multi-system URLs never stitch together legacy system ranks',()=>{
  const state=parseState('?family=nintendo&systems=nes,snes&rank=10',catalog);
  assert.equal(state.sort,'score');assert.equal(state.rank,'all');
  assert.deepEqual(filterGames(catalog,state).map(g=>g.title),['Another','Mario','Zelda']);
  const single=parseState('?systems=nes&sort=curated',catalog);
  assert.deepEqual(filterGames(catalog,single).map(g=>g.rank),[1,2]);
});
test('scope survives bookmarks and does not hide saved games outside MVP',()=>{
  const state=parseState('?family=nintendo&scope=all&sort=vgc',catalog);
  assert.deepEqual(parseState(encodeState(state),catalog),state);
  assert.equal(filterGames(catalog,state).length,4);
  assert.deepEqual(filterGames(catalog,{...freshState(),view:'collection'},{entries:{d:{favorite:true}}}).map(g=>g.id),['d']);
});
test('a family score cohort has continuous descending ranks with missing values last and unranked',()=>{
  const ids=filterGames(catalog,{...freshState(),family:'nintendo',sort:'vgc'}).map(g=>g.id);
  const values={a:75,b:95,c:null,d:null};
  const ranked=rankCandidates(ids.map(id=>({targetId:id,title:id,value:values[id]})),{cohort:'Nintendo',mode:'vgc'});
  assert.deepEqual([...ranked.records.values()].map(r=>[r.targetId,r.rank]),[['b',1],['a',2],['c',null],['d',null]]);
});
test('PC and storefront presets require both to match the same owned copy and rating evidence',()=>{
  const game={copies:[{id:'console',platforms:['PS4'],sources:['Steam']},{id:'gog',platforms:['PC (Windows)'],sources:['GOG.com']},{id:'epic',platforms:['Windows'],sources:['Epic Games Store']}]};
  assert.equal(game.copies.some(c=>copyMatchesFilters(c,{platform:'pc',source:'store:steam'})),false);
  assert.deepEqual(matchingCopies(game,{platform:'pc',source:'store:gog'}).map(c=>c.id),['gog']);
  assert.deepEqual(matchingCopies(game,{platform:'pc',source:'store:epic'}).map(c=>c.id),['epic']);
  assert.deepEqual(matchingCopies(game,{platform:'PC (Windows)',source:'GOG.com'}).map(c=>c.id),['gog']);
  assert.equal(copyMatchesFilters({platforms:[],sources:['Steam']},{platform:'pc',source:'store:steam'}),false);
});

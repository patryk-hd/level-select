import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, titleSearch } from '../library/core.js';
import { freshState, filterGames, parseState } from '../lib.js';

test('Super Mario requires complete preceding words, excluding superstar and description references',()=>{
  const games=[{name:'Super Mario World'},{title:'New Super Mario Bros. U Deluxe'},
    {title:'Super Paper Mario'},{name:'Mario Party Superstars'},{name:'Mario and Luigi: Superstar Saga'},
    {name:'Unrelated platformer',search:'Super Mario inspired platformer',summary:'Super Mario'}];
  assert.deepEqual(games.filter(game=>matchesSearch(game,'super mario')).map(game=>game.name??game.title),
    ['Super Mario World','New Super Mario Bros. U Deluxe','Super Paper Mario']);
  assert.equal(matchesSearch(games[0],'mario super'),true);
  assert.equal(matchesSearch(games[0],'super mari'),true);
});

test('Division matches title words, never publishers, descriptions or word fragments',()=>{
  const games=[{name:"Tom Clancy’s The Division"},{name:"Tom Clancy's The Division 2 — Ultimate Edition"},
    {name:'Subdivision Infinity DX'},{name:'Other title',publishers:['Private Division'],search:'Private Division military division'}];
  assert.deepEqual(games.map(game=>matchesSearch(game,'division')),[true,true,false,false]);
  assert.equal(matchesSearch(games[1],'division 2'),true);
  assert.equal(matchesSearch({name:'The Division 20'},'division 2'),false);
});

test('punctuation, possessives, case, accents and whitespace are normalized without fuzzy expansion',()=>{
  assert.equal(matchesSearch({name:'Pokémon™: Édition'},'  POKEMON edition '),true);
  assert.equal(matchesSearch({name:'Super Mario World 2: Yoshi’s Island'},'yoshi island'),true);
  assert.equal(matchesSearch({name:'Yoshi Island'},"Yoshi's Island"),true);
  assert.equal(matchesSearch({name:'R-Type III'},'r type'),true);
  assert.equal(matchesSearch({name:'Tom Clancy’s The Division'},'tom clancy division'),true);
  assert.equal(matchesSearch({name:'Pokémon'},'pokmon'),false);
  assert.equal(matchesSearch({name:'ゼルダの伝説'},'ゼルダの伝説'),true);
});

test('every query word must belong to one title or explicit alias, including copy titles',()=>{
  const game={name:'Star Fox 64',aliases:['Lylat Wars'],copies:[{name:'Star Fox 64 3D'}]};
  assert.equal(matchesSearch(game,'lylat wars'),true);
  assert.equal(matchesSearch(game,'star fox 3d'),true);
  assert.equal(matchesSearch(game,'fox wars'),false);
  assert.equal(matchesSearch(game,'lylat 3d'),false);
  assert.equal(matchesSearch({name:'Super Game',copies:[{name:'Mario Game'}]},'super mario'),false);
});

test('blank query preserves the list, punctuation-only query does not display every game',()=>{
  assert.equal(matchesSearch({title:'Anything'},'   '),true);
  assert.equal(matchesSearch({title:'Anything'},'!!!'),false);
  assert.equal(matchesSearch({title:'Anything'},'—'),false);
});

test('catalog and owned/wishlist title search obey the same matching rules',()=>{
  const games=['Super Mario World','Mario Party Superstars','Subdivision Infinity','The Division'].map((title,i)=>({id:String(i),title,systemId:'test',genres:[],aliases:[],rank:i+1}));
  const catalog={systems:[{id:'test'}],games};
  for(const q of ['super mario','division','!!!',''])assert.deepEqual(filterGames(catalog,{...freshState(),q}).map(g=>g.id).sort(),games.filter(g=>matchesSearch(g,q)).map(g=>g.id).sort());
});


test('only the final word can be incomplete; number tokens remain exact',()=>{
  const game={title:'Super Mario World 2'};
  for(const query of ['sup','super ma','mario wor','super mario world 2']) assert.equal(matchesSearch(game,query),true,query);
  for(const query of ['su mari','uper mario','super super','super mario world 20']) assert.equal(matchesSearch(game,query),false,query);
  assert.equal(matchesSearch({title:'The Division 20'},'division 2'),false);
  assert.equal(matchesSearch({title:'The Division 2'},'divi'),true);
  assert.equal(matchesSearch({title:'Subdivision'},'divi'),false);
});

test('relevance prefers full titles, phrases, other complete words, then prefixes',()=>{
  const titles=['Mario Superstars','Super Paper Mario','Super Mario World','Super Mario'];
  const games=titles.map(title=>({title})),search=titleSearch('super mario');
  assert.deepEqual(games.filter(g=>search.match(g)).sort(search.compare).map(g=>g.title),['Super Mario','Super Mario World','Super Paper Mario']);
  const single=[{title:'Divisionary'},{title:'The Division 2'},{title:'Division'}];
  assert.deepEqual(single.sort(titleSearch('division').compare).map(g=>g.title),['Division','The Division 2','Divisionary']);
});

test('spelling suggestions allow one edit or transposition, without silently matching',()=>{
  const games=[{title:'The Division'},{title:'Subdivision'},{title:'Other game',search:'Division'}];
  for(const query of ['divison','diviis on','divisoin','divisxon','divission']) {
    if(query==='diviis on') {assert.deepEqual(titleSearch(query).suggestions(games),[]);continue;}
    assert.equal(matchesSearch(games[0],query),false,query);
    assert.deepEqual(titleSearch(query).suggestions(games).map(g=>g.title),['The Division'],query);
  }
  assert.deepEqual(titleSearch('divson').suggestions(games),[]);
  assert.deepEqual(titleSearch('divi').suggestions(games),[],'direct results suppress corrections');
  assert.deepEqual(titleSearch('halo').suggestions([{title:'Halt'}]),[],'short words are strict');
  assert.deepEqual(titleSearch('division 2').suggestions([{title:'The Division 3'},{title:'The Division 20'}]),[]);
  assert.deepEqual(titleSearch('supar maroi').suggestions([{title:'Super Mario'}]),[],'two corrections are not allowed');
});

test('suggestions preserve all words and one-title boundaries, deduplicate and obey supplied scope',()=>{
  const games=[{title:'Lylat Wars',aliases:['Star Fox 64']},{title:'Lylat Wars'},{title:'Lylat Wars 2'}];
  assert.deepEqual(titleSearch('lylat warts').suggestions(games).map(g=>g.title),['Lylat Wars','Lylat Wars 2']);
  assert.deepEqual(titleSearch('lylat warts').suggestions(games.slice(2)).map(g=>g.title),['Lylat Wars 2']);
  assert.deepEqual(titleSearch('lylat foxx').suggestions(games),[]);
  assert.deepEqual(titleSearch('star fox 64').suggestions(games),[]);
  assert.equal(titleSearch('lylat warts').suggestions(games,1).length,1);
  assert.deepEqual(titleSearch('!!!').suggestions(games),[]);
});

test('catalog defaults to relevance for searches while honoring explicit sorts',()=>{
  const catalog={systems:[{id:'test'}],families:[],games:[
    {id:'1',title:'Super Paper Mario',systemId:'test',aliases:[],genres:[],year:2007},
    {id:'2',title:'Super Mario',systemId:'test',aliases:[],genres:[],year:1985},
  ]};
  const automatic=parseState('?q=super+mario',catalog);
  assert.equal(automatic.sort,'relevance');
  assert.deepEqual(filterGames(catalog,automatic).map(g=>g.id),['2','1']);
  const explicit=parseState('?q=super+mario&sort=newest',catalog);
  assert.equal(explicit.sort,'newest');
  assert.deepEqual(filterGames(catalog,explicit).map(g=>g.id),['1','2']);
  const cutoff=parseState('?systems=test&rank=10&q=super+mario',catalog);
  assert.equal(cutoff.sort,'curated');
  assert.equal(cutoff.rank,'10','search must not remove an existing system-rank cutoff');
});

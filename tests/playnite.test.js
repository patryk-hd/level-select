import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { connectLibrary, matchesCopy, matchesSearch, validateEdits, platformKey, titleKey } from '../library/core.js';
import { freshState, filterGames, parseState, encodeState } from '../lib.js';

test('title and alias candidates never imply ownership, even on the same platform', () => {
  const catalog = { games: [
    { id:'ps4', title:'The Witcher 3', systemId:'ps4' },
    { id:'pc', title:'The Witcher 3', systemId:'dos' },
    { id:'edition', title:'The Witcher 3 Complete Edition', systemId:'dos' },
    { id:'alias', title:'Another title', aliases:['The Witcher 3'], systemId:'dos' },
  ] };
  const library = [{id:'witcher', name:'The Witcher™ 3', copies:[{id:'copy',platforms:['PC (Windows)']}]}];
  const matches = connectLibrary(catalog,library);
  assert.equal(Object.keys(matches.byRelease).length,0);
  assert.equal(matches.candidatesByRelease.pc[0].sameSystem,true);
  assert.equal(matches.candidatesByRelease.ps4[0].sameSystem,false);
  assert.equal(matches.candidatesByRelease.edition,undefined);
  assert.equal(matches.candidatesByRelease.alias[0].status,'unresolved');
  assert.equal(platformKey('Sony PlayStation 4'),'ps4');
  assert.equal(titleKey('Pokémon: Édition'),'pokemon edition');
});

test('store and platform filters require a matching copy', () => {
  const game={copies:[{platforms:['PS4'],sources:['PlayStation']},{platforms:['PC'],sources:['Steam']}]};
  assert.equal(matchesCopy(game,'PS4','Steam'),false);
  assert.equal(matchesCopy(game,'PC','Steam'),true);
  assert.equal(matchesCopy(game,'','Steam'),true);
  assert.equal(matchesCopy(game,'PS4',''),true);
});

test('owned title search handles accents, punctuation and unordered words without metadata matches', () => {
  const game={name:'Pokémon: Édition',search:'Nintendo Switch RPG'};
  assert.equal(matchesSearch(game,'  edition pokemon  '),true);
  assert.equal(matchesSearch(game,'RPG pokemon'),false);
  assert.equal(matchesSearch(game,'PlayStation'),false);
});

test('backup import accepts old overrides and full backups, rejecting malformed data', () => {
  const edit=validateEdits({game:{favorite:true,hidden:false,notes:'<note>'}});
  assert.equal(edit.overrides.game.notes,'<note>');
  const full=validateEdits({format:'playnite-library-backup',version:1,overrides:{},removed:{123:{title:'Game',removedAt:'2026-09-10'}},notes:{123:''}});
  assert.equal(full.notes[123],'');
  assert.throws(()=>validateEdits({game:{favorite:'true'}}));
  assert.throws(()=>validateEdits(JSON.parse('{"__proto__":{"favorite":true}}')));
  assert.throws(()=>validateEdits({format:'playnite-library-backup',version:99}));
  assert.throws(()=>validateEdits([]));
});

test('ownership filter survives URLs without changing manual tracking', () => {
  const catalog={families:[],systems:[{id:'pc',family:'pc'}],games:[
    {id:'a',title:'A',aliases:[],systemId:'pc',genres:[],rank:1,year:2000,playniteOwned:true},
    {id:'b',title:'B',aliases:[],systemId:'pc',genres:[],rank:2,year:2000,playniteOwned:false},
  ]};
  const state={...freshState(),scope:'all',ownership:'owned'};
  assert.equal(parseState(encodeState(state),catalog).ownership,'owned');
  assert.deepEqual(filterGames(catalog,state).map(g=>g.id),['a']);
  assert.deepEqual(filterGames(catalog,{...state,ownership:'missing'}).map(g=>g.id),['b']);
  assert.deepEqual(filterGames(catalog,{...state,view:'collection'}),[]);
});

test('sample library preserves every copy and uses only public catalog artwork', async () => {
  const context={window:{}};
  vm.runInNewContext(await readFile(new URL('../library/sample/library-data.js',import.meta.url),'utf8'),context);
  const games=context.window.PLAYNITE_LIBRARY, stats=context.window.PLAYNITE_STATS;
  assert.equal(games.length,stats.total);
  assert.equal(games.reduce((n,g)=>n+g.copies.length,0),stats.totalCopies);
  assert.equal(new Set(games.flatMap(g=>g.copies.map(c=>c.id))).size,stats.totalCopies);
  assert.equal(context.window.PLAYNITE_SAMPLE,true);
  // Box art comes from the shipped catalog (public image hosts), never a local or private file.
  const catalogCovers=new Set(JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url),'utf8')).games.map(game=>game.cover?.url).filter(Boolean));
  assert.ok(games.every(game => !game.background && (!game.cover || catalogCovers.has(game.cover) && /^https:\/\//.test(game.cover))));
  assert.ok(games.filter(game => game.cover).length > 100);
});

test('integrated pages keep unique IDs and all static control references', async () => {
  for(const [page,script] of [['index.html','app.js'],['wishlist.html','wishlist.js']]) {
    const html=await readFile(new URL(`../library/${page}`,import.meta.url),'utf8');
    const js=await readFile(new URL(`../library/${script}`,import.meta.url),'utf8');
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length,page);
    for(const match of js.matchAll(/document\.querySelector\("#([^"]+)"\)/g)) assert.ok(ids.includes(match[1]),`${page}: ${match[1]}`);
    assert.ok(html.includes('<dialog id="detailsPanel"'));
  }
});

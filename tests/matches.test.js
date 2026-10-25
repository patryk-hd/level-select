import test from 'node:test';
import assert from 'node:assert/strict';
import { connectLibrary, matchKey } from '../library/core.js';
import { emptyState, ensureTarget, applyCommand } from '../tracking/domain.js';
import { reviewLibraryMatch } from '../tracking/matches.js';
import { createBackup, parseBackup, validateState, previewMerge, mergeBackup } from '../tracking/backup.js';
import { buildSuggestionChoices } from '../tracking/suggestions.js';
import { enableRewards, rewardTransition, rewardTotal } from '../tracking/rewards.js';

const at = '2026-09-16T12:00:00.000Z';
function fixture() {
  return { state: emptyState(), catalog: { systems: [{id:'dos',name:'PC'}], games: [
    { id:'original',title:'Prey',systemId:'dos',year:2006,rank:3,genres:['Action'] },
    { id:'reboot',title:'Prey',systemId:'dos',year:2017,rank:7,genres:['Immersive sim'] },
    { id:'port',title:'Prey',systemId:'x360',year:2006,rank:4 },
    { id:'edition',title:'Prey Deluxe Edition',systemId:'dos',year:2017 },
  ] }, library: [{id:'title-group',name:'Prey',copies:[
    {id:'old-copy',platforms:['PC (Windows)'],sources:['GOG'],year:2006},
    {id:'new-copy',platforms:['PC (Windows)'],sources:['Steam'],year:2017},
  ]}] };
}
const connections = ctx => connectLibrary(ctx.catalog, ctx.library, ctx.state.matchReviews);
function review(ctx, decision, catalogId='original', copyId='old-copy') {
  ctx.state = reviewLibraryMatch(ctx.state, ctx, { catalogId, copyId, decision, at,
    expected: ctx.state.matchReviews[matchKey(catalogId,copyId)] ?? null });
  return ctx.state;
}

test('same-name reboot and multiple copies stay unresolved until each association is reviewed', () => {
  const ctx=fixture();
  assert.deepEqual(Object.keys(connections(ctx).byRelease),[]);
  assert.equal(connections(ctx).candidatesByRelease.original.length,2);
  assert.equal(connections(ctx).candidatesByRelease.edition,undefined);
  review(ctx,'accepted'); review(ctx,'rejected','original','new-copy');
  assert.equal(connections(ctx).byRelease.original.copyId,'old-copy');
  assert.equal(connections(ctx).byRelease.reboot,undefined);
  assert.equal(connections(ctx).candidatesByRelease.original[1].status,'rejected');
  review(ctx,'accepted','reboot','new-copy');
  assert.equal(connections(ctx).byRelease.reboot.copyId,'new-copy');
});

test('regional aliases suggest review; remakes, bundles, DLC and demos never inherit a score by name', () => {
  const ctx=fixture();
  ctx.catalog.games[0].aliases=['Regional Prey'];
  ctx.library.push({id:'regional',name:'Regional Prey',copies:[{id:'regional-copy',platforms:['PC']}]});
  for(const suffix of ['Remake','Bundle','DLC','Demo'])ctx.library.push({id:suffix,name:`Prey ${suffix}`,copies:[{id:suffix,platforms:['PC']}]});
  assert.equal(connections(ctx).candidatesByRelease.original.length,3);
  assert.equal(buildSuggestionChoices(ctx).flatMap(c=>c.options).flatMap(o=>o.ranks).length,0);
});

test('a reviewed port association does not claim ownership or rank of the original platform', () => {
  const ctx=fixture(); review(ctx,'accepted','port');
  assert.equal(connections(ctx).byRelease.port.sameSystem,false);
  assert.equal(connections(ctx).byRelease.original,undefined);
  assert.equal(buildSuggestionChoices(ctx)[0].options[0].ranks.length,0);
});

test('only the reviewed copy gains catalog context and reset removes it', () => {
  const ctx=fixture(); review(ctx,'accepted');
  const options=buildSuggestionChoices(ctx).flatMap(c=>c.options);
  assert.equal(options.find(o=>o.descriptor.ref.id==='old-copy').ranks[0].rank,3);
  assert.equal(options.find(o=>o.descriptor.ref.id==='new-copy').ranks.length,0);
  review(ctx,'unresolved');
  assert.equal(connections(ctx).byRelease.original,undefined);
  assert.equal(ctx.state.matchReviews[matchKey('original','old-copy')].decision,'unresolved');
});

test('identity changes invalidate acceptance; ordinary refresh data and group IDs do not', () => {
  const ctx=fixture(); review(ctx,'accepted');
  ctx.library[0].id='regrouped';ctx.library[0].copies[0].timePlayed=500;ctx.library[0].copies[0].bestScore=99;
  assert.equal(connections(ctx).byRelease.original.id,'regrouped');
  for(const [field,value] of [['year',2017],['platforms',['PlayStation']],['name','Different edition']]) {
    const changed=structuredClone(ctx);changed.library[0].copies[0][field]=value;
    assert.equal(connections(changed).byRelease.original,undefined);
    assert.equal(connections(changed).candidatesByRelease.original.find(item=>item.copyId==='old-copy').status,'changed');
    assert.equal(buildSuggestionChoices(changed)[0].options[0].ranks.length,0);
    review(changed,'accepted');assert.equal(connections(changed).byRelease.original.status,'accepted');
  }
  ctx.catalog.games[0].year=2017;
  assert.equal(connections(ctx).byRelease.original,undefined);
});

test('rejections survive renaming and missing copies; an unavailable copy never supplies ownership', () => {
  const ctx=fixture();review(ctx,'rejected');ctx.library[0].copies[0].name='Renamed original';
  assert.equal(connections(ctx).candidatesByRelease.original.find(item=>item.copyId==='old-copy').status,'rejected');
  review(ctx,'accepted');ctx.library[0].copies[0].available=false;
  assert.equal(connections(ctx).byRelease.original,undefined);
  assert.throws(()=>review(ctx,'accepted'),/not available/);
  const stored=structuredClone(ctx.state.matchReviews);ctx.library=[];
  assert.deepEqual(Object.keys(connections(ctx).byRelease),[]);
  assert.deepEqual(ctx.state.matchReviews,stored);
});

test('match reviews leave progress, notes, queue, rewards and provider values untouched', () => {
  const ctx=fixture();ctx.state=enableRewards(ctx.state,{at,timeZone:'UTC'});
  const target=ensureTarget(ctx.state,{ref:{provider:'playnite',id:'old-copy'},title:'Prey',platforms:['PC']});
  ctx.state=applyCommand(ctx.state,{type:'queue',targetId:target.id,eventId:'queue',at});
  const before=structuredClone(ctx),incoming=review(ctx,'accepted');
  ctx.state=rewardTransition(before.state,incoming,{at,eventId:'review',reason:'local tracking change'});
  const {matchReviews,...rest}=ctx.state;const {matchReviews:ignored,...old}=before.state;
  assert.deepEqual(rest,old);assert.equal(rewardTotal(ctx.state),0);
  assert.deepEqual(ctx.library,before.library);assert.deepEqual(ctx.catalog,before.catalog);
  validateState(ctx.state);
});

test('stale cross-tab decisions fail instead of overwriting a newer review', () => {
  const ctx=fixture();review(ctx,'accepted');
  assert.throws(()=>reviewLibraryMatch(ctx.state,ctx,{catalogId:'original',copyId:'old-copy',decision:'rejected',expected:null,at}),/another tab/);
  assert.equal(connections(ctx).byRelease.original.status,'accepted');
});

test('schema-five migration and backup restore preserve reviewed and rejected associations', () => {
  const old=emptyState();old.schemaVersion=5;delete old.matchReviews;delete old.productReviews;delete old.listAwards;const before=structuredClone(old);
  assert.deepEqual(validateState(old).matchReviews,{});assert.deepEqual(old,before);
  const ctx=fixture();review(ctx,'accepted');review(ctx,'rejected','original','new-copy');
  const restored=parseBackup(JSON.stringify(createBackup(ctx.state,at)),'personal');
  assert.deepEqual(restored.matchReviews,ctx.state.matchReviews);
  assert.equal(connections({...ctx,state:restored}).byRelease.original.copyId,'old-copy');
  assert.throws(()=>parseBackup(JSON.stringify(createBackup(ctx.state,at)),'sample'),/workspace/);
});

test('backup merges require an explicit conflict choice including resets', () => {
  const ctx=fixture();review(ctx,'accepted');const incoming=structuredClone(ctx.state);review(ctx,'unresolved');
  const conflict=previewMerge(ctx.state,incoming).conflicts[0];
  assert.equal(conflict.section,'matchReviews');
  assert.throws(()=>mergeBackup(ctx.state,incoming),/Choose which value/);
  const key=`matchReviews/${matchKey('original','old-copy')}`;
  assert.equal(mergeBackup(ctx.state,incoming,{[key]:'current'}).matchReviews[matchKey('original','old-copy')].decision,'unresolved');
  assert.equal(mergeBackup(ctx.state,incoming,{[key]:'incoming'}).matchReviews[matchKey('original','old-copy')].decision,'accepted');
});

test('malformed and unsupported match evidence fails backup validation', () => {
  const ctx=fixture();review(ctx,'accepted');const id=matchKey('original','old-copy');
  for(const [key,value] of [['decision','automatic'],['method','title-match'],['reviewedAt','yesterday'],['copyId','other'],['catalogIdentity',null]]) {
    const changed=structuredClone(ctx.state);changed.matchReviews[id][key]=value;
    assert.throws(()=>validateState(changed));
  }
});

test('a ROM on the same system matches its Atlas game without review, unless the title is ambiguous', () => {
  const catalog={ systems:[{id:'dc',name:'Dreamcast'},{id:'n64',name:'Nintendo 64'}], games:[
    { id:'crazy',title:'Crazy Taxi',systemId:'dc',year:2000 },
    { id:'thps',title:'Tony Hawk\'s Pro Skater 2',systemId:'dc',year:2000 },
    { id:'twin-a',title:'Twin',systemId:'dc',year:1999 },{ id:'twin-b',title:'Twin',systemId:'dc',year:2001 },
  ] };
  const rom=(id,name,platform)=>({id,name,rom:true,copies:[{id,name,rom:true,platforms:[platform],sources:['ES-DE']}]});
  const library=[rom('r1','Crazy Taxi','Dreamcast'),rom('r2','Tony Hawk\'s Pro Skater 2','Nintendo 64'),rom('r3','Twin','Dreamcast')];
  const result=connectLibrary(catalog,library,{});
  assert.equal(result.byRelease.crazy.status,'accepted');
  assert.deepEqual(result.byRelease.crazy.sources,['ES-DE']);
  assert.equal(result.candidatesByRelease.crazy[0].auto,true);
  // Another system's ROM is a different release; two same-titled games need you to choose.
  assert.equal(result.byRelease.thps,undefined);
  assert.equal(result.candidatesByRelease.thps[0].rom,true);
  assert.equal(result.byRelease['twin-a'],undefined);
  assert.equal(result.byRelease['twin-b'],undefined);
  // A decision you made still wins.
  const rejected=connectLibrary(catalog,library,{[matchKey('crazy','r1')]:{decision:'rejected'}});
  assert.equal(rejected.byRelease.crazy,undefined);
  // "Reset to unreviewed" (ticking Owned again) brings the automatic match back.
  assert.equal(connectLibrary(catalog,library,{[matchKey('crazy','r1')]:{decision:'unresolved'}}).byRelease.crazy.status,'accepted');
});

test('a store copy matches its PC list game when the title, system and year agree', () => {
  const catalog={ systems:[{id:'dos',name:'Classic PC'},{id:'pc',name:'PC'}], games:[
    { id:'hl2',title:'Half-Life 2',systemId:'pc',year:2004 },{ id:'w3',title:'The Witcher 3: Wild Hunt',systemId:'pc',year:2015 },{ id:'doom',title:'Doom',systemId:'dos',year:1993 },{ id:'doom-2016',title:'Doom',systemId:'pc',year:2016 },
  ] };
  const copy=(id,name,year)=>({id,name,copies:[{id,name,platforms:['PC (Windows)'],sources:['Steam'],year}]});
  const result=connectLibrary(catalog,[copy('a','Half-Life 2',2004),copy('b','Doom',1993),copy('w','The Witcher 3: Wild Hunt - Complete Edition',2015)],{});
  assert.equal(result.byRelease.hl2.status,'accepted');
  // Store editions are found by the game's title.
  assert.equal(result.byRelease.w3.status,'accepted');
  // "Doom" is on both PC lists: the year says which one a copy is.
  assert.equal(result.byRelease.doom.status,'accepted');
  assert.equal(result.byRelease['doom-2016'],undefined);
  // Two games of one title on the same list still need you to choose.
  const twins={ systems:catalog.systems, games:[{id:'p1',title:'Prey',systemId:'pc',year:2006},{id:'p2',title:'Prey',systemId:'pc',year:2017}] };
  assert.equal(connectLibrary(twins,[copy('d','Prey',2017)],{}).byRelease.p2,undefined);
  // A copy from another year (a remake, a re-release) waits for review.
  assert.equal(connectLibrary(catalog,[copy('c','Half-Life 2',2010)],{}).byRelease.hl2,undefined);
});

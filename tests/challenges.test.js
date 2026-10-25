import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyCommand, ensureTarget } from '../tracking/domain.js';
import { editPlaythrough, writeJournal } from '../tracking/history.js';
import { enableRewards, rewardTransition, rewardTotal, linkRewardIdentity } from '../tracking/rewards.js';
import { createBackup, parseBackup, validateState, mergeBackup, previewMerge } from '../tracking/backup.js';
import { createRepository, RevisionConflict } from '../tracking/persistence.js';
import { confirmIdentity } from '../tracking/compat.js';
import { CHALLENGE_SECTIONS, CHALLENGE_TEMPLATES, challengeCandidates, challengeFacets, previewChallenge, chooseChallengeMember, acceptChallenge, substitutionPreview, archiveChallenge, challengeProgress, validChallengeAward, distinctChallengeGames, sameChallengeGame, challengeListCounts } from '../tracking/challenges.js';

import { reviewLibraryMatch } from '../tracking/matches.js';

const at='2026-09-15T12:00:00.000Z',later='2026-09-15T18:00:00.000Z';let serial=0;
const stamp=(time=later)=>({at:time,eventId:`event-${++serial}`});
function fixture(count=6,rewards=true,names=[]) {
  const library=Array.from({length:count},(_,i)=>({id:`game-${i}`,name:names[i]??`Fictional ${i}`,genres:i%2?['Action']:['Action','RPG'],year:1985+(i%3)*10,hidden:false,
    copies:[{id:`copy-${i}`,platforms:[i<3?'SNES':i===3?'NES':'PlayStation'],sources:['Fixture store'],year:1985+(i%3)*10}]}));
  const catalog={updatedAt:'2026-09-15',systems:[{id:'snes',name:'SNES'},{id:'nes',name:'NES'},{id:'ps1',name:'PlayStation'}],games:library.map((game,i)=>({id:`catalog-${i}`,title:game.name,systemId:i<3?'snes':i===3?'nes':'ps1',year:game.year,genres:game.genres,rank:i+1,...(names[i]?{reviews:{critics:{value:95,count:10,source:'wikipedia'},players:{value:90,count:100}}}:{})}))};
  const context = {catalog,library,state:rewards?enableRewards(emptyState(),{at,timeZone:'Pacific/Tahiti'}):emptyState()};
  library.forEach((game,i)=>{context.state=reviewLibraryMatch(context.state,context,{catalogId:`catalog-${i}`,copyId:`copy-${i}`,decision:'accepted',expected:null,at});});
  return context;
}
const preview=(context,templateId='season',extra={})=>previewChallenge(context,{templateId,...extra},{at,timeZone:'Pacific/Tahiti'});
function accept(context,templateId='season',id=`challenge-${++serial}`,extra={}) {
  const draft=preview(context,templateId,extra);context.state=validateState(acceptChallenge(context.state,draft,{id,revisionId:`rev-${++serial}`,at,confirmed:true}));return context.state.challenges[id];
}
const revision=(context,id)=>context.state.challengeRevisions[context.state.challenges[id].currentRevision];
function update(context,operation,time=later) {const a=stamp(time);context.state=validateState(rewardTransition(context.state,operation(context.state,a),a));}
function start(context,member,id=`play-${++serial}`) {update(context,(s,a)=>applyCommand(s,{...a,type:'start',targetId:member.targetId,playthroughId:id,objective:'main-game',playedSource:member.descriptor.ref,playedPlatforms:member.descriptor.platforms}));return id;}
function finish(context,member,id=start(context,member),time=later) {update(context,(s,a)=>editPlaythrough(s,id,{...a,expected:s.playthroughs[id],fields:{status:'finished',finishedAt:time}}),time);return id;}
function merge(a,b) {const resolutions=Object.fromEntries(previewMerge(a,b).conflicts.map(c=>[`${c.section}/${c.id}`,'current']));return mergeBackup(a,b,resolutions,stamp());}

test('six templates form smaller achievable boards and never require purchases or writes during preview',()=>{
  const context=fixture(1),before=structuredClone(context);
  for(const id of Object.keys(CHALLENGE_TEMPLATES).filter(id=>!CHALLENGE_TEMPLATES[id].list)){const draft=preview(context,id,id==='top'?{system:'snes'}:{});assert.equal(draft.cells.length,1);assert.equal(draft.bonus,CHALLENGE_TEMPLATES[id].points);}
  assert.deepEqual(context,before);assert.equal(preview(fixture(0)).cells.length,0);
  // With all systems, the top ten takes any system's top ten.
  assert.equal(preview(context,'top').cells.length,1);
});

test('the planner filters by store, counts games per system and store, and keeps earlier rules unchanged',()=>{
  const context=fixture(6);context.library[4].copies[0].sources=['Steam'];context.library[5].copies[0].sources=['Steam','Epic'];
  assert.deepEqual(challengeCandidates(context,{store:'Steam'}).map(member=>member.title),['Fictional 4','Fictional 5']);
  assert.equal(preview(context,'season',{store:'Epic'}).rules.store,'Epic');
  assert.ok(!('store' in preview(context,'season').rules));
  const facets=challengeFacets(context,{templateId:'top',store:'Steam'});
  assert.deepEqual(Object.fromEntries(facets.systems.map(item=>[item.id,item.count])),{snes:0,nes:0,ps1:2});
  assert.deepEqual(Object.fromEntries(challengeFacets(context,{templateId:'season',system:'ps1'}).stores.map(item=>[item.id,item.count])),{'Fixture store':0,Steam:2,Epic:1});
  // An all-systems top ten accepts games from each system's own list, and validates.
  const top=preview(context,'top');assert.equal(top.cells.length,3);
  context.state=validateState(acceptChallenge(context.state,top,{id:'top-all',revisionId:'rev-top-all',at,confirmed:true}));
  assert.deepEqual(revision(context,'top-all').cells.map(cell=>cell.member.rank.position),[1,2,3]);
});

test('genre overlap uses maximum matching and multiple copies occupy only one board cell',()=>{
  const context=fixture(2);context.library[0].copies.push({id:'port',platforms:['PlayStation'],sources:['Fixture']});
  const draft=preview(context,'bingo');assert.equal(draft.cells.length,2);
  assert.equal(draft.cells.find(cell=>cell.category==='RPG').member.title,'Fictional 0');
  assert.equal(draft.cells.find(cell=>cell.category==='Action').member.title,'Fictional 1');
  assert.equal(preview(context,'season').cells.length,2);
});

test('owned eligibility excludes hidden, inaccessible, missing, retired and previously finished games',()=>{
  const context=fixture();context.library[0].hidden=true;context.library[1].copies[0].available=false;
  const instance=accept(context);const member=revision(context,instance.id).cells[0].member;finish(context,member);
  const candidates=challengeCandidates(context);assert.ok(candidates.every(member=>!['Fictional 0','Fictional 1'].includes(member.title)));
  assert.ok(!candidates.some(candidate=>candidate.targetId===member.targetId));
  assert.ok(challengeCandidates(context,{templateId:'rediscovery',allowReplays:true}).some(candidate=>candidate.targetId===member.targetId));
  assert.throws(()=>preview(context,'season',{allowReplays:true}),/Only rediscovery/);
  context.library=[];assert.equal(challengeCandidates(context).length,0);assert.ok(context.state.playthroughs);
});

test('decade, console and top-ten criteria use the selected copy and preserve their ranking snapshot',()=>{
  const context=fixture();const draft=preview(context,'top',{system:'snes'});assert.equal(draft.cells.length,3);assert.ok(draft.cells.every(cell=>cell.member.rank.position<=10&&cell.member.platform==='snes'));
  const instance=accept(context,'top','top',{system:'snes'}),frozen=structuredClone(revision(context,instance.id));
  context.catalog.games.forEach(game=>{game.rank=99;game.year=2026;game.genres=['Changed'];});context.catalog.updatedAt='2027-01-01';
  assert.deepEqual(revision(context,instance.id),frozen);assert.equal(preview(context,'top',{system:'snes'}).cells.length,0);
  assert.equal(preview(context,'decades').cells.length,3);assert.equal(preview(context,'passport').cells.length,3);
});

test('new local finishes award a badge and one bonus; corrections, Undo and imports do not duplicate it',()=>{
  const context=fixture(1),instance=accept(context),member=revision(context,instance.id).cells[0].member;
  const play=finish(context,member);assert.equal(challengeProgress(context.state,revision(context,instance.id)).complete,true);assert.equal(rewardTotal(context.state),120);
  const award=Object.values(context.state.challengeAwards)[0];assert.ok(validChallengeAward(context.state,award));
  update(context,(s,a)=>editPlaythrough(s,play,{...a,expected:s.playthroughs[play],fields:{status:'playing'}}));assert.equal(rewardTotal(context.state),0);assert.equal(validChallengeAward(context.state,award),false);
  const event=Object.values(context.state.events).at(-1);update(context,(s,a)=>applyCommand(s,{...a,type:'undo',targetId:member.targetId,undoEventId:event.id}));assert.equal(rewardTotal(context.state),120);
  assert.equal(Object.keys(context.state.challengeAwards).length,1);
  const backup=parseBackup(JSON.stringify(createBackup(context.state,later)),'personal');assert.deepEqual(merge(backup,backup),backup);
});

test('one finish may satisfy different challenge types but imports and rewards activation create no badge',()=>{
  const context=fixture(1,false),a=accept(context,'season'),b=accept(context,'bingo');
  const member=revision(context,a.id).cells[0].member;finish(context,member);assert.equal(Object.keys(context.state.challengeAwards).length,2);assert.equal(rewardTotal(context.state),0);
  context.state=enableRewards(context.state,{at:later,timeZone:'Pacific/Tahiti'});assert.equal(rewardTotal(context.state),0);validateState(context.state);
  assert.ok(challengeProgress(context.state,revision(context,b.id)).complete);
  assert.equal(rewardTotal(merge(emptyState(),context.state)),0);
});

test('milestones show partial progress, require dates, and cannot award challenge completion XP',()=>{
  const context=fixture(1),instance=accept(context),member=revision(context,instance.id).cells[0].member,id=start(context,member);
  const note={entryId:'step',expected:null,kind:'milestone',text:'First island restored',achieved:true,occurredOn:'2026-09-15'};
  update(context,(s,a)=>writeJournal(s,id,{...note,...a}));let result=challengeProgress(context.state,revision(context,instance.id));assert.equal(result.cells[0].milestones,1);assert.equal(result.finished,0);assert.equal(rewardTotal(context.state),0);
  update(context,(s,a)=>writeJournal(s,id,{...note,...a,expected:s.journalEntries.step,deleted:true}));assert.equal(challengeProgress(context.state,revision(context,instance.id)).cells[0].milestones,0);
});

test('substitution preserves other cells, starts a new boundary, and retains an immutable previous revision',()=>{
  const context=fixture(4),instance=accept(context,'top','top',{system:'snes'}),old=structuredClone(revision(context,instance.id));
  finish(context,old.cells[0].member);context.library.push({...context.library[0],id:'extra',name:'Extra',copies:[{id:'extra-copy',platforms:['SNES'],sources:['Fixture']}]});context.catalog.games.push({id:'extra',title:'Extra',systemId:'snes',rank:4,year:1990,genres:['RPG']});
  context.state=reviewLibraryMatch(context.state,context,{catalogId:'extra',copyId:'extra-copy',decision:'accepted',expected:null,at:later});
  let draft=substitutionPreview(context,instance.id,old.cells[1].id,{at:later,timeZone:'Pacific/Tahiti'});
  const replacement=draft.candidates.find(member=>member.title==='Extra');draft=chooseChallengeMember(context.state,draft,old.cells[1].id,replacement.key);
  context.state=validateState(acceptChallenge(context.state,draft,{id:instance.id,previousId:instance.id,revisionId:'sub',reason:'substitution',at:later,confirmed:true}));
  assert.deepEqual(context.state.challengeRevisions[old.id],old);const current=revision(context,instance.id);assert.deepEqual(current.cells[0].boundary,old.cells[0].boundary);
  assert.equal(current.cells[1].boundary.acceptedAt,later);assert.equal(challengeProgress(context.state,current).finished,1);
});

test('regeneration preserves earlier earned badges and cannot stack a second bonus',()=>{
  const context=fixture(1),instance=accept(context,'rediscovery','discovery',{allowReplays:true}),member=revision(context,instance.id).cells[0].member;finish(context,member);
  const award=Object.values(context.state.challengeAwards)[0],draft=previewChallenge(context,{templateId:'rediscovery',allowReplays:true},{at:later,timeZone:'Pacific/Tahiti'});
  context.state=acceptChallenge(context.state,draft,{id:instance.id,previousId:instance.id,revisionId:'regen',reason:'regenerated',at:later,confirmed:true});
  assert.equal(challengeProgress(context.state,revision(context,instance.id)).finished,0);assert.ok(validChallengeAward(context.state,award));
  finish(context,member);assert.equal(rewardTotal(context.state),120);assert.equal(Object.keys(context.state.challengeAwards).length,1);validateState(context.state);
});

test('dated seasons respect the saved timezone and exclude late, unknown and backdated completions',()=>{
  const context=fixture(1),instance=accept(context,'season','dated',{startOn:'2026-09-15',endOn:'2026-09-15'}),member=revision(context,instance.id).cells[0].member;
  const play=start(context,member);finish(context,member,play,'2026-09-16T09:59:00.000Z');assert.equal(challengeProgress(context.state,revision(context,instance.id)).complete,true);
  update(context,(s,a)=>editPlaythrough(s,play,{...a,expected:s.playthroughs[play],fields:{finishedAt:'2026-09-16T10:01:00.000Z'}}),'2026-09-16T11:00:00.000Z');assert.equal(challengeProgress(context.state,revision(context,instance.id)).complete,false);
  const late=fixture(1),season=accept(late,'season','late',{startOn:'2026-09-15',endOn:'2026-09-15'}),m=revision(late,season.id).cells[0].member,p=start(late,m);
  update(late,(s,a)=>editPlaythrough(s,p,{...a,expected:s.playthroughs[p],fields:{status:'finished',finishedAt:later}}),'2026-09-16T12:00:00.000Z');assert.equal(challengeProgress(late.state,revision(late,season.id)).finished,0);
  assert.throws(()=>preview(context,'season',{startOn:'2026-09-20',endOn:'2026-09-19'}),/start and end/);
});

test('a pre-acceptance finish cannot count through replay toggles or reused same-type awards',()=>{
  const context=fixture(1),instance=accept(context,'rediscovery','first',{allowReplays:true}),member=revision(context,instance.id).cells[0].member,play=finish(context,member);
  context.state=archiveChallenge(context.state,instance.id,context.state.challenges[instance.id]);const next=accept(context,'rediscovery','next',{allowReplays:true});
  update(context,(s,a)=>editPlaythrough(s,play,{...a,expected:s.playthroughs[play],fields:{status:'playing'}}));finish(context,member,play);
  assert.equal(challengeProgress(context.state,revision(context,next.id)).finished,0);assert.equal(rewardTotal(context.state),120);
  finish(context,member);assert.equal(rewardTotal(context.state),140);
});

test('duplicate identity corrections cannot fill two slots or preserve an invalid badge',()=>{
  const context=fixture(2),instance=accept(context),cells=revision(context,instance.id).cells;for(const cell of cells)finish(context,cell.member);
  assert.equal(rewardTotal(context.state),240);context.state=linkRewardIdentity(context.state,{...stamp(),first:cells[0].member.targetId,second:cells[1].member.targetId,confirmed:true});validateState(context.state);
  assert.equal(challengeProgress(context.state,revision(context,instance.id)).finished,1);assert.equal(rewardTotal(context.state),100);
  assert.throws(()=>confirmIdentity(context.state,cells[0].member.descriptor,cells[1].member.descriptor,stamp()),/Both releases/);
});

test('new schema reads preserve old data and reject malformed references without mutating input',()=>{
  const old=emptyState();old.schemaVersion=4;for(const section of [...CHALLENGE_SECTIONS,'matchReviews','productReviews','listAwards'])delete old[section];const before=structuredClone(old),migrated=validateState(old);assert.deepEqual(old,before);assert.equal(migrated.schemaVersion,8);for(const section of CHALLENGE_SECTIONS)assert.deepEqual(migrated[section],{});
  const context=fixture(1),instance=accept(context);const bad=structuredClone(context.state);bad.challengeRevisions[instance.currentRevision].cells[0].member.targetId='missing';assert.throws(()=>validateState(bad),/game is missing/);
  assert.throws(()=>parseBackup(JSON.stringify(createBackup(context.state,later)),'sample'),/Sample and personal/);
});

test('acceptance needs a fresh reviewed preview, distinct cells and one active instance per template',()=>{
  const context=fixture(2),draft=preview(context);assert.throws(()=>acceptChallenge(context.state,draft,{id:'a',revisionId:'b',at,confirmed:false}),/Confirm/);
  const stale={...context.state,revision:1};assert.throws(()=>acceptChallenge(stale,draft,{id:'a',revisionId:'b',at,confirmed:true}),/Tracking changed/);
  draft.cells[1].member=structuredClone(draft.cells[0].member);assert.throws(()=>acceptChallenge(context.state,draft,{id:'a',revisionId:'b',at,confirmed:true}),/only one/);
  accept(context);assert.throws(()=>accept(context),/Archive the current/);
});

test('concurrent acceptance and failed reward writes preserve atomic challenge records',async()=>{
  const context=fixture(1);let durable=context.state;
  const adapter={read:async()=>structuredClone(durable),compareAndSwap:async(namespace,revision,next)=>{if(revision!==durable.revision)throw new RevisionConflict();durable=structuredClone(next);return next;}};
  const a=await createRepository({adapter}),b=await createRepository({adapter}),draft=preview(context);
  const results=await Promise.allSettled([a.update(state=>acceptChallenge(state,draft,{id:'a',revisionId:'ra',at,confirmed:true})),b.update(state=>acceptChallenge(state,draft,{id:'b',revisionId:'rb',at,confirmed:true}))]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(Object.keys(durable.challenges).length,1);
  await a.close();await b.close();context.state=durable;const member=revision(context,'a').cells[0].member,id=start(context,member);durable=context.state;
  const failed=await createRepository({adapter:{read:async()=>durable,compareAndSwap:async()=>{throw Error('interrupted');}}});
  const audit=stamp();assert.equal((await failed.update(state=>rewardTransition(state,editPlaythrough(state,id,{...audit,expected:state.playthroughs[id],fields:{status:'finished',finishedAt:later}}),audit))).saved,false);
  assert.equal(Object.keys(durable.challengeAwards).length,0);assert.equal(Object.keys(failed.snapshot().challengeAwards).length,1);assert.equal(rewardTotal(failed.snapshot()),120);await failed.close();
});

test('unmatched copies join a top ten only by an unambiguous title on the same system, as a hint',()=>{
  const context=fixture(3);context.state.matchReviews={};
  // Same title, system and year matches automatically (a confirmed reference); without a year it stays a hint.
  assert.ok(challengeCandidates(context,{templateId:'top'}).every(member=>member.rank.match==='confirmed reference'));
  for(const game of context.library)for(const copy of game.copies)delete copy.year;
  const top=challengeCandidates(context,{templateId:'top'});
  assert.deepEqual(top.map(member=>[member.title,member.rank.position,member.rank.match]),[['Fictional 0',1,'title/platform hint'],['Fictional 1',2,'title/platform hint'],['Fictional 2',3,'title/platform hint']]);
  // A second copy with the same title makes it ambiguous: no hint for either.
  context.library.push({...structuredClone(context.library[0]),id:'game-copy-2',copies:[{...context.library[0].copies[0],id:'copy-dup'}]});
  assert.ok(!challengeCandidates(context,{templateId:'top'}).some(member=>member.title==='Fictional 0'));
});

test('two editions of one game never fill two cells, and pickers list each game once',()=>{
  const context=fixture(3);
  // The same game owned twice under edition names, plus the same list game on two systems.
  context.library[1].name='The Witcher 3: Wild Hunt - Complete Edition';context.library[2].name='The Witcher 3: Wild Hunt – Game of the Year Edition';
  context.library[1].year=context.library[2].year=context.library[1].copies[0].year=context.library[2].copies[0].year=2015;
  const draft=preview(context,'season');
  assert.equal(draft.cells.length,2);
  assert.equal(distinctChallengeGames(context.state,draft.candidates).length,2);
  const witcher=draft.candidates.filter(member=>/Witcher/.test(member.title));
  assert.equal(witcher.length,2);assert.ok(sameChallengeGame(context.state,witcher[0],witcher[1]));
  assert.throws(()=>chooseChallengeMember(context.state,{...draft,cells:[{...draft.cells[0],member:witcher[0]},{...draft.cells[1]}]},draft.cells[1].id,witcher[1].key),/only one challenge cell/);
});

test('a series sampler and a genre history run take owned games from their list',()=>{
  const zelda=['The Legend of Zelda: Ocarina of Time','Zelda II: The Adventure of Link'],context=fixture(3,true,zelda);
  assert.throws(()=>preview(context,'series'),/Choose a series/);
  const draft=preview(context,'series',{list:'zelda'});
  assert.deepEqual(draft.cells.map(cell=>cell.member.title).sort(),[...zelda].sort());
  assert.equal(draft.rules.list,'zelda');assert.equal(draft.bonus,2*CHALLENGE_TEMPLATES.series.points);
  assert.equal(challengeListCounts(context,'series').find(item=>item.id==='zelda').count,2);
  // Accepting and finishing works like any challenge, and the board keeps its list.
  const id='challenge-series';context.state=validateState(acceptChallenge(context.state,draft,{id,revisionId:'rev-series',at,confirmed:true}));
  assert.equal(revision(context,id).rules.list,'zelda');
  for(const cell of revision(context,id).cells)finish(context,cell.member);
  assert.equal(challengeProgress(context.state,revision(context,id)).complete,true);
  // A genre history run takes games from its timeline.
  const history=fixture(3,true,['Super Mario Bros.','Super Metroid']);
  assert.deepEqual(preview(history,'history',{list:'platformer'}).cells.map(cell=>cell.member.title).sort(),['Super Mario Bros.','Super Metroid']);
  assert.equal(preview(history,'history',{list:'fps'}).cells.length,0);
});


import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, ensureTarget, applyCommand } from '../tracking/domain.js';
import { editPlaythrough, writeJournal } from '../tracking/history.js';
import { startReview, reviewWishlist } from '../tracking/wishlist.js';
import { createBackup, parseBackup, validateState, mergeBackup, previewMerge } from '../tracking/backup.js';
import { createRepository, RevisionConflict } from '../tracking/persistence.js';
import { CHALLENGE_SECTIONS } from '../tracking/challenges.js';
import { confirmIdentity } from '../tracking/compat.js';
import { enableRewards, rewardTransition, rewardTotal, reconcileRewards, levelProgress, setRewardPreferences, visibleFrame, linkRewardIdentity, unlinkRewardIdentity, saveWeeklyGoal, weeklyGoalProgress, weekKey, REWARD_SECTIONS } from '../tracking/rewards.js';

const at='2026-09-14T18:00:00.000Z', later='2026-09-15T18:00:00.000Z', today='2026-09-15';
let sequence=0;
const audit=(time=later)=>({at:time,eventId:`event-${++sequence}`});
const desc=id=>({ref:{provider:'manual',id:String(id)},title:`Fictional game ${id}`,platforms:['PC']});
const target=id=>`target:manual:${id}`;
function seed(count=1) { const state=emptyState();for(let i=1;i<=count;i++)ensureTarget(state,desc(i));return enableRewards(state,{at,timeZone:'Pacific/Tahiti'}); }
function transition(state,operation,time=later) { const stamp=audit(time);return validateState(rewardTransition(state,operation(state,stamp),stamp)); }
function start(state,id=1,playId=`play-${id}`) { return transition(state,(s,a)=>applyCommand(s,{...a,type:'start',targetId:target(id),playthroughId:playId,objective:'main-game'})); }
function edit(state,id,fields,time=later) { return transition(state,(s,a)=>editPlaythrough(s,id,{...a,expected:s.playthroughs[id],fields}),time); }
function finish(state,id=1,reflection='',playId=`play-${id}`) { return edit(state,playId,{status:'finished',finishedAt:later,reflection}); }
function journal(state,{id='note',kind='note',achieved=false,occurredOn=today,text='A meaningful objective',deleted=false,playId='play-1'}={}) {
  return transition(state,(s,a)=>writeJournal(s,playId,{...a,entryId:id,expected:s.journalEntries[id]??null,kind,achieved,occurredOn,text,deleted}));
}
// Reviewed games are not due again for a while, so later sessions use other games (offset).
function reviews(state,sessionId,count=10,time=later,offset=0) {
  state=startReview(state,Array.from({length:count},(_,i)=>desc(i+1+offset)),{sessionId,at:time,today:time.slice(0,10)});
  for(const targetId of state.reviewSessions[sessionId].targetIds) state=transition(state,(s,a)=>reviewWishlist(s,{...a,sessionId,targetId,action:'keep',today:time.slice(0,10)}),time);
  return state;
}
function merge(a,b,choice='current') {const resolutions=Object.fromEntries(previewMerge(a,b).conflicts.map(c=>[`${c.section}/${c.id}`,['events','rewardEvidence','rewardAdjustments'].includes(c.section)?'current':choice]));return mergeBackup(a,b,resolutions,audit());}

test('one finish and reflection survive edits, reversal, undo and replay without duplicate core XP',()=>{
  let state=finish(start(seed()),1,'A memorable adventure'); assert.equal(rewardTotal(state),110);
  state=edit(state,'play-1',{reflection:'A revised reflection',minutesPlayed:900}); assert.equal(rewardTotal(state),110);
  state=edit(state,'play-1',{status:'playing'}); assert.equal(rewardTotal(state),0);
  const correction=Object.values(state.events).at(-1);
  state=transition(state,(s,a)=>applyCommand(s,{...a,type:'undo',targetId:target(1),undoEventId:correction.id}));assert.equal(rewardTotal(state),110);
  state=edit(state,'play-1',{status:'playing'});state=finish(state,1,'Restored');assert.equal(rewardTotal(state),110);
  state=finish(start(state,1,'replay'),1,'A replay reflection','replay');assert.equal(rewardTotal(state),120);
  assert.equal(Object.values(state.rewardLedger).filter(entry=>entry.type==='finish'&&entry.amount).length,1);
  assert.ok(Object.values(state.rewardAdjustments).some(entry=>entry.to===0));
  assert.ok(Object.values(state.rewardAdjustments).some(entry=>entry.to===0&&entry.eventIds.some(id=>state.events[id].type==='play-edit')));
});

test('a finish without a date counts as a past finish; future dates and unwritten personal objectives earn nothing',()=>{
  let state=start(seed());state=edit(state,'play-1',{status:'finished',finishedAt:null});assert.equal(rewardTotal(state),100);
  state=edit(state,'play-1',{finishedAt:'2027-01-01T00:00:00.000Z'});assert.equal(rewardTotal(state),0);
  state=edit(state,'play-1',{finishedAt:later,objective:'personal',objectiveText:''});assert.equal(rewardTotal(state),0);
  state=edit(state,'play-1',{objectiveText:'Finish the garden'});assert.equal(rewardTotal(state),100);
  state=edit(state,'play-1',{objective:'unspecified'});assert.equal(rewardTotal(state),100);
  state=edit(state,'play-1',{objective:'main-game'});assert.equal(rewardTotal(state),100);
});

test('enabling rewards and importing old finishes never creates retroactive activity awards',()=>{
  let old=emptyState();ensureTarget(old,desc(1));old=applyCommand(old,{...audit(at),type:'start',targetId:target(1),playthroughId:'old',objective:'main-game'});
  old=editPlaythrough(old,'old',{...audit(at),expected:old.playthroughs.old,fields:{status:'finished',finishedAt:at,reflection:'Existing history'}});
  let state=enableRewards(old,{at:later,timeZone:'Pacific/Tahiti'});assert.equal(rewardTotal(state),0);
  state=edit(state,'old',{status:'playing'});state=finish(state,1,'','old');assert.equal(rewardTotal(state),0);
  state=finish(start(state,1,'replay'),1,'','replay');assert.equal(rewardTotal(state),0);
  const imported=merge(seed(2),old);assert.equal(rewardTotal(imported),0);
  assert.ok(imported.progression.profile.baselineFinishedTargets.includes(target(1)));
  assert.equal(rewardTotal(finish(start(imported,1,'import-replay'),1,'','import-replay')),0);
  // A profile restored onto existing old history also preserves that baseline.
  assert.ok(merge(old,seed()).progression.profile.baselineFinishedTargets.includes(target(1)));
});

test('mastery is a single extra tier after a main-game finish and corrections reverse it',()=>{
  let state=start(seed());state=journal(state,{kind:'mastery',achieved:true});assert.equal(rewardTotal(state),0);
  state=finish(state);assert.equal(rewardTotal(state),150);
  state=journal(state,{id:'extra',kind:'mastery',achieved:true});assert.equal(rewardTotal(state),150);
  state=journal(state,{kind:'mastery',achieved:false});assert.equal(rewardTotal(state),150);
  state=journal(state,{id:'extra',kind:'mastery',achieved:true,deleted:true});assert.equal(rewardTotal(state),100);
  state=journal(state,{kind:'mastery',achieved:true,occurredOn:'2026-09-01'});assert.equal(rewardTotal(state),100);
  state=journal(state,{kind:'mastery',achieved:true});assert.equal(rewardTotal(state),150);
  state=edit(state,'play-1',{status:'retired'});assert.equal(rewardTotal(state),0);
});

test('ten distinct keeps earn one weekly reward, repeat sessions do not and undo adjusts it',()=>{
  // 20 for ten distinct review decisions in a week, plus 2 per decision.
  let state=reviews(seed(10),'first');assert.equal(rewardTotal(state),40);
  const last=Object.values(state.events).at(-1);
  state=transition(state,(s,a)=>applyCommand(s,{...a,type:'undo',targetId:last.targetId,undoEventId:last.id}));assert.equal(rewardTotal(state),18);
  state=transition(state,(s,a)=>reviewWishlist(s,{...a,sessionId:'first',targetId:last.targetId,action:'archive',today}));assert.equal(rewardTotal(state),40);
  state=transition(state,(s,a)=>applyCommand(s,{...a,type:'wishlist',targetId:last.targetId,decision:'interested'}));
  state=reviews(state,'second',10,later,10);assert.equal(rewardTotal(state),60);
  state=reviews(state,'next',10,'2026-09-22T18:00:00.000Z',20);assert.equal(rewardTotal(state),100);
});

test('Monday boundaries are fixed to the saved timezone across midnight and DST',()=>{
  assert.equal(weekKey('2026-09-21T09:59:59.000Z','Pacific/Tahiti'),'2026-09-14');
  assert.equal(weekKey('2026-09-21T10:00:00.000Z','Pacific/Tahiti'),'2026-09-21');
  assert.equal(weekKey('2026-03-09T03:59:59.000Z','America/New_York'),'2026-03-02');
  assert.equal(weekKey('2026-03-09T04:00:00.000Z','America/New_York'),'2026-03-09');
  const incoming=seed();incoming.progression.profile.timeZone='UTC';assert.throws(()=>previewMerge(seed(),incoming),/different timezones/);
});

test('weekly goals require later activity even at identical timestamps; skip/replace costs no XP',()=>{
  let state=start(seed()), stamp=audit();
  state=saveWeeklyGoal(state,{...stamp,slot:0,type:'continue',targetId:target(1),expected:null});
  const id='2026-09-14:0';assert.equal(weeklyGoalProgress(state,state.weeklyGoals[id]).done,false);
  state=journal(state,{occurredOn:null});assert.equal(weeklyGoalProgress(state,state.weeklyGoals[id]).done,false);
  state=journal(state,{id:'dated'});assert.equal(weeklyGoalProgress(state,state.weeklyGoals[id]).done,true);
  state=saveWeeklyGoal(state,{...audit(),slot:0,type:'milestone',targetId:target(1),expected:state.weeklyGoals[id]});
  assert.equal(weeklyGoalProgress(state,state.weeklyGoals[id]).done,false);
  state=journal(state,{id:'step',kind:'milestone',achieved:true});assert.equal(weeklyGoalProgress(state,state.weeklyGoals[id]).done,true);
  state=saveWeeklyGoal(state,{...audit(),slot:0,type:'milestone',targetId:target(1),expected:state.weeklyGoals[id],skipped:true});
  assert.equal(weeklyGoalProgress(state,state.weeklyGoals[id]).status,'Skipped');assert.equal(rewardTotal(state),0);
  assert.throws(()=>saveWeeklyGoal(state,{...audit(),slot:0,type:'review',count:1,expected:null}),/goal changed/);
  assert.throws(()=>saveWeeklyGoal(state,{...audit(),slot:3,type:'review',count:1,expected:null}),/three weekly slots/);validateState(state);
});

test('a review goal counts distinct eligible reviews after acceptance and needs no completion XP',()=>{
  let state=seed(3);state=saveWeeklyGoal(state,{...audit(),slot:1,type:'review',count:3,expected:null});
  state=reviews(state,'session',3);assert.deepEqual(weeklyGoalProgress(state,state.weeklyGoals['2026-09-14:1']),{done:true,count:3,status:'Complete'});assert.equal(rewardTotal(state),6);
});

test('cosmetic levels are configurable, hidden without changing XP, and relock after corrections',()=>{
  // Level 2 starts at 100 XP; level 3 needs 200 more (the curve rises by one step per level).
  let state=finish(start(seed()));assert.deepEqual(levelProgress(state),{total:100,step:100,level:2,within:0,next:200,span:200,title:'Player Two'});
  state=setRewardPreferences(state,{levelStep:100,frame:'brass',visible:true});assert.equal(visibleFrame(state),'brass');
  const hidden=setRewardPreferences(state,{levelStep:100,frame:'brass',visible:false});assert.equal(visibleFrame(hidden),'plain');assert.equal(rewardTotal(hidden),100);
  assert.throws(()=>setRewardPreferences(state,{levelStep:100,frame:'folio',visible:true}),/not unlocked/);
  state=edit(state,'play-1',{status:'playing'});assert.equal(visibleFrame(state),'plain');assert.equal(state.progression.profile.frame,'brass');
  assert.throws(()=>setRewardPreferences(state,{expected:{...state.progression.profile,levelStep:50},levelStep:100,frame:'plain',visible:true}),/preferences changed/);
});

test('explicit duplicate links consolidate core XP with a reversible audit, retaining both histories',()=>{
  const original=finish(start(finish(start(seed(2)),1,'First reflection'),2),2,'Second reflection');assert.equal(rewardTotal(original),220);
  assert.throws(()=>linkRewardIdentity(original,{...audit(),first:target(1),second:target(2)}),/Confirm/);
  const linked=linkRewardIdentity(original,{at:later,eventId:'link',first:target(1),second:target(2),confirmed:true});validateState(linked);
  assert.equal(rewardTotal(linked),120);assert.equal(rewardTotal(original),220);assert.deepEqual(linked.playthroughs,original.playthroughs);
  const repeat=linkRewardIdentity(linked,{...audit(),first:target(1),second:target(2),confirmed:true});assert.equal(rewardTotal(repeat),120);
  const separated=unlinkRewardIdentity(linked,{...audit(),id:'reward-link:link'});assert.equal(rewardTotal(separated),220);validateState(separated);
});

test('goal and reward identity references prevent ordinary linking from discarding a tracked target',()=>{
  let state=seed(2);state=saveWeeklyGoal(state,{...audit(),slot:0,type:'continue',targetId:target(1),expected:null});
  state=linkRewardIdentity(state,{...audit(),first:target(1),second:target(2),confirmed:true});
  assert.throws(()=>confirmIdentity(state,desc(1),desc(2),{at}),/Both releases/);validateState(state);
});

test('backup restores and independently earned duplicate finishes reconcile to one current balance',()=>{
  const base=start(seed()),a=finish(base),b=finish(base);
  assert.equal(rewardTotal(a),100);assert.equal(rewardTotal(b),100);
  const merged=merge(a,b);assert.equal(rewardTotal(merged),100);assert.equal(Object.keys(merged.rewardLedger).length,1);
  const restored=parseBackup(JSON.stringify(createBackup(merged,later)),'personal');assert.deepEqual(restored,merged);
  assert.deepEqual(merge(restored,merged),merged);assert.deepEqual(reconcileRewards(merged,audit()),merged);
  const old=structuredClone(a);for(const section of [...REWARD_SECTIONS,...CHALLENGE_SECTIONS,'matchReviews','productReviews','listAwards'])delete old[section];old.schemaVersion=3;
  assert.equal(rewardTotal(merge(a,validateState(old))),100,'an older snapshot cannot revoke established local evidence');
  const bad=structuredClone(merged);Object.values(bad.rewardLedger)[0].amount=200;assert.throws(()=>validateState(bad),/ledger/);
});

test('schema-three reads are lossless and malformed evidence cannot invent a bonus',()=>{
  const old=emptyState();old.schemaVersion=3;for(const section of [...REWARD_SECTIONS,...CHALLENGE_SECTIONS,'matchReviews','productReviews','listAwards'])delete old[section];const before=structuredClone(old);
  const migrated=validateState(old);assert.deepEqual(old,before);for(const section of REWARD_SECTIONS)assert.deepEqual(migrated[section],{});
  const state=finish(start(seed())),bad=structuredClone(state);Object.values(bad.rewardEvidence)[0].week='2026-01-01';assert.throws(()=>validateState(bad),/week/);
  const badLedger=structuredClone(state);Object.values(badLedger.rewardLedger)[0].sourceIds=[];assert.throws(()=>validateState(badLedger),/different evidence/);
  const badCalendar=structuredClone(state);delete badCalendar.progression.profile.timeZone;assert.throws(()=>validateState(badCalendar),/timezone/);
});

test('concurrent and failed commits preserve atomic progress, evidence and rewards',async()=>{
  let durable=start(seed());
  const adapter={read:async()=>structuredClone(durable),compareAndSwap:async(namespace,revision,next)=>{if(durable.revision!==revision)throw new RevisionConflict();durable=structuredClone(next);return structuredClone(durable);}};
  const a=await createRepository({adapter}),b=await createRepository({adapter});
  const results=await Promise.allSettled([a.update(s=>finish(s)),b.update(s=>finish(s))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(rewardTotal(durable),100);assert.equal(Object.keys(durable.rewardLedger).length,1);validateState(durable);
  const original=structuredClone(durable),failed=await createRepository({adapter:{read:async()=>durable,compareAndSwap:async()=>{throw Error('disk full');}}});
  assert.equal((await failed.update(s=>edit(s,'play-1',{status:'playing'}))).saved,false);assert.deepEqual(durable,original);
  assert.equal(rewardTotal(failed.snapshot()),0);assert.equal(rewardTotal(failed.durableSnapshot()),100);assert.equal(failed.snapshot().playthroughs['play-1'].status,'playing');
  await Promise.all([a.close(),b.close(),failed.close()]);
});

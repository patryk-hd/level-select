import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyCommand, ensureTarget } from '../tracking/domain.js';
import { createBackup, parseBackup, validateState, mergeBackup } from '../tracking/backup.js';
import { patchAnnotation, editsView, confirmIdentity } from '../tracking/compat.js';
import { createRepository } from '../tracking/persistence.js';
import { decideWishlist, startReview, reviewWishlist, activeReview, nextReviewTarget, compareWishlist, acquireWishlist, targetPriceStatus, parseTargetPrice, dueForReview, isSnoozed, acquisitionCandidates, ownedAlternatives } from '../tracking/wishlist.js';

const at='2026-09-14T18:00:00.000Z', today='2026-09-14';
const desc=id=>({ref:{provider:'steam',id:String(id)},title:`Fixture ${id}`,platforms:['PC']});
const decision=(state,id,options={})=>decideWishlist(state,desc(id),{decision:'interested',at,eventId:`decide-${id}`,...options});
function reviewSeed(count=3) { return startReview(emptyState(),Array.from({length:count},(_,i)=>desc(i+1)),{sessionId:'session',at,today}); }
function review(state,action,eventId,fields={}) { return reviewWishlist(state,{sessionId:'session',targetId:nextReviewTarget(state.reviewSessions.session),action,eventId,at,today,...fields}); }

test('schema-one backups and stored workspaces upgrade losslessly without a write on read',async()=>{
  const old=emptyState();old.schemaVersion=1;delete old.reviewSessions;delete old.journalEntries; for (const section of ['progression','rewardEvidence','rewardLedger','rewardAdjustments','rewardLinks','weeklyGoals','challenges','challengeRevisions','challengeEvidence','challengeAwards','matchReviews','productReviews','listAwards']) delete old[section];
  const original=structuredClone(old);
  const upgraded=parseBackup(JSON.stringify({format:'retro-library-tracking',version:1,exportedAt:at,state:old}),'personal');
  assert.equal(upgraded.schemaVersion,8);assert.deepEqual(upgraded.reviewSessions,{});assert.deepEqual(old,original);
  const adapter={read:async()=>structuredClone(old),compareAndSwap:async()=>{throw Error('interrupted');}};
  const repository=await createRepository({adapter});
  assert.equal(repository.snapshot().schemaVersion,8);assert.deepEqual(old,original);
  assert.equal((await repository.update(state=>startReview(state,[desc(1)],{sessionId:'session',at,today}))).saved,false);
  assert.equal(repository.durableSnapshot().reviewSessions.session,undefined);
  assert.ok(repository.snapshot().reviewSessions.session);await repository.close();
});

test('wishlist metadata and notes survive archive, restore and acquisition independently',()=>{
  let state=patchAnnotation(emptyState(),desc(1),{notes:'Keep original notes'});
  state=decision(state,1,{fields:{priority:3,reason:'Wait for a quiet weekend',targetPrice:{amountMinor:1500,currency:'GBP'},reviewOn:'2026-10-01',snoozeUntil:null}});
  const id=ensureTarget(state,desc(1)).id;
  state=applyCommand(state,{type:'wishlist',targetId:id,decision:'archived',at,eventId:'archive'});
  assert.ok(editsView(state).removed[1]);assert.equal(state.wishlist[id].priority,3);
  state=applyCommand(state,{type:'wishlist',targetId:id,decision:'interested',at,eventId:'restore'});
  state=acquireWishlist(state,desc(1),{confirmed:true,acquiredAt:null,handoff:'library',at,eventId:'acquire'});
  assert.equal(state.wishlist[id].decision,'acquired');assert.equal(state.wishlist[id].reason,'Wait for a quiet weekend');
  assert.equal(editsView(state).removed[1],undefined);assert.equal(editsView(state).notes[1],'Keep original notes');
  assert.equal(Object.keys(state.backlog).length,0);assert.equal(Object.keys(state.playthroughs).length,0);
  assert.equal(state.ownership['acquired:steam:1'].acquiredAt,null);validateState(state);
});

test('reviews freeze at ten distinct due games and every keep counts exactly once',()=>{
  let state=startReview(emptyState(),[desc(1),desc(1),...Array.from({length:15},(_,i)=>desc(i+2))],{sessionId:'session',at,today});
  const session=state.reviewSessions.session;assert.equal(session.targetIds.length,10);
  const first=nextReviewTarget(session);
  state=review(state,'keep','review-1');assert.equal(Object.keys(state.reviewSessions.session.reviewed).length,1);
  assert.throws(()=>reviewWishlist(state,{sessionId:'session',targetId:first,action:'keep',eventId:'repeat',at,today}),/moved/);
  assert.throws(()=>startReview(state,[desc(30)],{sessionId:'another',at,today}),/Resume/);
  for(let i=2;i<=10;i++)state=review(state,'keep',`review-${i}`);
  assert.equal(activeReview(state),null);assert.equal(state.reviewSessions.session.completedAt,at);
  assert.equal(Object.keys(editsView(state).removed).length,0);validateState(state);
});

test('review undo restores the previous decision and count; repeated restore does not duplicate progress',()=>{
  let state=reviewSeed(1);state=review(state,'archive','review-1');
  const id=state.reviewSessions.session.targetIds[0];
  state=applyCommand(state,{type:'undo',targetId:id,undoEventId:'review-1',at,eventId:'undo'});
  assert.equal(state.wishlist[id],undefined);assert.equal(state.reviewSessions.session.completedAt,null);assert.deepEqual(state.reviewSessions.session.reviewed,{});
  state=review(state,'wait-for-price','review-2',{targetPrice:{amountMinor:1000,currency:'GBP'}});
  const backup=parseBackup(JSON.stringify(createBackup(state,at)),'personal');
  const restored=mergeBackup(emptyState(),backup);assert.deepEqual(mergeBackup(restored,backup),restored);
  assert.equal(Object.keys(restored.reviewSessions.session.reviewed).length,1);assert.equal(Object.keys(restored.events).length,3);
  const reordered=structuredClone(restored);
  reordered.wishlist[id]=Object.fromEntries(Object.entries(reordered.wishlist[id]).reverse());
  reordered.wishlist[id].targetPrice=Object.fromEntries(Object.entries(reordered.wishlist[id].targetPrice).reverse());
  const corrected=structuredClone(reordered);corrected.wishlist[id].targetPrice.amountMinor=1;
  const undo={type:'undo',targetId:id,undoEventId:'review-2',at,eventId:'undo-2'};
  assert.throws(()=>applyCommand(corrected,undo),/decision has changed/);
  assert.equal(applyCommand(reordered,undo).wishlist[id],undefined);
  const wrong=structuredClone(state);wrong.reviewSessions.session.reviewed[id]='review-1';assert.throws(()=>validateState(wrong),/undone review/);
});

test('reviews and manual edits reject stale decisions without partial changes',()=>{
  let state=reviewSeed(2), id=nextReviewTarget(state.reviewSessions.session);
  state=decision(state,1,{decision:'want-soon'});const before=structuredClone(state);
  assert.throws(()=>reviewWishlist(state,{sessionId:'session',targetId:id,action:'archive',expected:null,eventId:'stale',at,today}),/changed in another tab/);
  assert.deepEqual(state,before);
  assert.throws(()=>compareWishlist(state,[desc(1),desc(2)],{choice:'both',expected:[state.wishlist[id],{stale:true}],eventId:'pair',at}),/changed in another tab/);
  assert.deepEqual(state,before);
});

test('snooze and review dates are calendar dates and skipped by new sessions until due',()=>{
  let state=decision(emptyState(),1,{fields:{snoozeUntil:'2026-09-15',reviewOn:'2026-09-16'}});
  const entry=Object.values(state.wishlist)[0];assert.equal(isSnoozed(entry,today),true);assert.equal(isSnoozed(entry,'2026-09-15'),false);
  assert.equal(dueForReview(entry,'2026-09-15'),false);assert.equal(dueForReview(entry,'2026-09-16'),true);
  state=startReview(state,[desc(1),desc(2)],{sessionId:'session',at,today});assert.equal(state.reviewSessions.session.targetIds.length,1);
  assert.throws(()=>review(state,'snooze','bad',{snoozeUntil:today}),/future/);
  state=review(state,'snooze','later',{snoozeUntil:'2026-09-21'});validateState(state);
  assert.throws(()=>decision(emptyState(),1,{fields:{reviewOn:'2026-02-30'}}),/calendar date/);
});

test('comparison choices preserve notes and never archive the unchosen game',()=>{
  for(const choice of ['a','b','both','neither','skip']) {
    let state=patchAnnotation(emptyState(),desc(1),{notes:'Personal note'});const before=structuredClone(state);
    state=compareWishlist(state,[desc(1),desc(2)],{choice,expected:[null,null],at,eventId:'pair'});
    if(choice==='skip')assert.deepEqual(state,before);
    else for(const [index,id] of ['1','2'].entries())assert.equal(state.wishlist[ensureTarget(state,desc(id)).id].decision,choice==='both'||choice===(index===0?'a':'b')?'want-soon':'maybe');
    assert.equal(editsView(state).notes[1],'Personal note');assert.equal(Object.keys(editsView(state).removed).length,0);validateState(state);
  }
  assert.throws(()=>compareWishlist(emptyState(),[desc(1),desc(1)],{choice:'both',at,eventId:'pair'}),/distinct/);
});

test('acquisition requires edition confirmation, honors the chosen handoff and cannot duplicate ownership',()=>{
  assert.throws(()=>acquireWishlist(emptyState(),desc(1),{at,eventId:'bad'}),/Confirm/);
  for(const handoff of ['library','backlog','upnext']) {
    const state=acquireWishlist(emptyState(),desc(1),{confirmed:true,acquiredAt:at,handoff,at,eventId:'acquire'}),id=ensureTarget(state,desc(1)).id;
    assert.equal(Boolean(state.backlog[id]),handoff!=='library');assert.equal(Boolean(state.backlog[id]?.upNext),handoff==='upnext');
    assert.equal(Object.keys(state.playthroughs).length,0);assert.equal(Object.keys(state.ownership).length,1);
    assert.throws(()=>acquireWishlist(state,desc(1),{confirmed:true,at,eventId:'again'}),/already recorded/);validateState(state);
  }
});

test('price checks require a known recent date, matching currency and an actual amount',()=>{
  const entry={targetPrice:parseTargetPrice('15.00','GBP')},snapshot={amountMinor:1500,currency:'GBP',observedAt:at};
  assert.equal(targetPriceStatus(entry,snapshot,at).code,'met');
  assert.equal(targetPriceStatus(entry,{...snapshot,amountMinor:1501},at).code,'above');
  assert.equal(targetPriceStatus(entry,{...snapshot,currency:'USD'},at).code,'currency');
  for(const change of [{observedAt:null},{observedAt:'bad'},{observedAt:'2026-09-14'},{observedAt:'09/14/2026'},{observedAt:'2026-09-15T18:00:00.000Z'},{amountMinor:null}])assert.equal(targetPriceStatus(entry,{...snapshot,...change},at).code,'unknown');
  assert.equal(targetPriceStatus(entry,{...snapshot,observedAt:'2026-09-07T17:59:59.000Z'},at).code,'stale');
  assert.equal(targetPriceStatus({targetPrice:{amountMinor:0,currency:'GBP'}},{...snapshot,amountMinor:0},at).code,'met');
  assert.deepEqual(parseTargetPrice('1500','JPY'),{amountMinor:1500,currency:'JPY'});
  for(const amount of ['-1','1.999','Infinity','1e2'])assert.throws(()=>parseTargetPrice(amount,'GBP'));
  assert.throws(()=>parseTargetPrice('12.5','JPY'));
});

test('owned alternative and acquisition hints distinguish platforms, editions, and exact Steam IDs',()=>{
  const wanted={appid:'101',title:'Fixture Remaster',genres:['RPG']};
  const library=[{id:'retro',name:'Fixture Original',steamAppId:'101',platforms:['SNES'],genres:['RPG'],copies:[{id:'retro-copy',platforms:['SNES'],sources:['Steam']}]},
    {id:'pc',name:'Fixture Remaster',steamAppId:'102',platforms:['Windows'],genres:['RPG'],copies:[{id:'pc-copy',platforms:['Windows'],sources:['Steam']}]}];
  assert.equal(acquisitionCandidates(wanted,library).length,0);
  library[1].steamAppId='101';assert.equal(acquisitionCandidates(wanted,library)[0].copyId,'pc-copy');
  const state=emptyState(),before=structuredClone(state),alternatives=ownedAlternatives(wanted,{state,library,catalog:{systems:[],games:[]}});
  assert.ok(alternatives.find(choice=>choice.title==='Fixture Original').platformReason.includes('another platform'));
  assert.deepEqual(state,before);assert.equal(Object.keys(state.wishlist).length,0);
});

test('review membership prevents identity linking from orphaning a queued review target',()=>{
  const state=reviewSeed(1),other={ref:{provider:'playnite',id:'owned-copy'},title:'Fixture 1',platforms:['PC']};
  const id=ensureTarget(state,other).id;state.backlog[id]={targetId:id,priority:0,queuedAt:at};
  assert.throws(()=>confirmIdentity(state,desc(1),other,{at}),/Both releases/);
  validateState(state);
});

test('reviewed games are not due again straight away: keep in 90 days, buy soon and wait in 30', async () => {
  const { emptyState } = await import('../tracking/domain.js');
  const { startReview, reviewWishlist, entryFor } = await import('../tracking/wishlist.js');
  const today = '2026-09-29', at = '2026-09-29T10:00:00.000Z';
  const descs = ['1', '2', '3', '4'].map(id => ({ ref: { provider: 'steam', id }, title: `Game ${id}`, platforms: ['PC'] }));
  let state = startReview(emptyState(), descs, { sessionId: 's1', at, today });
  for (const [index, action] of ['keep', 'want-soon', 'wait-for-price', 'archive'].entries()) {
    const targetId = state.reviewSessions.s1.targetIds[index];
    state = reviewWishlist(state, { sessionId: 's1', targetId, action, expected: null, at, today, eventId: `e${index}` });
  }
  assert.deepEqual(descs.map(desc => entryFor(state, desc.ref).reviewOn ?? null), ['2026-12-28', '2026-10-29', '2026-10-29', null]);
  assert.throws(() => startReview(state, descs, { sessionId: 's2', at, today }), /No games are due/);
  const later = startReview(state, descs, { sessionId: 's3', at, today: '2026-10-29' });
  assert.equal(later.reviewSessions.s3.targetIds.length, 2);
});

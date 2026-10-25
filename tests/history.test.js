import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, ensureTarget, applyCommand } from '../tracking/domain.js';
import { editPlaythrough, writeJournal, planStats, membershipChanges, historyRows, selectHistory, yearSummary } from '../tracking/history.js';
import { validateState, createBackup, parseBackup, mergeBackup } from '../tracking/backup.js';
import { ingestOwned } from '../tracking/legacy.js';
import { setUpNext, progress } from '../tracking/compat.js';

const at = '2026-09-14T18:00:00.000Z', later = '2026-09-15T18:00:00.000Z';
const desc = id => ({ ref: { provider: 'manual', id: String(id) }, title: `Fixture ${id}`, platforms: ['snes'] });
function seed(count = 1) {
  let state = emptyState();
  for (let id = 1; id <= count; id++) {
    const target = ensureTarget(state, desc(id));
    state = applyCommand(state, { type: 'queue', targetId: target.id, at, eventId: `queue-${id}` });
    state = applyCommand(state, { type: 'start', targetId: target.id, playthroughId: `play-${id}`, at, eventId: `start-${id}`, playedSource: desc(id).ref, playedPlatforms: ['snes'] });
  }
  return state;
}
function edit(state, id, fields, eventId = `edit-${id}`, time = later) {
  return editPlaythrough(state, id, { expected: state.playthroughs[id], fields, at: time, eventId });
}
function finish(state, id, fields = {}) { return edit(state, `play-${id}`, { status: 'finished', finishedAt: later, ...fields }); }

test('a six-game plan with three finishes and a retirement is 3/6; imports cannot change it', () => {
  let state = seed(6);
  for (const id of [1,2,3]) state = finish(state,id);
  state = edit(state,'play-4',{ status: 'retired', endedAt: later });
  assert.deepEqual(planStats(state), { total:6, finished:3, retired:1, remaining:2, completion:0.5 });
  const imported = ingestOwned(state,[{name:'An imported game',copies:[{id:'copy-1',platforms:['PC'],sources:['Steam'],playtimeSeconds:9000000,played:true}]}]);
  assert.deepEqual(planStats(imported),planStats(state)); assert.deepEqual(imported.playthroughs,state.playthroughs);
  const removed = applyCommand(state,{type:'unqueue',targetId:state.playthroughs['play-6'].targetId,at:later,eventId:'remove'});
  assert.equal(planStats(removed).total,5); assert.equal(planStats(removed).completion,3/5);
  validateState(imported); validateState(removed);
});

test('corrections and undo update the same card and statistics without duplicating a playthrough', () => {
  let state = finish(seed(),1,{minutesPlayed:90,rating:0,reflection:'My first finish'});
  state = edit(state,'play-1',{status:'retired',endedAt:later,reflection:'Stopped before my objective'},'correct');
  assert.equal(planStats(state).finished,0); assert.equal(planStats(state).retired,1);
  assert.equal(state.playthroughs['play-1'].finishedAt,null); assert.equal(Object.keys(state.playthroughs).length,1);
  state = applyCommand(state,{type:'undo',targetId:state.playthroughs['play-1'].targetId,undoEventId:'correct',at:later,eventId:'undo'});
  assert.equal(planStats(state).finished,1); assert.equal(historyRows(state)[0].play.reflection,'My first finish');
  assert.equal(historyRows(state)[0].play.rating,0); validateState(state);
});

test('replays keep earlier cards and use stable order even after correcting historical dates', () => {
  let state = finish(seed(),1);
  state = setUpNext(state,desc(1),true,{at:later,eventId:'replay'});
  assert.equal(planStats(state).remaining,1); assert.equal(selectHistory(historyRows(state)).length,1);
  state = applyCommand(state,{type:'status',targetId:state.playthroughs['play-1'].targetId,playthroughId:'planned:replay',status:'playing',at:later,eventId:'resume'});
  assert.throws(()=>edit(state,'play-1',{status:'playing'},'reopen'),/Another playthrough is active/);
  state = edit(state,'planned:replay',{status:'finished',finishedAt:later},'finish-replay');
  assert.equal(selectHistory(historyRows(state)).length,2); assert.equal(planStats(state).finished,1);
  state = edit(state,'play-1',{status:'retired',endedAt:later},'correct-old');
  assert.equal(progress(state,state.playthroughs['play-1'].targetId),'finished');
  assert.equal(state.playthroughs['planned:replay'].playedSource.id,'1'); validateState(state);
  const older = structuredClone(state);
  for (const play of Object.values(older.playthroughs)) delete play.ordinal;
  older.playthroughs['play-1'].startedAt = later;
  assert.equal(progress(older,older.playthroughs['play-1'].targetId),'finished');
});

test('old schema workspaces and backups keep unknown dates and receive only an empty journal section', () => {
  const old = seed(); old.schemaVersion = 2; delete old.journalEntries; for (const section of ['progression','rewardEvidence','rewardLedger','rewardAdjustments','rewardLinks','weeklyGoals','challenges','challengeRevisions','challengeEvidence','challengeAwards','matchReviews','productReviews','listAwards']) delete old[section];
  const play = old.playthroughs['play-1']; play.historical = true; play.status = 'finished'; play.startedAt = null; play.finishedAt = null;
  const before = structuredClone(old), state = validateState(old);
  assert.equal(state.schemaVersion,8); assert.deepEqual(state.journalEntries,{}); assert.deepEqual(old,before);
  assert.deepEqual(state.playthroughs,old.playthroughs);
  assert.equal(selectHistory(historyRows(state),{year:'unknown'}).length,1);
  assert.equal(selectHistory(historyRows(state),{year:'2026'}).length,0);
  const restored = parseBackup(JSON.stringify({format:'retro-library-tracking',version:2,exportedAt:at,state:old}),'personal');
  assert.deepEqual(restored,state);
});

test('year summaries use local finish dates and explicit per-playthrough time, including zero values', () => {
  let state = seed(3);
  state = finish(state,1,{finishedAt:'2027-01-01T02:00:00.000Z',minutesPlayed:0});
  state = finish(state,2,{finishedAt:'2027-01-01T02:00:00.000Z',minutesPlayed:120});
  state = finish(state,3,{finishedAt:null});
  const rows = historyRows(state);
  assert.equal(selectHistory(rows,{year:'2026'},'Pacific/Tahiti').length,2);
  assert.equal(selectHistory(rows,{year:'2027'},'UTC').length,2);
  assert.deepEqual(yearSummary(rows,'2026','Pacific/Tahiti'),{finished:2,retired:0,minutesPlayed:120,timeRecords:2,unknownDates:1});
  assert.equal(selectHistory(rows,{platform:'dos'}).length,0);
  assert.equal(selectHistory(rows,{q:'fixture 1'}).length,1);
});

test('membership changes count explicit additions/removals and corrections, not priority edits or finishes', () => {
  let state = finish(seed(),1), targetId = state.playthroughs['play-1'].targetId;
  state = applyCommand(state,{type:'queue',targetId,priority:3,at:later,eventId:'priority'});
  state = setUpNext(state,desc(1),true,{at:later,eventId:'next'});
  state = setUpNext(state,desc(2),true,{at:later,eventId:'next-2'});
  state = applyCommand(state,{type:'unqueue',targetId,at:later,eventId:'remove'});
  assert.deepEqual(membershipChanges(state),{added:2,removed:1,net:1,unknown:0});
  state = applyCommand(state,{type:'undo',targetId,undoEventId:'remove',at:later,eventId:'undo-remove'});
  assert.deepEqual(membershipChanges(state),{added:3,removed:1,net:2,unknown:0});
  delete state.events['next-2'].details.previous;
  assert.equal(membershipChanges(state).unknown,1);
});

test('notes and milestones are scoped to a playthrough, correctable, restorable and stale-write protected', () => {
  let state = seed(), entry = {entryId:'note',expected:null,kind:'note',text:'First session',occurredOn:null,at,eventId:'note-add'};
  state = writeJournal(state,'play-1',entry);
  const before = structuredClone(state);
  assert.throws(()=>writeJournal(state,'play-1',{...entry,text:'Stale',eventId:'stale'}),/changed in another tab/);
  assert.deepEqual(state,before);
  state = writeJournal(state,'play-1',{...entry,expected:state.journalEntries.note,kind:'milestone',achieved:true,text:'Reached the island',occurredOn:'2026-09-14',eventId:'milestone'});
  state = writeJournal(state,'play-1',{...state.journalEntries.note,entryId:'note',expected:state.journalEntries.note,deleted:true,at:later,eventId:'hide'});
  assert.equal(state.journalEntries.note.deletedAt,later);
  state = writeJournal(state,'play-1',{...state.journalEntries.note,entryId:'note',expected:state.journalEntries.note,deleted:false,at:later,eventId:'restore'});
  assert.equal(state.journalEntries.note.deletedAt,null); assert.equal(Object.keys(state.journalEntries).length,1);
  assert.equal(Object.keys(state.events).filter(id=>['note-add','milestone','hide','restore'].includes(id)).length,4); validateState(state);
});

test('history backups round-trip, repeated merges do not duplicate cards or journals, malformed references reject', () => {
  let state = finish(seed(),1,{reflection:'A personal reflection',minutesPlayed:100,rating:4.5});
  state = writeJournal(state,'play-1',{entryId:'note',expected:null,kind:'note',text:'A session',at,eventId:'note-add'});
  const restored = parseBackup(JSON.stringify(createBackup(state,later)),'personal');
  assert.deepEqual(restored,state); assert.deepEqual(mergeBackup(restored,state),state);
  assert.equal(selectHistory(historyRows(restored)).length,1);
  const bad = structuredClone(state);bad.journalEntries.note.playthroughId='missing';assert.throws(()=>validateState(bad),/Journal event|Journal entry/);
  assert.throws(()=>parseBackup(JSON.stringify(createBackup(state,later)),'sample'),/Sample and personal/);
});

test('invalid times, ratings, objectives, dates and stale completion edits leave state unchanged', () => {
  const state = seed(), before = structuredClone(state);
  for (const fields of [{minutesPlayed:-1},{minutesPlayed:1.5},{rating:5.5},{rating:3.2},{reflection:4},{objective:'everything'},{finishedAt:'bad'},{status:'finished',finishedAt:'2025-01-01T00:00:00.000Z'}]) assert.throws(()=>edit(state,'play-1',fields));
  const changed = edit(state,'play-1',{reflection:'New version'});
  assert.throws(()=>editPlaythrough(changed,'play-1',{expected:state.playthroughs['play-1'],fields:{status:'finished'},at,eventId:'stale'}),/changed in another tab/);
  assert.deepEqual(state,before);
  assert.throws(()=>writeJournal(state,'play-1',{entryId:'bad',expected:null,kind:'note',text:'Note',occurredOn:'2026-02-30',at,eventId:'bad'}),/calendar date/);
  assert.deepEqual(planStats(emptyState()),{total:0,finished:0,retired:0,remaining:0,completion:null});
});

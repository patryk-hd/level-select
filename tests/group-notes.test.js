import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, ensureTarget, applyCommand } from '../tracking/domain.js';
import { patchAnnotation, editsView } from '../tracking/compat.js';
import { ingestOwned, migrateLegacy } from '../tracking/legacy.js';
import { preservedGroupNotes, copyGroupNotes } from '../tracking/group-notes.js';
import { createBackup, parseBackup } from '../tracking/backup.js';

const at='2026-09-19T12:00:00.000Z';
const ancestor={id:'old',name:'Same title',copyIds:['original','reboot'],notes:'Old shared note',favorite:true,hidden:true};
const library=['original','reboot'].map(id=>({id:`new-${id}`,name:'Same title',platforms:['PC'],notes:'',legacyGroups:[ancestor],copies:[{id,name:`${id} title`,platforms:['PC'],sources:['Steam']}]}));
const oldDesc={ref:{provider:'legacy-owned',id:'old'},title:'Old group',platforms:['PC']};

test('split groups expose original notes without inheriting flags or changing copy histories',()=>{
  let state=ingestOwned(emptyState(),library);
  state=patchAnnotation(state,oldDesc,{notes:'Browser note',favorite:true,hidden:true});
  const target=ensureTarget(state,{ref:{provider:'playnite',id:'original'},title:'Original',platforms:['PC']});
  state=applyCommand(state,{type:'start',targetId:target.id,eventId:'started',playthroughId:'play',at});
  const original=structuredClone(state);
  const source=preservedGroupNotes(state,library[0])[0];
  assert.equal(source.notes,'Browser note');
  assert.equal(editsView(state).overrides['new-original'],undefined);
  const copied=copyGroupNotes(state,library,{gameId:'new-original',legacyId:'old',expectedSource:source,expectedNotes:''});
  assert.deepEqual(state,original);
  assert.equal(copied.annotations['owned:new-original'].notes,'Browser note');
  assert.equal(copied.annotations['owned:new-original'].hidden,undefined);
  assert.equal(copied.annotations['owned:new-original'].favorite,undefined);
  assert.equal(copied.annotations['owned:new-reboot'],undefined);
  assert.deepEqual(copied.annotations['owned:old'],state.annotations['owned:old']);
  for(const field of ['playthroughs','events','backlog','ownership','matchReviews','productReviews','rewardLedger'])assert.deepEqual(copied[field],state[field]);
  const roundtrip=parseBackup(JSON.stringify(createBackup(copied,at)), 'personal');
  assert.equal(roundtrip.annotations['owned:new-original'].notes,'Browser note');
  assert.equal(preservedGroupNotes(roundtrip,library[1])[0].notes,'Browser note');
  assert.equal(roundtrip.targets['target:playnite:original'].title,'original title');
});

test('copying notes appends and rejects stale source/destination or unrelated groups',()=>{
  let state=emptyState();
  const options={gameId:'new-original',legacyId:'old',expectedSource:preservedGroupNotes(state,library[0])[0],expectedNotes:''};
  state=copyGroupNotes(state,library,options);
  assert.throws(()=>copyGroupNotes(state,library,options),/changed in another tab/);
  state=copyGroupNotes(state,library,{...options,expectedNotes:'Old shared note'});
  assert.equal(state.annotations['owned:new-original'].notes,'Old shared note\n\nOld shared note');
  state=patchAnnotation(state,oldDesc,{notes:'Changed elsewhere'});
  assert.throws(()=>copyGroupNotes(state,library,{...options,expectedNotes:'Old shared note\n\nOld shared note'}),/preserved group changed/);
  assert.throws(()=>copyGroupNotes(emptyState(),library,{...options,legacyId:'not-related'}),/preserved group changed/);
});

test('legacy migration and restore keep old group identity after a split',()=>{
  const state=migrateLegacy(emptyState(),{overrides:{old:{notes:'Preserved',hidden:true}}},{library,at}).state;
  assert.equal(state.targets['target:legacy-owned:old'].title,'Same title');
  assert.equal(state.targets['target:legacy-owned:old'].unresolved,false);
  assert.equal(state.annotations['owned:old'].notes,'Preserved');
  assert.equal(Object.keys(state.playthroughs).length,0);
  assert.equal(editsView(state).overrides['new-original'],undefined);
});

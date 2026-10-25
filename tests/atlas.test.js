import test from 'node:test';
import assert from 'node:assert/strict';
import { platformSummary } from '../tracking/atlas.js';
const ref = id => ({ provider:'playnite', id });
const copy = (id, source, platforms=['Windows']) => ({ id, sources:[source], platforms });
const library = [
  { id:'one', copies:[copy('steam','Steam'),copy('gog','GOG.com'),copy('steam2','Steam')] },
  { id:'two', copies:[copy('epic','Epic Games Store')] },
  { id:'console', copies:[copy('console','Steam',['PS4'])] },
];
test('platform totals deduplicate copies and finishes stay with the played storefront',()=>{
  const state={targets:{one:{refs:[ref('steam'),ref('gog'),ref('steam2')]},two:{refs:[ref('epic')]}},playthroughs:{
    first:{targetId:'one',status:'finished',playedSource:ref('steam')},
    replay:{targetId:'one',status:'playing',playedSource:ref('gog')},
    secondFinish:{targetId:'one',status:'finished',playedSource:ref('steam')},
    legacy:{targetId:'two',status:'finished'},
  }};
  assert.deepEqual(platformSummary(state,library,{platform:'pc'}),{total:2,completed:2});
  assert.deepEqual(platformSummary(state,library,{platform:'pc',source:'store:steam'}),{total:1,completed:1});
  assert.deepEqual(platformSummary(state,library,{platform:'pc',source:'store:gog'}),{total:1,completed:0});
  state.playthroughs.first.status='playing';state.playthroughs.secondFinish.status='retired';
  assert.deepEqual(platformSummary(state,library,{platform:'pc',source:'store:steam'}),{total:1,completed:0});
});
test('unknown attribution, catalog finishes and imported playtime do not imply a storefront completion',()=>{
  const state={targets:{one:{refs:[ref('steam'),ref('gog'),{provider:'catalog',id:'release'}]}},playthroughs:{
    ambiguous:{targetId:'one',status:'finished'},
    catalog:{targetId:'one',status:'finished',playedSource:{provider:'catalog',id:'release'}},
    invalid:{targetId:'one',status:'finished',playedSource:ref('epic')},
  }};
  assert.deepEqual(platformSummary(state,library,{platform:'pc'}),{total:2,completed:0});
  assert.deepEqual(platformSummary(state,[],{platform:'pc'}),{total:0,completed:0});
});

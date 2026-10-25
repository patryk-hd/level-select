import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importedEvidence, validateEvidence, ownedRating, steamApproval, wilsonLowerBound, compareSteam, eligibleSteamRank } from '../ranking/evidence.js';
import { copyEvidenceHtml, approvalEvidenceHtml } from '../ranking/ui.js';

const original = { id: 'original', platforms: ['SNES'], sources: ['Local'], criticScore: 70, communityScore: 80, userScore: 100 };
const port = { id: 'port', platforms: ['PC'], sources: ['Steam'], criticScore: 95, communityScore: 99, userScore: 50 };

test('personal, critic and community evidence stay separate and carry copy references', () => {
  const observations = importedEvidence(original).map(validateEvidence);
  assert.deepEqual(observations.map(item => item.original.value), [70, 80, 100]);
  assert.ok(observations.every(item => item.scope.ref.id === 'original' && item.dates.observedAt === null && item.source.family === null));
  assert.equal(observations[2].type, 'personal-rating');
  assert.equal(ownedRating({copies:[original]}, 'critic').value, 70);
  assert.equal(ownedRating({copies:[original]}, 'personal').value, 100);
});

test('grouped copies cannot transfer port ratings and filters must identify the same copy', () => {
  const game = { copies: [original, port], bestScore: 100 };
  assert.equal(ownedRating(game).value, null);
  assert.equal(ownedRating(game, 'critic', {platform:'SNES'}).value, 70);
  assert.equal(ownedRating(game, 'critic', {platform:'PC', source:'Steam'}).value, 95);
  assert.equal(ownedRating(game, 'critic', {platform:'SNES', source:'Steam'}).value, null);
  assert.equal(ownedRating({copies:[original,{...original,id:'second'}]}).value, null);
});

test('legacy maxima remain labeled and never masquerade as known score components', () => {
  const copy = { id: 'old', platforms: ['PS1'], bestScore: 91 };
  assert.equal(ownedRating({copies:[copy]},'critic').value, null);
  assert.equal(ownedRating({copies:[copy]},'legacy').value, 91);
  assert.equal(importedEvidence(copy)[0].type, 'legacy-unspecified');
  assert.equal(importedEvidence({...copy,criticScore:null,userScore:null,communityScore:null}).some(item=>item.lane==='legacy'),false);
  assert.match(copyEvidenceHtml(copy), /Reimport the original Playnite CSV/);
});

test('zero is distinct from missing and invalid numeric values remain visible only as raw input', () => {
  for (const value of [null, -1, 101, Infinity, '99', false]) {
    const evidence = importedEvidence({...original,criticScore:value})[0];
    assert.equal(evidence.original.value, null);
    validateEvidence(evidence);
  }
  assert.equal(ownedRating({copies:[{...original,criticScore:0}]}).value,0);
  const evidence = importedEvidence(original)[0];
  assert.throws(()=>validateEvidence({...evidence,original:{...evidence.original,positive:9,negative:2,count:10}}));
  assert.throws(()=>validateEvidence({...evidence,dates:{...evidence.dates,observedAt:'yesterday'}}));
  assert.throws(()=>validateEvidence({...evidence,original:{...evidence.original,value:NaN}}));
});

test('conservative approval separates volume from reception and handles tiny samples', () => {
  const better={title:'Better approval',reviewPct:95,reviewCount:1000,pickScore:.8045};
  const popular={title:'Popular',reviewPct:90,reviewCount:100000,pickScore:.8787};
  assert.deepEqual([popular,better].sort(compareSteam),[better,popular]);
  assert.deepEqual([better,popular].sort((a,b)=>compareSteam(a,b,'reviewCount')),[popular,better]);
  assert.ok(wilsonLowerBound(100,1)<wilsonLowerBound(90,100000));
  assert.equal(wilsonLowerBound(100,0),null);
  assert.equal(wilsonLowerBound(null,20),null);
  assert.equal(wilsonLowerBound(95,1.5),null);
  const zero={reviewEvidence:{percentage:0,total:10,positive:0,negative:10}};
  assert.equal(steamApproval(zero).pct,0);
  assert.equal(steamApproval(zero).lowerBound,0);
});

test('rounded approval is approximate; exact counts, unknown dates and query scope survive', () => {
  const legacy={reviewPct:91,reviewCount:100};
  assert.equal(steamApproval(legacy).approximate,true);
  assert.equal(steamApproval(legacy).positive,null);
  assert.equal(steamApproval(legacy).observedAt,null);
  assert.equal(steamApproval({reviewPct:0,reviewCount:100}).pct,null,'old exporter coerced unknown to zero');
  const exact={reviewEvidence:{percentage:99,positive:2,negative:1,total:3,observedAt:'2026-09-15T12:00:00Z',queryScope:{language:'all'}}};
  assert.equal(steamApproval(exact).pct,200/3);
  assert.equal(steamApproval(exact).approximate,false);
  assert.equal(steamApproval({...exact,reviewEvidence:{...exact.reviewEvidence,total:10}}).lowerBound,null);
});

test('unranked and unreleased entries cannot be removed by a top-genre cutoff', () => {
  for (const game of [{reviewCount:0,reviewPct:0}, {reviewCount:200}, {reviewPct:100}, {reviewPct:99,reviewCount:200,comingSoon:true}]) assert.equal(eligibleSteamRank(game),false);
  assert.equal(eligibleSteamRank({reviewPct:90,reviewCount:100}),true);
  assert.ok(compareSteam({title:'Unknown'}, {title:'Rated',reviewPct:90,reviewCount:100})>0);
  assert.ok(compareSteam({title:'Soon',reviewPct:99,reviewCount:10000,comingSoon:true}, {title:'Rated',reviewPct:90,reviewCount:100})>0);
});

test('artwork, purchase price and legacy heuristic cannot affect conservative ordering', () => {
  const a={title:'A',reviewPct:90,reviewCount:100},b={title:'B',reviewPct:90,reviewCount:100};
  assert.ok(compareSteam({...a,pricePence:5000,pickScore:-100}, {...b,cover:'yes',pickScore:100})<0);
  assert.match(approvalEvidenceHtml({reviewPct:95,reviewCount:1000,pickScore:.8045}),/approximate/);
  assert.match(approvalEvidenceHtml({reviewEvidence:{percentage:null,total:null,observedAt:'<img>'}}), /&lt;img&gt;/);
});

test('shared synthetic evidence and approval contract retains identities and known mathematical results', async () => {
  const fixture=JSON.parse(await readFile(new URL('../ranking/fixtures/contracts.json',import.meta.url)));
  assert.equal(new Set(fixture.observations.map(item=>item.id)).size,fixture.observations.length);
  fixture.observations.forEach(validateEvidence);
  for (const {pct,count,expected} of fixture.approvalCases) {
    const actual=wilsonLowerBound(pct,count);
    if(expected===null)assert.equal(actual,null);else assert.ok(Math.abs(actual-expected)<1e-8,`${pct}/${count}: ${actual}`);
  }
});

test('catalog keeps original stable rank aliases and fifty reviewed pilot decisions never become automatic mappings', async () => {
  const catalog=JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url)));
  const method=new Map(catalog.systems.map(system=>[system.id,system.method]));
  // Legacy lists keep their editorial ranks; review-backed lists rank by reviews and keep the old rank for reference.
  assert.ok(catalog.games.filter(game=>method.get(game.systemId)==='legacy').every(game=>game.legacyRank===game.rank && game.rankingMethod==='editorial-system-rank-v1'));
  assert.ok(catalog.games.filter(game=>method.get(game.systemId)==='reviews'&&!game.unlisted).every(game=>game.rankingMethod==='reviews-v1'&&game.reviews&&(game.reviews.critics||game.reviews.players)));
  const pilot=JSON.parse(await readFile(new URL('../ranking/pilot-manifest.json',import.meta.url)));
  assert.equal(pilot.entries.length,50);assert.equal(new Set(pilot.entries.map(entry=>entry.id)).size,50);
  assert.ok(pilot.entries.every(entry=>entry.audit.review.reason && entry.audit.review.exactReleaseAccepted===false));
  assert.equal(pilot.gates.consensusEligible,false);
});

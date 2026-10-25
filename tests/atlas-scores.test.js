import test from 'node:test';
import assert from 'node:assert/strict';
import { atlasAppids, attachAtlasScores } from '../scripts/atlas-scores.mjs';
import { audit } from '../scripts/list-audit.mjs';

test('PC list games get Steam reviews and a scored VGC record by their Steam app', () => {
  const catalog = { games: [{ id: 'a', steamAppId: '220' }, { id: 'b', steamAppId: '400' }, { id: 'c' }] };
  assert.deepEqual(atlasAppids(catalog), ['220', '400']);
  attachAtlasScores(catalog, { steam: { apps: { 220: { count: 1000, percent: 97 }, 400: null } }, vgc: { games: { 220: { status: 'scored', score: 91 }, 400: { status: 'missing' } } } });
  assert.deepEqual(catalog.games[0].steamReviews, { count: 1000, percent: 97 });
  assert.equal(catalog.games[0].vgc.score, 91);
  assert.equal(catalog.games[1].steamReviews, undefined);
  assert.equal(catalog.games[1].vgc, undefined);
});

test('the coverage check finds a reference game by title, edition or numerals, and says why it is missing', () => {
  const pools = { pc: [{ id: 1, name: 'The Elder Scrolls III: Morrowind', alt: [], first: Date.UTC(2002, 4, 1) / 1000 }, { id: 2, name: 'Disco Elysium', alt: [] }] };
  const explain = new Map([['pc|1', { reason: 'cut', rank: 140 }], ['pc|2', { reason: 'listed', rank: 5 }]]);
  const results = audit({ pools, explain }, ['pc'], [{ title: 'The Elder Scrolls 3: Morrowind' }, { title: 'Disco Elysium - The Final Cut' }, { title: 'Unknown Game' }]);
  assert.deepEqual(results.map(result => result.reason), ['cut', 'listed', 'missing']);
});

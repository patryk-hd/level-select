import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReviews, reviewBoxes, reviewsFor, lineScores } from '../ranking/critic-reviews.mjs';

const page = `Intro text.
{{Video game reviews
| title = Reception
| SNES = true
| GBA = true
| GR = SNES: 89%<br />GBA: 83%
| EGM_SNES = 9/10, 9.5/10, 9.5/10, 9/10<ref>{{cite magazine|title=Review|issue=12}}</ref>
| Fam = SNES: 8/10, 9/10, 8/10, 9/10<br />GBA: 34/40
| Allgame = {{Rating|4.5|5}}
| IGN_GBA = 8.6/10
| CVG = 91/100{{sfn|Smith|1994|p=64}}
| rev1 = ''[[Entertainment Weekly]]''
| rev1Score = A−
| rev2 = Nintendojo
| rev2_SNES = 10/10
| award1Pub = ''[[Electronic Gaming Monthly]]''
| award1 = Best Super NES Game
}}`;

test('every score in a reviews box is read on a 0–100 scale, with its platform', () => {
  const reviews = parseReviews(page);
  const find = (outlet, code) => reviews.find(review => review.outlet === outlet && review.code === code);
  assert.equal(find('GR', 'SNES').value, 89); assert.equal(find('GR', 'SNES').aggregate, true);
  assert.equal(find('EGM', 'SNES').value, 92.5);
  assert.equal(find('Fam', 'SNES').value, 85); assert.equal(find('Fam', 'GBA').value, 85);
  assert.equal(find('Allgame', null).value, 90);
  assert.equal(find('IGN', 'GBA').value, 86);
  assert.equal(find('CVG', null).value, 91);
  assert.equal(find('Entertainment Weekly', null).value, 91);
  assert.equal(find('Nintendojo', 'SNES').value, 100);
  assert.ok(!reviews.some(review => /award/i.test(review.outlet)));
});

test('a system keeps its own reviews; unlabelled ones only count for the original release', () => {
  const reviews = parseReviews(page);
  const snes = reviewsFor(reviews, 'snes').map(review => review.outlet).sort();
  assert.deepEqual(snes, ['Allgame', 'CVG', 'EGM', 'Entertainment Weekly', 'Fam', 'GR', 'Nintendojo']);
  // The GBA version was a later port: only reviews that name it.
  assert.deepEqual(reviewsFor(reviews, 'gba', { original: false }).map(review => review.outlet).sort(), ['Fam', 'GR', 'IGN']);
  assert.deepEqual(reviewsFor(reviews, 'md'), reviewsFor(parseReviews(page), 'md'));
  assert.equal(reviewsFor(reviews, 'md', { original: false }).length, 0);
});

test('score formats: panels, grades, percentages, regions and non-scores', () => {
  assert.deepEqual(lineScores('10/9/9/9'), [92.5]);
  assert.deepEqual(lineScores('34/40'), [85]);
  assert.deepEqual(lineScores('B+'), [88]);
  assert.deepEqual(lineScores('97%'), [97]);
  assert.deepEqual(lineScores('Favorable'), []);
  assert.deepEqual(lineScores('2/1'), []);
  const regions = parseReviews('{{Video game reviews|IGN = 8.8/10 (US) <br /> 9.1/10 (AU)|GEN = Genesis: 7/10<br>SNES: 8/10|MM = 93%}}');
  assert.equal(reviewsFor(regions, 'snes').find(review => review.outlet === 'IGN').value, 89.5);
  // Inline "Genesis:" and template code "SMD" both mean the Mega Drive.
  assert.equal(parseReviews('{{Video game reviews|EGM = Genesis: 7/10<br>SNES: 8/10}}').find(review => review.code === 'GENESIS').value, 70);
  assert.equal(reviewsFor(parseReviews('{{Video game reviews|EGM_SMD = 7/10|EGM_SNES = 8/10}}'), 'md')[0].value, 70);
  assert.equal(parseReviews('No reviews box here.').length, 0);
  // Comments between the name and the first field, and the old {{VG Reviews}} name.
  assert.equal(parseReviews('{{Video game reviews\n<!-- Formatting -->\n| na = true\n| CVG_NES = 98%<ref>{{cite web|title=x}}</ref>\n}}')[0].value, 98);
  assert.equal(parseReviews('{{VG Reviews|EGM = 8/10}}')[0].value, 80);
  // Single-machine magazines say which version they reviewed.
  const computers = parseReviews("{{Video game reviews|Zzap!64 = 97%|CRASH = 92%|rev1 = ''[[Amiga Power]]''|rev1Score = 85%|CVG = 90%}}");
  assert.deepEqual(computers.map(review => review.code), ['C64', 'ZX', 'AMI', null]);
  assert.deepEqual(reviewsFor(computers, 'c64', { original: false }).map(review => review.outlet), ['Zzap!64']);
  // Newer systems have labels too: a Vita or PS4 score belongs to that version, and a
  // label for any known machine (Neo Geo Pocket, 5200) never counts as "no platform".
  const modern = parseReviews('{{Video game reviews|MC_VITA = 93/100|MC_PS4 = 89/100|IGN = Neo Geo Pocket: 7/10|EGM = 9/10}}');
  assert.deepEqual(reviewsFor(modern, 'vita', { original: false }).map(review => review.value), [93]);
  assert.deepEqual(reviewsFor(modern, 'ps4', { original: false }).map(review => review.value), [89]);
  assert.deepEqual(reviewsFor(modern, 'gbc').map(review => review.outlet), ['EGM']);
});

test('only the review boxes are kept for the cache, and they parse the same', () => {
  const boxes = reviewBoxes(page);
  assert.ok(!boxes.includes('Intro text') && !boxes.includes('cite magazine'));
  assert.deepEqual(parseReviews(boxes), parseReviews(page));
});

test('a box titled for a version gives its unlabelled scores to that version', () => {
  const reviews = parseReviews(`{{Video game reviews\n| title = PlayStation 4 and Xbox One reception\n| IGN = 10/10\n}}\n{{Video game reviews\n| title = Windows reception\n| PCGN = 9/10\n| GSpot = 8/10\n}}`);
  assert.deepEqual(reviewsFor(reviews, 'pc', { original: false }).map(review => review.outlet).sort(), ['GSpot', 'PCGN']);
  assert.deepEqual(reviewsFor(reviews, 'ps4', { original: false }).map(review => review.outlet), ['IGN']);
  // Unlabelled scores in an untitled box stay about the first release.
  assert.equal(reviewsFor(parseReviews('{{Video game reviews\n| IGN = 9/10\n}}'), 'pc', { original: false }).length, 0);
  // "PC: 8.8/10" is about the PC version on the PC list too.
  assert.equal(Math.round(reviewsFor(parseReviews('{{Video game reviews\n| IGN = X360: 9/10<br />PC: 8.8/10\n}}'), 'pc', { original: false })[0].value), 88);
});

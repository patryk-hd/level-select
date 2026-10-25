import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAwards, awardIndex, awardsFor, attachAwards } from '../scripts/awards.mjs';
import { awardSummary, awardLift, compareWithAwards } from '../tracking/awards.js';

const uri = id => ({ value: `http://www.wikidata.org/entity/${id}` });
const text = value => ({ value });
const row = (game, title, award, ceremony, kind, year, extra = {}) => ({ game: uri(game), gameLabel: text(title), awardLabel: text(award), ceremony: text(ceremony),
  kind: text(kind), time: year ? text(`${year}-12-08T00:00:00Z`) : undefined, steams: text(extra.steam ?? ''), igdbs: text(extra.igdb ?? ''), released: text(extra.released ?? '') });

test('Wikidata rows become awards: quality awards only, GOTY nominations kept, a win replaces its nomination', () => {
  const elden = { steam: '1245620', igdb: 'elden-ring', released: '2022-02-25T00:00:00Z' };
  const games = parseAwards([
    row('Q64826862', 'Elden Ring', 'The Game Awards − Game of the Year', 'Q18642757', 'won', 2022, elden),
    row('Q64826862', 'Elden Ring', 'The Game Awards − Game of the Year', 'Q18642757', 'nominated', 2022, elden),
    row('Q64826862', 'Elden Ring', 'The Game Awards − Best Art Direction', 'Q18642757', 'won', 2022, elden),
    row('Q64826862', 'Elden Ring', 'The Game Awards − Most Anticipated Game', 'Q18642757', 'won', 2019, elden),
    row('Q64826862', 'Elden Ring', 'British Academy Games Award for Multiplayer', 'Q546692', 'nominated', 2023, elden),
    row('Q1', 'Someone', 'The Game Awards − Content Creator of the Year', 'Q18642757', 'won', 2022),
    row('Q2', 'Hades', 'British Academy Games Award for Best Game', 'Q546692', 'won', 2021, { steam: '1145360', igdb: 'hades--1', released: '2020-09-17' }),
  ]);
  const elden2 = games.find(game => game.title === 'Elden Ring');
  assert.deepEqual(elden2.awards, [
    { ceremony: 'The Game Awards', name: 'Game of the Year', year: 2022, won: true, goty: true },
    { ceremony: 'The Game Awards', name: 'Best Art Direction', year: 2022, won: true, goty: false },
  ], 'hype awards and category nominations are dropped');
  assert.deepEqual([elden2.year, elden2.steam, elden2.igdb], [2022, ['1245620'], ['elden-ring']]);
  assert.equal(games.find(game => game.title === 'Hades').awards[0].name, 'Best Game');
  assert.equal(games.some(game => game.title === 'Someone'), false);
});

test('awards attach by Steam app, IGDB page (or its parent game), or exact title within a year', () => {
  const data = { games: [
    { id: 'Q1', title: 'Elden Ring', year: 2022, steam: ['1245620'], igdb: ['elden-ring'], awards: [{ ceremony: 'The Game Awards', name: 'Game of the Year', year: 2022, won: true, goty: true }] },
    { id: 'Q2', title: 'The Witcher 3: Wild Hunt', year: 2015, steam: [], igdb: ['the-witcher-3-wild-hunt'], awards: [{ ceremony: 'The Game Awards', name: 'Game of the Year', year: 2015, won: true, goty: true }] },
    { id: 'Q3', title: 'Call of Duty', year: 2003, steam: ['2620'], igdb: [], awards: [{ ceremony: 'D.I.C.E. Awards', name: 'Game of the Year', year: 2004, won: true, goty: true }] },
  ] };
  const index = awardIndex(data);
  assert.equal(awardsFor(index, { steam: ['1245620'] }).length, 1);
  assert.equal(awardsFor(index, { title: 'Call of Duty', year: 2022, steam: ['1938090'] }).length, 0, 'the 2022 Call of Duty is not the 2003 one');
  assert.equal(awardsFor(index, { title: 'Operator', year: 2022 }).length, 0);
  const groups = [{ name: 'Witcher', copies: [{ name: 'The Witcher 3: Wild Hunt – Game of the Year Edition', igdb: { url: 'https://www.igdb.com/games/the-witcher-3-goty', versionParent: 9 } }] }];
  const catalog = { games: [{ title: 'Elden Ring', year: 2022 }, { title: 'Elden Ring', year: 2030 }] };
  const wishlist = [{ appid: 2620, title: 'Call of Duty® (2003)' }];
  attachAwards(data, { groups, wishlist, catalog, slugsOf: record => [record?.url?.split('/').pop(), record?.versionParent === 9 ? 'the-witcher-3-wild-hunt' : null] });
  assert.equal(groups[0].copies[0].awards[0].year, 2015, 'a GOTY edition finds its game through the parent');
  assert.equal(groups[0].awards.length, 1);
  assert.equal(wishlist[0].awards[0].ceremony, 'D.I.C.E. Awards');
  assert.deepEqual(catalog.games.map(game => Boolean(game.awards)), [true, false]);
});

test('award summaries read well and lift a near-tie, never a clearly better game', () => {
  const goty = [{ ceremony: 'D.I.C.E. Awards', name: 'Game of the Year', year: 2023, won: true, goty: true }, { ceremony: 'The Game Awards', name: 'Game of the Year', year: 2022, won: true, goty: true },
    { ceremony: 'The Game Awards', name: 'Best Art Direction', year: 2022, won: true, goty: false }];
  assert.deepEqual([awardSummary(goty).tier, awardSummary(goty).label, awardSummary(goty).short, awardSummary(goty).headline], ['goty', 'Game of the Year ×2', 'GOTY ×2', 'Game of the Year · The Game Awards 2022, D.I.C.E. 2023']);
  const category = [{ ceremony: 'BAFTA Games Awards', name: 'Narrative', year: 2020, won: true, goty: false }];
  assert.equal(awardSummary(category).headline, 'Narrative · BAFTA 2020');
  assert.equal(awardSummary([{ ceremony: 'The Game Awards', name: 'Game of the Year', year: 2020, won: false, goty: true }]).label, 'GOTY nominee');
  assert.equal(awardSummary([]), null);
  assert.deepEqual([awardLift(goty), awardLift(category), awardLift(null)], [3, 1, 0]);
  const winner = { rating: { value: 88 }, awards: goty }, rival = { rating: { value: 90 }, awards: null }, better = { rating: { value: 93 }, awards: null };
  assert.equal([rival, winner].sort(compareWithAwards)[0], winner, '88 + GOTY edges out 90');
  assert.equal([better, winner].sort(compareWithAwards)[0], better, 'but not a game rated 5 higher');
  assert.equal([{ rating: null, awards: goty }, { rating: { value: 50 }, awards: null }].sort(compareWithAwards)[0].rating.value, 50, 'unrated stays behind rated');
});

test('your weekly refresh stays in library/data: your copy uses the newer file, public builds the shipped one', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { readAwards } = await import('../scripts/awards.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'level-select-awards-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'data')); await mkdir(path.join(root, 'library/data'), { recursive: true });
  const write = (file, fetchedAt, title) => writeFile(path.join(root, file), JSON.stringify({ fetchedAt, games: [{ title }] }));
  await write('data/awards.json', '2026-10-12T00:00:00.000Z', 'Shipped');
  assert.equal((await readAwards(root, { local: true })).games[0].title, 'Shipped');
  await write('library/data/awards.json', '2026-10-19T00:00:00.000Z', 'Yours');
  assert.equal((await readAwards(root, { local: true })).games[0].title, 'Yours');
  assert.equal((await readAwards(root)).games[0].title, 'Shipped');
  await write('data/awards.json', '2026-10-26T00:00:00.000Z', 'Shipped later');
  assert.equal((await readAwards(root, { local: true })).games[0].title, 'Shipped later');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { igdbRecord, attachOwned, attachCatalog, ownedSteamId, steamSummaries, contradictsCopy } from '../scripts/igdb-snapshot.mjs';

const state = {
  games: {
    1: { id: 1, name: 'Euro Truck Simulator 2: Legendary Edition', year: 2013, criticCount: 0, playersCount: 0, versionParent: 2, steam: ['227300'] },
    2: { id: 2, name: 'Euro Truck Simulator 2', year: 2012, critic: 79, criticCount: 20, players: 88, playersCount: 900, steam: [] },
    3: { id: 3, name: 'Doom', year: 1993, critic: 90, criticCount: 5, players: 87, playersCount: 1000, steam: ['2280', '2281'] },
  },
  ttb: { 2: { main: 180000, count: 12 } },
  links: {
    owned: { a: { igdbId: 1, confidence: 'medium' }, b: { igdbId: 3, confidence: 'low' }, c: { igdbId: 3, confidence: 'high' } },
    wishlist: {}, catalog: { 'dos-doom': { igdbId: 3, confidence: 'high' } },
  },
};

test('an edition without reception borrows its parent game and says so; low confidence attaches nothing', () => {
  const record = igdbRecord(state, state.links.owned.a);
  assert.equal(record.players, 88); assert.equal(record.ratingsFrom, 'Euro Truck Simulator 2');
  assert.equal(record.ttb.main, 180000); assert.deepEqual(record.steam, ['227300']);
  assert.equal(record.versionParent, 2, 'editions keep their parent so the wishlist can tell them apart'); assert.equal(record.type, null);
  assert.equal(igdbRecord(state, state.links.owned.b), null);
  const groups = [{ copies: [{ id: 'a' }, { id: 'b', igdb: { stale: true } }] }];
  attachOwned(state, groups);
  assert.ok(groups[0].copies[0].igdb); assert.equal(groups[0].copies[1].igdb, undefined);
  assert.equal(attachCatalog(state, { games: [{ id: 'dos-doom' }] }).games[0].igdb.name, 'Doom');
});

test('owned Steam products come from explicit ids or a single IGDB Steam id, never a title search or a guess', () => {
  assert.equal(ownedSteamId({ sources: ['GOG'], igdb: { steam: ['1'] } }), null);
  assert.equal(ownedSteamId({ sources: ['Steam'], igdb: { steam: ['227300'] } }), '227300');
  assert.equal(ownedSteamId({ sources: ['Steam'], igdb: { steam: ['2280', '2281'] } }), null);
  assert.equal(ownedSteamId({ sources: ['Steam'], steamAppId: '9', steamAppIdProvenance: { origin: 'title-search' }, igdb: { steam: ['227300'] } }), '227300');
  assert.equal(ownedSteamId({ sources: ['Steam'], steamAppId: '9', steamAppIdProvenance: { origin: 'csv-steam-id' } }), '9');
});

test('Steam summaries use the query totals and keep zero-review products distinct', () => {
  const row = (id, positive, count) => ({ provider: 'steam', providerId: id, observedAt: 'x', observations: [{ lane: 'steam-approval', original: { positive, count } }] });
  const summaries = steamSummaries({ rows: [row('1', 930, 1000), row('2', 0, 0)] });
  assert.deepEqual([summaries.get('1').percent, summaries.get('1').count], [93, 1000]);
  assert.equal(summaries.get('2').percent, null);
});

test('an owned link that contradicts the copy\'s Steam app and year is not attached; hand-picked links are', () => {
  const cod2003 = { id: 621, name: 'Call of Duty', year: 2003, steam: ['2620'] };
  const copy = { id: 'hq', name: 'Call of Duty', steamAppId: '1938090', year: 2022 };
  assert.equal(contradictsCopy(copy, cod2003, { method: 'search' }), true);
  assert.equal(contradictsCopy(copy, cod2003, { method: 'manual' }), false);
  assert.equal(contradictsCopy({ ...copy, steamAppId: '2620' }, cod2003, {}), false, 'the listed app');
  assert.equal(contradictsCopy({ ...copy, year: 2003 }, cod2003, {}), false, 'an edition with its own app, same year');
  assert.equal(contradictsCopy({ ...copy, steamAppId: null }, cod2003, {}), false, 'no app id: nothing to contradict');
  const state = { games: { 621: { ...cod2003, criticCount: 0, playersCount: 0 } }, ttb: {}, links: { owned: { hq: { igdbId: 621, confidence: 'medium', method: 'search' } } } };
  const groups = [{ year: 2022, copies: [{ ...copy, year: undefined, igdb: { stale: true } }] }];
  attachOwned(state, groups);
  assert.equal(groups[0].copies[0].igdb, undefined);
});

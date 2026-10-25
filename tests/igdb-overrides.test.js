import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOverride, applyOverrides, correctionRequestAllowed } from '../scripts/igdb-overrides.mjs';
import { igdbRecord } from '../scripts/igdb-snapshot.mjs';

const state = () => ({ games: { 1: { id: 1, name: 'Pokémon Yellow', playersCount: 500, players: 80, criticCount: 0 }, 2: { id: 2, name: 'Doom', playersCount: 900, players: 87, criticCount: 0 } }, ttb: {},
  links: { owned: { a: { igdbId: 1, confidence: 'medium' }, b: { igdbId: 2, confidence: 'medium' }, c: { igdbId: 1, confidence: 'high' } }, wishlist: {}, catalog: {} } });
const data = overrides => ({ schemaVersion: 1, overrides });

test('confirming promotes a match, rejecting hides its score, replacing points at another game', () => {
  const next = applyOverrides(state(), data({
    'owned:a': { decision: 'rejected', igdbId: null }, 'owned:b': { decision: 'confirmed', igdbId: null }, 'owned:c': { decision: 'replaced', igdbId: 2 },
  }));
  assert.equal(igdbRecord(next, next.links.owned.a), null);
  assert.equal(next.links.owned.b.confidence, 'high');
  assert.equal(igdbRecord(next, next.links.owned.c).name, 'Doom');
  // A pasted link not yet resolved hides the old score until the next refresh.
  const pending = applyOverrides(state(), data({ 'owned:c': { decision: 'replaced', igdbId: null, slug: 'doom' } }));
  assert.equal(igdbRecord(pending, pending.links.owned.c), null);
});

test('corrections are validated strictly', () => {
  assert.deepEqual(validateOverride({ collection: 'catalog', key: 'nes-eb55f77bf8d98dfb', decision: 'replaced', slug: 'super-metroid' }).slug, 'super-metroid');
  assert.equal(validateOverride({ collection: 'owned', key: '602d499c-f617-4330-aec9-9b9c9b7e126a', decision: 'rejected' }).decision, 'rejected');
  for (const bad of [
    { collection: 'secrets', key: 'a', decision: 'rejected' },
    { collection: 'owned', key: '../../etc/passwd', decision: 'rejected' },
    { collection: 'owned', key: 'a', decision: 'delete' },
    { collection: 'owned', key: 'a', decision: 'replaced' },
    { collection: 'owned', key: 'a', decision: 'replaced', igdbId: -4 },
    { collection: 'owned', key: 'a', decision: 'replaced', slug: 'Not A Slug!' },
    { collection: 'owned', key: 'a', decision: 'rejected', igdbId: 5 },
  ]) assert.throws(() => validateOverride(bad), undefined, JSON.stringify(bad));
});

test('only same-origin JSON posts with the app header may save corrections', () => {
  const ok = { method: 'POST', headers: { origin: 'http://127.0.0.1:8765', 'x-retro-library': '1', 'content-type': 'application/json' } };
  assert.equal(correctionRequestAllowed(ok, 8765), true);
  assert.equal(correctionRequestAllowed({ ...ok, headers: { ...ok.headers, origin: 'http://localhost:8765' } }, 8765), true);
  assert.equal(correctionRequestAllowed({ ...ok, headers: { ...ok.headers, origin: 'https://evil.example' } }, 8765), false);
  assert.equal(correctionRequestAllowed({ ...ok, headers: { ...ok.headers, origin: undefined } }, 8765), false);
  assert.equal(correctionRequestAllowed({ ...ok, headers: { ...ok.headers, 'x-retro-library': undefined } }, 8765), false);
  assert.equal(correctionRequestAllowed({ ...ok, headers: { ...ok.headers, 'content-type': 'text/plain' } }, 8765), false);
  assert.equal(correctionRequestAllowed({ ...ok, method: 'GET' }, 8765), false);
  assert.equal(correctionRequestAllowed(ok, 18765), false);
});

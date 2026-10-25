import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../tracking/domain.js';
import { patchCatalog } from '../tracking/compat.js';
import { manualOwnedGroups } from '../tracking/owned.js';

const at = '2026-09-29T10:00:00.000Z';
const catalog = { systems: [{ id: 'snes', name: 'SNES' }], games: [
  { id: 'snes-metroid', systemId: 'snes', title: 'Super Metroid', year: 1994, genres: ['Action'], cover: { local: './assets/covers/metroid.png' }, igdb: { id: 1103 } },
  { id: 'snes-zelda', systemId: 'snes', title: 'A Link to the Past', year: 1991, genres: ['Adventure'], cover: { url: 'https://example.test/zelda.png' }, igdb: { id: 1026 } },
] };
const desc = id => ({ ref: { provider: 'catalog', id }, title: id, platforms: ['snes'] });

test('games marked owned in Game Atlas and wishlist purchases become labelled Library entries', () => {
  let state = patchCatalog(emptyState(), desc('snes-metroid'), { owned: true }, { at, eventId: 'o1' });
  state.ownership['manual:steam:42'] = { id: 'manual:steam:42', targetId: 't', evidence: 'manual', source: { provider: 'steam', id: '42' }, acquiredAt: at, platforms: ['PC'], sources: ['Manual acquisition'] };
  const groups = manualOwnedGroups(state, { catalog, wishlist: [{ appid: 42, title: 'Hades', image: 'https://example.test/hades.jpg', genres: ['Action'], year: 2020 }] });
  assert.deepEqual(groups.map(group => [group.name, group.platforms, group.sources[0]]), [
    ['Hades', ['PC'], 'Bought from wishlist'], ['Super Metroid', ['SNES'], 'Marked owned']]);
  assert.equal(groups[1].cover, '../assets/covers/metroid.png');
  assert.equal(groups[1].copies[0].igdb.id, 1103);
});

test('a game already imported from Playnite is not listed twice; unmarking removes it', () => {
  let state = patchCatalog(emptyState(), desc('snes-zelda'), { owned: true }, { at, eventId: 'o1' });
  const library = [{ id: 'p', copies: [{ id: 'c', igdb: { id: 1026 } }] }];
  assert.equal(manualOwnedGroups(state, { catalog, library }).length, 0);
  assert.equal(manualOwnedGroups(state, { catalog }).length, 1);
  state = patchCatalog(state, desc('snes-zelda'), { owned: false }, { at, eventId: 'o2' });
  assert.equal(manualOwnedGroups(state, { catalog }).length, 0);
});

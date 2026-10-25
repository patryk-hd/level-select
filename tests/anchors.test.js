import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyCommand, ensureTarget } from '../tracking/domain.js';
import { patchAnnotation } from '../tracking/compat.js';
import { ownedIndex, anchorsFor, verdict, enjoyment } from '../tracking/anchors.js';

// Fixtures are top-down fantasy real-time strategy games unless a test says otherwise.
const igdb = (id, extra = {}) => ({ id, players: 80, playersCount: 500, series: [], franchises: [], similar: [], genres: [11, 15], themes: [17], perspectives: [3], ...extra });
const library = [
  { id: 'g1', name: 'Total War: Warhammer', copies: [{ id: 'tw1', name: 'Total War: Warhammer', timePlayed: 0, igdb: igdb(1, { series: [2651], franchises: [509, 977], players: 82 }) }] },
  { id: 'g2', name: 'Space Marine', copies: [{ id: 'sm', name: 'Space Marine', timePlayed: 0, igdb: igdb(2, { franchises: [977] }) }] },
  { id: 'g3', name: 'Crusader Kings II', copies: [{ id: 'ck', name: 'Crusader Kings II', timePlayed: 40 * 3600, igdb: igdb(3, { similar: [99] }) }] },
];
const warhammer3 = igdb(10, { series: [2651], franchises: [509, 977], players: 88 });
const index = ownedIndex(library);

test('anchors: same series first; a broad franchise alone is not enough; IGDB similar games count', () => {
  const big = { ...index, franchiseSize: new Map([...index.franchiseSize, [977, 40]]) };
  assert.deepEqual(anchorsFor(warhammer3, big, emptyState()).map(item => [item.title, item.relation]), [['Total War: Warhammer', 'series']]);
  assert.deepEqual(anchorsFor(igdb(99, { similar: [] }), index, emptyState()).map(item => item.relation), ['similar']);
});

test('verdicts: play yours first, keep the best, or probably remove — scores can overrule a dislike', () => {
  let state = emptyState();
  let [anchor] = anchorsFor(warhammer3, index, state);
  assert.equal(verdict(warhammer3, [anchor]).kind, 'play-first');
  const target = ensureTarget(state, { ref: { provider: 'playnite', id: 'tw1' }, title: 'Total War: Warhammer', platforms: ['PC'] }).id;
  state = applyCommand(state, { type: 'start', targetId: target, playthroughId: 'p', at: '2026-09-01T10:00:00.000Z', eventId: 's' });
  state = applyCommand(state, { type: 'status', targetId: target, playthroughId: 'p', status: 'finished', at: '2026-09-20T10:00:00.000Z', eventId: 'f' });
  [anchor] = anchorsFor(warhammer3, index, state);
  assert.equal(anchor.feeling, 'enjoyed');
  assert.equal(verdict(warhammer3, [anchor]).kind, 'keep');
  assert.equal(verdict(igdb(11, { series: [2651], players: 70 }), [anchor], [warhammer3]).kind, 'keep-best');
  state = patchAnnotation(state, { ref: { provider: 'playnite', id: 'tw1' }, title: 'x', platforms: [] }, { enjoyed: 'no' });
  [anchor] = anchorsFor(warhammer3, index, state);
  assert.equal(verdict(igdb(12, { series: [2651], players: 80 }), [anchor]).kind, 'remove');
  assert.equal(verdict(igdb(13, { series: [2651], players: 95 }), [anchor]).kind, 'reconsider');
});

test('Playnite hours stand in for enjoyment when there is no answer or history', () => {
  const ck = [...index.games.values()].find(game => game.title.startsWith('Crusader'));
  assert.equal(enjoyment(emptyState(), ck), 'probably-enjoyed');
});

test('editions of an owned game count as owning it; unplayed "similar" games give no verdict', async () => {
  const { sameGameKey, ownedCopiesOf } = await import('../tracking/anchors.js');
  assert.equal(sameGameKey("Marvel’s Spider-Man Remastered"), sameGameKey("Marvel's Spider-Man"));
  assert.equal(sameGameKey('Divinity: Original Sin 2 - Definitive Edition'), sameGameKey('Divinity: Original Sin 2'));
  assert.notEqual(sameGameKey('Hades II'), sameGameKey('Hades'));
  assert.equal(ownedCopiesOf({ title: 'Total War: WARHAMMER - Game of the Year Edition', igdb: { id: 555 } }, index).length, 1);
  const similarOnly = anchorsFor(igdb(99), index, emptyState());
  similarOnly[0].feeling = 'unplayed';
  assert.equal(verdict(igdb(99), similarOnly), null);
});

// Real wishlist cases: the name alone never decides when IGDB knows both games.
test('ownership: same game, other edition, remaster of an original you own, or a different game', async () => {
  const { ownedCopiesOf, originalAnchor, versionVerdict } = await import('../tracking/anchors.js');
  const own = (id, name, extra = {}) => ({ id: `g${id}`, name, copies: [{ id: `c${id}`, name, timePlayed: 0, platforms: ['PC (Windows)'], sources: ['Steam'], igdb: igdb(id, extra) }] });
  const mine = ownedIndex([
    own(216958, 'The Operator', { year: 2024, type: 0 }),
    own(2155, 'DARK SOULS', { year: 2011, type: 0, players: 88 }),
    own(75357, 'Pillars of Eternity - Definitive Edition', { year: 2017, type: 3, versionParent: 1593 }),
    own(673, 'DOOM', { year: 1993, type: 0 }),
    own(81085, 'Dark Souls II: Scholar of the First Sin Remastered', { year: 2015, type: 9 }),
    own(8040, 'Poker Night at the Inventory', { year: 2010, type: 0 }),
  ]);
  const owns = wish => ownedCopiesOf(wish, mine).map(copy => [copy.title, copy.owns, copy.version ?? null]);
  assert.deepEqual(owns({ title: 'OPERATOR', igdb: { id: 250827, year: 2023, type: 0 } }), []);
  assert.deepEqual(owns({ title: 'The Operator', igdb: { id: 216958 } }), [['The Operator', 'same', null]]);
  assert.deepEqual(owns({ title: 'DARK SOULS™: REMASTERED', igdb: { id: 81086, year: 2018, type: 9 } }), [['DARK SOULS', 'original', 'remaster']]);
  assert.deepEqual(owns({ title: 'Pillars of Eternity', igdb: { id: 1593, year: 2015, type: 0 } }), [['Pillars of Eternity - Definitive Edition', 'edition', null]]);
  assert.deepEqual(owns({ title: 'DOOM', igdb: { id: 7351, year: 2016, type: 0 } }), [], 'a 2016 reboot is not the 1993 game');
  assert.deepEqual(owns({ title: 'Dark Souls II: Scholar of the First Sin', igdb: { id: 9999, year: 2015, type: 0 } }), [['Dark Souls II: Scholar of the First Sin Remastered', 'newer', 'remaster']]);
  assert.deepEqual(owns({ title: 'Poker Night at the Inventory', igdb: { id: 388390, year: 2026, type: 9 } }), [['Poker Night at the Inventory', 'original', 'remaster']]);
  assert.deepEqual(owns({ title: 'Pillars of Eternity - Complete Edition' }), [['Pillars of Eternity - Definitive Edition', 'edition', null]], 'no IGDB match: the name decides');

  // A remaster is judged by how the original went.
  const original = ownedCopiesOf({ title: 'Dark Souls Remastered', igdb: { id: 81086, type: 9 } }, mine)[0];
  let state = emptyState();
  assert.equal(versionVerdict({ id: 81086 }, originalAnchor(original, state), 'remaster').kind, 'play-first');
  state = patchAnnotation(state, { ref: { provider: 'playnite', id: 'c2155' }, title: 'x', platforms: [] }, { enjoyed: 'yes' });
  const liked = versionVerdict({ id: 81086 }, originalAnchor(original, state), 'remaster');
  assert.deepEqual([liked.kind, liked.action], ['upgrade', 'wait-for-price']);
  state = patchAnnotation(state, { ref: { provider: 'playnite', id: 'c2155' }, title: 'x', platforms: [] }, { enjoyed: 'no' });
  assert.equal(versionVerdict({ id: 81086 }, originalAnchor(original, state), 'remaster').kind, 'remove');
  // Versions of the wish are never also offered as "similar" anchors.
  assert.deepEqual(anchorsFor({ ...igdb(81086), similar: [2155] }, mine, emptyState(), 'Dark Souls Remastered'), []);
});

test('time to beat ignores lone "with extras" reports and endless games', async () => {
  const { beatHours } = await import('../tracking/score.js');
  assert.equal(beatHours({ ttb: { main: 414202, extra: 458844, count: 72 } }), 115);
  assert.equal(beatHours({ ttb: { main: null, extra: 2253600, count: 2 } }), null, 'GTA V Enhanced: one report of 626h');
  assert.equal(beatHours({ ttb: { main: 180000000, count: 3 } }), null, 'BeamNG: 50,000h');
  assert.equal(beatHours({ ttb: { main: null, extra: 36000, count: 5 } }), 10);
});

test('same-named games stay separate: Steam apps and release years beat a shared IGDB link', async () => {
  const { ownedCopiesOf } = await import('../tracking/anchors.js');
  const copy = (id, name, extra, igdbExtra) => ({ id: `g-${id}`, name, copies: [{ id, name, platforms: ['PC (Windows)'], sources: ['Steam'], ...extra, igdb: igdbExtra && igdb(igdbExtra.id, igdbExtra) }] });
  // Your 2022 Call of Duty app once carried the 2003 game's IGDB link.
  const mine = ownedIndex([copy('hq', 'Call of Duty', { steamAppId: '1938090', year: 2022 }, { id: 621, year: 2003, steam: ['2620'] })]);
  const wish2003 = { appid: 2620, title: 'Call of Duty® (2003)', igdb: { id: 621, year: 2003 } };
  assert.deepEqual(ownedCopiesOf(wish2003, mine), []);
  assert.deepEqual(ownedCopiesOf({ ...wish2003, title: 'Call of Duty' }, mine), [], 'even with the very same name');
  // The same Steam app is always the same game, even with no IGDB match on your copy.
  const unmatched = ownedIndex([copy('hq', 'Call of Duty', { steamAppId: '1938090', year: 2022 })]);
  assert.deepEqual(ownedCopiesOf({ appid: 1938090, title: 'Call of Duty®', igdb: { id: 999, year: 2022 } }, unmatched).map(item => item.owns), ['same']);
  // A GOTY copy with its own Steam app, from the same era, still means you own the game.
  const goty = ownedIndex([copy('b', 'Batman: Arkham Asylum GOTY Edition', { steamAppId: '35140', year: 2010 }, { id: 5, year: 2009, steam: ['35010'] })]);
  assert.deepEqual(ownedCopiesOf({ appid: 35010, title: 'Batman: Arkham Asylum', igdb: { id: 5, year: 2009 } }, goty).map(item => item.owns), ['same']);
  // An Epic or PlayStation copy linked to a game released years before it came out: not proof.
  const epic = ownedIndex([{ id: 'g-e', name: 'Prey', copies: [{ id: 'e', name: 'Prey', sources: ['Epic'], platforms: [], year: 2017, igdb: igdb(99, { year: 2006 }) }] }]);
  assert.deepEqual(ownedCopiesOf({ appid: 3970, title: 'Prey', igdb: { id: 99, year: 2006 } }, epic), []);
});

// IGDB genres: 5 shooter, 8 platform, 10 racing, 12 RPG, 31 adventure, 32 indie, 33 arcade.
// Themes: 1 action, 17 fantasy, 18 sci-fi, 19 horror, 39 war. Cameras: 1 first person, 2 third, 3 top-down, 4 side.
test('only games of the same kind are compared: camera, genre and theme first, then scores', async () => {
  const { gameplayFit } = await import('../tracking/gameplay.js');
  const isaac = igdb(7789, { genres: [5, 9, 12, 31, 32, 33], themes: [1, 17, 19, 27], perspectives: [3] });
  const shock2 = igdb(1, { genres: [5, 12], themes: [1, 18, 19, 21, 23], perspectives: [1], similar: [7789] });
  const deadSpace = igdb(2, { genres: [5, 9], themes: [1, 18, 19, 21], perspectives: [2] });
  const hades = igdb(3, { genres: [12, 25, 31, 32], themes: [1, 17, 31], perspectives: [3], similar: [7789] });
  assert.equal(gameplayFit(isaac, shock2, { strict: true }).fits, false, 'top-down roguelike vs first-person shooter');
  const kind = (a, b) => { const fit = gameplayFit(a, b, { strict: true }); return fit.fits ? fit.kind : null; };
  assert.equal(kind(shock2, deadSpace), 'horror shooter', 'first and third person are both 3D');
  assert.equal(kind(isaac, hades), 'top-down fantasy RPG');
  // One broad genre and a camera aren't enough to call games similar.
  assert.equal(kind(igdb(9, { genres: [9], themes: [43], perspectives: [1] }), igdb(10, { genres: [9], themes: [43], perspectives: [2] })), null, 'two mystery puzzle games, different cameras');
  const kart = igdb(4, { genres: [10, 33], themes: [1, 17, 35, 40], perspectives: [2], series: [240] });
  const odyssey = igdb(5, { genres: [8, 31], themes: [1, 17, 33, 38], perspectives: [2], series: [240] });
  assert.equal(gameplayFit(kart, odyssey).fits, false, 'one Mario series, different kinds of game');
  const walk = igdb(6, { genres: [31, 32], themes: [43], perspectives: [1] });
  assert.equal(gameplayFit(walk, shock2).fits, false, 'sharing only "Adventure" with an RPG is not enough');
  assert.equal(gameplayFit(igdb(8, { genres: [], themes: [], perspectives: [] }), shock2).fits, true, 'unknown data never proves a difference…');
  assert.equal(gameplayFit(igdb(8, { genres: [], themes: [], perspectives: [] }), shock2, { strict: true }).fits, false, '…but is no evidence of similarity either');

  // The review: Isaac is only judged against a game that plays like it.
  const library = [
    { id: 'ss2', name: 'System Shock 2', copies: [{ id: 'ss2', name: 'System Shock 2', timePlayed: 20 * 3600, igdb: shock2 }] },
    { id: 'kart', name: 'Mario Kart 8 Deluxe', copies: [{ id: 'kart', name: 'Mario Kart 8 Deluxe', timePlayed: 0, igdb: kart }] },
  ];
  assert.deepEqual(anchorsFor(isaac, ownedIndex(library), emptyState()), []);
  assert.deepEqual(anchorsFor(odyssey, ownedIndex(library), emptyState()), [], 'same series, different kind');
  const withHades = ownedIndex([...library, { id: 'hades', name: 'Hades', copies: [{ id: 'hades', name: 'Hades', timePlayed: 30 * 3600, igdb: hades }] }]);
  assert.deepEqual(anchorsFor(isaac, withHades, emptyState()).map(item => [item.title, item.relation, item.gameplay]), [['Hades', 'similar', 'top-down fantasy RPG']]);
  // Call of Duty stays a Call of Duty comparison.
  const cod = igdb(621, { genres: [5], themes: [1, 22, 39], perspectives: [1], series: [9] });
  const mw = igdb(119177, { genres: [5], themes: [1, 39], perspectives: [1], series: [9] });
  const [anchor] = anchorsFor(cod, ownedIndex([{ id: 'mw', name: 'Call of Duty: Modern Warfare', copies: [{ id: 'mw', name: 'Call of Duty: Modern Warfare', timePlayed: 0, igdb: mw }] }]), emptyState());
  assert.deepEqual([anchor.relation, anchor.gameplay], ['series', 'first-person war shooter']);
});

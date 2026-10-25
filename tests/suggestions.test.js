import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, ensureTarget, applyCommand } from '../tracking/domain.js';
import { ingestOwned } from '../tracking/legacy.js';
import { confirmIdentity, patchAnnotation, setUpNext, moveInQueue } from '../tracking/compat.js';
import { buildSuggestionChoices, selectSuggestions, suggestionFilters, writeSuggestionFilters, drawSuggestion, roulettePool, rememberOffer, recentTaste } from '../tracking/suggestions.js';

import { reviewLibraryMatch } from '../tracking/matches.js';

const at = '2026-09-14T18:00:00.000Z';
const catalog = { systems: [{ id: 'snes', name: 'SNES' }, { id: 'ps1', name: 'PlayStation' }], games: [
  { id: 'alpha-snes', title: 'Alpha', systemId: 'snes', rank: 30, genres: ['RPG'] },
  { id: 'zulu-snes', title: 'Zulu', systemId: 'snes', rank: 1, genres: ['Action'] },
  { id: 'beta-ps1', title: 'Beta', systemId: 'ps1', rank: 1, genres: ['RPG'] },
] };
function game(id, name, platforms = ['SNES'], sources = ['Store A']) {
  return { id, name, platforms, genres: [], hidden: false, favorite: false,
    copies: [{ id: `${id}-copy`, platforms, sources, hidden: false }] };
}
function fixture() {
  const library = [game('a', 'Alpha'), game('z', 'Zulu'), game('b', 'Beta', ['PlayStation']), game('m', 'Missing metadata', [])];
  const context = { state: emptyState(), catalog, library };
  for (const [catalogId, copyId] of [['alpha-snes','a-copy'],['zulu-snes','z-copy'],['beta-ps1','b-copy']]) context.state = reviewLibraryMatch(context.state, context, { catalogId, copyId, decision: 'accepted', expected: null, at });
  return context;
}
const desc = (id, title = id, platforms = ['SNES']) => ({ ref: { provider: 'playnite', id: `${id}-copy` }, title, platforms });
const selected = (context, filters) => selectSuggestions(buildSuggestionChoices(context), filters);
const titles = choices => choices.map(choice => choice.title);

test('suggestions are read-only, ignore playtime, and compare editorial ranks only inside a selected system', () => {
  const context = fixture(), before = structuredClone(context);
  assert.deepEqual(titles(selected(context)), ['Alpha', 'Beta', 'Missing metadata', 'Zulu']);
  assert.deepEqual(titles(selected(context, { system: 'snes' })), ['Zulu', 'Alpha']);
  assert.deepEqual(context, before);
  context.library[0].played = true; context.library[0].timePlayed = 50000;
  assert.deepEqual(titles(selected(context, { system: 'snes' })), ['Zulu', 'Alpha']);
  assert.ok(selected(context, { system: 'snes' })[0].reasons.some(reason => reason.includes('confirmed catalog match')));
  assert.equal(Object.keys(context.state.targets).length, 0);
});

test('best-rated games rise above unrated ones; critic and player scores are averaged and explained', () => {
  const context = fixture();
  context.library[2].copies[0].communityScore = 70;
  context.library[3].copies[0].criticScore = 100; context.library[3].copies[0].communityScore = 50;
  context.library[2].copies[0].communityScore = 70;
  assert.deepEqual(titles(selected(context)), ['Missing metadata', 'Beta', 'Alpha', 'Zulu']);
  assert.ok(selected(context)[0].reasons.includes('Score 72 · critics 100 · players 50 · few ratings · via Playnite'));
  assert.ok(selected(context)[1].reasons.includes('Score 70 · players 70 · few ratings · via Playnite'));
  // A curated list position still leads inside its own system.
  context.library[0].copies[0].criticScore = 99;
  assert.deepEqual(titles(selected(context, { system: 'snes' })), ['Zulu', 'Alpha']);
});

test('manual Up Next order takes precedence over active games, priority, favorites and editorial rank', () => {
  const context = fixture();
  context.state = setUpNext(context.state, desc('a', 'Alpha'), true, { at, eventId: 'a-next' });
  context.state = setUpNext(context.state, desc('z', 'Zulu'), true, { at, eventId: 'z-next' });
  const zId = ensureTarget(context.state, desc('z')).id;
  context.state = applyCommand(context.state, { targetId: zId, type: 'queue', priority: 3, eventId: 'z-priority', at });
  context.library[1].favorite = true;
  const bId = ensureTarget(context.state, desc('b', 'Beta', ['PlayStation'])).id;
  context.state = applyCommand(context.state, { type: 'start', targetId: bId, playthroughId: 'playing', eventId: 'b-start', at });
  assert.deepEqual(titles(selected(context)).slice(0, 3), ['Alpha', 'Zulu', 'Beta']);
  context.state = moveInQueue(context.state, zId, -1);
  assert.deepEqual(titles(selected(context)).slice(0, 3), ['Zulu', 'Alpha', 'Beta']);
  assert.match(selected(context)[0].reasons[0], /Up Next choice #1/);
  context.state = applyCommand(context.state, { type: 'status', targetId: bId, playthroughId: 'playing', status: 'paused', eventId: 'pause', at });
  assert.deepEqual(titles(selected(context, { intent: 'continue' })), ['Beta']);
  assert.match(selected(context, { intent: 'continue' })[0].reasons[0], /paused/);
});

test('platform, source and genre filters must match one eligible copy, not different copies in a group', () => {
  const context = fixture();
  context.library[0].copies.push({ id: 'a-port-copy', platforms: ['PlayStation'], sources: ['Store B'] });
  context.library[0].platforms.push('PlayStation');
  assert.equal(selected(context, { system: 'snes', source: 'Store B' }).length, 0);
  const result = selected(context, { system: 'ps1', source: 'Store B' });
  assert.equal(result.length, 1); assert.equal(result[0].option.descriptor.ref.id, 'a-port-copy');
  assert.equal(result[0].option.ranks.length, 0);
  assert.equal(selected(context, { system: 'ps1', source: 'Store B', genre: 'RPG' }).length, 0);
});

test('hidden and favorites rules respect edits; unavailable and missing imported copies stay excluded', () => {
  const context = fixture();
  context.library[0].hidden = true; context.library[0].copies[0].hidden = true; context.library[1].favorite = true;
  assert.ok(!titles(selected(context)).includes('Alpha'));
  assert.ok(titles(selected(context, { hidden: true })).includes('Alpha'));
  assert.deepEqual(titles(selected(context, { favorites: true })), ['Zulu']);
  context.state = patchAnnotation(context.state, { ref: { provider: 'legacy-owned', id: 'a' }, title: 'Alpha', platforms: ['SNES'] }, { hidden: false });
  assert.ok(titles(selected(context)).includes('Alpha'));
  context.state = ingestOwned(context.state, context.library);
  context.state.ownership['playnite:a-copy'].available = false;
  assert.ok(!titles(selected(context, { hidden: true, ownership: 'planned' })).includes('Alpha'));
  context.state = setUpNext(context.state, desc('z', 'Zulu'), true, { at, eventId: 'z-next' });
  context.library = context.library.filter(game => game.id !== 'z');
  assert.ok(!titles(selected(context, { ownership: 'planned' })).includes('Zulu'));
  assert.ok(context.state.ownership['playnite:z-copy']);
});

test('finished and retired playthroughs need an explicit replay; archived targets never enter the pool', () => {
  const context = fixture();
  for (const [id, status] of [['a', 'finished'], ['z', 'retired']]) {
    const targetId = ensureTarget(context.state, desc(id, id === 'a' ? 'Alpha' : 'Zulu')).id;
    context.state = applyCommand(context.state, { type: 'start', targetId, playthroughId: id, eventId: `${id}-start`, at });
    context.state = applyCommand(context.state, { type: 'status', targetId, playthroughId: id, status, eventId: `${id}-end`, at });
  }
  assert.deepEqual(titles(selected(context)), ['Beta', 'Missing metadata']);
  context.state = setUpNext(context.state, desc('a', 'Alpha'), true, { at, eventId: 'replay' });
  assert.equal(selected(context)[0].title, 'Alpha');
  const targetId = ensureTarget(context.state, desc('a')).id;
  context.state = applyCommand(context.state, { type: 'wishlist', targetId, decision: 'archived', eventId: 'archive', at });
  assert.ok(!titles(selected(context, { hidden: true, ownership: 'planned' })).includes('Alpha'));
  assert.equal(context.state.playthroughs.a.status, 'finished');
});

test('manual planning with unknown ownership requires opt-in, and an unowned wishlist alone is not playable intent', () => {
  const context = fixture(), manual = { ref: { provider: 'manual', id: 'physical' }, title: 'Offline Game', platforms: [] };
  context.state = setUpNext(context.state, manual, true, { at, eventId: 'manual-next' });
  const wishId = ensureTarget(context.state, { ref: { provider: 'steam', id: '101' }, title: 'Not purchased', platforms: ['PC'] }).id;
  context.state = applyCommand(context.state, { type: 'wishlist', targetId: wishId, decision: 'want-soon', eventId: 'wish', at });
  assert.ok(!titles(selected(context)).includes('Offline Game'));
  const results = selected(context, { ownership: 'planned' });
  assert.equal(results[0].title, 'Offline Game');
  assert.ok(results[0].reasons.some(reason => reason.includes('ownership and access are not recorded')));
  assert.ok(!titles(results).includes('Not purchased'));
  assert.ok(!titles(selected(context, { ownership: 'planned', system: 'snes' })).includes('Offline Game'));
});

test('confirmed copies share one roulette choice and recent exclusions survive identity linking', () => {
  const context = fixture();
  const catalogDesc = { ref: { provider: 'catalog', id: 'alpha-snes' }, title: 'Alpha', platforms: ['snes'] };
  const recent = rememberOffer([], selected(context)[0]);
  context.state = confirmIdentity(context.state, catalogDesc, desc('a', 'Alpha'), { at });
  context.state.ownership['manual:alpha-snes'] = { id: 'manual:alpha-snes', targetId: ensureTarget(context.state, catalogDesc).id, evidence: 'manual', source: catalogDesc.ref, acquiredAt: null };
  const choices = selected(context);
  assert.equal(choices.filter(choice => choice.title === 'Alpha').length, 1);
  assert.equal(choices.find(choice => choice.title === 'Alpha').options.length, 2);
  assert.equal(choices.find(choice => choice.title === 'Alpha').option.descriptor.ref.provider, 'playnite');
  assert.ok(!titles(roulettePool(choices, recent)).includes('Alpha'));
});

test('ambiguous titles and different editions do not inherit editorial ranks', () => {
  const context = fixture();
  context.state.matchReviews = {};
  context.library.push(game('duplicate', 'Alpha'));
  assert.equal(selected(context, { system: 'snes' }).find(choice => choice.title === 'Alpha').rank, undefined);
  context.library.push(game('remaster', 'Zulu Remastered'));
  assert.equal(selected(context, { system: 'snes' }).find(choice => choice.title === 'Zulu Remastered').rank, undefined);
});

test('roulette obeys filters, has a deliberate exhausted state, and never changes tracking', () => {
  const context = fixture(), before = structuredClone(context.state), choices = selected(context, { system: 'snes' });
  const first = drawSuggestion(choices, { random: () => 0 });
  assert.equal(first.title, 'Zulu');
  const recent = rememberOffer([], first);
  const second = drawSuggestion(choices, { recent, random: () => 0 });
  assert.equal(second.title, 'Alpha');
  const exhausted = rememberOffer(recent, second);
  assert.equal(drawSuggestion(choices, { recent: exhausted }), null);
  assert.equal(drawSuggestion(choices, { recent: exhausted, excludeRecent: false, random: () => 0.999 }).title, 'Alpha');
  assert.throws(() => drawSuggestion(choices, { random: () => 1 }), /random value/);
  let bounded = []; for (let i = 0; i < 20; i++) bounded = rememberOffer(bounded, first);
  assert.equal(bounded.length, 10); assert.deepEqual(context.state, before);
});

test('suggestion filters round-trip without losing plan links or workspace selection', () => {
  const query = new URLSearchParams('workspace=sample&view=paused&q=Metroid');
  const filters = { system: 'snes', source: 'Store A', genre: 'RPG', ownership: 'planned', intent: 'queue', hidden: true, favorites: true, mood: 'story', length: 'long', taste: 'more' };
  writeSuggestionFilters(query, filters);
  assert.deepEqual(suggestionFilters(query), filters);
  assert.equal(query.get('workspace'), 'sample'); assert.equal(query.get('view'), 'paused'); assert.equal(query.get('q'), 'Metroid');
  assert.equal(suggestionFilters(new URLSearchParams('suggestIntent=invalid&suggestHidden=false')).hidden, false);
  assert.equal(selected(fixture(), { system: 'unknown' }).length, 0);
});

test('IGDB counts outweigh thin evidence, and time to beat is explained', () => {
  const context = fixture();
  // A near-perfect score from five players loses to a well-reviewed classic.
  context.library[0].copies[0].igdb = { players: 97, playersCount: 5, critic: null, criticCount: 0 };
  context.library[1].copies[0].igdb = { players: 92, playersCount: 1727, critic: 100, criticCount: 1, ttb: { main: 30600 } };
  const result = selected(context);
  assert.deepEqual(titles(result).slice(0, 2), ['Zulu', 'Alpha']);
  assert.ok(result[0].reasons.includes('Score 92 · critics 100 (1) · players 92 (1.7k) · via IGDB'));
  assert.ok(result[0].reasons.includes('About 9h to beat'));
  assert.ok(result[1].reasons.some(reason => reason.includes('few ratings')));
});

test('demos, soundtracks and comics are never suggested unless you planned them', () => {
  const context = fixture();
  context.library.push(game('d', 'Heavy Rain Demo'), game('s', 'Q.U.B.E. 2 Soundtrack'), game('c', 'God of War Digital Comic Books'), game('r', 'Demon Turf'));
  const result = titles(selected(context));
  assert.ok(result.includes('Demon Turf'));
  assert.ok(!result.some(title => /Demo$|Soundtrack|Comic/.test(title)));
  context.state = setUpNext(context.state, desc('d', 'Heavy Rain Demo'), true, { at, eventId: 'demo-next' });
  assert.equal(titles(selected(context))[0], 'Heavy Rain Demo');
});

test('Steam-only scores are shifted onto the IGDB scale, so they do not outrank well-reviewed classics', () => {
  const context = fixture();
  context.library[0].copies[0].steamReviews = { percent: 98, count: 358 };
  context.library[1].copies[0].igdb = { players: 94, playersCount: 3000, critic: 92, criticCount: 20 };
  const result = selected(context);
  assert.deepEqual(titles(result).slice(0, 2), ['Zulu', 'Alpha']);
  assert.ok(result[1].reasons.includes('Score 87 · steam 98% positive (358) · via Steam'));
});

test('mood and length narrow tonight\'s picks, and two editions of one game take one slot', () => {
  const context = fixture();
  context.library[0].genres = ['Puzzle']; context.library[0].copies[0].igdb = { id: 7, players: 80, playersCount: 500, ttb: { main: 5 * 3600 } };
  context.library[1].genres = ['Role-playing (RPG)']; context.library[1].copies[0].igdb = { id: 8, players: 90, playersCount: 500, ttb: { main: 60 * 3600 } };
  context.library[2].genres = ['Role-playing (RPG)']; context.library[2].copies[0].igdb = { id: 8, players: 90, playersCount: 500, ttb: { main: 60 * 3600 } };
  assert.deepEqual(titles(selected(context, { mood: 'relaxed' })), ['Alpha']);
  assert.deepEqual(titles(selected(context, { length: 'long' })), ['Beta']);
  assert.deepEqual(titles(selected(context, { length: 'short' })), ['Alpha']);
  assert.ok(selected(context, { mood: 'story' })[0].reasons.some(reason => reason.includes('going by its genres: Role-playing (RPG)')));
  // Beta and Zulu share IGDB id 8: only the first of them is suggested.
  assert.equal(titles(selected(context)).filter(title => ['Beta', 'Zulu'].includes(title)).length, 1);
  const query = writeSuggestionFilters(new URLSearchParams(), { mood: 'quick', length: 'medium' });
  assert.deepEqual([suggestionFilters(query).mood, suggestionFilters(query).length], ['quick', 'medium']);
});

test('after your recent games: more of their genres, or something different', () => {
  const library = [game('doom', 'Doom'), game('quake', 'Quake'), game('myst', 'Myst'), game('tetris', 'Tetris'), game('mystery', 'No genres')];
  library[0].genres = ['Shooter']; library[1].genres = ['Shooter', 'Indie']; library[2].genres = ['Puzzle', 'Adventure']; library[3].genres = ['Puzzle'];
  const context = { state: emptyState(), catalog: { systems: [], games: [] }, library };
  const target = ensureTarget(context.state, desc('doom', 'Doom')).id;
  context.state = applyCommand(context.state, { type: 'start', targetId: target, playthroughId: 'doom-play', eventId: 'doom-start', at });
  const choices = buildSuggestionChoices(context), taste = recentTaste({ ...context, choices });
  assert.deepEqual(taste.games.map(item => item.title), ['Doom']);
  assert.deepEqual(taste.top, ['Shooter']);
  assert.deepEqual(titles(selectSuggestions(choices, { taste: 'more' }, { taste })), ['Quake']);
  assert.ok(selectSuggestions(choices, { taste: 'more' }, { taste })[0].reasons.includes('More Shooter, like Doom'));
  // Something different needs a known genre that isn't one you've been playing.
  assert.deepEqual(titles(selectSuggestions(choices, { taste: 'fresh' }, { taste })), ['Myst', 'Tetris']);
  // With no recent games, the choice changes nothing.
  assert.equal(selectSuggestions(choices, { taste: 'more' }, { taste: recentTaste({ ...context, state: emptyState(), choices }) }).length, 5);
  assert.equal(suggestionFilters(new URLSearchParams('suggestTaste=fresh')).taste, 'fresh');
});

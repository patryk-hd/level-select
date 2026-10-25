import { referenceKey } from './domain.js';
import { orderedQueue, progress } from './compat.js';
import { connectLibrary, platformKey, isExtra } from '../library/core.js';
import { copyRating, igdbRating, compareRatings, ratingText, beatHours, steamText } from './score.js';
import { awardSummary, compareWithAwards } from './awards.js';

export const SUGGESTION_DEFAULTS = { system: '', source: '', genre: '', intent: 'all', ownership: 'owned', favorites: false, hidden: false, mood: '', length: '', taste: '' };

// Tonight's quick choices. Moods are genre-based guesses, and the cards say so.
export const MOODS = {
  // Playnite/IGDB genre names and the retro catalog's own names ("Platformer", "RPG", …).
  relaxed: { label: 'Relaxed', genres: ['Puzzle', 'Simulator', 'Simulation', 'Card & Board', 'Point-and-click', 'Visual Novel', 'Educational', 'Music', 'Rhythm', 'Pinball', 'Creative'] },
  story: { label: 'Story', genres: ['Role-playing (RPG)', 'RPG', 'Adventure', 'Visual Novel', 'Point-and-click', 'Mystery'] },
  challenge: { label: 'Challenge', genres: ['Platform', 'Platformer', 'Fighting', 'Shooter', 'Shoot ’em up', "Shoot 'em up", "Hack and slash/Beat 'em up", 'Roguelike', 'Tactical', 'Real Time Strategy (RTS)', 'Turn-based strategy (TBS)', 'Strategy'] },
  quick: { label: 'Quick fun', genres: ['Arcade', 'Racing', 'Sport', 'Sports', 'Party', 'Fighting', 'Pinball', 'Music', 'Rhythm', 'Quiz/Trivia'] },
};
const inMood = (mood, genre) => MOODS[mood].genres.some(item => item.toLowerCase() === String(genre).toLowerCase());
// Main-story hours from IGDB time-to-beat. Games of unknown length are left out while a length is chosen.
export const LENGTHS = { short: { label: 'Short', hint: 'under 10h', min: 0, max: 10 }, medium: { label: 'Medium', hint: '10–30h', min: 10, max: 30 }, long: { label: 'Long', hint: '30h+', min: 30, max: Infinity } };
// "After your recent games": more of the genres you've been playing, or a change of pace.
export const TASTES = { more: { label: 'More like them' }, fresh: { label: 'Something different' } };
// Genres too broad to say how a game plays.
const BROAD = new Set(['indie', 'action', 'other', 'adventure']);
const specific = genres => genres.filter(genre => !BROAD.has(String(genre).toLowerCase()));
// The last few games you played or finished (newest first, ones you rated low or said you
// didn't enjoy left out) and the genres they share. Games logged as played before, with
// no date, aren't recent.
export function recentTaste({ state, catalog, choices, limit = 5 }) {
  const byTarget = new Map(choices.map(choice => [choice.id, choice])), catalogById = new Map(catalog.games.map(game => [game.id, game]));
  const disliked = new Set(Object.values(state.annotations).filter(note => note.enjoyed === 'no').map(note => note.targetId));
  const latest = new Map();
  for (const play of Object.values(state.playthroughs)) {
    if (!['playing', 'paused', 'finished'].includes(play.status) || Number.isFinite(play.rating) && play.rating <= 2 || disliked.has(play.targetId)) continue;
    const at = [play.finishedAt, play.startedAt].filter(Boolean).sort().at(-1); if (!at) continue;
    if ((latest.get(play.targetId) ?? '') < at) latest.set(play.targetId, at);
  }
  const genresOf = id => [...new Set([...(byTarget.get(id)?.options.flatMap(option => option.genres) ?? []),
    ...(state.targets[id]?.refs ?? []).filter(ref => ref.provider === 'catalog').flatMap(ref => catalogById.get(ref.id)?.genres ?? [])])];
  const games = [...latest].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => ({ id, title: byTarget.get(id)?.title ?? state.targets[id]?.title ?? id, genres: specific(genresOf(id)) }))
    .filter(game => game.genres.length).slice(0, limit);
  // Newer games weigh more; the main genres are the ones close to the strongest.
  const weights = new Map();
  games.forEach((game, index) => { for (const genre of game.genres) weights.set(genre, (weights.get(genre) ?? 0) + games.length - index); });
  const ranked = [...weights].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), strongest = ranked[0]?.[1] ?? 0;
  return { games, top: ranked.filter(([, weight]) => weight >= strongest / 2).slice(0, 3).map(([genre]) => genre), all: ranked.map(([genre]) => genre),
    weights: Object.fromEntries(ranked.map(([genre, weight]) => [genre.toLowerCase(), weight])) };
}
// How much of your recent genres a game shares, 0–1, weighted like recentTaste.
function similarity(taste, option) {
  const total = Object.values(taste.weights).reduce((sum, weight) => sum + weight, 0);
  return total ? [...lower(specific(option.genres))].reduce((sum, genre) => sum + (taste.weights[genre] ?? 0), 0) / total : 0;
}
const lower = genres => new Set(genres.map(genre => String(genre).toLowerCase()));
function tasteMatch(taste, filter, option) {
  if (!filter || !taste?.games.length) return true;
  const own = specific(option.genres);
  if (filter === 'more') { const top = lower(taste.top); return own.some(genre => top.has(genre.toLowerCase())); }
  const all = lower(taste.all); return own.length > 0 && !own.some(genre => all.has(genre.toLowerCase()));
}
export function suggestionFilters(query) {
  return {
    system: query.get('suggestSystem') ?? '', source: query.get('suggestSource') ?? '', genre: query.get('suggestGenre') ?? '',
    intent: ['continue', 'queue', 'discover'].includes(query.get('suggestIntent')) ? query.get('suggestIntent') : 'all',
    ownership: query.get('suggestOwnership') === 'planned' ? 'planned' : 'owned',
    favorites: query.get('suggestFavorites') === '1', hidden: query.get('suggestHidden') === '1',
    mood: Object.hasOwn(MOODS, query.get('suggestMood')) ? query.get('suggestMood') : '',
    length: Object.hasOwn(LENGTHS, query.get('suggestLength')) ? query.get('suggestLength') : '',
    taste: Object.hasOwn(TASTES, query.get('suggestTaste')) ? query.get('suggestTaste') : '',
  };
}
export function writeSuggestionFilters(query, filters) {
  for (const [key, value] of Object.entries(filters)) {
    if (!(key in SUGGESTION_DEFAULTS)) continue;
    const name = `suggest${key[0].toUpperCase()}${key.slice(1)}`;
    if (value === SUGGESTION_DEFAULTS[key]) query.delete(name);
    else query.set(name, typeof value === 'boolean' ? '1' : value);
  }
  return query;
}

// This projects choices from current facts. It never ingests ownership or writes
// progress; only reviewed matches or explicit tracking links supply catalog metadata.
export function buildSuggestionChoices({ state, catalog, library }) {
  const byRef = new Map(), annotations = new Map(), owned = new Map(), manualByTarget = new Map(), choices = new Map();
  const catalogById = new Map(catalog.games.map(game => [game.id, game]));
  const reviewed = new Map();
  for (const candidates of Object.values(connectLibrary(catalog, library, state.matchReviews).candidatesByRelease)) {
    for (const item of candidates) if (item.status === 'accepted' && item.sameSystem) {
      if (!reviewed.has(item.copyId)) reviewed.set(item.copyId, []);
      reviewed.get(item.copyId).push(catalogById.get(item.catalogId));
    }
  }
  const append = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  for (const target of Object.values(state.targets)) for (const ref of target.refs) byRef.set(referenceKey(ref), target);
  for (const item of Object.values(state.annotations)) append(annotations, item.targetId, item);
  for (const item of Object.values(state.ownership)) {
    owned.set(referenceKey(item.source), item);
    if (item.evidence === 'manual') append(manualByTarget, item.targetId, item);
  }
  const positions = new Map(orderedQueue(state).map((item, index) => [item.targetId, index]));

  function add(desc, option) {
    const target = byRef.get(referenceKey(desc.ref)), id = target?.id ?? `target:${referenceKey(desc.ref)}`;
    if (!choices.has(id)) {
      const entry = state.backlog[id], status = target ? progress(state, id) : 'untracked';
      choices.set(id, { id, title: target?.title ?? desc.title, status, priority: entry?.priority ?? 0,
        queued: Boolean(entry), queuePosition: positions.get(id) ?? null, archived: state.wishlist[id]?.decision === 'archived',
        keys: (target?.refs ?? [desc.ref]).map(referenceKey), options: [] });
    }
    const notes = annotations.get(id) ?? [];
    choices.get(id).triage ??= notes.find(item => item.triage)?.triage ?? null;
    const platforms = [...new Set(desc.platforms.map(platformKey))];
    let ranks = (target?.refs ?? [desc.ref]).filter(ref => ref.provider === 'catalog').map(ref => catalogById.get(ref.id))
      .filter(game => game && platforms.includes(game.systemId)).map(game => ({ id: game.id, systemId: game.systemId, rank: game.rank, confirmed: true, genres: game.genres ?? [] }));
    if (!ranks.length && desc.ref.provider === 'playnite') {
      ranks = (reviewed.get(desc.ref.id) ?? []).map(game => ({ id: game.id, systemId: game.systemId, rank: game.rank, confirmed: true, genres: game.genres ?? [] }));
    }
    choices.get(id).options.push({ descriptor: desc, platforms, sources: option.sources ?? [], owned: option.owned,
      ownershipReason: option.ownershipReason, unavailable: option.unavailable === true,
      hidden: option.hidden === true || notes.some(item => item.hidden === true),
      favorite: option.favorite === true || notes.some(item => item.favorite === true), rating: option.rating ?? null, beatHours: option.beatHours ?? null, steam: option.steam ?? null,
      cover: option.cover ?? null, summary: option.summary ?? '', igdb: option.igdb ?? null, awards: option.awards ?? null, vgc: option.vgc ?? null,
      genres: [...new Set([...(option.genres ?? []), ...ranks.flatMap(rank => rank.genres)])],
      ranks: ranks.filter(rank => Number.isInteger(rank.rank) && rank.rank > 0) });
  }
  for (const game of library) {
    const edit = state.annotations[`owned:${game.id}`] ?? {};
    for (const copy of game.copies) {
      const ref = { provider: 'playnite', id: copy.id };
      add({ ref, title: copy.name ?? game.name, platforms: copy.platforms ?? [], sources: copy.sources ?? [] }, {
        group: game, owned: true, ownershipReason: 'Copy in your current library import',
        sources: copy.sources, genres: game.genres, favorite: edit.favorite ?? game.favorite, rating: copyRating(copy), beatHours: beatHours(copy.igdb), steam: steamText(copy.steamReviews),
        cover: game.cover ?? null, summary: game.summary ?? '', igdb: copy.igdb ?? null, awards: copy.awards ?? game.awards ?? null, vgc: copy.vgc ?? null,
        hidden: edit.hidden ?? (game.hidden || copy.hidden), unavailable: copy.available === false || owned.get(referenceKey(ref))?.available === false,
      });
    }
  }
  for (const target of Object.values(state.targets)) {
    const records = manualByTarget.get(target.id) ?? [];
    for (const record of records) {
      // Games marked owned in Game Atlas carry the catalog's IGDB score, genres and cover.
      const game = record.source.provider === 'catalog' ? catalogById.get(record.source.id) : null;
      const cover = game?.cover?.local?.startsWith('./') ? `.${game.cover.local}` : game?.cover?.url ?? null;
      add({ ref: record.source, title: target.title, platforms: record.platforms ?? target.platforms }, {
        owned: true, ownershipReason: game ? 'Marked owned in Game Atlas' : 'Ownership recorded manually; access is not verified',
        sources: record.sources ?? (game ? ['Marked owned'] : []), unavailable: record.available === false,
        genres: game?.genres, rating: game ? igdbRating(game.igdb) : null, beatHours: beatHours(game?.igdb), igdb: game?.igdb ?? null, awards: game?.awards ?? null, cover,
      });
    }
    const tracked = state.backlog[target.id] || ['playing', 'paused', 'not-started'].includes(progress(state, target.id));
    // A missing imported copy is not a playable fallback. Its history stays in the store.
    if (!choices.has(target.id) && tracked && !target.refs.some(ref => ref.provider === 'playnite') && !records.length) {
      add({ ref: target.refs[0], title: target.title, platforms: target.platforms }, {
        owned: false, ownershipReason: 'Selected in your plan; ownership and access are not recorded',
      });
    }
  }
  return [...choices.values()];
}

export function suggestionFacets(choices, catalog) {
  const options = choices.flatMap(choice => choice.options), systems = new Map(catalog.systems.map(system => [system.id, system.name ?? system.id]));
  const unique = values => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  return { systems: unique(options.flatMap(option => option.platforms)).map(id => ({ id, label: id === 'dos' ? 'PC' : systems.get(id) ?? id })).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })),
    sources: unique(options.flatMap(option => option.sources)), genres: unique(options.flatMap(option => option.genres)) };
}

// IGDB games you have already dealt with through any copy: playing, planned, finished,
// retired or triaged. Other editions of them are not offered as something new.
export function handledGames(choices) {
  const handled = new Set();
  for (const choice of choices) {
    if (choice.status === 'untracked' && !choice.queued && !choice.triage) continue;
    for (const option of choice.options) if (option.igdb?.id) handled.add(option.igdb.id);
  }
  return handled;
}

// `taste` (from recentTaste) is needed for the "after your recent games" choice.
export function selectSuggestions(choices, input = {}, { taste = null } = {}) {
  const filters = { ...SUGGESTION_DEFAULTS, ...input }, result = [], handled = handledGames(choices);
  for (const choice of choices) {
    if (choice.archived || ['finished', 'retired'].includes(choice.status)) continue;
    const continuing = ['playing', 'paused'].includes(choice.status);
    // The games the choice is based on aren't suggestions for it.
    if (filters.taste && taste?.games.some(game => game.id === choice.id)) continue;
    if (filters.intent === 'continue' && !continuing || filters.intent === 'queue' && (!choice.queued || continuing) || filters.intent === 'discover' && (continuing || choice.queued || choice.status === 'not-started')) continue;
    const options = choice.options.filter(option => !option.unavailable && (filters.hidden || !option.hidden) &&
      (!filters.favorites || option.favorite) && (option.owned || filters.ownership === 'planned' && (choice.queued || continuing || choice.status === 'not-started')) &&
      (!filters.system || option.platforms.includes(filters.system)) && (!filters.source || option.sources.includes(filters.source)) && (!filters.genre || option.genres.includes(filters.genre)) &&
      (!filters.mood || option.genres.some(genre => inMood(filters.mood, genre))) && tasteMatch(taste, filters.taste, option) &&
      (!filters.length || option.beatHours !== null && option.beatHours >= LENGTHS[filters.length].min && option.beatHours < LENGTHS[filters.length].max));
    if (!options.length) continue;
    options.sort((a, b) => Number(b.descriptor.ref.provider === 'playnite') - Number(a.descriptor.ref.provider === 'playnite') || Number(b.favorite) - Number(a.favorite) || compareRatings(a.rating, b.rating) || referenceKey(a.descriptor.ref).localeCompare(referenceKey(b.descriptor.ref)));
    const option = options[0], rank = filters.system ? option.ranks.find(rank => rank.systemId === filters.system) : null;
    const tier = choice.queuePosition !== null ? 0 : continuing ? 1 : choice.queued || choice.status === 'not-started' ? 2 : 3;
    // Demos, soundtracks and other extras are never suggested unless you planned them yourself.
    if (tier === 3 && isExtra(choice.title)) continue;
    // Games you triaged as "not for me" stay out of suggestions until you change your mind.
    if (tier === 3 && choice.triage?.decision === 'pass') continue;
    if (tier === 3 && option.igdb?.id && handled.has(option.igdb.id)) continue;
    const reasons = [tier === 0 ? `Your Up Next choice #${choice.queuePosition + 1}` : continuing ? (choice.status === 'paused' ? 'You paused this playthrough; resume when ready' : 'You marked this playthrough as playing') : tier === 2 ? 'You selected this game for your backlog' : option.ranks.length ? 'Rediscover an owned game from a curated system list' : 'Explore a game you already own', option.ownershipReason];
    if (choice.priority) reasons.push(`Your priority: ${['Normal', 'Interested', 'Want soon', 'Highest'][choice.priority]}`);
    if (option.rating) reasons.push(`${ratingText(option.rating)} · via ${option.rating.via}`);
    const awards = awardSummary(option.awards);
    if (awards) reasons.push(awards.headline);
    if (option.steam && option.rating?.source !== 'steam') reasons.push(option.steam);
    if (option.beatHours) reasons.push(`About ${option.beatHours}h to beat`);
    if (filters.taste === 'more' && taste?.games.length) {
      const top = lower(taste.top), shared = specific(option.genres).filter(genre => top.has(genre.toLowerCase()));
      const like = taste.games.filter(game => lower(game.genres).has(shared[0]?.toLowerCase())).slice(0, 2).map(game => game.title);
      reasons.push(`More ${shared.join(', ')}${like.length ? `, like ${like.join(' and ')}` : ''}`);
    }
    if (filters.taste === 'fresh' && taste?.games.length) reasons.push(`A change from your recent ${taste.top.join(', ')}: ${specific(option.genres).join(', ')}`);
    if (filters.mood) reasons.push(`${MOODS[filters.mood].label} pick, going by its genres: ${option.genres.filter(genre => inMood(filters.mood, genre)).join(', ')}`);
    if (option.favorite) reasons.push('Marked as a favorite');
    if (option.hidden) reasons.push('Hidden game included by your filter');
    if (rank) reasons.push(`List #${rank.rank} on ${rank.systemId} · confirmed catalog match`);
    result.push({ ...choice, options, option, tier, rank, reasons, similarity: filters.taste === 'more' && taste?.games.length ? similarity(taste, option) : 0 });
  }
  result.sort((a, b) => a.tier - b.tier || (a.tier === 0 ? a.queuePosition - b.queuePosition : 0) ||
    // "More like them" puts the closest matches first.
    b.similarity - a.similarity || b.priority - a.priority || Number(b.option.favorite) - Number(a.option.favorite) ||
    (filters.system ? (a.rank?.rank ?? Infinity) - (b.rank?.rank ?? Infinity) : 0) || compareWithAwards(a.option, b.option) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  // Two editions of one game (matched to the same IGDB entry) take a single slot.
  const seen = new Set();
  return result.filter(choice => { const key = choice.option.igdb?.id; if (!key) return true; if (seen.has(key)) return false; seen.add(key); return true; });
}

export function roulettePool(choices, recent = [], excludeRecent = true) {
  const seen = new Set(recent.flat());
  return choices.filter(choice => !excludeRecent || !choice.keys.some(key => seen.has(key)));
}
export function drawSuggestion(choices, { recent = [], excludeRecent = true, random = Math.random } = {}) {
  const pool = roulettePool(choices, recent, excludeRecent);
  if (!pool.length) return null;
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Roulette requires a random value between zero and one.');
  return pool[Math.floor(value * pool.length)];
}
export function rememberOffer(recent, choice) { return [...recent, [...choice.keys]].slice(-10); }

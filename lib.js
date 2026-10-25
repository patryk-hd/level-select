import { matchesSearch, titleSearch } from './library/core.js';
import { igdbRating, reviewRating, compareRatings } from './tracking/score.js';

// A list game's score: its critic reviews and player ratings (review-backed lists), else IGDB.
export const catalogScore = game => reviewRating(game?.reviews) ?? igdbRating(game?.igdb);
// Which list a system shows: its review-backed ranking, or the original project's list
// (corrected). Systems without a review-backed list show the original either way.
export const listRank = (game, state) => state.list === 'original' ? game.legacyRank : game.rank;
// A ranked list reads in tiers: the podium, then the top 5, 10 and 25, then the rest.
export const RANK_TIERS = [[3, 'podium', 'Top 3'], [5, 'top5', 'Top 5'], [10, 'top10', 'Top 10'], [25, 'top25', 'Top 25'], [Infinity, 'rest', 'The rest of the list']];
export const rankTier = rank => rank == null ? ['off', 'Not on this list'] : RANK_TIERS.find(([max]) => rank <= max).slice(1);
// Games the chosen list leaves out have no rank and sort last.
const rankOf = (game, state) => listRank(game, state) ?? Number.MAX_SAFE_INTEGER;

export const STORAGE_KEY = 'retro-library.collection.v1';
// The public demo (npm run build -- --demo) marks every page; the mark holds the site's home
// page, relative to that page. Elsewhere this is null.
export const demoHome = () => document.querySelector('meta[name="level-select-demo"]')?.getAttribute('content') ?? null;
export const demoNote = what => `${what} works in the Level Select app on your computer. This demo shows a made-up library of real games. <a href="${escapeHtml(demoHome())}">Get Level Select</a>, free.`;
// A page shown on a paired phone (phone-access.mjs marks it). Importing, updating and adding
// games happen on the computer, which these notes say.
export const onPhone = () => Boolean(document.querySelector('meta[name="level-select-phone"]'));
// The phone app that opens your copy (npm run build -- --phone): it's a phone page too.
export const copyApp = () => Boolean(document.querySelector('meta[name="level-select-copy-app"]'));
export const phoneNote = what => copyApp() ? `${what} happens on your computer, in Level Select there. Then open your updated copy here (Your copy).`
  : `${what} happens on your computer, in Level Select there. Your phone shows the result after the next look (or reload).`;
export const PREFERENCES_KEY = 'retro-library.preferences.v1';
export const PAGE_SIZE = 36;
export const STATUSES = ['untracked', 'backlog', 'playing', 'paused', 'completed', 'dropped'];
export const STATUS_LABELS = { untracked:'Not tracked', backlog:'Backlog', playing:'Playing', paused:'Paused', completed:'Completed', dropped:'Dropped' };
export const DEFAULTS = { view:'games', q:'', family:'', systems:[], scope:'all', genres:[], yearFrom:'', yearTo:'', rank:'all', kind:'', era:'', collection:'any', sort:'score', layout:'list', page:1, game:'', ownership:'all', list:'reviews' };
export const isCatalogLanding = state => state.view === 'games' && !state.family && !state.systems.length && !state.q &&
  !state.genres.length && !state.yearFrom && !state.yearTo && !state.kind && !state.era && state.ownership === 'all' &&
  ['curated','title','score'].includes(state.sort);
export const hasSystemRank = state => state.systems.length === 1 && state.sort === 'curated';
export function catalogSystems(catalog, state, pinnedSystems = []) {
  return catalog.systems.filter(system => (!state.family || system.family === state.family) &&
    (state.systems.length ? state.systems.includes(system.id) : state.scope !== 'favorites' || pinnedSystems.includes(system.id)));
}
export const normalize = text => String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const freshState = () => ({ ...DEFAULTS, systems:[], genres:[] });
export const emptyCollection = () => ({ schemaVersion:1, entries:{}, pinnedSystems:[] });
export const isTracked = entry => Boolean(entry && (entry.favorite || entry.owned || entry.wishlist || (entry.status && entry.status !== 'untracked')));

export function parseState(search, catalog, preferredLayout = 'list') {
  const p = new URLSearchParams(search), state = freshState();
  const select = (key, options) => options.includes(p.get(key)) ? p.get(key) : state[key];
  state.view = select('view',['games','collection','systems']);
  state.q = (p.get('q') || '').slice(0,300);
  state.family = catalog.families.some(f => f.id === p.get('family')) ? p.get('family') : '';
  state.systems = [...new Set((p.get('systems') || '').split(','))].filter(id => catalog.systems.some(s => s.id === id));
  state.scope = select('scope',['all','favorites']);
  const genres = new Set(catalog.games.flatMap(g => g.genres));
  state.genres = [...new Set((p.get('genres') || '').split(','))].filter(g => genres.has(g));
  for (const key of ['yearFrom','yearTo']) { const value = p.get(key); state[key] = value && /^\d{4}$/.test(value) && +value >= 1900 && +value <= 2100 ? value : ''; }
  if (state.yearFrom && state.yearTo && +state.yearFrom > +state.yearTo) [state.yearFrom,state.yearTo] = [state.yearTo,state.yearFrom];
  state.rank = select('rank',['all','10','30']);
  state.kind = select('kind',['Console','Handheld','Hybrid','Computer','Arcade collection']);
  state.era = select('era',['before2000','2000s','2010plus']);
  state.collection = select('collection',['any','favorite','wishlist','owned',...STATUSES.slice(1)]);
  state.ownership = select('ownership',['all','owned','missing']);
  state.list = select('list',['reviews','original']);
  state.sort = select('sort',['curated','score','relevance','title','newest','oldest','vgc','igdb-community','igdb-critics']);
  // Old "top 10 on one system" bookmarks only make sense with the editorial list rank.
  if (!p.has('sort') && state.systems.length === 1 && state.rank !== 'all') state.sort = 'curated';
  if (state.q && !p.has('sort') && state.view !== 'systems' && !(state.systems.length === 1 && state.rank !== 'all')) state.sort = 'relevance';
  if (state.sort === 'curated' && state.systems.length !== 1 && (state.family || state.q || state.view === 'collection' || state.systems.length)) state.sort = 'score';
  if(!hasSystemRank(state))state.rank='all';
  state.layout = ['list','grid','spotlight'].includes(p.get('layout')) ? p.get('layout') : ['list','grid','spotlight'].includes(preferredLayout) ? preferredLayout : 'list';
  state.page = /^\d+$/.test(p.get('page') || '') ? Math.max(1,Math.min(10000,+p.get('page'))) : 1;
  state.game = catalog.games.some(g => g.id === p.get('game')) ? p.get('game') : '';
  return state;
}

export function encodeState(state) {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (!(key in DEFAULTS)) continue;
    if (Array.isArray(value)) { if (value.length) p.set(key,value.join(',')); }
    else if (value !== DEFAULTS[key] && value !== '') p.set(key,String(value));
  }
  // An explicit layout makes bookmarked views independent of browser preferences.
  p.set('layout',state.layout);
  return p.toString();
}

export function filterGames(catalog, state, collection = emptyCollection()) {
  const systems = new Map(catalog.systems.map(s => [s.id,s]));
  const order = new Map(catalog.systems.map((s,i) => [s.id,i]));
  const eligible = new Set(catalogSystems(catalog,state,collection.pinnedSystems).map(s=>s.id));
  const found = catalog.games.filter(game => {
    const system = systems.get(game.systemId), entry = collection.entries[game.id];
    if (state.ownership === 'owned' && !game.playniteOwned) return false;
    if (state.ownership === 'missing' && game.playniteOwned) return false;
    if (!system || (state.family && system.family !== state.family)) return false;
    if (state.view !== 'collection' && !eligible.has(game.systemId)) return false;
    if (state.systems.length && !state.systems.includes(game.systemId)) return false;
    if (state.genres.length && !state.genres.some(g => game.genres.includes(g))) return false;
    if (state.kind && state.kind !== system.kind) return false;
    if (hasSystemRank(state) && state.rank !== 'all' && rankOf(game, state) > +state.rank) return false;
    // Not on the chosen list: still there for search, tracking and owned copies. An entry
    // taken out of the original list (not a released game there) only for the last two.
    if (listRank(game, state) == null && state.view !== 'collection' && !isTracked(entry) && !game.playniteOwned && (!state.q || game.correction?.removed)) return false;
    if (state.yearFrom && game.year < +state.yearFrom) return false;
    if (state.yearTo && game.year > +state.yearTo) return false;
    if (state.era === 'before2000' && game.year >= 2000) return false;
    if (state.era === '2000s' && (game.year < 2000 || game.year >= 2010)) return false;
    if (state.era === '2010plus' && game.year < 2010) return false;
    if (state.view === 'collection' && !isTracked(entry)) return false;
    if (state.view === 'collection' && state.collection !== 'any') {
      if (STATUSES.includes(state.collection) ? entry?.status !== state.collection : !entry?.[state.collection]) return false;
    }
    return matchesSearch(game,state.q);
  });
  const search = titleSearch(state.q);
  return found.sort((a,b) => {
    if (state.sort === 'relevance') return search.compare(a,b) || order.get(a.systemId) - order.get(b.systemId);
    if (state.sort === 'title' || state.sort === 'curated' && state.systems.length !== 1) return a.title.localeCompare(b.title) || order.get(a.systemId) - order.get(b.systemId);
    if (state.sort === 'score') return compareRatings(catalogScore(a), catalogScore(b)) || a.title.localeCompare(b.title);
    if (state.sort === 'newest' && a.year !== b.year) return b.year-a.year;
    if (state.sort === 'oldest' && a.year !== b.year) return a.year-b.year;
    return order.get(a.systemId)-order.get(b.systemId) || rankOf(a, state)-rankOf(b, state);
  });
}

export function paginate(games, requestedPage, size = PAGE_SIZE) {
  const pages = Math.max(1,Math.ceil(games.length/size));
  const page = Math.max(1,Math.min(pages,Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  return { page, pages, total:games.length, start:(page-1)*size, items:games.slice((page-1)*size,page*size) };
}

export function validateCollection(value, catalog) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries) || !Array.isArray(value.pinnedSystems)) throw new Error('Choose a Level Select backup with schema version 1.');
  if (Object.keys(value.entries).length > 20000 || value.pinnedSystems.length > 1000) throw new Error('This backup is too large.');
  const validIds = new Set(catalog.games.map(g => g.id));
  const validSystems = new Set(catalog.systems.map(s => s.id));
  const clean = emptyCollection(); let skipped = 0;
  for (const [id,entry] of Object.entries(value.entries)) {
    if (!validIds.has(id)) { skipped++; continue; }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !STATUSES.includes(entry.status ?? 'untracked')) throw new Error('A game has an invalid play status. No data was imported.');
    for (const key of ['favorite','owned','wishlist']) if (key in entry && typeof entry[key] !== 'boolean') throw new Error('A game has an invalid collection flag. No data was imported.');
    const record = { favorite:entry.favorite === true, owned:entry.owned === true, wishlist:entry.wishlist === true, status:entry.status || 'untracked' };
    if (isTracked(record)) clean.entries[id] = record;
  }
  clean.pinnedSystems = [...new Set(value.pinnedSystems)].filter(id => validSystems.has(id));
  return { collection:clean, skipped };
}

export function mergeCollections(current, incoming) {
  return { schemaVersion:1, entries:{...current.entries,...incoming.entries}, pinnedSystems:[...new Set([...current.pinnedSystems,...incoming.pinnedSystems])] };
}

export function updateEntry(collection,id,patch) {
  const next = { favorite:false,owned:false,wishlist:false,status:'untracked',...collection.entries[id],...patch };
  const entries = {...collection.entries};
  if (isTracked(next)) entries[id] = next; else delete entries[id];
  return {...collection,entries};
}

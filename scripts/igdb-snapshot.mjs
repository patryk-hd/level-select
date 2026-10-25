// Attach saved IGDB evidence (library/data/igdb.json) to the private library,
// wishlist and catalog as they are served. Source imports are never rewritten.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOverrides, applyOverrides } from './igdb-overrides.mjs';

const USABLE = new Set(['high', 'medium']);

export async function readIgdb(root) {
  try {
    const state = JSON.parse(await readFile(path.join(root, 'library/data/igdb.json'), 'utf8'));
    // Your corrections always win over automatic matches.
    return state.schemaVersion === 1 ? applyOverrides(state, await readOverrides(root)) : null;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

const rated = game => game && (game.criticCount > 0 || game.playersCount > 0);

// The compact per-game record the browser sees.
export function igdbRecord(state, link) {
  if (!link || !USABLE.has(link.confidence)) return null;
  const game = state.games[link.igdbId];
  if (!game) return null;
  // An edition without its own reception borrows its parent game's, and says so.
  const parent = !rated(game) && game.versionParent ? state.games[game.versionParent] : null;
  const source = rated(parent) ? parent : game;
  const ttb = state.ttb[game.id] ?? (parent ? state.ttb[parent.id] : null) ?? null;
  return {
    id: game.id, name: game.name, year: game.year, url: game.url, confidence: link.confidence, method: link.method ?? null,
    // IGDB's game type and edition parent tell a remaster or an edition from a different game.
    type: game.type ?? null, versionParent: game.versionParent ?? null,
    critic: source.critic, criticCount: source.criticCount, players: source.players, playersCount: source.playersCount,
    ratingsFrom: source === game ? null : source.name, steam: game.steam, ttb,
    series: game.series ?? [], franchises: game.franchises ?? [], similar: game.similar ?? [],
    genres: game.genres ?? [], themes: game.themes ?? [], perspectives: game.perspectives ?? [],
  };
}

// A link that contradicts the copy's own Steam app is a same-name mix-up when the years
// disagree too: IGDB lists other Steam apps for that game (e.g. the 2022 "Call of Duty"
// app matched to the 2003 game). No score beats another game's score. Links you
// confirmed or picked by hand are always kept.
export function contradictsCopy(copy, record, link) {
  if (['manual', 'confirmed'].includes(link?.method)) return false;
  const app = copy.steamAppId ? String(copy.steamAppId) : null, steam = record.steam ?? [];
  if (!app || !steam.length || steam.includes(app)) return false;
  return !record.year || !copy.year || Math.abs(copy.year - record.year) > 1;
}

export function attachOwned(state, groups) {
  for (const group of groups) for (const copy of group.copies) {
    const link = state.links.owned[copy.id];
    let record = igdbRecord(state, link);
    if (record && contradictsCopy({ ...copy, year: copy.year ?? group.year }, record, link)) record = null;
    // ROM copies keep the Atlas game's record when IGDB hasn't matched the ROM itself.
    if (record) copy.igdb = record; else if (!copy.rom) delete copy.igdb;
  }
  for (const group of groups) fillFromIgdb(state, group);
  return groups;
}
const igdbCover = id => `https://images.igdb.com/igdb/image/upload/t_cover_big/${encodeURIComponent(id)}.jpg`;
// What Playnite left blank or dated by a store listing, from the matched IGDB game: the
// cover and description when there are none, and the original release year when Playnite
// has none or a later one (stores often date a game by when it was listed: Epic's 2021
// Alien: Isolation came out in 2014).
export function fillFromIgdb(state, group) {
  const games = group.copies.map(copy => copy.igdb && state.games[copy.igdb.id]).filter(Boolean);
  if (!games.length) return group;
  if (!group.cover) { const art = games.find(game => game.cover); if (art) { group.cover = igdbCover(art.cover); group.coverSource = 'igdb'; } }
  if (!group.summary) { const text = games.find(game => game.summary); if (text) { group.summary = text.summary; group.summarySource = 'igdb'; } }
  for (const copy of group.copies) {
    const year = copy.igdb?.year;
    if (Number.isInteger(year) && (!copy.year || year < copy.year)) { copy.storeYear = copy.year ?? null; copy.year = year; }
  }
  const years = group.copies.map(copy => copy.year).filter(Number.isInteger);
  if (years.length && (!group.year || Math.min(...years) < group.year)) { group.storeYear = group.year ?? null; group.year = Math.min(...years); }
  return group;
}
export function attachWishlist(state, items) {
  for (const item of items) {
    const record = igdbRecord(state, state.links.wishlist[String(item.appid)]);
    if (record) item.igdb = record; else delete item.igdb;
  }
  return items;
}
export function attachCatalog(state, catalog) {
  for (const game of catalog.games) {
    const record = igdbRecord(state, state.links.catalog[game.id]);
    if (record) game.igdb = record; else delete game.igdb;
  }
  return catalog;
}

// The Steam product of an owned Steam copy: an explicit import id, else the single
// Steam id IGDB lists for a confident match. Several ids (e.g. original and
// enhanced editions) stay ambiguous rather than guessed.
export function ownedSteamId(copy) {
  if (!(copy.sources ?? []).includes('Steam')) return null;
  if (copy.steamAppId && copy.steamAppIdProvenance?.origin !== 'title-search') return copy.steamAppId;
  const ids = copy.igdb?.steam ?? [];
  return ids.length === 1 ? ids[0] : null;
}

// Saved Steam review summaries by app id, from library/data/ratings.json rows.
export function steamSummaries(ratings) {
  const byId = new Map();
  for (const row of ratings?.rows ?? []) {
    const observation = row.provider === 'steam' && row.observations?.find(item => item.lane === 'steam-approval');
    const original = observation?.original;
    if (original && Number.isFinite(original.count)) byId.set(row.providerId, { appid: row.providerId, percent: original.count ? Math.round(original.positive / original.count * 100) : null, count: original.count, observedAt: row.observedAt });
  }
  return byId;
}
export function attachOwnedSteam(summaries, groups) {
  for (const group of groups) for (const copy of group.copies) {
    const summary = summaries.get(ownedSteamId(copy) ?? '');
    if (summary) copy.steamReviews = summary; else delete copy.steamReviews;
  }
}

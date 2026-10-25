// Steam reviews and VideoGamesCritic scores for Game Atlas games that are on Steam (the PC
// list): context next to our score, never part of the ranking. Cached privately in
// library/data/atlas-steam.json (VGC shares library/data/vgc.json) and added to the
// catalog when the app serves it.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { storeItems } from './sources.mjs';

export const ATLAS_STEAM_FILE = 'library/data/atlas-steam.json';
const FRESH_DAYS = 3, DAY = 86400000;

// The Steam apps of Atlas games (data/catalog.json's steamAppId).
export const atlasAppids = catalog => [...new Set((catalog?.games ?? []).map(game => game.steamAppId).filter(Boolean).map(String))];

export async function readAtlasSteam(root) {
  try { return JSON.parse(await readFile(path.join(root, ATLAS_STEAM_FILE), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, apps: {} }; throw error; }
}

// One Steam request per 100 games, at most every few days.
export async function refreshAtlasSteam(root, { appids, fetchImpl = fetch, now = () => new Date(), force = false }) {
  const cache = await readAtlasSteam(root);
  const missing = appids.filter(appid => !(appid in cache.apps));
  if (!force && !missing.length && cache.fetchedAt && now() - Date.parse(cache.fetchedAt) < FRESH_DAYS * DAY) return { fetched: 0 };
  const items = await storeItems(appids, { fetchImpl });
  for (const appid of appids) {
    const reviews = items.get(appid)?.reviews;
    cache.apps[appid] = reviews ? { count: reviews.count, percent: reviews.percPositive } : null;
  }
  cache.fetchedAt = now().toISOString();
  const file = path.join(root, ATLAS_STEAM_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(cache)); await rename(`${file}.tmp`, file);
  return { fetched: appids.length };
}

// Adds steamReviews ({ count, percent }) and vgc (a scored VGC record) to catalog games.
export function attachAtlasScores(catalog, { steam = null, vgc = null }) {
  for (const game of catalog.games) {
    const appid = game.steamAppId && String(game.steamAppId);
    if (!appid) continue;
    const reviews = steam?.apps?.[appid];
    if (reviews?.count > 0) game.steamReviews = reviews;
    const entry = vgc?.games?.[appid];
    if (entry?.status === 'scored' && entry.score != null) game.vgc = entry;
  }
  return catalog;
}

// VideoGamesCritic (VGC) scores for your Steam games and wishlist: a patch-aware blend of
// critic reviews (OpenCritic) and player reviews (Steam), cached privately in
// library/data/vgc.json and shown next to our own score.
//
//   npm run vgc:refresh   (scripts/vgc-refresh.mjs)
//
// Without a key the API allows 60 requests an hour, so a big library fills in over several
// updates (missing games first, then the stalest). A free key allows 5,000 a day: saved in
// Import games → Scores (library/data/secrets.json), or VGC_API_KEY in the environment. Terms: wherever a VGC number is shown, the app says
// "Powered by VideoGamesCritic" and links to the game's page.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const VGC_FILE = 'library/data/vgc.json';
const API = 'https://videogamescritic.com/api/v1';
const FRESH_DAYS = 14, MISSING_DAYS = 45, DAY = 86400000;

export async function readVgc(root) {
  try { return JSON.parse(await readFile(path.join(root, VGC_FILE), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, games: {} }; throw error; }
}
async function saveVgc(root, cache) {
  const file = path.join(root, VGC_FILE); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(cache)); await rename(`${file}.tmp`, file);
}

// The parts of a VGC game page the app uses.
export function vgcRecord(body) {
  const scores = body.scores ?? {}, patch = scores.sincePatch;
  return { status: body.status ?? 'scored', score: scores.vgc ?? null, players: scores.players ?? null, critics: scores.critics ?? null, criticCount: scores.criticCount ?? 0,
    confidence: scores.confidence ?? null, trend: scores.trend ?? null, gap: scores.gap?.verdict ?? null,
    sincePatch: patch?.score != null ? { score: patch.score, reviews: patch.reviews ?? null, title: patch.patch?.title ?? null, date: patch.patch?.date ?? null } : null,
    url: body.links?.page ?? body.url ?? null, updatedAt: scores.updatedAt ?? null };
}

// Steam apps worth looking up: your Steam copies (or the one Steam app IGDB knows for a
// copy bought elsewhere) and every wishlist game.
export function vgcAppids(groups, wishlist) {
  const ids = new Set();
  for (const group of groups) for (const copy of group.copies) {
    const app = copy.steamAppId || (copy.igdb?.steam?.length === 1 ? copy.igdb.steam[0] : null);
    if (app) ids.add(String(app));
  }
  for (const item of wishlist) if (item.appid) ids.add(String(item.appid));
  return [...ids];
}

// Missing first, then the stalest; games VGC doesn't know are retried after longer. Ties keep
// the order given, so your own games (listed first) come before the Game Atlas's.
export function vgcQueue(cache, appids, now = Date.now()) {
  const age = appid => { const entry = cache.games[appid]; return entry ? now - Date.parse(entry.fetchedAt) : Infinity; };
  const order = new Map(appids.map((appid, index) => [appid, index]));
  return appids.filter(appid => { const entry = cache.games[appid]; return !entry || age(appid) > (entry.status === 'missing' ? MISSING_DAYS : FRESH_DAYS) * DAY; })
    .sort((a, b) => (age(a) === age(b) ? 0 : age(b) - age(a)) || order.get(a) - order.get(b));
}

export async function refreshVgc(root, { appids, key = process.env.VGC_API_KEY, fetch = globalThis.fetch, max = key ? 4000 : 55, now = () => new Date(), log = () => {} }) {
  const cache = await readVgc(root), queue = vgcQueue(cache, appids, now().getTime());
  let fetched = 0, limited = false, failures = 0;
  for (const appid of queue.slice(0, max)) {
    const response = await fetch(`${API}/game/${appid}`, { headers: { Accept: 'application/json', 'User-Agent': 'RetroLibrary/0.1 (personal game library)', ...(key ? { Authorization: `Bearer ${key}` } : {}) } });
    if (response.status === 429) { limited = true; break; }
    if (response.status === 404) cache.games[appid] = { status: 'missing', fetchedAt: now().toISOString() };
    else if (response.ok) cache.games[appid] = { ...vgcRecord(await response.json()), fetchedAt: now().toISOString() };
    else { if (++failures >= 3) { log(`VideoGamesCritic answered HTTP ${response.status}; stopping for now.`); break; } continue; }
    failures = 0;
    // Saved every 25 games, with a count the app shows as progress.
    if (++fetched % 25 === 0) { await saveVgc(root, cache); log(`VideoGamesCritic: ${fetched}/${Math.min(queue.length, max)} looked up`); }
    // Stay inside the hourly allowance rather than hitting it.
    if (Number(response.headers.get('x-ratelimit-remaining') ?? Infinity) <= 1) { limited = true; break; }
  }
  cache.updatedAt = now().toISOString();
  // Import games shows how many are waiting, and suggests a free key when there's no key.
  cache.lastRun = { at: cache.updatedAt, fetched, waiting: Math.max(0, queue.length - fetched), keyed: Boolean(key), limited };
  await saveVgc(root, cache);
  return { fetched, waiting: Math.max(0, queue.length - fetched), limited };
}

// Attach scored games to Steam copies and wishlist games.
export function attachVgc(cache, { groups = [], wishlist = [] }) {
  const scored = appid => { const entry = appid && cache?.games?.[String(appid)]; return entry?.status === 'scored' && entry.score != null ? entry : null; };
  for (const group of groups) for (const copy of group.copies) {
    const entry = scored(copy.steamAppId || (copy.igdb?.steam?.length === 1 ? copy.igdb.steam[0] : null));
    if (entry) copy.vgc = entry; else delete copy.vgc;
  }
  for (const item of wishlist) { const entry = scored(item.appid); if (entry) item.vgc = entry; else delete item.vgc; }
}

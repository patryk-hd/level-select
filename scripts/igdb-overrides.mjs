// Your corrections to IGDB matches, kept in private library/data/igdb-overrides.json.
// They win over automatic matching and survive every refresh.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const COLLECTIONS = ['owned', 'wishlist', 'catalog'];

// Only this app's own pages may save corrections: same origin, a custom header
// (which other sites cannot send without a CORS preflight we never approve) and JSON.
export function correctionRequestAllowed({ method, headers }, port) {
  return method === 'POST' && [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(headers.origin) &&
    headers['x-retro-library'] === '1' && String(headers['content-type'] ?? '').startsWith('application/json');
}
export const DECISIONS = ['confirmed', 'rejected', 'replaced'];
const file = root => path.join(root, 'library/data/igdb-overrides.json');

// A replacement names the IGDB game by numeric id or by the slug in its page link
// (igdb.com/games/<slug>); a slug is resolved to an id on the next refresh.
export function validateOverride({ collection, key, decision, igdbId = null, slug = null }) {
  if (!COLLECTIONS.includes(collection)) throw new Error('Unknown collection.');
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(key)) throw new Error('Invalid game key.');
  if (!DECISIONS.includes(decision)) throw new Error('Unknown decision.');
  const validId = Number.isSafeInteger(igdbId) && igdbId > 0, validSlug = typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,119}$/.test(slug);
  if (decision === 'replaced' ? !(validId || validSlug) || (igdbId !== null && !validId) || (slug !== null && !validSlug) : igdbId !== null || slug !== null) throw new Error('Paste an IGDB game link or id.');
  return { collection, key, decision, igdbId, slug };
}

export async function readOverrides(root) {
  try {
    const value = JSON.parse(await readFile(file(root), 'utf8'));
    return value?.schemaVersion === 1 && value.overrides && typeof value.overrides === 'object' ? value : { schemaVersion: 1, overrides: {} };
  } catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, overrides: {} }; throw error; }
}

export async function saveOverride(root, input, at = new Date().toISOString()) {
  const override = validateOverride(input), data = await readOverrides(root);
  data.overrides[`${override.collection}:${override.key}`] = { decision: override.decision, igdbId: override.igdbId, slug: override.slug, at };
  await mkdir(path.dirname(file(root)), { recursive: true });
  await writeFile(`${file(root)}.tmp`, JSON.stringify(data, null, 1)); await rename(`${file(root)}.tmp`, file(root));
  return data;
}

// Forget a correction (the game was removed from your library).
export async function removeOverride(root, collection, key) {
  const data = await readOverrides(root), id = `${collection}:${key}`;
  if (!(id in data.overrides)) return data;
  delete data.overrides[id];
  await writeFile(`${file(root)}.tmp`, JSON.stringify(data, null, 1)); await rename(`${file(root)}.tmp`, file(root));
  return data;
}

// Apply corrections to the links of an igdb.json state (in place).
export function applyOverrides(state, data) {
  for (const [id, override] of Object.entries(data?.overrides ?? {})) {
    const split = id.indexOf(':'), collection = id.slice(0, split), key = id.slice(split + 1);
    const links = state.links[collection]; if (!links) continue;
    const link = links[key] ?? { igdbId: null, confidence: 'none', method: 'manual', fingerprint: null };
    if (override.decision === 'confirmed' && link.igdbId) links[key] = { ...link, confidence: 'high', method: 'confirmed' };
    if (override.decision === 'rejected') links[key] = { ...link, igdbId: null, confidence: 'none', method: 'rejected' };
    // Until a slug is resolved there is no game to show, so the old score is hidden.
    if (override.decision === 'replaced') links[key] = override.igdbId ? { ...link, igdbId: override.igdbId, confidence: 'high', method: 'manual' } : { ...link, igdbId: null, confidence: 'none', method: 'manual-pending' };
  }
  return state;
}

// Your tracking (plans, progress, XP, notes) kept by the app in library/data/tracking/, one
// file per workspace, so every browser on this computer and every phone you pair shares one
// copy. The browser keeps its own copy too (tracking/browser.js), so nothing depends on
// either alone. A save only lands on top of the version it was made from.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { validateState } from '../tracking/backup.js';
import { NAMESPACES } from '../tracking/domain.js';

export const TRACKING_DIR = 'library/data/tracking';
export const MAX_TRACKING_BYTES = 25 * 1024 * 1024;
const fileOf = (root, namespace) => {
  if (!NAMESPACES.includes(namespace)) throw Object.assign(new Error('Unknown tracking workspace.'), { status: 400 });
  return path.join(root, TRACKING_DIR, `${namespace}.json`);
};

export async function readTracking(root, namespace) {
  let raw;
  try { raw = await readFile(fileOf(root, namespace), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const state = validateState(JSON.parse(raw));
  if (state.namespace !== namespace) throw new Error('Wrong workspace in the tracking file.');
  return state;
}

// One save at a time, so two devices can't both build on the same version.
let queue = Promise.resolve();
// { base, state } saves state as base + 1 when the stored version is still base.
// { seed: true, state } is the first save, from a browser's own copy, when nothing is stored.
// Returns { state } (saved) or { conflict: true, state } (the newer stored version).
export function writeTracking(root, namespace, { base = null, state, seed = false }) {
  const run = async () => {
    const file = fileOf(root, namespace), current = await readTracking(root, namespace);
    let next;
    try { next = validateState(state); } catch (error) { throw Object.assign(error, { status: 400 }); }
    if (next.namespace !== namespace) throw Object.assign(new Error('That tracking belongs to another workspace.'), { status: 400 });
    if (seed ? current : (current?.revision ?? 0) !== base || next.revision !== base + 1) return { conflict: true, state: current };
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(next)); await rename(`${file}.tmp`, file);
    return { state: next };
  };
  const result = queue.then(run);
  queue = result.catch(() => {});
  return result;
}

// GET /__retro_library/tracking?namespace=… and POST { namespace, base, state, seed }.
// canWrite(req) is the server's own check (its address, its header): see serve.mjs.
export async function handleTracking(req, res, { root, canWrite, onSaved = () => {} }) {
  if (new URL(req.url, 'http://x').pathname !== '/__retro_library/tracking') return false;
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  try {
    if (req.method === 'GET') { send(200, { state: await readTracking(root, new URL(req.url, 'http://x').searchParams.get('namespace') ?? '') }); return true; }
    if (!canWrite(req)) { send(403, { error: 'Forbidden' }); return true; }
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > MAX_TRACKING_BYTES) { send(413, { error: 'Tracking is too large.' }); return true; } chunks.push(chunk); }
    const { namespace, base = null, state, seed = false } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const result = await writeTracking(root, namespace, { base, state, seed: Boolean(seed) });
    if (!result.conflict) onSaved(namespace);
    send(result.conflict ? 409 : 200, result);
  } catch (error) { send(error.status ?? 500, { error: error.message }); }
  return true;
}

// Your copy, on the Level Select phone app (scripts/phone-copy.mjs makes it on your computer).
// Opening it here: read the file, check the passphrase, decrypt and unpack it with the
// browser's own Web Crypto and decompression, keep your library's files for the service
// worker (phone-sw.js) to serve, and bring your computer's plan into this phone's.
// Nothing leaves the phone: the file is read where it is.
import { openTracking } from '../tracking/browser.js';
import { previewMerge, mergeBackup } from '../tracking/backup.js';

export const COPY_CACHE = 'level-select-copy';
const INFO = 'level-select-copy-info', REMEMBERED = 'level-select-copy-passphrase';
const scope = () => new URL('../', import.meta.url).href;
const bytes = base64 => Uint8Array.from(atob(base64), char => char.charCodeAt(0));

export function copyInfo() { try { return JSON.parse(localStorage.getItem(INFO)); } catch { return null; } }
export const rememberedPassphrase = () => { try { return localStorage.getItem(REMEMBERED) ?? ''; } catch { return ''; } };

// The file's outside: is it a copy, and does it need a passphrase?
export function readCopyFile(text) {
  let file;
  try { file = JSON.parse(text); } catch { throw new Error('This isn’t a Level Select copy. Choose level-select-copy.json.'); }
  if (file?.format !== 'level-select-copy') throw new Error('This isn’t a Level Select copy. Choose level-select-copy.json.');
  if (file.version !== 1) throw new Error('This copy is from a newer Level Select. Reload this page (or update the app) and try again.');
  return file;
}

async function unpack(file, passphrase) {
  let packed = bytes(file.data);
  if (file.encrypted) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: file.kdf.hash, iterations: file.kdf.iterations, salt: bytes(file.kdf.salt) }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    try { packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(file.iv) }, key, packed)); }
    catch { throw new Error('That passphrase doesn’t open this copy. It’s the one you set on your computer (On your phone → Away from home).'); }
  }
  const text = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text);
}

// Your computer's plan joins this phone's: what's new comes in, and where both changed a
// record, the computer's version is kept, except this phone's own history (finished games,
// rewards), which is never replaced.
const HISTORY = ['events', 'rewardEvidence', 'rewardAdjustments', 'challengeRevisions', 'challengeEvidence', 'challengeAwards', 'listAwards'];
async function bringPlan(incoming) {
  if (!incoming) return 'no plan in this copy';
  const tracking = await openTracking({ namespace: 'personal' });
  try {
    await tracking.update(current => {
      if (!current.revision) return { ...incoming, revision: current.revision + 1 };
      const preview = previewMerge(current, incoming), resolutions = {};
      for (const conflict of preview.conflicts) resolutions[`${conflict.section}/${conflict.id}`] = HISTORY.includes(conflict.section) ? 'current' : 'incoming';
      return mergeBackup(current, incoming, resolutions, { at: new Date().toISOString(), eventId: crypto.randomUUID(), reason: 'your copy from your computer' });
    });
    return 'plan updated';
  } finally { await tracking.close?.(); }
}

// Opens the file with the passphrase (if it has one) and keeps it on this phone.
export async function openCopy(text, passphrase = '', { remember = true } = {}) {
  const file = readCopyFile(text), payload = await unpack(file, passphrase);
  const cache = await caches.open(COPY_CACHE);
  for (const [name, body] of Object.entries(payload.files ?? {})) {
    if (!/^library\/data\/(?:library-data\.js|wishlist-data\.js|connections\.json|ratings\.json)$/.test(name)) continue;
    await cache.put(new URL(name, scope()).href, new Response(body, { headers: { 'Content-Type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json; charset=utf-8' } }));
  }
  // The library opens even if the plan can't join (it says why; Backup & import can merge it).
  const plan = await bringPlan(payload.tracking?.personal ?? null).catch(error => `plan not merged: ${error.message}`);
  const games = (() => { try { const window = {}; new Function('window', payload.files['library/data/library-data.js'])(window); return window.PLAYNITE_LIBRARY?.length ?? null; } catch { return null; } })();
  const info = { createdAt: payload.createdAt, openedAt: new Date().toISOString(), games, encrypted: Boolean(file.encrypted), plan };
  try {
    localStorage.setItem(INFO, JSON.stringify(info));
    if (file.encrypted && remember) localStorage.setItem(REMEMBERED, passphrase); else localStorage.removeItem(REMEMBERED);
  } catch {}
  return info;
}

// Takes your library off this phone (the app shows the sample again). Your plan stays,
// until you clear this site's data in the browser.
export async function removeCopy() {
  await caches.delete(COPY_CACHE);
  try { localStorage.removeItem(INFO); localStorage.removeItem(REMEMBERED); } catch {}
}

// Responses the server builds (the library snapshot, the catalog with your private evidence,
// ratings) are built once and reused until a data file changes. Each request compares the
// size, modification time and inode of every file in the data folders, so an update, import
// or edit shows up on the very next request: nothing is ever served stale.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const WATCHED = ['data', 'library/data', 'library/data/sources', 'library/sample'];

export async function fingerprint(root, dirs = WATCHED) {
  const lists = await Promise.all(dirs.map(async dir => {
    const entries = await readdir(path.join(root, dir), { withFileTypes: true }).catch(() => []);
    return Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
      const info = await stat(path.join(root, dir, entry.name), { bigint: true }).catch(() => null);
      return info ? `${dir}/${entry.name}:${info.size}:${info.mtimeNs}:${info.ino}` : '';
    }));
  }));
  return lists.flat().sort().join('\n');
}

// A response body with its validator, so an unchanged file is answered with 304.
export const entity = text => {
  const body = Buffer.from(text);
  return { body, etag: `"${createHash('sha1').update(body).digest('base64url')}"` };
};

// cached(name, build): build's result, rebuilt only when the data files changed. Requests
// that arrive while it is being built share the same build.
export function responseCache(root, { dirs = WATCHED } = {}) {
  const entries = new Map();
  return async function cached(name, build) {
    const key = await fingerprint(root, dirs);
    const hit = entries.get(name);
    if (hit?.key === key) return hit.value;
    const value = Promise.resolve().then(build);
    entries.set(name, { key, value });
    value.catch(() => { if (entries.get(name)?.value === value) entries.delete(name); });
    return value;
  };
}

// The browser keeps a copy but asks before each use; unchanged answers are a bodiless 304.
export function sendEntity(req, res, { body, etag }, type) {
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag };
  if (matches(req, etag)) { res.writeHead(304, headers); res.end(); return; }
  res.writeHead(200, headers); res.end(body);
}

export const matches = (req, etag) => Boolean(req.headers['if-none-match']?.split(',').map(tag => tag.trim().replace(/^W\//, '')).some(tag => tag === etag || tag === '*'));

// A static file's validator from its size and modification time, without reading it.
export const fileTag = info => `"${info.size.toString(36)}-${Math.round(info.mtimeMs * 1000).toString(36)}"`;

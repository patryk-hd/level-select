// Responses the server builds (the library snapshot, the catalog with your private evidence,
// ratings) are built once and reused until a data file changes. Each request compares the
// size, modification time and inode of every file in the data folders, so an update, import
// or edit shows up on the very next request: nothing is ever served stale.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
const gzipped = promisify(gzip);

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
// With compression (a paired phone), text goes gzipped, under a tag of its own.
export async function sendEntity(req, res, { body, etag }, type, compress = null) {
  const packed = Boolean(compress?.wanted(req, type, body.length)), tag = packed ? compress.tag(etag) : etag;
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: tag, ...(compress && { Vary: 'Accept-Encoding' }) };
  if (matches(req, tag)) { res.writeHead(304, headers); res.end(); return; }
  if (packed) { const zipped = await compress.body(tag, () => body); res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' }); res.end(zipped); return; }
  res.writeHead(200, headers); res.end(body);
}

// Over Wi-Fi, a paired phone gets text compressed: the catalog, a library and its scores shrink
// to a tenth or less. On this computer it would only add time, so only phones are sent it.
// Each body is compressed once and kept by its tag (the newest few).
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|manifest\+json)|image\/svg\+xml)/;
export const acceptsGzip = req => String(req.headers['accept-encoding'] ?? '').toLowerCase().split(',').some(part => {
  const [name, ...params] = part.split(';').map(item => item.trim());
  return name === 'gzip' && !params.some(param => /^q=0(?:\.0*)?$/.test(param));
});
export function compression({ keep = 32 } = {}) {
  const kept = new Map();
  return {
    wanted: (req, type, size) => size >= 1024 && COMPRESSIBLE.test(type) && acceptsGzip(req),
    tag: etag => etag.replace(/"$/, '-gz"'),
    body(tag, read) {
      let found = kept.get(tag);
      if (!found) {
        found = Promise.resolve().then(read).then(body => gzipped(body));
        kept.set(tag, found);
        found.catch(() => { if (kept.get(tag) === found) kept.delete(tag); });
        while (kept.size > keep) kept.delete(kept.keys().next().value);
      }
      return found;
    },
  };
}

export const matches = (req, etag) => Boolean(req.headers['if-none-match']?.split(',').map(tag => tag.trim().replace(/^W\//, '')).some(tag => tag === etag || tag === '*'));

// A static file's validator from its size and modification time, without reading it.
export const fileTag = info => `"${info.size.toString(36)}-${Math.round(info.mtimeMs * 1000).toString(36)}"`;

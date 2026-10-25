// Opt-in public metadata audit. Never reads personal imports, keys or tracking.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--fetch') throw Error('Usage: node scripts/audit-ranking-coverage.mjs --fetch <cache-directory> (up to 50 anonymous requests)');
const cache = path.resolve(args[1]);
const manifest = JSON.parse(await readFile(new URL('../ranking/pilot-manifest.json', import.meta.url)));
if (manifest.entries.length > 50) throw Error('Audit request budget exceeded');
await mkdir(cache, { recursive: true });
for (const entry of manifest.entries) {
  const file = path.join(cache, `${entry.id}.json`);
  try { JSON.parse(await readFile(file)); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const url = `https://videogamescritic.com/api/v1/search?q=${encodeURIComponent(entry.title)}&limit=5`;
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw Error(`Audit stopped at ${entry.id}: HTTP ${response.status}; no automatic retries`);
  const raw = await response.text(), body = JSON.parse(raw);
  if (!Array.isArray(body.games)) throw Error('Unexpected search schema');
  await writeFile(file, JSON.stringify({ url, observedAt: new Date().toISOString(), sha256: createHash('sha256').update(raw).digest('hex'), etag: response.headers.get('etag'), remaining: response.headers.get('x-ratelimit-remaining'), body }, null, 2));
  console.log(`${entry.title}: ${body.games.length} candidates (${body.total} reported)`);
  if (response.headers.has('x-ratelimit-remaining') && Number(response.headers.get('x-ratelimit-remaining')) <= 2) throw Error('Audit stopped to preserve anonymous quota; rerun after reset using the same cache');
}

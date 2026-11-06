import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { responseCache, entity, sendEntity, compression, acceptsGzip } from '../scripts/serve-cache.mjs';
import { gunzipSync } from 'node:zlib';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'serve-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'library/data/sources'), { recursive: true });
  await writeFile(path.join(root, 'library/data/igdb.json'), '{"a":1}');
  return root;
}

test('built responses are reused until a data file changes, and concurrent requests share one build', async t => {
  const root = await fixture(t), cached = responseCache(root);
  let builds = 0;
  const build = async () => { builds += 1; return entity(`build ${builds}`); };
  const [first, second] = await Promise.all([cached('snapshot', build), cached('snapshot', build)]);
  assert.equal(builds, 1); assert.equal(first, second);
  assert.equal(await cached('snapshot', build), first);
  // An edit (even one of the same size), a new file, an atomic replace and a removal all rebuild.
  await writeFile(path.join(root, 'library/data/igdb.json'), '{"a":2}');
  assert.equal((await cached('snapshot', build)).body.toString(), 'build 2');
  await writeFile(path.join(root, 'library/data/sources/esde.json'), '{}');
  assert.equal((await cached('snapshot', build)).body.toString(), 'build 3');
  await writeFile(path.join(root, 'library/data/igdb.json.tmp'), '{"a":2}');
  await rename(path.join(root, 'library/data/igdb.json.tmp'), path.join(root, 'library/data/igdb.json'));
  assert.equal((await cached('snapshot', build)).body.toString(), 'build 4');
  await rm(path.join(root, 'library/data/sources/esde.json'));
  assert.equal((await cached('snapshot', build)).body.toString(), 'build 5');
  assert.equal(builds, 5);
});

test('a failed build is not kept', async t => {
  const root = await fixture(t), cached = responseCache(root);
  await assert.rejects(cached('catalog', async () => { throw new Error('broken'); }), /broken/);
  assert.equal((await cached('catalog', async () => entity('ok'))).body.toString(), 'ok');
});

test('an unchanged response is answered with a bodiless 304', () => {
  const sent = [], res = { writeHead: (status, headers) => sent.push({ status, headers }), end: body => { sent.at(-1).body = body; } };
  const page = entity('{"games":[]}');
  sendEntity({ headers: {} }, res, page, 'application/json');
  sendEntity({ headers: { 'if-none-match': page.etag } }, res, page, 'application/json');
  sendEntity({ headers: { 'if-none-match': '"stale"' } }, res, page, 'application/json');
  assert.deepEqual(sent.map(item => item.status), [200, 304, 200]);
  assert.equal(sent[0].headers['Cache-Control'], 'no-cache');
  assert.equal(sent[1].body, undefined);
});

test('a paired phone gets text compressed, under its own tag, compressed once', async () => {
  const sent = [], res = { writeHead: (status, headers) => sent.push({ status, headers }), end: body => { sent.at(-1).body = body; } };
  const text = JSON.stringify({ games: Array.from({ length: 200 }, (_, id) => ({ id, title: `Game ${id}` })) }), page = entity(text), gzip = compression();
  const phone = headers => ({ headers: { 'accept-encoding': 'gzip, deflate, br', ...headers } });
  await sendEntity(phone(), res, page, 'application/json', gzip);
  assert.equal(sent[0].headers['Content-Encoding'], 'gzip');
  assert.equal(sent[0].headers.Vary, 'Accept-Encoding');
  assert.equal(gunzipSync(sent[0].body).toString(), text);
  assert.ok(sent[0].body.length < text.length / 3);
  assert.notEqual(sent[0].headers.ETag, page.etag);
  await sendEntity(phone({ 'if-none-match': sent[0].headers.ETag }), res, page, 'application/json', gzip);
  assert.equal(sent[1].status, 304);
  // Its plain copy's tag is a different version: the phone is sent the compressed one again.
  await sendEntity(phone({ 'if-none-match': page.etag }), res, page, 'application/json', gzip);
  assert.equal(sent[2].status, 200);
  assert.equal(sent[2].body, sent[0].body, 'compressed once');
  // Not compressed: a browser that doesn't take gzip, a small answer, a picture, or no compression (this computer).
  await sendEntity({ headers: {} }, res, page, 'application/json', gzip);
  await sendEntity(phone(), res, entity('{"games":[]}'), 'application/json', gzip);
  await sendEntity(phone(), res, entity('x'.repeat(4096)), 'image/png', gzip);
  await sendEntity(phone(), res, page, 'application/json');
  assert.deepEqual(sent.slice(3).map(item => [item.headers['Content-Encoding'], item.headers.ETag === page.etag || item.headers.ETag.endsWith('-gz"') === false]), [[undefined, true], [undefined, true], [undefined, true], [undefined, true]]);
  assert.equal(sent.at(-1).headers.Vary, undefined);
  assert.equal(acceptsGzip({ headers: { 'accept-encoding': 'br, gzip;q=0' } }), false);
  assert.equal(acceptsGzip({ headers: { 'accept-encoding': 'GZIP;q=0.5' } }), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { updateAll, checkLibraryCsv, checkWishlistJson } from '../scripts/update-all.mjs';

test('export checks explain what is wrong', () => {
  assert.throws(() => checkLibraryCsv(Buffer.from('Name,Platforms\n')), /missing the Id, Sources/);
  assert.doesNotThrow(() => checkLibraryCsv(Buffer.from('﻿"Name","Id","Platforms","Sources"\n')));
  assert.throws(() => checkWishlistJson(Buffer.from('{"version":1}')), /"data" list/);
  assert.equal(checkWishlistJson(Buffer.from('{"version":1,"data":[{"gameid":"1145360","title":"Hades"}]}')), 1);
  assert.equal(checkWishlistJson(Buffer.from('{"version":"05","data":[{"gameid":["steam","app/1700"],"title":"Arx Fatalis"}]}')), 1);
  assert.throws(() => checkWishlistJson(Buffer.from('{"data":[{"gameid":["gog","x"]}]}')), /Steam games/);
});

test('update archives changed exports, skips unchanged ones, and reports every step', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'update-'));
  try {
    await mkdir(path.join(root, 'library/data'), { recursive: true }); await mkdir(path.join(root, 'data'), { recursive: true });
    await writeFile(path.join(root, 'data/catalog.json'), JSON.stringify({ systems: [], games: [] }));
    await writeFile(path.join(root, 'library/data/library-data.js'), 'window.PLAYNITE_LIBRARY = [];');
    await writeFile(path.join(root, 'library/playnite_library.csv'), 'Id,Name,Platforms,Sources\n');
    await writeFile(path.join(root, 'library/steam-wishlist.json'), '{"data":[{"gameid":"1"}]}');
    const calls = [];
    const run = async (command, args) => { calls.push(args[0]); };
    const first = await updateAll(root, { run });
    assert.equal(first.state, 'done');
    assert.deepEqual(first.steps.map(step => [step.id, step.state]), [['sources', 'skipped'], ['library', 'done'], ['wishlist', 'done'], ['prices', 'done'], ['roms', 'skipped'], ['igdb', first.steps[5].state], ['steam', 'done'], ['awards', first.steps[7].state], ['vgc', 'done']]);
    assert.ok(calls.includes('library/tools/build_site.py') && calls.includes('library/tools/build_wishlist.py'));
    const archived = await readdir(path.join(root, 'library/data/imports'));
    assert.equal(archived.filter(name => name !== 'last.json').length, 1);
    calls.length = 0;
    const second = await updateAll(root, { run });
    assert.deepEqual(second.steps.slice(1, 3).map(step => step.state), ['skipped', 'skipped']);
    assert.ok(!calls.includes('library/tools/build_site.py'));
    // Prices are checked on every update, even when the wishlist export is unchanged.
    assert.equal(second.steps[3].id, 'prices'); assert.equal(second.steps[3].state, 'done');
    assert.ok(calls.includes('library/tools/steam_enrich.py') && calls.includes('library/tools/build_wishlist.py'));
    assert.equal(JSON.parse(await readFile(path.join(root, '.runtime/update.json'), 'utf8')).state, 'done');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a failed step keeps going and reports a partial update; bad exports stop before anything changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'update-'));
  try {
    await mkdir(path.join(root, 'library/data'), { recursive: true }); await mkdir(path.join(root, 'data'), { recursive: true });
    await writeFile(path.join(root, 'data/catalog.json'), JSON.stringify({ systems: [], games: [] }));
    await writeFile(path.join(root, 'library/data/library-data.js'), 'window.PLAYNITE_LIBRARY = [];');
    await writeFile(path.join(root, 'library/steam-wishlist.json'), 'not json');
    let status = await updateAll(root, { run: async () => {} });
    assert.equal(status.state, 'failed'); assert.match(status.error, /not valid JSON/); assert.equal(status.steps.length, 0);
    await writeFile(path.join(root, 'library/steam-wishlist.json'), '{"data":[{"gameid":"1"}]}');
    status = await updateAll(root, { run: async (command, args) => { if (args[0] === 'library/tools/steam_enrich.py') throw new Error('Steam is down'); } });
    assert.equal(status.state, 'partial');
    assert.equal(status.steps.find(step => step.id === 'wishlist').state, 'failed');
    assert.equal(status.steps.find(step => step.id === 'steam').state, 'done');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('progress lines from each step become counts the app can show', async () => {
  const { parseProgress } = await import('../scripts/update-all.mjs');
  assert.deepEqual(parseProgress('owned: 1 games\r  owned: 25/191 searched · ~2 min left   '), { done: 25, total: 191, detail: 'owned: 25/191 searched · ~2 min left' });
  assert.deepEqual(parseProgress('[12/40] cached 1700 Arx Fatalis\n'), { done: 12, total: 40, detail: '12/40 cached 1700 Arx Fatalis' });
  assert.deepEqual(parseProgress('{"complete":false,"total":300,"processed":120,"counts":{}}'), { done: 120, total: 300, detail: '120 of 300' });
  assert.equal(parseProgress('Done after 400 IGDB requests.'), null);
  assert.equal(parseProgress('0/0'), null);
});

test('steps are planned up front, report progress, and a stop keeps finished steps', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'update-'));
  try {
    await mkdir(path.join(root, 'library/data'), { recursive: true }); await mkdir(path.join(root, 'data'), { recursive: true });
    await writeFile(path.join(root, 'data/catalog.json'), JSON.stringify({ systems: [], games: [] }));
    await writeFile(path.join(root, 'library/data/library-data.js'), 'window.PLAYNITE_LIBRARY = [];');
    await writeFile(path.join(root, 'library/playnite_library.csv'), 'Id,Name,Platforms,Sources\n');
    await writeFile(path.join(root, 'library/steam-wishlist.json'), '{"data":[{"gameid":"1"}]}');
    const controller = new AbortController(), seen = [];
    const run = async (command, args, cwd, env, { onOutput, signal } = {}) => {
      if (args[0] === 'library/tools/build_site.py') {
        onOutput('[2/4] building');
        seen.push(JSON.parse(await readFile(path.join(root, '.runtime/update.json'), 'utf8')).steps.map(step => step.state));
      }
      if (args[0] === 'library/tools/steam_enrich.py') { controller.abort(); if (signal?.aborted) throw new Error('Stopped.'); }
    };
    const status = await updateAll(root, { run, signal: controller.signal });
    // Every step is listed before the first one runs.
    assert.deepEqual(seen[0], ['done', 'running', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending'].map((state, index) => index === 0 ? 'skipped' : state));
    assert.equal(status.state, 'stopped');
    assert.deepEqual(status.steps.map(step => step.state), ['skipped', 'done', 'stopped', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    assert.match(status.steps[3].note, /stopped the update/);
    assert.ok(status.updatedAt && status.finishedAt);
  } finally { await rm(root, { recursive: true, force: true }); }
});

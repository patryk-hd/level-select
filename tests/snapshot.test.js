import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readSnapshot, parseData } from '../scripts/snapshot.mjs';

const run = promisify(execFile);
const root = new URL('../', import.meta.url);
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'retro-snapshot-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const folder of ['library/data', 'data', 'assets', 'pages']) await mkdir(path.join(dir, folder), { recursive: true });
  await cp(new URL('library/sample', root), path.join(dir, 'library/sample'), { recursive: true });
  await writeFile(path.join(dir, 'data/catalog.json'), JSON.stringify({systems:[{id:'snes'}],games:[{id:'metroid',title:'Super Metroid',systemId:'snes'}]}));
  return dir;
}
async function privateData(dir) {
  const file = path.join(dir, 'library/data/library-data.js');
  const data = parseData(await readFile(path.join(dir, 'library/sample/library-data.js'), 'utf8'), 'PLAYNITE_LIBRARY');
  data.PLAYNITE_LIBRARY[0].name = 'PRIVATE_TITLE_CANARY';
  await writeFile(file, `window.PLAYNITE_LIBRARY=${JSON.stringify(data.PLAYNITE_LIBRARY)}; window.PLAYNITE_STATS=${JSON.stringify(data.PLAYNITE_STATS)};`);
  await writeFile(path.join(dir, 'library/data/wishlist-data.js'), 'window.STEAM_WISHLIST=[]; window.WISHLIST_STATS={total:0}; // PRIVATE_WISHLIST_CANARY');
  return file;
}

test('samples are the default even with personal files present; local mode explicitly selects them', async t => {
  const dir = await fixture(t);
  await privateData(dir);
  const sample = await readSnapshot(dir);
  assert.equal(sample.owned.local, false);
  assert.equal(sample.connections.sample, true);
  assert.doesNotMatch(JSON.stringify(sample), /PRIVATE_/);
  const local = await readSnapshot(dir, { local: true });
  assert.equal(local.owned.local, true);
  assert.equal(local.connections.sample, false);
  assert.match(local.owned.source, /PRIVATE_TITLE_CANARY/);
  assert.match(local.wishlist.source, /PRIVATE_WISHLIST_CANARY/);
});

test('missing data uses samples, but malformed personal data produces an error', async t => {
  const dir = await fixture(t);
  assert.equal((await readSnapshot(dir, { local:true })).owned.local, false);
  await writeFile(path.join(dir, 'library/data/library-data.js'), 'window.PLAYNITE_LIBRARY = null;');
  await assert.rejects(readSnapshot(dir, { local:true }), /Invalid snapshot/);
  assert.equal((await readSnapshot(dir)).owned.local, false);
});

test('sharing check rejects private files even if they are already tracked', async t => {
  const dir = await fixture(t);
  await run('git', ['init', '-q'], {cwd:dir});
  await cp(new URL('.gitignore', root), path.join(dir,'.gitignore'));
  await privateData(dir);
  await writeFile(path.join(dir,'.env'), 'SAMPLE_SETTING=private-test-value\n');
  const trackingBackups = ['retro-tracking-personal.json', 'retro-tracking-sample.json', 'retro-tracking-recovery.json', 'wishlist-acquisitions.json'];
  for (const file of trackingBackups) await writeFile(path.join(dir, file), '{"notes":"PRIVATE_TRACKING_CANARY"}');
  const ignored = await run('git', ['check-ignore', ...trackingBackups], {cwd:dir});
  for (const file of trackingBackups) assert.ok(ignored.stdout.includes(file));
  const checker = new URL('scripts/check-share.mjs', root).pathname;
  await run(process.execPath, [checker], {cwd:dir});
  await run('git', ['add','--force','library/data/library-data.js','.env', ...trackingBackups], {cwd:dir});
  await assert.rejects(run(process.execPath, [checker], {cwd:dir}), error => {
    assert.match(error.stderr, /library\/data\/library-data.js: private/);
    assert.match(error.stderr, /\.env: private/);
    for (const file of trackingBackups) assert.ok(error.stderr.includes(`${file}: private`));
    assert.doesNotMatch(error.stderr, /private-test-value|PRIVATE_TITLE_CANARY|PRIVATE_TRACKING_CANARY/);
    return true;
  });
});

test('public build excludes private data and artwork; local build works without artwork and leaves public output intact', async t => {
  const dir = await fixture(t);
  for (const file of ['ranking/evidence.js','ranking/ui.js','ranking/snapshot.js','ranking/panels.js','ranking/modes.js','ranking/mode-ui.js','ranking/methodology.html','ranking/styles.css','scripts/ratings-snapshot.mjs','scripts/build.mjs','scripts/snapshot.mjs','scripts/igdb-snapshot.mjs','scripts/awards.mjs','scripts/vgc.mjs','scripts/igdb-overrides.mjs','scripts/manual-games.mjs','scripts/corrections.mjs','ranking/igdb-match.mjs','scripts/roms.mjs','scripts/sources.mjs','scripts/platform.mjs','scripts/atlas-scores.mjs','scripts/sync-navigation.mjs','navigation-template.js','library/core.js','library/search-ui.js','index.html','library/index.html','library/wishlist.html','library/backlog.html','library/sources.html','library/mods.html','library/phone.html','ranking/mods.js']) {
    await mkdir(path.dirname(path.join(dir, file)), {recursive:true});
    await cp(new URL(file, root), path.join(dir, file));
  }
  await writeFile(path.join(dir,'package.json'), '{"type":"module"}');
  for (const file of ['styles.css','app.js','lib.js','navigation.js','navigation.css','controls.css','theme.css','theme.js','welcome.js','welcome.css','library/styles.css','library/app.js','library/wishlist.js','library/runtime.js','library/icons.js','library/README.md','library/backlog.js','library/backlog.css','library/suggestions.js','library/score-ui.js','library/browse-ui.js','library/triage.js','library/home.js','library/progress.js','library/update-ui.js','library/update-progress.js','library/motion.js','library/history.js','library/rewards.js','library/rewards.css','library/challenges.js','library/challenges.css','library/goals.js','library/hovercard.js','library/sources.js','library/sources.css','library/add-game.js','library/add-game.css','library/mods.js','library/mods.css','library/phone.js','library/phone.css','library/copy.js','library/copy-app.js','library/wishlist-planning.js','library/wishlist-planning.css']) await writeFile(path.join(dir,file), '');
  await cp(new URL('tracking', root), path.join(dir, 'tracking'), {recursive:true});
  const privateFile = await privateData(dir);
  const before = await readFile(privateFile,'utf8');
  const ratings=JSON.parse(await readFile(path.join(dir,'library/sample/ratings.json'),'utf8'));
  ratings.workspace='personal';ratings.rows[0].source.title='PRIVATE_RATINGS_CANARY';
  await writeFile(path.join(dir,'library/data/ratings.json'),JSON.stringify(ratings));
  await mkdir(path.join(dir,'.runtime/ratings'),{recursive:true});
  await writeFile(path.join(dir,'.runtime/ratings/cache.json'),'PRIVATE_CACHE_CANARY');
  await mkdir(path.join(dir,'library/assets'));
  await writeFile(path.join(dir,'library/assets/private-art.txt'), 'PRIVATE_ART_CANARY');
  await run(process.execPath, ['scripts/build.mjs'], {cwd:dir});
  const shareable = await readFile(path.join(dir,'dist/library/data/library-data.js'),'utf8');
  assert.doesNotMatch(shareable, /PRIVATE_/);
  assert.doesNotMatch(await readFile(path.join(dir,'dist/library/data/wishlist-data.js'),'utf8'), /PRIVATE_/);
  assert.doesNotMatch(await readFile(path.join(dir,'dist/library/data/connections.json'),'utf8'), /PRIVATE_/);
  await assert.rejects(access(path.join(dir,'dist/library/assets')), {code:'ENOENT'});
  await access(path.join(dir,'dist/ranking/evidence.js'));
  await access(path.join(dir,'dist/library/search-ui.js'));

  await access(path.join(dir,'dist/ranking/panels.js'));
  const publicRatings=await readFile(path.join(dir,'dist/library/data/ratings.json'),'utf8');
  assert.doesNotMatch(publicRatings,/PRIVATE_/);
  assert.equal(JSON.parse(publicRatings).workspace,'sample');
  for(const file of ['ranking/providers/vgc.mjs','ranking/crosswalk.json','.runtime/ratings/cache.json'])await assert.rejects(access(path.join(dir,'dist',file)),{code:'ENOENT'});
  await assert.rejects(access(path.join(dir,'dist/ranking/pilot-manifest.json')), {code:'ENOENT'});
  await rm(path.join(dir,'library/assets'), {recursive:true});
  await run(process.execPath, ['scripts/build.mjs','--local'], {cwd:dir});
  assert.match(await readFile(path.join(dir,'dist-local/library/data/library-data.js'),'utf8'), /PRIVATE_TITLE_CANARY/);
  assert.match(await readFile(path.join(dir,'dist-local/library/data/ratings.json'),'utf8'),/PRIVATE_RATINGS_CANARY/);
  assert.equal(await readFile(path.join(dir,'dist/library/data/library-data.js'),'utf8'), shareable);
  assert.equal(await readFile(privateFile,'utf8'), before);
});

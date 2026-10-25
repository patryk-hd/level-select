import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseRomName, scanFolders, romGroups, systemFromFolders } from '../scripts/roms.mjs';
import { romScan } from '../scripts/rom-scan.mjs';
import { platformKey } from '../library/core.js';

test('ROM names become clean titles with their region; articles move to the front', () => {
  assert.deepEqual(parseRomName('Super Metroid (USA, Europe) [!].sfc'), { title: 'Super Metroid', region: 'USA, Europe', disc: null });
  assert.equal(parseRomName('Legend of Zelda, The - A Link to the Past (USA).sfc').title, 'The Legend of Zelda - A Link to the Past');
  assert.deepEqual(parseRomName('Final Fantasy VII (USA) (Disc 2).chd'), { title: 'Final Fantasy VII', region: 'USA', disc: 2 });
  assert.equal(systemFromFolders(['Retro', 'Sony PlayStation']), 'ps1');
  assert.equal(systemFromFolders(['Mega Drive']), 'md');
  assert.equal(systemFromFolders(['misc']), null);
});

test('scanning finds games by extension or folder, merges regions and discs, and skips unknown images', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'roms-'));
  try {
    const files = ['SNES/Super Metroid (USA).sfc', 'SNES/Super Metroid (Japan).sfc', 'Anything/Sonic the Hedgehog (World).md',
      'PS1/Final Fantasy VII (USA) (Disc 1).chd', 'PS1/Final Fantasy VII (USA) (Disc 2).chd', 'PS1/Crash/Crash Bandicoot (USA).cue', 'PS1/Crash/Crash Bandicoot (USA).bin',
      'misc/Mystery Disc.iso', '.hidden/Secret.sfc', 'notes.txt'];
    for (const file of files) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), ''); }
    const { games, unrecognised } = await scanFolders([root]);
    assert.deepEqual(games.map(game => [game.system, game.title, game.files]), [['md', 'Sonic the Hedgehog', 1], ['ps1', 'Crash Bandicoot', 1], ['ps1', 'Final Fantasy VII', 2], ['snes', 'Super Metroid', 2]]);
    assert.deepEqual(games.at(-1).regions, ['Japan', 'USA']);
    assert.deepEqual(unrecognised, ['misc/Mystery Disc.iso']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ROM games become library entries on their catalog system, with Atlas art when titles match', () => {
  const catalog = { systems: [{ id: 'snes', name: 'SNES' }, { id: 'md', name: 'Mega Drive / Genesis' }], games: [{ id: 'snes-metroid', systemId: 'snes', title: 'Super Metroid', year: 1994, genres: ['Action'], cover: { local: './assets/covers/metroid.png' } }] };
  const groups = romGroups({ games: [{ id: 'rom-1', title: 'Super Metroid', system: 'snes', regions: ['USA'] }, { id: 'rom-2', title: 'Sonic the Hedgehog', system: 'md', regions: [] }] }, catalog);
  assert.deepEqual(groups.map(group => [group.name, group.platforms[0], group.cover, group.year, group.atlasId]), [
    ['Super Metroid', 'SNES', '../assets/covers/metroid.png', 1994, 'snes-metroid'], ['Sonic the Hedgehog', 'Mega Drive / Genesis', '', null, null]]);
  assert.deepEqual(groups.map(group => platformKey(group.platforms[0])), ['snes', 'md']);
  assert.equal(groups[0].copies[0].sources[0], 'ROM folder');
});

test('an unplugged ROM drive never wipes the last scan', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rom-root-')), folder = await mkdtemp(path.join(tmpdir(), 'rom-folder-'));
  try {
    await mkdir(path.join(root, 'library/data'), { recursive: true });
    await writeFile(path.join(folder, 'Tetris (World).gb'), '');
    assert.equal((await romScan(root, ['--add', folder])).games.length, 1);
    await rm(folder, { recursive: true, force: true });
    const result = await romScan(root, []);
    assert.match(result.message, /not available/);
    const { readRoms } = await import('../scripts/roms.mjs');
    assert.equal((await readRoms(root)).games.length, 1);
    await romScan(root, ['--remove', folder]);
    assert.equal((await readRoms(root)).games.length, 0, 'removing the last folder removes its games');
  } finally { await rm(root, { recursive: true, force: true }); await rm(folder, { recursive: true, force: true }); }
});

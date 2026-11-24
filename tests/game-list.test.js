import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseTable, readGameList, previewList, addList, LIST_LIMIT } from '../scripts/game-list.mjs';
import { manualGroups, systemName } from '../scripts/manual-games.mjs';

const catalog = {
  systems: [{ id: 'snes', name: 'SNES', fullName: 'Super Nintendo Entertainment System' }, { id: 'ps1', name: 'PlayStation', fullName: 'Sony PlayStation' }, { id: 'pc', name: 'PC', fullName: 'PC (Windows, 2000 onwards)' }, { id: 'dos', name: 'Classic PC', fullName: 'Classic PC (DOS & Windows, to 1999)' }],
  games: [
    { id: 'snes-metroid', title: 'Super Metroid', systemId: 'snes', year: 1994, genres: ['Action'], cover: { local: './assets/covers/super-metroid.png' } },
    { id: 'ps1-mgs', title: 'Metal Gear Solid', systemId: 'ps1', year: 1998, genres: [], cover: { url: 'https://example.com/mgs.png' } },
    { id: 'pc-witcher', title: 'The Witcher 3: Wild Hunt', aliases: ['Witcher 3'], systemId: 'pc', year: 2015, genres: ['RPG'], cover: { url: 'https://raw.githubusercontent.com/covers/witcher-3.png' } },
  ],
};
// As the app offers them (games-api platformOptions).
const systems = [...catalog.systems.map(system => systemName(system.id, catalog)), 'macOS'];

test('a table from a CSV file, Excel’s semicolons or cells copied from a spreadsheet', () => {
  assert.deepEqual(parseTable('﻿Title,System\r\n"Metal Gear Solid, Integral",PS1\r\n'), [['Title', 'System'], ['Metal Gear Solid, Integral', 'PS1']]);
  assert.deepEqual(parseTable('Title;System\nSuper Metroid;SNES'), [['Title', 'System'], ['Super Metroid', 'SNES']]);
  assert.deepEqual(parseTable('Super Metroid\tSNES\t1994\nChrono Trigger\tSNES'), [['Super Metroid', 'SNES', '1994'], ['Chrono Trigger', 'SNES']]);
  assert.deepEqual(parseTable('"Say ""hi""",x\n"Two\nlines",y'), [['Say "hi"', 'x'], ['Two lines', 'y']]);
  assert.deepEqual(parseTable('Just a title\nAnother one'), [['Just a title'], ['Another one']]);
});

test('columns by their headings, or the title first with a system or year beside it', () => {
  assert.deepEqual(readGameList('Platform,Game,Released\nSNES,Super Metroid,03/19/1994'), [{ line: 2, name: 'Super Metroid', system: 'SNES', year: 1994 }]);
  assert.deepEqual(readGameList('Super Metroid,1994,SNES\n\nChrono Trigger', value => value === 'SNES'), [{ line: 1, name: 'Super Metroid', system: 'SNES', year: 1994 }, { line: 3, name: 'Chrono Trigger', system: '', year: null }]);
  assert.throws(() => readGameList(' \n,,\n'), /The list is empty/);
  assert.throws(() => readGameList(Array.from({ length: LIST_LIMIT + 1 }, (_, i) => `Game ${i}`).join('\n')), /at most/);
});

test('each row: its system, the Game Atlas’s details, and whether you already have it', () => {
  const owned = [
    { id: 'g1', name: 'Metal Gear Solid', copies: [{ id: 'c1', name: 'Metal Gear Solid', platforms: ['PlayStation'], sources: ['Local backup'], year: 1998 }] },
    { id: 'g2', name: 'The Witcher 3: Wild Hunt', copies: [{ id: 'c2', name: 'The Witcher 3: Wild Hunt', platforms: ['PC (Windows)'], sources: ['Steam'], year: 2015 }] },
  ];
  const text = 'Title,System,Year\nSuper Metroid,Super Nintendo\nMetal Gear Solid,PS1\nThe Witcher 3: Wild Hunt,PC\nsuper metroid,SNES\nSome Homebrew,\nDoom,DOS,1993\nBad year,SNES,1890';
  const { rows, counts } = previewList({ text, platform: '' }, { catalog, owned, systems });
  const brief = rows.map(row => [row.line, row.platform, row.status, row.atlas?.title ?? null]);
  assert.deepEqual(brief, [
    [2, 'Super Nintendo Entertainment System', 'new', 'Super Metroid'],
    [3, 'Sony PlayStation', 'owned', 'Metal Gear Solid'],
    [4, 'PC (Windows)', 'new', 'The Witcher 3: Wild Hunt'],
    [5, 'Super Nintendo Entertainment System', 'repeat', 'Super Metroid'],
    [6, '', 'invalid', null],
    [7, 'PC (DOS)', 'new', null],
    [8, 'Super Nintendo Entertainment System', 'new', null],
  ]);
  assert.deepEqual(counts, { new: 4, owned: 1, repeat: 1, invalid: 1 });
  // From the Atlas: its year, genres and box art; a year in the list wins.
  assert.equal(rows[0].year, 1994); assert.deepEqual(rows[0].genres, ['Action']); assert.equal(rows[0].atlas.cover, '../assets/covers/super-metroid.png'); assert.equal(rows[0].atlasId, 'snes-metroid');
  assert.equal(rows[5].year, 1993);
  // Box art the app doesn't ship: its link, only from hosts covers may come from.
  assert.equal(rows[2].atlas.cover, 'https://raw.githubusercontent.com/covers/witcher-3.png'); assert.equal(rows[1].atlas.cover, '');
  // Already yours from another store on that system: the backup is added beside it.
  assert.deepEqual(rows[2].also, ['Steam']);
  assert.match(rows[4].reason, /Which system/);
  // A year that can't be: not read as a year, so the row stays.
  assert.equal(rows[6].year, null);
  // One system for the whole list.
  assert.deepEqual(previewList({ text: 'Some Homebrew', platform: 'snes' }, { catalog, systems }).rows.map(row => [row.platform, row.ownedOn]), [['Super Nintendo Entertainment System', 'Local backup']]);
});

test('the list’s new games are added in one go, as local backups, except the ones you untick', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'game-list-')); t.after(() => rm(root, { recursive: true, force: true }));
  const input = { text: 'Super Metroid\nChrono Trigger\nEarthBound', platform: 'SNES', skip: [3] };
  assert.deepEqual(await addList(root, input, { catalog, systems }), { added: 2, skipped: 1 });
  const saved = JSON.parse(await readFile(path.join(root, 'library/data/manual-games.json'), 'utf8')).games;
  assert.deepEqual(saved.map(game => [game.name, game.platform, game.ownedOn, game.cover, game.atlasId]), [['Super Metroid', 'Super Nintendo Entertainment System', 'Local backup', '../assets/covers/super-metroid.png', 'snes-metroid'], ['Chrono Trigger', 'Super Nintendo Entertainment System', 'Local backup', '', null]]);
  assert.ok(saved.every(game => /^manual-[0-9a-f]{12}$/.test(game.id)));
  // In the library, "Local backup" is where you own them (the Store filter shows it).
  assert.deepEqual(manualGroups({ games: saved }).map(group => group.sources), [['Local backup'], ['Local backup']]);
  // The same list again adds nothing: they're yours now.
  const owned = manualGroups({ games: saved });
  assert.deepEqual(await addList(root, { ...input, skip: [] }, { catalog, systems, owned }), { added: 1, skipped: 2 });
});

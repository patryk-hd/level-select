import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gameFamilies, titleKey } from '../tracking/families.js';
import { listEntries, listTitle, featuredLists, availableSeries, scoreOf, SHAPED } from '../tracking/lists.js';
import { originOf, entryIgdb } from '../scripts/retro-lists.mjs';

const reviews = (score, igdb) => ({ critics: { value: score, count: 10, source: 'wikipedia' }, players: { value: score, count: 100 }, ...(igdb ? { igdb } : {}) });
let serial = 0;
const game = (title, systemId, year, score, igdb, extra = {}) => ({ id: `${systemId}-${++serial}`, title, systemId, year, rank: serial, genres: [], reviews: reviews(score, igdb), ...extra });
const same = (games, a, b) => { const families = gameFamilies(games); return families.get(a.id) === families.get(b.id); };

test('ports, editions and remasters are one game; remakes, sequels and reboots are not', () => {
  const tlou = game('The Last of Us', 'ps3', 2013, 95, { id: 1009, type: 0, versions: [6036, 204350] });
  const remastered = game('The Last of Us Remastered', 'ps4', 2014, 95, { id: 6036, type: 9, parent: 1009, origin: 1009 });
  const partOne = game('The Last of Us Part I', 'ps5', 2022, 89, { id: 204350, type: 8, parent: 1009 });
  const partTwo = game('The Last of Us Part II', 'ps4', 2020, 93, { id: 26192, type: 0 });
  const p5 = game('Persona 5', 'ps3', 2016, 93, { id: 9927, type: 0 }), royal = game('Persona 5 Royal', 'switch', 2022, 94, { id: 114283, type: 10, parent: 9927, origin: 9927 });
  const ff7 = game('Final Fantasy VII', 'ps1', 1997, 92, { id: 427, type: 0, versions: [11169] }), ff7r = game('Final Fantasy VII Remake', 'ps4', 2020, 87, { id: 11169, type: 8, parent: 427 });
  // Chrono Trigger on DS traces to the SNES original through its PS1 release.
  const ct = game('Chrono Trigger', 'snes', 1995, 92, { id: 1802, type: 0 }), ctDs = game('Chrono Trigger', 'ds', 2008, 92, { id: 20398, type: 10, parent: 263446, origin: 1802 });
  const gow = game('God of War', 'ps2', 2005, 91, { id: 549, type: 0 }), gow18 = game('God of War', 'ps4', 2018, 94, { id: 19560, type: 0 });
  // A re-release that kept the name doesn't join a later reboot.
  const ng = game('Ninja Gaiden', 'wii', 2009, 80, { id: 7558, type: 0 }), ngXbox = game('Ninja Gaiden', 'xbox', 2004, 91, { id: 5972, type: 0 });
  const tetrisNes = game('Tetris', 'nes', 1989, 80, { id: 8197, type: 8, parent: 130749 }), tetrisGb = game('Tetris', 'gb', 1989, 89, { id: 86490, type: 8, parent: 130749 });
  const doomDos = game('Doom', 'dos', 1993, 90, { id: 673, type: 0 }), doom32x = game('Doom', '32x', 1994, 70), doom16 = game('Doom (2016)', 'ps4', 2016, 85, { id: 7351, type: 0 });
  const ep2 = game('Half-Life 2: Episode Two', 'pc', 2007, 90, { id: 1, type: 4, parent: 233 }), hl2 = game('Half-Life 2', 'pc', 2004, 96, { id: 233, type: 0 });
  // A remaster of a remake (Resident Evil from 2014) belongs to the remake, not the original.
  const re = game('Resident Evil', 'ps1', 1996, 90, { id: 424, type: 0, versions: [24869] }), remake = game('Resident Evil Remake', 'gc', 2002, 91, { id: 24869, type: 8, parent: 424, versions: [8254] });
  const reHd = game('Resident Evil', 'ps4', 2014, 85, { id: 8254, type: 9, parent: 24869, origin: 24869 }), reSaturn = game('Resident Evil', 'saturn', 1997, 80);
  const all = [re, remake, reHd, reSaturn, tlou, remastered, partOne, partTwo, p5, royal, ff7, ff7r, ct, ctDs, gow, gow18, ng, ngXbox, tetrisNes, tetrisGb, doomDos, doom32x, doom16, ep2, hl2];
  for (const [a, b] of [[remake, reHd], [re, reSaturn], [tlou, remastered], [p5, royal], [ct, ctDs], [tetrisNes, tetrisGb], [doomDos, doom32x]]) assert.ok(same(all, a, b), `${a.title} · ${b.title}`);
  for (const [a, b] of [[re, remake], [re, reHd], [tlou, partOne], [remastered, partOne], [tlou, partTwo], [ff7, ff7r], [gow, gow18], [ng, ngXbox], [doomDos, doom16], [ep2, hl2]]) assert.ok(!same(all, a, b), `${a.title} · ${b.title}`);
  assert.equal(titleKey('The Witcher 3: Wild Hunt – Game of the Year Edition'), titleKey('The Witcher 3: Wild Hunt - Complete Edition'));
});

test('lists count each game once, at its best score, under its original name, and any version counts', () => {
  const tlou = game('The Last of Us', 'ps3', 2013, 93, { id: 1009, type: 0 }), remastered = game('The Last of Us Remastered', 'ps4', 2014, 95, { id: 6036, type: 9, parent: 1009, origin: 1009 });
  const orange = game('The Orange Box', 'pc', 2007, 96, { id: 2, type: 3 }), hl2 = game('Half-Life 2', 'pc', 2004, 94, { id: 233, type: 0, perspectives: [1] }, { genres: ['Shooter'] });
  const ep2 = game('Half-Life 2: Episode Two', 'pc', 2007, 92, { id: 3, type: 4, parent: 233, perspectives: [1] }, { genres: ['Shooter'] });
  const halo = game('Halo: Combat Evolved', 'xbox', 2001, 90, { id: 4, type: 0, perspectives: [1] }, { genres: ['Shooter'] });
  const unlisted = { ...game('Removed', 'pc', 2000, 99), unlisted: true };
  const catalog = { systems: [], games: [tlou, remastered, orange, hl2, ep2, halo, unlisted] };
  const top = listEntries(catalog, { size: 10, system: '', year: null });
  // Compilations repeat their games; a standalone expansion gives way to its listed game.
  assert.deepEqual(top.map(entry => entry.title), ['The Last of Us', 'Half-Life 2', 'Halo: Combat Evolved']);
  assert.equal(top[0].score, Math.round(scoreOf(remastered)));
  assert.deepEqual(top[0].games.map(item => item.id), [remastered.id, tlou.id]);
  assert.deepEqual(listEntries(catalog, { size: 10, system: '', year: null, genre: 'fps' }).map(entry => entry.title), ['Half-Life 2', 'Halo: Combat Evolved']);
  assert.deepEqual(listEntries(catalog, { size: 10, system: '', year: null, decade: 2000 }).map(entry => entry.title), ['Half-Life 2', 'Halo: Combat Evolved']);
  // One system's list keeps its order.
  assert.deepEqual(listEntries(catalog, { size: 10, system: 'pc', year: null }).map(entry => entry.title), ['The Orange Box', 'Half-Life 2', 'Half-Life 2: Episode Two']);
});

test('a series list leaves out crossovers that only borrow the series', () => {
  const botw = game('The Legend of Zelda: Breath of the Wild', 'switch', 2017, 97, { id: 1, type: 0, series: ['The Legend of Zelda'] });
  const smash = game('Super Smash Bros. Ultimate', 'switch', 2018, 93, { id: 2, type: 0, series: ['Super Smash Bros.', 'The Legend of Zelda', 'Pokémon'] });
  const old = game('Zelda II: The Adventure of Link', 'nes', 1987, 80);
  const catalog = { systems: [], games: [botw, smash, old] };
  assert.deepEqual(listEntries(catalog, { size: 10, series: 'zelda' }).map(entry => entry.title), ['The Legend of Zelda: Breath of the Wild', 'Zelda II: The Adventure of Link']);
  assert.equal(listTitle({ size: 10, series: 'zelda' }, undefined, 2), 'Top 2 Zelda games');
  assert.equal(listTitle({ size: 10, system: '', year: null, genre: 'rpg' }), 'Top 10 RPGs of all time');
  assert.equal(listTitle({ size: 25, system: '', year: null, decade: 1990 }), 'Top 25 of the 1990s');
  assert.equal(listTitle({ size: 10, system: 'snes', year: null, genre: 'rpg' }, () => 'SNES'), 'Top 10 RPGs · SNES');
  assert.equal(listTitle({ size: 10, shaped: 'fps' }), 'The games that shaped first-person shooters');
});

test('the list builder traces a version to its original through any number of steps', () => {
  const links = new Map([[263446, { type: 10, parent: 1802 }], [1802, { type: 0, parent: null }]]);
  assert.equal(originOf({ id: 20398, type: 10, parent: 263446 }, id => links.get(id)), 1802);
  // A remake or standalone expansion is its own original.
  assert.equal(originOf({ id: 11169, type: 8, parent: 427 }, id => links.get(id)), 11169);
  assert.equal(originOf({ id: 3, type: 4, parent: 233 }, id => links.get(id)), 3);
  assert.deepEqual(entryIgdb({ id: 20398, url: 'u', type: 10, parent: 263446 }, { perspectives: [3], series: ['Chrono'], versions: [], tags: [] }, 1802),
    { id: 20398, url: 'u', type: 10, parent: 263446, origin: 1802, perspectives: [3], series: ['Chrono'] });
});

test('every game in the genre histories is on today’s lists, and every offered list has five games', () => {
  const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  for (const [id, shaped] of Object.entries(SHAPED)) {
    const entries = listEntries(catalog, { shaped: id });
    assert.deepEqual(entries.map(entry => entry.title), shaped.games.map(([title]) => title), id);
    assert.deepEqual(entries.map(entry => entry.year), [...entries.map(entry => entry.year)].sort((a, b) => a - b), `${id} in release order`);
  }
  for (const group of featuredLists(catalog)) for (const spec of group.lists) assert.ok(listEntries(catalog, { ...spec, size: 10 }).length >= 5, JSON.stringify(spec));
  assert.ok(availableSeries(catalog).some(series => series.id === 'zelda'));
});

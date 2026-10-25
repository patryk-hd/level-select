import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { connectLibrary } from '../library/core.js';

// Only execute the locally generated data assignment, in an isolated context.
const context = { window: {} };
vm.runInNewContext(await readFile(new URL('../library/data/library-data.js', import.meta.url), 'utf8'), context, { timeout: 3000 });
const games = context.window.PLAYNITE_LIBRARY;
const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
if (!Array.isArray(games) || !games.length) throw new Error('No Playnite games were found.');
const connections = connectLibrary(catalog, games);
connections.totalTitles = games.length;
connections.totalCopies = games.reduce((total, game) => total + game.copies.length, 0);
connections.owned = games.map(({ id, name, platforms, steamAppId }) => ({ id, name, platforms, steamAppId }));
await writeFile(new URL('../library/data/connections.json', import.meta.url), JSON.stringify(connections));
const count = Object.keys(connections.candidatesByRelease).length;
console.log(`Found possible matches for ${count} recommendations; ${games.length} library titles retained. Review matches in the app to confirm ownership.`);

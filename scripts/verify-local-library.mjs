import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { parseData } from './snapshot.mjs';

const root = new URL('../library/', import.meta.url);
const data = parseData(await readFile(new URL('data/library-data.js', root), 'utf8'), 'PLAYNITE_LIBRARY');
const games = data.PLAYNITE_LIBRARY, stats = data.PLAYNITE_STATS;
assert.ok(!data.PLAYNITE_SAMPLE, 'Import your own library before running this local integrity check.');
assert.equal(games.length, stats.total);
assert.equal(games.reduce((n, game) => n + game.copies.length, 0), stats.totalCopies);
assert.equal(new Set(games.flatMap(game => game.copies.map(copy => copy.id))).size, stats.totalCopies);
const assets = [...new Set(games.flatMap(game => [game.cover, game.background]).filter(url => url && !/^https?:/.test(url)))];
for (let i = 0; i < assets.length; i += 100) await Promise.all(assets.slice(i, i + 100).map(url => access(new URL(url, root))));
const wishlist = parseData(await readFile(new URL('data/wishlist-data.js', root), 'utf8'), 'STEAM_WISHLIST');
assert.equal(wishlist.STEAM_WISHLIST.length, wishlist.WISHLIST_STATS.total);
console.log(`Verified ${games.length} local titles, ${stats.totalCopies} copies, ${assets.length} artwork files and ${wishlist.STEAM_WISHLIST.length} wishlist entries.`);

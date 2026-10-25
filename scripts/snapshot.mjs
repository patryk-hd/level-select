import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { connectLibrary } from '../library/core.js';
import { readIgdb, attachOwned, attachWishlist, attachCatalog, steamSummaries, attachOwnedSteam } from './igdb-snapshot.mjs';
import { readRatingsSnapshot } from './ratings-snapshot.mjs';
import { readRoms, romGroups, withoutOwnedDuplicates } from './roms.mjs';
import { readEsdeImport } from './sources.mjs';
import { readManual, manualGroups, mergeManual } from './manual-games.mjs';
import { readCorrections, applyCorrections } from './corrections.mjs';
import { readAwards, attachAwards, igdbSlug } from './awards.mjs';
import { readVgc, attachVgc } from './vgc.mjs';
import { readAtlasSteam, attachAtlasScores } from './atlas-scores.mjs';

export function parseData(source, key) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { timeout: 3000 });
  if (!Array.isArray(context.window[key])) throw new Error(`Invalid snapshot: ${key} must be an array`);
  return context.window;
}

async function selectData(root, name, local) {
  if (local) {
    try { return { source: await readFile(path.join(root, 'library/data', name), 'utf8'), local: true }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { source: await readFile(path.join(root, 'library/sample', name), 'utf8'), local: false };
}

// Shareable builds opt into samples by default, even when private files exist.
export async function readSnapshot(root, { local = false } = {}) {
  let owned = await selectData(root, 'library-data.js', local);
  // Games you added by hand are a library of their own, even before any import.
  const manual = local ? await readManual(root) : null;
  if (!owned.local && manual?.games.length) owned = { source: 'window.PLAYNITE_LIBRARY = [];', local: true };
  const wishlist = await selectData(root, 'wishlist-data.js', local);
  const ownedData = parseData(owned.source, 'PLAYNITE_LIBRARY'), games = ownedData.PLAYNITE_LIBRARY;
  const wishlistData = parseData(wishlist.source, 'STEAM_WISHLIST');
  const catalog = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
  // Games found in your ROM folders and ES-DE join the private library (never the sample).
  const igdb = local ? await readIgdb(root) : null;
  const roms = owned.local ? withoutOwnedDuplicates(romGroups(await readRoms(root), igdb ? attachCatalog(igdb, structuredClone(catalog)) : catalog, await readEsdeImport(root)), games) : [];
  if (roms.length) { games.push(...roms); owned.source = serialize(ownedData); }
  // Your fixes to imported games, then the games you added (which may join a fixed one).
  if (owned.local) { applyCorrections(games, await readCorrections(root)); owned.source = serialize(ownedData); }
  if (owned.local && manual?.games.length) { mergeManual(games, manualGroups(manual)); owned.source = serialize(ownedData); }
  // Private IGDB evidence is attached only to private imports, never to samples.
  if (igdb && owned.local) {
    attachOwned(igdb, games);
    attachOwnedSteam(steamSummaries(await readRatingsSnapshot(root, { local: true })), games);
    owned.source = serialize(ownedData);
  }
  if (igdb && wishlist.local) { attachWishlist(igdb, wishlistData.STEAM_WISHLIST); wishlist.source = serialize(wishlistData); }
  // Awards are public data, so samples get them too (your newer refresh only in your own copy).
  const awards = await readAwards(root, { local });
  if (awards) {
    attachAwards(awards, { groups: games, wishlist: wishlistData.STEAM_WISHLIST, slugsOf: slugsFrom(igdb) });
    owned.source = serialize(ownedData); wishlist.source = serialize(wishlistData);
  }
  // VideoGamesCritic scores are a private cache, like IGDB evidence.
  if (owned.local || wishlist.local) {
    const vgc = await readVgc(root);
    if (Object.keys(vgc.games).length) {
      attachVgc(vgc, { groups: owned.local ? games : [], wishlist: wishlist.local ? wishlistData.STEAM_WISHLIST : [] });
      owned.source = serialize(ownedData); wishlist.source = serialize(wishlistData);
    }
  }
  const connections = connectLibrary(catalog, games);
  connections.sample = !owned.local;
  connections.totalTitles = games.length;
  connections.totalCopies = games.reduce((total, game) => total + game.copies.length, 0);
  connections.owned = games.map(({ id, name, platforms, steamAppId }) => ({ id, name, platforms, steamAppId }));
  return { owned, wishlist, connections };
}

export const serialize = data => Object.entries(data).map(([key, value]) => `window.${key} = ${JSON.stringify(value)};`).join('\n') + '\n';

// The catalog with private IGDB evidence when requested and available.
export async function readCatalog(root, { local = false } = {}) {
  const catalog = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
  const igdb = local ? await readIgdb(root) : null;
  if (igdb) attachCatalog(igdb, catalog);
  const awards = await readAwards(root, { local });
  if (awards) attachAwards(awards, { catalog, slugsOf: slugsFrom(igdb) });
  // Steam reviews and VGC Scores you fetched (private caches) for the PC list.
  if (local) attachAtlasScores(catalog, { steam: await readAtlasSteam(root), vgc: await readVgc(root) });
  return catalog;
}

// An edition's IGDB page plus its parent game's, so a GOTY edition finds the game's awards.
const slugsFrom = igdb => record => [igdbSlug(record?.url), igdbSlug(igdb?.games?.[record?.versionParent]?.url)];

// The private owned library as refresh scripts see it: the built library plus ROMs, with your
// fixes and the games you added (corrections: false gives the library as imported).
export async function readOwnedGroups(root, { corrections = true } = {}) {
  const manual = await readManual(root);
  const source = await readFile(path.join(root, 'library/data/library-data.js'), 'utf8').catch(error => { if (error.code === 'ENOENT' && manual.games.length) return 'window.PLAYNITE_LIBRARY = [];'; throw error; });
  const data = parseData(source, 'PLAYNITE_LIBRARY');
  const catalog = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
  const games = [...data.PLAYNITE_LIBRARY, ...withoutOwnedDuplicates(romGroups(await readRoms(root), catalog, await readEsdeImport(root)), data.PLAYNITE_LIBRARY)];
  if (!corrections) return games;
  return mergeManual(applyCorrections(games, await readCorrections(root)), manualGroups(manual));
}

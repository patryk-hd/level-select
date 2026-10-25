// npm run vgc:refresh — fetch VideoGamesCritic scores for your Steam games, wishlist and the
// Game Atlas PC list (see scripts/vgc.mjs), and Steam reviews for the PC list
// (scripts/atlas-scores.mjs). A separate entry point, because the snapshot reader imports vgc.mjs.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readSnapshot, parseData } from './snapshot.mjs';
import { refreshVgc, vgcAppids } from './vgc.mjs';
import { atlasAppids, refreshAtlasSteam } from './atlas-scores.mjs';
import { scoreKeys } from './sources.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshot = await readSnapshot(root, { local: true });
const groups = parseData(snapshot.owned.source, 'PLAYNITE_LIBRARY').PLAYNITE_LIBRARY, wishlist = parseData(snapshot.wishlist.source, 'STEAM_WISHLIST').STEAM_WISHLIST;
const atlas = atlasAppids(JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8')));
try { const steam = await refreshAtlasSteam(root, { appids: atlas }); if (steam.fetched) console.log(`Steam: reviews for ${steam.fetched} Game Atlas games`); }
catch (error) { console.log(`Steam reviews for Game Atlas skipped: ${error.message}`); }
const { vgc: key } = await scoreKeys(root);
const result = await refreshVgc(root, { appids: [...new Set([...vgcAppids(groups, wishlist), ...atlas])], key, log: console.log });
const pace = key ? 'run again to continue' : 'without a key VideoGamesCritic allows 60 lookups an hour; a free key (Import games → Scores) allows 5,000 a day';
console.log(`VideoGamesCritic: ${result.fetched} games updated${result.waiting ? `, ${result.waiting} waiting (${pace})` : ''}.`);

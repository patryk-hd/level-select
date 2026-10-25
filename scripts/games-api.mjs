// The local server's "Add a game" endpoints: search, add, change and remove games you add by
// hand, their cover pictures, and serving those pictures. Writes are accepted only from the
// app's own pages (same origin, custom header), like Import games.
import { localRequestAllowed } from './sources-api.mjs';
import { scoreKeys, storeItems } from './sources.mjs';
import { igdbClient } from '../ranking/igdb-client.mjs';
import { readOwnedGroups } from './snapshot.mjs';
import { correctionOf, saveCorrection, setCorrectionCover, resetCorrection } from './corrections.mjs';
import { readAtlas, systemName, searchAtlas, searchIgdb, searchSteam, combineResults, addGame, getGame, editGame, removeGame, setCover, readCover, COVER_ROUTE, COVER_LIMIT } from './manual-games.mjs';

const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('That’s too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

// Recent searches, so typing back and forth doesn't ask IGDB again.
const recent = new Map();
async function search(root, query, { fetchImpl = fetch } = {}) {
  const text = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (text.length < 2) return { results: [], igdb: false };
  const keys = await scoreKeys(root), cacheKey = `${Boolean(keys.igdb)}|${text.toLowerCase()}`;
  if (recent.has(cacheKey)) return recent.get(cacheKey);
  const catalog = await readAtlas(root), atlas = searchAtlas(catalog, text);
  let primary = [], note = null;
  try {
    if (keys.igdb) { const client = await igdbClient(keys.igdb); primary = await searchIgdb(text, (endpoint, body) => client.query(endpoint, body), catalog); }
    else primary = await searchSteam(text, { fetchImpl, details: ids => storeItems(ids, { fetchImpl }) });
  } catch { note = keys.igdb ? 'IGDB couldn’t be reached, so only Game Atlas games are shown.' : 'Steam couldn’t be reached, so only Game Atlas games are shown.'; }
  const answer = { results: combineResults(primary, atlas), igdb: Boolean(keys.igdb), note };
  if (!note) { recent.set(cacheKey, answer); if (recent.size > 200) recent.delete(recent.keys().next().value); }
  return answer;
}

// Your library with your fixes and added games (to spot duplicates), and as imported.
const library = root => readOwnedGroups(root).catch(() => []);
const imported = root => readOwnedGroups(root, { corrections: false }).catch(() => []);

export async function handleGames(req, res, { root, port, startUpdate }) {
  const url = new URL(req.url, 'http://localhost'), route = decodeURIComponent(url.pathname);

  if (route.startsWith(COVER_ROUTE) && req.method === 'GET') {
    const cover = await readCover(root, route.slice(COVER_ROUTE.length));
    if (!cover) { res.writeHead(404); res.end(); return true; }
    // Each picture has its own name, so it never changes and may be kept.
    res.writeHead(200, { 'Content-Type': cover.type, 'Cache-Control': 'private, max-age=31536000, immutable' }); res.end(cover.body);
    return true;
  }

  if (route === '/__retro_library/games/cover') {
    if (!localRequestAllowed(req, port, { json: false })) { send(res, 403, { error: 'Forbidden' }); return true; }
    try {
      if (Number(req.headers['content-length']) > COVER_LIMIT) throw new Error('That picture is too large (8 MB at most).');
      const body = await readBody(req, COVER_LIMIT);
      const picture = body.length ? body : null, copy = url.searchParams.get('copy');
      // A game you added (?id=), or a fix to an imported one (?copy=).
      if (copy) send(res, 200, { correction: await setCorrectionCover(root, copy, picture, { owned: await imported(root) }) });
      else send(res, 200, { game: await setCover(root, url.searchParams.get('id'), picture) });
    } catch (error) { send(res, 400, { error: error.message }); }
    return true;
  }

  if (route !== '/__retro_library/games') return false;
  if (!localRequestAllowed(req, port)) { send(res, 403, { error: 'Forbidden' }); return true; }
  try {
    const body = JSON.parse((await readBody(req, 16384)).toString('utf8') || '{}');
    switch (body.action) {
      case 'search': send(res, 200, await search(root, body.query)); break;
      // Platforms to suggest when typing one, and whether IGDB search is set up.
      case 'options': {
        const catalog = await readAtlas(root), keys = await scoreKeys(root);
        const platforms = [...new Set([...catalog.systems.map(system => systemName(system.id, catalog)), 'macOS', 'Linux', 'iOS', 'Android'].filter(Boolean))];
        send(res, 200, { platforms, igdb: Boolean(keys.igdb) }); break;
      }
      // A new game may bring scores, Steam reviews and time to beat: the update fetches them.
      case 'add': { const game = await addGame(root, body.game, { owned: await library(root) }); send(res, 200, { game, update: startUpdate({ skipSync: true }) }); break; }
      case 'get': send(res, 200, { game: await getGame(root, body.id) }); break;
      case 'edit': send(res, 200, { game: await editGame(root, body.id, body.game, { owned: await library(root) }) }); break;
      // Fixes to imported games. A new title or year may match another IGDB game: the update
      // looks again.
      case 'correction': send(res, 200, await correctionOf(root, String(body.copyId ?? ''), await imported(root))); break;
      case 'correct': {
        const correction = await saveCorrection(root, String(body.copyId ?? ''), body.correction, { owned: await imported(root) });
        send(res, 200, { correction, update: correction?.name || correction?.year || correction?.platform ? startUpdate({ skipSync: true }) : false }); break;
      }
      case 'correction-reset': send(res, 200, { correction: await resetCorrection(root, String(body.copyId ?? '')) }); break;
      case 'remove': send(res, 200, { game: await removeGame(root, body.id) }); break;
      default: throw new Error('Unknown action.');
    }
  } catch (error) { send(res, 400, { error: error.message }); }
  return true;
}

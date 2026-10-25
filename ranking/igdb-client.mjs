// IGDB API client shared by the refresh scripts. Credentials: IGDB_CLIENT_ID and
// IGDB_CLIENT_SECRET in the environment. The access token is cached outside the
// project, shared with library/tools/igdb_genres.py.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const TOKEN_CACHE = path.join(os.homedir(), '.cache/playnite-library-site/igdb-token.json');

async function token(keys, { fresh = false } = {}) {
  const id = keys.IGDB_CLIENT_ID?.trim(), secret = keys.IGDB_CLIENT_SECRET?.trim();
  if (!fresh) try {
    const cached = JSON.parse(await readFile(TOKEN_CACHE, 'utf8'));
    if (cached.expires_at > Date.now() / 1000 + 3600 && cached.client_id === id) return cached;
  } catch {}
  if (!id || !secret) throw new Error('Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET (see README).');
  const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }) });
  if (!response.ok) throw new Error(`Twitch refused the IGDB credentials (HTTP ${response.status}).`);
  const payload = await response.json();
  const cached = { access_token: payload.access_token, client_id: id, expires_at: Date.now() / 1000 + payload.expires_in };
  await mkdir(path.dirname(TOKEN_CACHE), { recursive: true });
  await writeFile(TOKEN_CACHE, JSON.stringify(cached)); await chmod(TOKEN_CACHE, 0o600);
  return cached;
}

// { query(endpoint, body), requests }: four requests a second, retried on 429 and 5xx.
// Keys come from the environment unless given (the app passes the ones saved in Import games).
export async function igdbClient(keys = process.env) {
  let credentials = await token(keys), renewed = false;
  let nextSlot = 0;
  const client = {
    requests: 0,
    async query(endpoint, body, attempt = 0) {
      // IGDB allows four requests per second; space request starts accordingly.
      const wait = Math.max(0, nextSlot - Date.now()); nextSlot = Math.max(Date.now(), nextSlot) + 260;
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      client.requests++;
      let response;
      try {
        response = await fetch(`https://api.igdb.com/v4/${endpoint}`, { method: 'POST', body,
          headers: { 'Client-ID': credentials.client_id, Authorization: `Bearer ${credentials.access_token}` } });
      } catch (error) {
        if (attempt < 4) { await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt)); return client.query(endpoint, body, attempt + 1); }
        throw error;
      }
      // Twitch can withdraw a token before it expires (a new secret, or its own clean-up): ask
      // for a new one once, instead of failing until the cached one runs out.
      if (response.status === 401 && !renewed) {
        renewed = true; credentials = await token(keys, { fresh: true });
        return client.query(endpoint, body, attempt);
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 5) {
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt)); return client.query(endpoint, body, attempt + 1);
      }
      if (!response.ok) throw new Error(`IGDB ${endpoint} HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return response.json();
    },
  };
  return client;
}

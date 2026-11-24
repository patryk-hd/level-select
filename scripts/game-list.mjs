// A list of games you own, all at once: a CSV file, or rows copied from Excel or Google Sheets.
// Each row is a game you added by hand (manual-games.mjs), on the system the list names (or the
// one you chose for all of it), owned where you say: by default a Local backup, like a GOG
// installer you keep or a game a friend gave you. A row the Game Atlas knows on that system
// brings its cover, year and genres. Nothing is saved until you've seen what will be added.
import { randomBytes } from 'node:crypto';
import { titleKey, platformKey, ownedMatches } from '../library/core.js';
import { readManual, writeManual, validateGame, atlasCover, remoteCover, systemName } from './manual-games.mjs';

export const LIST_LIMIT = 5000;

// ---------- the table ----------
// Commas, semicolons (Excel in many countries) or tabs (cells copied from a spreadsheet);
// quoted cells may hold any of them, quotes ("") and line breaks.
export function parseTable(text) {
  const source = String(text ?? '').replace(/^﻿/, '');
  const first = source.split(/\r?\n/).find(line => line.trim()) ?? '';
  const outside = char => { let quoted = false, count = 0; for (const c of first) { if (c === '"') quoted = !quoted; else if (c === char && !quoted) count++; } return count; };
  const delimiter = ['\t', ';', ','].map(char => [char, outside(char)]).filter(([, count]) => count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) { if (c === '"' && source[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; continue; }
    if (c === '"' && !cell.trim()) { quoted = true; cell = ''; }
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && source[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map(cells => cells.map(value => value.replace(/\s+/g, ' ').trim()));
}

// Which column is which: by its heading when the list has one, else the first column is the
// title and a cell elsewhere that names a system or a year is taken as one.
const HEADINGS = { name: /^(?:title|name|game|games|game title|game name)$/, system: /^(?:system|platform|console|machine)s?$/, year: /^(?:year|release year|released|release date)$/ };
const asYear = value => { const match = /^(?:\d{1,2}[./-]\d{1,2}[./-])?((?:19|20)\d{2})(?:[./-]\d{1,2}[./-]\d{1,2})?$/.exec(value); return match ? Number(match[1]) : null; };
export function readGameList(text, isSystem = () => false) {
  const table = parseTable(text).map((cells, index) => ({ cells, line: index + 1 })).filter(row => row.cells.some(Boolean));
  if (!table.length) throw new Error('The list is empty. Paste some games, or choose a file.');
  const head = table[0].cells.map(cell => cell.toLowerCase()), columns = {};
  for (const [field, pattern] of Object.entries(HEADINGS)) { const index = head.findIndex(cell => pattern.test(cell)); if (index >= 0) columns[field] = index; }
  const rows = columns.name == null ? table : table.slice(1);
  if (rows.length > LIST_LIMIT) throw new Error(`That’s ${rows.length.toLocaleString()} games; a list can have ${LIST_LIMIT.toLocaleString()} at most. Split it in two.`);
  return rows.map(({ cells, line }) => {
    if (columns.name != null) return { line, name: cells[columns.name] ?? '', system: cells[columns.system] ?? '', year: asYear(cells[columns.year] ?? '') };
    const rest = cells.slice(1);
    return { line, name: cells[0] ?? '', system: rest.find(cell => isSystem(cell)) ?? '', year: rest.map(asYear).find(Boolean) ?? null };
  }).filter(row => row.name);
}

// ---------- what each row becomes ----------
// systems: the names the app knows (games-api options). A list's "SNES" or "Super Nintendo"
// becomes the name the library uses.
export function previewList({ text, platform = '', ownedOn = 'Local backup' }, { catalog, owned = [], systems = [], now = new Date() }) {
  // A name as written first ("DOS" is PC (DOS)), then loosely ("Sega Genesis" is Mega Drive).
  // PC, Windows and DOS are one family to the library: a list's plain "PC" is Windows.
  const exact = new Map(), known = new Map([[platformKey('PC (Windows)'), 'PC (Windows)']]);
  const learn = (name, display) => { if (!name || !display) return; if (!exact.has(titleKey(name))) exact.set(titleKey(name), display); if (!known.has(platformKey(name))) known.set(platformKey(name), display); };
  for (const name of systems) learn(name, name);
  for (const system of catalog?.systems ?? []) for (const name of [system.id, system.name, system.fullName]) learn(name, systemName(system.id, catalog));
  learn('Windows', 'PC (Windows)');
  const systemOf = value => exact.get(titleKey(value)) ?? known.get(platformKey(value)) ?? null;
  // The Atlas's games by title (and other titles they go by).
  const atlas = new Map();
  for (const game of catalog?.games ?? []) for (const name of new Set([game.title, ...(game.aliases ?? [])])) {
    const key = titleKey(name); if (!atlas.has(key)) atlas.set(key, []); atlas.get(key).push(game);
  }
  const fallback = String(platform ?? '').trim(), seen = new Set();
  const rows = readGameList(text, value => Boolean(systemOf(value))).map(row => {
    const system = row.system ? systemOf(row.system) ?? row.system : systemOf(fallback) ?? fallback;
    const base = { line: row.line, name: row.name, platform: system, year: row.year };
    if (!system) return { ...base, status: 'invalid', reason: 'Which system? Choose one for the whole list, or add a System column.' };
    const found = (atlas.get(titleKey(row.name)) ?? []).filter(game => platformKey(systemName(game.systemId, catalog) ?? '') === platformKey(system))
      .sort((a, b) => (row.year ? Math.abs((a.year ?? 0) - row.year) - Math.abs((b.year ?? 0) - row.year) : 0) || (a.rank ?? 999) - (b.rank ?? 999))[0] ?? null;
    let game;
    try { game = validateGame({ name: row.name, platform: system, year: row.year ?? found?.year ?? null, ownedOn, atlasId: found?.id ?? null, genres: found?.genres ?? [] }, now); }
    catch (error) { return { ...base, status: 'invalid', reason: error.message }; }
    // The Atlas's box art: the copy that ships with the app, else its link (from a host covers may come from).
    const atlasMatch = found ? { title: found.title, year: found.year ?? null, cover: found.cover?.local ? `.${found.cover.local}` : remoteCover(found.cover?.url) ?? '' } : null;
    const key = `${titleKey(game.name)}|${platformKey(system)}`;
    if (seen.has(key)) return { ...base, ...game, atlas: atlasMatch, status: 'repeat', reason: 'Already further up this list.' };
    seen.add(key);
    const matches = ownedMatches(owned, game);
    const same = matches.find(match => match.level === 'same');
    if (same) return { ...base, ...game, atlas: atlasMatch, status: 'owned', reason: `Already in your library on ${system} (${ownedOn}).` };
    const also = [...new Set(matches.filter(match => match.level === 'platform').flatMap(match => match.copy.sources ?? []))];
    return { ...base, ...game, atlas: atlasMatch, status: 'new', also };
  });
  const counts = { new: 0, owned: 0, repeat: 0, invalid: 0 };
  for (const row of rows) counts[row.status]++;
  return { rows, counts };
}

// Adds the list's new games (except the lines you unticked) in one save.
export async function addList(root, input, context) {
  const skip = new Set((Array.isArray(input?.skip) ? input.skip : []).map(Number));
  const { rows } = previewList(input, context), now = context.now ?? new Date();
  const games = rows.filter(row => row.status === 'new' && !skip.has(row.line)).map(row => ({
    id: `manual-${randomBytes(6).toString('hex')}`, ...validateGame(row, now), cover: atlasCover(row.atlas?.cover) ?? remoteCover(row.atlas?.cover) ?? '', coverFile: null, addedAt: now.toISOString() }));
  if (games.length) { const data = await readManual(root); data.games.push(...games); await writeManual(root, data); }
  return { added: games.length, skipped: rows.length - games.length };
}

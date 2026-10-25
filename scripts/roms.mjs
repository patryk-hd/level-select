// ROM folders: find retro games by file name and turn them into owned library entries.
// Only file names are read; nothing is hashed, copied or uploaded.
import { readdir, readFile, stat, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { platformKey, titleKey } from '../library/core.js';

export const ROMS_FILE = 'library/data/roms.json';
export const FOLDERS_FILE = 'library/data/rom-folders.json';

// Extensions that identify one system on their own.
const BY_EXTENSION = {
  nes: 'nes', fds: 'nes', unf: 'nes', sfc: 'snes', smc: 'snes', n64: 'n64', z64: 'n64', v64: 'n64',
  gb: 'gb', gbc: 'gbc', gba: 'gba', nds: 'ds', '3ds': '3ds', md: 'md', gen: 'md', smd: 'md', sms: 'ms', gg: 'gg',
  '32x': '32x', sg: 'sg1000', pce: 'tg16', ngp: 'ngpc', ngc: 'ngpc', a26: 'atari2600', a52: 'atari5200', a78: 'atari7800',
  lnx: 'lynx', j64: 'jaguar', jag: 'jaguar', adf: 'amiga', d64: 'c64', t64: 'c64', crt: 'c64', tzx: 'spectrum', z80: 'spectrum',
  gcm: 'gc', rvz: 'gc', cso: 'psp', xci: 'switch', nsp: 'switch',
};
// Disc images and archives: the system comes from a folder name on the way.
const NEEDS_FOLDER = new Set(['iso', 'bin', 'cue', 'chd', 'img', 'zip', '7z', 'pbp', 'cdi', 'gdi', 'm3u', 'rom', 'dsk', 'mx1', 'mx2']);
const FOLDER_ALIASES = {
  psx: 'ps1', ps1: 'ps1', ps2: 'ps2', psp: 'psp', gc: 'gc', ngc: 'gc', gamecube: 'gc', dc: 'dc', dreamcast: 'dc', saturn: 'saturn',
  sfc: 'snes', snes: 'snes', 'super famicom': 'snes', nes: 'nes', fc: 'nes', famicom: 'nes', n64: 'n64', gb: 'gb', gbc: 'gbc', gba: 'gba',
  md: 'md', gen: 'md', genesis: 'md', megadrive: 'md', 'mega drive': 'md', sms: 'ms', 'master system': 'ms', gg: 'gg', 'game gear': 'gg',
  '32x': '32x', scd: 'scd', segacd: 'scd', 'sega cd': 'scd', 'mega cd': 'scd', megacd: 'scd', pce: 'tg16', tg16: 'tg16', 'pc engine': 'tg16', pcengine: 'tg16',
  pcecd: 'pcecd', 'pc engine cd': 'pcecd', tgcd: 'pcecd', neogeo: 'neogeo', 'neo geo': 'neogeo', ngp: 'ngpc', ngpc: 'ngpc', mame: 'mame', arcade: 'mame',
  fbneo: 'mame', fba: 'mame', cps1: 'cps', cps2: 'cps', cps3: 'cps', naomi: 'naomi', amiga: 'amiga', c64: 'c64', spectrum: 'spectrum', zxspectrum: 'spectrum',
  msx: 'msx', msx2: 'msx', dos: 'dos', 'ms dos': 'dos', atari2600: 'atari2600', '2600': 'atari2600', lynx: 'lynx', jaguar: 'jaguar', wii: 'wii', xbox: 'xbox',
};
const SYSTEMS = new Set(Object.values(FOLDER_ALIASES).concat(Object.values(BY_EXTENSION)));

export function systemFromFolders(parts) {
  for (const part of [...parts].reverse()) {
    const key = titleKey(part);
    if (FOLDER_ALIASES[key]) return FOLDER_ALIASES[key];
    const mapped = platformKey(part);
    if (SYSTEMS.has(mapped)) return mapped;
  }
  return null;
}

// "Legend of Zelda, The - A Link to the Past (USA) [!]" → title + region.
export function parseRomName(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const region = base.match(/\((USA|Europe|Japan|World|Japan, USA|USA, Europe|Europe, Australia|[A-Z][a-z]+(?:, [A-Z][a-z]+)*)\)/)?.[1] ?? null;
  const disc = base.match(/\((?:Disc|Disk|CD) ?(\d+)(?: of \d+)?\)/i)?.[1] ?? null;
  let title = base.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  title = title.replace(/^(.*), (The|A|An)(\s*-\s*.*|$)/, '$2 $1$3').trim();
  return { title, region, disc: disc ? Number(disc) : null };
}

async function walk(folder, depth = 0, found = []) {
  if (depth > 8) return found;
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) await walk(full, depth + 1, found);
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

// Scan folders; one game per system + title, with every file (regions, discs) kept.
export async function scanFolders(folders) {
  const games = new Map(), unrecognised = [];
  for (const folder of folders) {
    const files = await walk(folder), cues = new Set(files.filter(file => /\.(cue|m3u)$/i.test(file)).map(file => path.dirname(file)));
    for (const file of files) {
      const ext = path.extname(file).slice(1).toLowerCase(); if (!ext) continue;
      // A .bin next to a .cue (or discs listed by an .m3u) is part of that image.
      if (ext === 'bin' && cues.has(path.dirname(file))) continue;
      const system = BY_EXTENSION[ext] ?? (NEEDS_FOLDER.has(ext) ? systemFromFolders(path.relative(folder, path.dirname(file)).split(path.sep).concat(path.basename(folder))) : null);
      if (!system) { if (NEEDS_FOLDER.has(ext)) unrecognised.push(path.relative(folder, file)); continue; }
      const { title, region } = parseRomName(path.basename(file));
      if (!title) continue;
      const key = `${system}|${titleKey(title)}`;
      if (!games.has(key)) games.set(key, { id: `rom-${createHash('sha1').update(key).digest('hex').slice(0, 16)}`, title, system, regions: [], files: 0 });
      const game = games.get(key); game.files++;
      if (region && !game.regions.includes(region)) game.regions.push(region);
    }
  }
  for (const game of games.values()) game.regions.sort();
  return { games: [...games.values()].sort((a, b) => a.system.localeCompare(b.system) || a.title.localeCompare(b.title)), unrecognised };
}

export async function readRoms(root) {
  try { const data = JSON.parse(await readFile(path.join(root, ROMS_FILE), 'utf8')); return data.schemaVersion === 1 ? data : null; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function readFolders(root) {
  try { const data = JSON.parse(await readFile(path.join(root, FOLDERS_FILE), 'utf8')); return Array.isArray(data.folders) ? data.folders : []; }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
export async function writeJson(root, file, value) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(`${target}.tmp`, JSON.stringify(value, null, 1)); await rename(`${target}.tmp`, target);
}

// Library groups for your ROMs: games found in ROM folders and in ES-DE's gamelists,
// matched by system and title so each game appears once. Box art, year and genres come from
// ES-DE's scrape when there is one, else from the Game Atlas entry with the same title.
export const ESDE_MEDIA_ROUTE = '/__retro_library/esde-media/';
export function romGroups(roms, catalog, esde = null) {
  const entries = new Map();
  for (const rom of roms?.games ?? []) entries.set(rom.id, { id: rom.id, title: rom.title, system: rom.system, regions: [...rom.regions], scanned: true, esde: null });
  for (const game of esde?.games ?? []) {
    const entry = entries.get(game.id) ?? { id: game.id, title: game.fileTitle, system: game.system, regions: [], scanned: false, esde: null };
    const region = parseRomName(path.basename(game.file)).region;
    if (region && !entry.regions.includes(region)) entry.regions.push(region);
    // Several files of one game (regions, discs): the first has the scrape; play stats add up.
    if (!entry.esde) entry.esde = { ...game };
    else Object.assign(entry.esde, { playCount: entry.esde.playCount + game.playCount, lastPlayed: [entry.esde.lastPlayed, game.lastPlayed].filter(Boolean).sort().at(-1) ?? null,
      favorite: entry.esde.favorite || game.favorite, hidden: entry.esde.hidden && game.hidden, cover: entry.esde.cover ?? game.cover });
    entries.set(game.id, entry);
  }
  if (!entries.size) return [];
  const systems = new Map(catalog.systems.map(system => [system.id, system]));
  const byKey = new Map(catalog.games.map(game => [`${game.systemId}|${titleKey(game.title)}`, game]));
  return [...entries.values()].map(rom => {
    const system = systems.get(rom.system), scraped = rom.esde;
    const atlas = byKey.get(`${rom.system}|${titleKey(rom.title)}`) ?? (scraped ? byKey.get(`${rom.system}|${titleKey(scraped.title)}`) : undefined);
    const platform = system?.name ?? rom.system, name = scraped?.title || rom.title;
    const genres = atlas?.genres?.length ? atlas.genres : scraped?.genre ? scraped.genre.split(/\s*[,/]\s*/).filter(Boolean) : [];
    const cover = scraped?.cover ? ESDE_MEDIA_ROUTE + scraped.cover.split(/[\\/]/).map(encodeURIComponent).join('/') : atlas?.cover?.local ? `.${atlas.cover.local}` : atlas?.cover?.url ?? '';
    const year = atlas?.year ?? scraped?.year ?? null, sources = [rom.scanned ? 'ROM folder' : null, scraped ? 'ES-DE' : null].filter(Boolean);
    const played = Boolean(scraped?.playCount);
    // Until IGDB matches the ROM itself, it borrows the Atlas game's IGDB score.
    const copy = { id: rom.id, name, rom: true, platforms: [platform], sources, year, playCount: scraped?.playCount ?? 0, timePlayed: 0, played, hidden: Boolean(scraped?.hidden), ...(atlas?.igdb ? { igdb: atlas.igdb } : {}) };
    return { id: rom.id, name, rom: true, atlasId: atlas?.id ?? null, platforms: [platform], sources, year,
      releaseDate: year ? String(year) : '', dateSort: year ? `${year}-01-01` : '', genres, mainGenre: genres[0] ?? '',
      developers: scraped?.developer ? [scraped.developer] : [], publishers: scraped?.publisher ? [scraped.publisher] : [],
      categories: [], tags: rom.regions.length ? [`Region: ${rom.regions.sort().join(', ')}`] : [], played, timePlayed: 0, playCount: scraped?.playCount ?? 0,
      hidden: Boolean(scraped?.hidden), favorite: Boolean(scraped?.favorite), notes: '', cover, background: '', summary: scraped?.summary ?? '',
      search: [name, platform, 'rom', ...genres, scraped?.developer ?? ''].join(' ').toLowerCase(), legacyGroups: [], copies: [copy] };
  });
}
// ROMs you already have through Playnite (an emulated game it imported) stay one entry.
export function withoutOwnedDuplicates(roms, games) {
  const owned = new Set(games.flatMap(game => game.copies.flatMap(copy => (copy.platforms ?? game.platforms ?? []).map(platform => `${platformKey(platform)}|${titleKey(copy.name ?? game.name)}`))));
  return roms.filter(rom => !owned.has(`${platformKey(rom.platforms[0])}|${titleKey(rom.name)}`) && !owned.has(`${platformKey(rom.platforms[0])}|${titleKey(rom.copies[0].name)}`));
}

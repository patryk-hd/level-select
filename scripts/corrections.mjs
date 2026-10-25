// Your fixes to imported games (Playnite, Steam, GOG Galaxy, ES-DE, ROM folders): title,
// year, platform and cover, kept by copy id in private library/data/corrections.json. They're
// applied as the server serves the library, and as the update reads it (so IGDB matches the
// corrected title), which means they survive every import and rebuild.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { remoteCover, atlasCover, fetchCover, saveCoverFile, removeCoverFile, COVER_ROUTE } from './manual-games.mjs';

export const CORRECTIONS_FILE = 'library/data/corrections.json';
const FIELDS = ['name', 'year', 'platform'];

export async function readCorrections(root) {
  try {
    const data = JSON.parse(await readFile(path.join(root, CORRECTIONS_FILE), 'utf8'));
    return data?.schemaVersion === 1 && data.copies && typeof data.copies === 'object' ? data : { schemaVersion: 1, copies: {} };
  } catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, copies: {} }; throw error; }
}
async function writeCorrections(root, data) {
  const file = path.join(root, CORRECTIONS_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(data, null, 1)); await rename(`${file}.tmp`, file);
}

// What the import says about a copy (its group fills in what the copy leaves out).
export const importedValues = (group, copy) => ({ name: copy.name ?? group.name, year: copy.year ?? group.year ?? null, platform: copy.platforms?.[0] ?? group.platforms?.[0] ?? '', cover: group.cover ?? '', sources: copy.sources ?? group.sources ?? [] });
export const correctedCover = fix => fix?.coverFile ? COVER_ROUTE + fix.coverFile : fix?.cover || '';

// Your fixes on top of the imported library (in place). A fixed title or year is the game's
// own when that copy is the one the game is shown as; a fixed cover is the game's cover.
export function applyCorrections(games, data) {
  const copies = data?.copies ?? {};
  if (!Object.keys(copies).length) return games;
  for (const group of games) {
    let touched = false, covered = false;
    group.copies.forEach((copy, index) => {
      const fix = copy.manual ? null : copies[copy.id];
      if (!fix) return;
      touched = true; copy.corrected = true;
      if (fix.name) copy.name = fix.name;
      if (fix.year) { copy.year = fix.year; copy.releaseDate = String(fix.year); }
      if (fix.platform) copy.platforms = [fix.platform];
      if (index === 0 || group.copies.length === 1) {
        if (fix.name) group.name = fix.name;
        if (fix.year) Object.assign(group, { year: fix.year, releaseDate: String(fix.year), dateSort: `${fix.year}-01-01` });
      }
      const cover = correctedCover(fix);
      if (cover && !covered) { group.cover = cover; covered = true; }
    });
    if (!touched) continue;
    group.platforms = [...new Set(group.copies.flatMap(copy => copy.platforms ?? []))];
    group.search = `${group.search ?? ''} ${group.copies.map(copy => [copy.name, ...(copy.platforms ?? [])].join(' ')).join(' ')}`.toLowerCase();
  }
  return games;
}

const text = (value, max, label) => {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length > max) throw new Error(`${label} is too long.`);
  return clean;
};
// Only what differs from the import is kept, so a later import's own fix still shows.
export function validateCorrection(input, imported, now = new Date()) {
  const name = text(input?.name, 200, 'The title'), platform = text(input?.platform, 60, 'The platform');
  const year = input?.year === '' || input?.year == null ? null : Number(input.year);
  if (year !== null && !(Number.isInteger(year) && year >= 1950 && year <= now.getFullYear() + 5)) throw new Error(`The year should be between 1950 and ${now.getFullYear() + 5}.`);
  const fix = {};
  if (name && name !== imported.name) fix.name = name;
  if (year && year !== imported.year) fix.year = year;
  if (platform && platform !== imported.platform) fix.platform = platform;
  return fix;
}
const coverId = copyId => `fix-${createHash('sha1').update(String(copyId)).digest('hex').slice(0, 12)}`;
const isEmpty = fix => !FIELDS.some(field => fix[field]) && !fix.cover && !fix.coverFile;

// owned: the library as imported (before your fixes). The copy must be one of its imported ones.
function importedCopy(owned, copyId) {
  for (const group of owned) for (const copy of group.copies) if (copy.id === copyId && !copy.manual) return { group, copy };
  throw new Error('That game isn’t in your imported library any more.');
}
export async function correctionOf(root, copyId, owned) {
  const { group, copy } = importedCopy(owned, copyId);
  return { imported: importedValues(group, copy), correction: (await readCorrections(root)).copies[copyId] ?? null };
}
export async function saveCorrection(root, copyId, input, { owned, fetchImpl = fetch, now = new Date() } = {}) {
  const { group, copy } = importedCopy(owned, copyId), imported = importedValues(group, copy);
  const data = await readCorrections(root), old = data.copies[copyId] ?? {};
  const fix = { ...validateCorrection(input, imported, now), cover: old.cover ?? '', coverFile: old.coverFile ?? null };
  // A cover picked from a search result replaces the old one.
  const remote = remoteCover(input?.coverUrl), local = atlasCover(input?.coverUrl);
  if (remote || local) {
    const file = remote ? await fetchCover(root, coverId(copyId), remote, fetchImpl) : null;
    if (fix.coverFile) await removeCoverFile(root, fix.coverFile);
    Object.assign(fix, { coverFile: file, cover: file ? '' : remote ?? local });
  }
  if (isEmpty(fix)) delete data.copies[copyId]; else data.copies[copyId] = { ...fix, at: now.toISOString() };
  await writeCorrections(root, data);
  return data.copies[copyId] ?? null;
}
// Your own picture (bytes), or back to the imported cover (null).
export async function setCorrectionCover(root, copyId, buffer, { owned, now = new Date() } = {}) {
  importedCopy(owned, copyId);
  const data = await readCorrections(root), fix = { ...(data.copies[copyId] ?? {}) }, old = fix.coverFile;
  fix.coverFile = buffer ? await saveCoverFile(root, coverId(copyId), buffer) : null;
  fix.cover = '';
  if (isEmpty(fix)) delete data.copies[copyId]; else data.copies[copyId] = { ...fix, at: now.toISOString() };
  await writeCorrections(root, data);
  await removeCoverFile(root, old);
  return data.copies[copyId] ?? null;
}
export async function resetCorrection(root, copyId) {
  const data = await readCorrections(root), fix = data.copies[copyId];
  if (!fix) return null;
  delete data.copies[copyId];
  await writeCorrections(root, data);
  await removeCoverFile(root, fix.coverFile);
  return fix;
}

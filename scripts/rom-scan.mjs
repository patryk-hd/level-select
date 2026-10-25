// Scan your ROM folders and add the games to your library.
//
//   npm run roms:scan -- --add "/path/to/ROMs"     remember a folder and scan
//   npm run roms:scan                              rescan remembered folders
//   npm run roms:scan -- --remove "/path/to/ROMs"  forget a folder
//   npm run roms:scan -- --list                    show remembered folders
//
// Only file names are read. Results go to private library/data/roms.json; reload the app.
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { scanFolders, readFolders, writeJson, FOLDERS_FILE, ROMS_FILE } from './roms.mjs';

export async function romScan(root, args = []) {
  const option = name => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : null; };
  let folders = await readFolders(root);
  const add = option('add'), remove = option('remove');
  if (add) {
    const folder = path.resolve(add);
    if (!(await stat(folder).catch(() => null))?.isDirectory()) throw new Error(`Not a folder: ${folder}`);
    if (!folders.includes(folder)) folders = [...folders, folder];
  }
  if (remove) folders = folders.filter(folder => folder !== path.resolve(remove));
  if (add || remove) await writeJson(root, FOLDERS_FILE, { folders });
  if (args.includes('--list')) return { folders };
  if (!folders.length) {
    // Removing the last folder removes its games too.
    if (remove) await writeJson(root, ROMS_FILE, { schemaVersion: 1, scannedAt: new Date().toISOString(), folders: [], games: [], unrecognised: 0 });
    return { folders, games: [], message: 'No ROM folders yet. Add one with: npm run roms:scan -- --add "/path/to/ROMs"' };
  }
  const missing = [];
  for (const folder of folders) if (!(await stat(folder).catch(() => null))?.isDirectory()) missing.push(folder);
  const available = folders.filter(folder => !missing.includes(folder));
  const result = await scanFolders(available);
  // An unplugged drive must not wipe the games found on it last time.
  if (missing.length && !result.games.length) return { folders, games: [], missing, message: 'ROM folders are not available (drive unplugged?). Nothing was changed.' };
  await writeJson(root, ROMS_FILE, { schemaVersion: 1, scannedAt: new Date().toISOString(), folders: available, games: result.games, unrecognised: result.unrecognised.length });
  return { folders, missing, ...result };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = await romScan(root, process.argv.slice(2));
  if (result.message) console.log(result.message);
  if (process.argv.includes('--list')) console.log(result.folders.length ? result.folders.join('\n') : 'No ROM folders yet.');
  else if (result.games) {
    const bySystem = {};
    for (const game of result.games) bySystem[game.system] = (bySystem[game.system] ?? 0) + 1;
    if (result.games.length) console.log(`Found ${result.games.length} games: ${Object.entries(bySystem).map(([system, count]) => `${system} ${count}`).join(', ')}`);
    if (result.missing?.length) console.log(`Not available right now: ${result.missing.join(', ')}`);
    if (result.unrecognised?.length) console.log(`${result.unrecognised.length} disc images/archives had no system folder, e.g. ${result.unrecognised.slice(0, 3).join(', ')}. Put them in a folder named after the system (e.g. "PS1", "Mega Drive").`);
    if (result.games.length) console.log('Reload the app to see them in Library (and run npm run update to fetch their scores).');
  }
}

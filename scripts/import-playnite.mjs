import { cp, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const sourceArg = args.indexOf('--source');
if (sourceArg === -1 || !args[sourceArg + 1]) throw new Error('Usage: npm run library:import -- --source /path/to/playnite-library-site');
const source = path.resolve(args[sourceArg + 1]);
const target = fileURLToPath(new URL('../library/', import.meta.url));
if (source === path.resolve(target)) throw new Error('Choose the original Playnite folder, not the integration folder.');
for (const required of ['playnite_library.csv', 'data/library-data.js', 'data/wishlist-data.js', 'assets']) await stat(path.join(source, required));
// Copy data and artwork only: imported UI files never replace the integrated UI.
for (const name of ['assets', 'data', 'playnite_library.csv', 'steam-wishlist.json']) {
  await cp(path.join(source, name), path.join(target, name), {
    recursive: true, mode: constants.COPYFILE_FICLONE,
    filter: file => !['.DS_Store', '__pycache__', 'connections.json'].includes(path.basename(file)),
  });
}
await import('./connect-library.mjs');
console.log('Imported the Playnite snapshot and artwork. Browser edits are unchanged.');

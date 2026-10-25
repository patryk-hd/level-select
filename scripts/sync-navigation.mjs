import { readFile, writeFile } from 'node:fs/promises';
import { navigationMarkup } from '../navigation-template.js';

for (const [file, prefix, active] of [['index.html','./','recommendations'], ['library/index.html','../','owned'], ['library/wishlist.html','../','wishlist'], ['library/backlog.html','../','backlog'], ['library/sources.html','../','sources'], ['library/mods.html','../','mods'], ['library/phone.html','../','phone']]) {
  const url = new URL(`../${file}`, import.meta.url);
  const source = await readFile(url, 'utf8');
  const region = /<!-- shared-navigation:start -->[\s\S]*?<!-- shared-navigation:end -->/;
  if (!region.test(source)) throw new Error(`Shared navigation marker missing in ${file}`);
  const updated = source.replace(region, navigationMarkup(prefix, active));
  if (updated !== source) await writeFile(url, updated);
}

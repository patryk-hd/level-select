import test from 'node:test';
import assert from 'node:assert/strict';
import { findPython, pythonCommand, parseRegistryValue, registryValue, isProjectCommand } from '../scripts/platform.mjs';
import { steamConfigPaths, steamRoots, galaxyPaths, esdePaths, esdeFolders, playnitePaths } from '../scripts/sources.mjs';

const WINDOWS_ENV = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files', ProgramData: 'C:\\ProgramData',
  APPDATA: 'C:\\Users\\pat\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\pat\\AppData\\Local' };

test('the bundled Python wins; a Mac uses a real Python, never Apple’s stand-in', () => {
  assert.equal(findPython({ env: { LEVEL_SELECT_PYTHON: 'C:\\Level Select\\runtime\\python\\python.exe' }, platform: 'win32' }), 'C:\\Level Select\\runtime\\python\\python.exe');
  assert.equal(findPython({ env: {}, platform: 'win32' }), 'python');
  const mac = (files, developer = () => null) => findPython({ env: {}, platform: 'darwin', exists: file => files.includes(file), developer });
  assert.equal(mac(['/opt/homebrew/bin/python3', '/usr/bin/python3']), '/opt/homebrew/bin/python3');
  // python.org's installer.
  assert.equal(mac(['/Library/Frameworks/Python.framework/Versions/Current/bin/python3']), '/Library/Frameworks/Python.framework/Versions/Current/bin/python3');
  // Apple's command line tools: their own Python, not /usr/bin/python3.
  assert.equal(mac(['/usr/bin/python3', '/Library/Developer/CommandLineTools/usr/bin/python3'], () => '/Library/Developer/CommandLineTools'), '/Library/Developer/CommandLineTools/usr/bin/python3');
  // Only the stand-in: no Python (Import games shows how to install it).
  assert.equal(mac(['/usr/bin/python3']), null);
  assert.equal(pythonCommand({ env: {}, platform: 'darwin', exists: () => false, developer: () => null }), 'python3');
});

test('Steam is found wherever the registry says it is installed, then in Program Files', async () => {
  const output = '\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    d:/games/steam\r\n\r\n';
  assert.equal(parseRegistryValue(output, 'SteamPath'), 'd:/games/steam');
  assert.equal(parseRegistryValue('ERROR: The system was unable to find the specified registry key or value.', 'SteamPath'), null);
  // reg.exe is only asked on Windows.
  assert.equal(await registryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath', { platform: 'darwin', run: () => assert.fail('no reg.exe on a Mac') }), null);
  const roots = await steamRoots({ platform: 'win32', registry: async (key, name) => name === 'SteamPath' ? 'd:/games/steam' : null });
  assert.deepEqual(roots, ['d:/games/steam']);
  assert.deepEqual(steamConfigPaths('C:\\Users\\pat', 'win32', { env: WINDOWS_ENV, roots }), [
    'd:\\games\\steam\\config\\loginusers.vdf', 'C:\\Program Files (x86)\\Steam\\config\\loginusers.vdf', 'C:\\Program Files\\Steam\\config\\loginusers.vdf']);
  assert.deepEqual(steamConfigPaths('/Users/pat', 'darwin'), ['/Users/pat/Library/Application Support/Steam/config/loginusers.vdf']);
});

test('GOG Galaxy, Playnite and ES-DE are looked for where Windows keeps them', () => {
  assert.deepEqual(galaxyPaths('win32', { ...WINDOWS_ENV, ProgramData: 'E:\\ProgramData' }), ['E:\\ProgramData\\GOG.com\\Galaxy\\storage\\galaxy-2.0.db', 'C:\\ProgramData\\GOG.com\\Galaxy\\storage\\galaxy-2.0.db']);
  assert.deepEqual(playnitePaths('win32', WINDOWS_ENV), ['C:\\Users\\pat\\AppData\\Roaming\\Playnite', 'C:\\Users\\pat\\AppData\\Local\\Playnite']);
  assert.deepEqual(playnitePaths('darwin', WINDOWS_ENV), []);
  const esde = esdePaths('C:\\Users\\pat', 'win32', WINDOWS_ENV);
  // Installed (user folder), EmuDeck, and the portable release unpacked to a drive.
  for (const folder of ['C:\\Users\\pat\\ES-DE', 'C:\\Users\\pat\\AppData\\Roaming\\EmuDeck\\Emulators\\ES-DE\\ES-DE', 'D:\\ES-DE\\ES-DE', 'E:\\Emulation\\ES-DE\\ES-DE']) assert.ok(esde.includes(folder), folder);
});

test('ES-DE’s ROM folder follows its settings: ~, %ESPATH% or the portable default', () => {
  assert.deepEqual(esdeFolders('/Users/pat/ES-DE', { rom: '~/ROMs', home: '/Users/pat' }), { romDirectory: '/Users/pat/ROMs', mediaDirectory: '/Users/pat/ES-DE/downloaded_media' });
  assert.equal(esdeFolders('/Volumes/Games/ES-DE/ES-DE', { rom: '%ESPATH%/ROMs', home: '/Users/pat' }).romDirectory, '/Volumes/Games/ES-DE/ROMs');
  assert.equal(esdeFolders('/Volumes/Games/ES-DE/ES-DE', { portable: true, home: '/Users/pat' }).romDirectory, '/Volumes/Games/ES-DE/ROMs');
  assert.equal(esdeFolders('/Users/pat/ES-DE', { home: '/Users/pat' }).romDirectory, '/Users/pat/ROMs');
  assert.equal(esdeFolders('/Users/pat/ES-DE', { media: '~/Media', home: '/Users/pat' }).mediaDirectory, '/Users/pat/Media');
});

test('Stop recognises the update’s own commands on any system, and nothing else', () => {
  assert.ok(isProjectCommand('/usr/local/bin/node /Users/pat/Level Select/scripts/enrich-ratings.mjs --batch'));
  assert.ok(isProjectCommand('python3 library/tools/build_site.py --csv library/playnite_library.csv'));
  assert.ok(isProjectCommand('"C:\\Users\\pat\\AppData\\Local\\Programs\\Level Select\\runtime\\node\\node.exe" C:\\Users\\pat\\AppData\\Local\\Programs\\Level Select\\app\\scripts\\update-all.mjs'));
  assert.ok(isProjectCommand('"C:\\Level Select\\runtime\\python\\python.exe" library/tools/steam_enrich.py --wishlist'));
  assert.ok(!isProjectCommand('/usr/bin/node /tmp/notscripts/update-all.mjs.bak'));
  assert.ok(!isProjectCommand('C:\\Windows\\explorer.exe'));
  assert.ok(!isProjectCommand(null));
});

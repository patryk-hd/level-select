// Checks an installed Level Select on Windows, end to end (the Installers workflow runs it on
// a fresh Windows machine after a silent install):
//   node scripts/check-windows-install.mjs "<install folder>" "<installer>"
// The bundled Node and Python run, the Windows helpers read real registry and process data,
// the app serves its pages and finds sources, a Playnite export is rebuilt into a library
// (through the bundled Python, with a non-English title), and the uninstaller keeps your
// imported games by default and leaves nothing else behind.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { registryValue, commandLine, isProjectCommand, PYTHON_ENV } from './platform.mjs';

const install = path.resolve(process.argv[2] ?? ''), setup = path.resolve(process.argv[3] ?? '');
const app = path.join(install, 'app'), node = path.join(install, 'runtime', 'node', 'node.exe'), python = path.join(install, 'runtime', 'python', 'python.exe');
const port = 8790, base = `http://127.0.0.1:${port}`;
const env = { ...process.env, RETRO_LIBRARY_PORT: String(port), LEVEL_SELECT_PYTHON: python };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const step = label => console.log(`\n▸ ${label}`);

step('Installed files and shortcuts');
for (const file of [node, python, path.join(app, 'launcher', 'windows', 'LevelSelect.ps1'), path.join(install, 'LevelSelect.ico'), path.join(install, 'Uninstall Level Select.exe'), path.join(app, '.payload-version')])
  assert.ok(existsSync(file), `missing ${file}`);
const startMenu = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Level Select.lnk');
assert.ok(existsSync(startMenu), 'no Start menu shortcut');
for (const file of ['library/data', 'library/playnite_library.csv', 'tests', 'docs']) assert.ok(!existsSync(path.join(app, file)), `${file} shouldn't be installed`);
console.log(`  ${(await readFile(path.join(app, '.payload-version'), 'utf8')).trim()} · Node ${execFileSync(node, ['-v'], { encoding: 'utf8' }).trim()}`);

step('The launcher script parses in Windows PowerShell');
const parse = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${path.join(app, 'launcher', 'windows', 'LevelSelect.ps1')}', [ref]$null, [ref]$errors); $errors.Count`], { encoding: 'utf8' });
assert.equal(parse.stdout.trim(), '0', parse.stdout + parse.stderr);

step('Bundled Python: library tools import each other; SQLite, HTTPS and UTF-8 work');
const check = spawnSync(python, ['-c', 'import sqlite3, ssl, json, urllib.request, steam_meta, title_groups; print("Pok\\u00e9mon \\u2713", sqlite3.sqlite_version)'], { encoding: 'utf8', env: { ...env, ...PYTHON_ENV } });
assert.equal(check.status, 0, check.stderr);
assert.match(check.stdout, /^Pokémon ✓ \d/, check.stdout);
console.log(`  ${check.stdout.trim()}`);

step('Windows helpers read the registry and process list');
assert.ok(await registryValue('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', 'ProductName'), 'registry read failed');
const ownLine = await commandLine(process.pid);
assert.ok(isProjectCommand(ownLine), `not recognised as this project's command: ${ownLine}`);

step('The library starts and serves its pages');
const control = action => spawnSync(node, [path.join(app, 'scripts', 'library-control.mjs'), action], { cwd: app, env, encoding: 'utf8' });
const started = control('start');
assert.equal(started.status, 0, started.stdout + started.stderr);
for (const page of ['library/backlog.html', 'library/index.html', 'library/sources.html', 'index.html', 'welcome.js', 'data/catalog.json', 'library/data/library-data.js'])
  assert.equal((await fetch(`${base}/${page}`)).status, 200, page);
const sources = await (await fetch(`${base}/__retro_library/sources`)).json();
assert.equal(sources.platform, 'win32');
console.log(`  sources: Steam accounts ${sources.steam.accounts.length}, Galaxy ${sources.galaxy.found.length}, ES-DE ${sources.esde.found.length}, Playnite ${sources.playnite.found.length}`);

step('A Playnite export becomes a library (bundled Python, non-English titles)');
const csv = '﻿Id,Name,Platforms,Sources,Release Date\r\n"a1","Pokémon Legends: Arceus","Nintendo Switch","Playnite","2022-01-28"\r\n"a2","Half-Life 2","PC (Windows)","Steam","2004-11-16"\r\n';
const upload = await fetch(`${base}/__retro_library/upload?kind=playnite`, { method: 'POST', headers: { Origin: base, 'X-Retro-Library': '1', 'Content-Type': 'application/octet-stream' }, body: csv });
assert.equal(upload.status, 200, await upload.text());
let status;
for (let attempt = 0; attempt < 120; attempt++) {
  status = await (await fetch(`${base}/__retro_library/update-status`)).json();
  if (status.status?.steps?.find(entry => entry.id === 'library')?.state === 'done' || ['failed', 'done', 'partial'].includes(status.status?.state) && !status.running) break;
  await delay(1000);
}
const library = status.status?.steps?.find(entry => entry.id === 'library');
assert.equal(library?.state, 'done', JSON.stringify(status.status, null, 1));
const built = await readFile(path.join(app, 'library', 'data', 'library-data.js'), 'utf8');
assert.ok(built.includes('Pokémon Legends: Arceus') && built.includes('Half-Life 2'), 'rebuilt library is missing the games');
console.log('  library rebuilt with 2 games');
// The rest of the update fetches scores; stop it rather than wait.
await fetch(`${base}/__retro_library/update-stop`, { method: 'POST', headers: { Origin: base, 'X-Retro-Library': '1', 'Content-Type': 'application/json' }, body: '{}' });
for (let attempt = 0; attempt < 30 && (await (await fetch(`${base}/__retro_library/update-status`)).json()).running; attempt++) await delay(1000);

const stoppedUpdate = (await (await fetch(`${base}/__retro_library/update-status`)).json()).status;
console.log(`  update after Stop: ${stoppedUpdate?.state} (${stoppedUpdate?.steps?.filter(entry => ['stopped', 'skipped'].includes(entry.state)).map(entry => entry.id).join(', ')})`);

step('The library stops, leaving nothing running from its folder');
const stopped = control('stop');
assert.ok([0, 3].includes(stopped.status), stopped.stdout + stopped.stderr);
assert.equal(control('status').status, 3);
await delay(1000);
const running = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($env:LEVEL_SELECT_RUNTIME, "OrdinalIgnoreCase") } | ForEach-Object { "$($_.Id) $($_.Path)" }'],
  { encoding: 'utf8', env: { ...process.env, LEVEL_SELECT_RUNTIME: path.join(install, 'runtime') + path.sep } }).stdout.trim();
assert.equal(running, '', `still running after Stop:\n${running}`);

// Uninstalls as Settings → Apps does: the uninstaller hands off to a copy of itself and
// returns at once, so this waits until that copy has removed the uninstaller.
const uninstaller = path.join(install, 'Uninstall Level Select.exe');
async function uninstall() {
  // A freshly installed uninstaller can be held for a moment (by the installer finishing, or a
  // virus scan), so starting it gets a few tries.
  let started;
  for (let attempt = 0; attempt < 10; attempt++) {
    started = spawnSync(uninstaller, ['/S']);
    if (started.status === 0) break;
    await delay(1000);
  }
  assert.equal(started.status, 0, `the uninstaller didn’t start: ${started.error?.message ?? `exit ${started.status}`}`);
  for (let attempt = 0; attempt < 120 && existsSync(uninstaller); attempt++) await delay(500);
  await delay(2000);
  assert.ok(!existsSync(uninstaller), 'the uninstaller didn’t finish');
}
// Everything left in the install folder, as paths inside it.
async function leftovers(folder = install) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(folder, entry.name);
    found.push(path.relative(install, full));
    if (entry.isDirectory()) found.push(...await leftovers(full));
  }
  return found;
}
// Stands in for Level Select's icon by the clock: Windows PowerShell running its script from
// the app folder (as the shortcuts start it), which keeps that folder in use.
function trayStandIn() {
  const tray = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Sleep -Seconds 600 # ${path.join(app, 'launcher', 'windows', 'LevelSelect.ps1')}`],
    { cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  tray.output = '';
  tray.stderr.on('data', chunk => { tray.output += chunk; });
  return tray;
}
const alive = tray => tray.exitCode === null && tray.signalCode === null;

step('Uninstalling keeps imported games unless asked, and nothing else');
let tray = trayStandIn();
await delay(1500);
assert.ok(alive(tray), `the stand-in icon didn’t start (exit ${tray.exitCode}): ${tray.output}`);
await uninstall();
assert.ok(!alive(tray), 'the icon by the clock is still running');
for (const file of [node, python, path.join(app, 'scripts', 'serve.mjs'), path.join(app, 'index.html'), startMenu]) assert.ok(!existsSync(file), `left behind: ${file}`);
assert.ok(existsSync(path.join(app, 'library', 'data', 'library-data.js')), 'imported library was deleted');
// Yours, from importing: the library, uploaded exports and artwork (the paths .gitignore keeps
// out of Git too). Only they and the folders holding them may stay.
const yours = entry => /^app\\library\\(?:data|assets|playnite_library_backup)(?:\\|$)|^app\\library\\(?:playnite_library[^\\]*\.csv|steam-wishlist[^\\]*\.json)$/i.test(entry);
const kept = (await leftovers()).filter(yours);
const extra = (await leftovers()).filter(entry => !yours(entry) && !['app', path.join('app', 'library')].includes(entry));
assert.deepEqual(extra, [], `left behind besides the imported games:\n${extra.join('\n')}`);
console.log(`  kept ${kept.length} files and folders of imported games, nothing else`);

step('Installing again and uninstalling with nothing imported leaves no folder behind');
// NSIS only reads /D= unquoted and last, and Node would quote a path with spaces, so the
// command line goes through cmd as written.
assert.equal(spawnSync(`"${setup}" /S /D=${install}`, { shell: true }).status, 0, 'the installer failed');
assert.ok(existsSync(uninstaller), `not installed again in ${install}`);
for (const entry of kept) await rm(path.join(install, entry), { recursive: true, force: true });
tray = trayStandIn();
await delay(1500);
await uninstall();
assert.ok(!alive(tray), 'the icon by the clock is still running');
assert.ok(!existsSync(install), `left behind:\n${(await leftovers()).join('\n')}`);
console.log(`\nAll checks passed on ${os.version()}.`);

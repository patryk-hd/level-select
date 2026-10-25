// One-click installers for people trying Level Select:
//   npm run package -- --mac       Level Select.app in a .dmg (built on a Mac, with Xcode)
//   npm run package -- --windows   Level-Select-Setup.exe (needs NSIS's makensis; GitHub's
//                                  Windows runners have it, see .github/workflows/installers.yml)
// Both carry the app (files tracked by Git only, so nothing personal ever goes in) and
// their own Node.js; the Windows one also carries Python, which rebuilds the library. The
// runtimes are downloaded once into .build/cache and checked against package-runtimes.json.
// Output goes to dist-installers/.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile, stat, chmod, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const BUILD = path.join(root, '.build'), CACHE = path.join(BUILD, 'cache'), OUT = path.join(root, 'dist-installers');
const RUNTIMES = JSON.parse(await readFile(path.join(root, 'scripts/package-runtimes.json'), 'utf8'));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

// What a tester's copy needs: the project as Git sees it, except tests, docs, the showcase site, dot-folders
// (CI and other tools' settings) and other tools' sources. Ignored files (your library, keys, exports) are never included.
const LEFT_OUT = /^(?:tests|docs|promo|site)\/|^\.|^launcher\/(?!windows\/LevelSelect\.ps1$)|^CONTRIBUTING\.md$|^Level Select\.app\//;
export const payloadFiles = files => files.filter(file => !LEFT_OUT.test(file));

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
async function stagePayload(target) {
  // Git's view of the project (as in check:share): tracked and new files, never ignored ones.
  const files = payloadFiles(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean)).filter(file => existsSync(path.join(root, file)));
  await rm(target, { recursive: true, force: true });
  for (const file of files) { await mkdir(path.dirname(path.join(target, file)), { recursive: true }); await cp(path.join(root, file), path.join(target, file)); }
  // Changes when the app does, so an installed copy knows to update itself.
  const dirty = git('status', '--porcelain', '--untracked-files=no') ? '+changes' : '';
  const stamp = `${version} ${git('rev-parse', '--short', 'HEAD')}${dirty}`;
  await writeFile(path.join(target, '.payload-version'), stamp);
  return { files, stamp };
}

// ---------- downloads ----------
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
async function download(url, name) {
  const file = path.join(CACHE, name);
  if (existsSync(file)) return readFile(file);
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  await mkdir(CACHE, { recursive: true }); await writeFile(file, body);
  return body;
}
// Node.js publishes the checksums of every release; Python's pinned one is in package-runtimes.json.
async function verified(url, name, expected) {
  const body = await download(url, name), actual = sha256(body);
  if (expected && actual !== expected) { await rm(path.join(CACHE, name), { force: true }); throw new Error(`${name}: checksum ${actual} doesn't match ${expected}. Download refused.`); }
  if (!expected) console.warn(`${name}: no pinned checksum yet; its SHA-256 is ${actual}. Add it to scripts/package-runtimes.json.`);
  return body;
}
async function nodeChecksum(nodeVersion, name) {
  const sums = (await download(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`, `node-v${nodeVersion}-SHASUMS256.txt`)).toString();
  const line = sums.split('\n').find(row => row.trim().endsWith(`  ${name}`));
  if (!line) throw new Error(`${name} isn't in Node.js ${nodeVersion}'s checksums.`);
  return line.split(/\s+/)[0];
}

// A small zip reader (the runtimes are zips; this keeps the build free of other tools).
export function unzip(buffer, keep = () => true) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a zip file.');
  const count = buffer.readUInt16LE(end + 10), files = new Map();
  for (let index = 0, at = buffer.readUInt32LE(end + 16); index < count; index++) {
    const method = buffer.readUInt16LE(at + 10), size = buffer.readUInt32LE(at + 20), nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30), comment = buffer.readUInt16LE(at + 32), local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extra + comment;
    if (name.endsWith('/') || !keep(name)) continue;
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28), data = buffer.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`${name}: unsupported zip compression ${method}.`);
  }
  return files;
}

// ---------- Windows ----------
async function windowsRuntimes(target) {
  const { node, python } = RUNTIMES;
  const nodeZip = `node-v${node.version}-win-x64.zip`;
  const nodeFiles = unzip(await verified(`https://nodejs.org/dist/v${node.version}/${nodeZip}`, nodeZip, await nodeChecksum(node.version, nodeZip)),
    name => /^[^/]+\/(?:node\.exe|LICENSE)$/.test(name));
  await mkdir(path.join(target, 'node'), { recursive: true });
  for (const [name, data] of nodeFiles) await writeFile(path.join(target, 'node', path.posix.basename(name)), data);

  const pythonZip = `python-${python.version}-embed-amd64.zip`;
  const pythonFiles = unzip(await verified(`https://www.python.org/ftp/python/${python.version}/${pythonZip}`, pythonZip, python.sha256));
  await mkdir(path.join(target, 'python'), { recursive: true });
  for (const [name, data] of pythonFiles) await writeFile(path.join(target, 'python', name), data);
  // The embeddable Python only looks where its ._pth file says: add the library tools, so
  // their scripts can import each other.
  const [major, minor] = python.version.split('.'), pth = path.join(target, 'python', `python${major}${minor}._pth`);
  await writeFile(pth, `${(await readFile(pth, 'utf8')).trimEnd()}\r\n..\\..\\app\\library\\tools\r\n`);
}
const nsisString = value => value.replace(/\$/g, '$$$$').replace(/"/g, '$\\"');
export function nsisScript({ version: appVersion, stage, output, files }) {
  const win = file => file.replace(/\//g, '\\');
  // The uninstaller removes what was installed and what running it made (logs, Python's
  // caches), so only imported games stay, and only unless you ask.
  const folders = [...new Set(files.flatMap(file => file.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'))))].sort((a, b) => b.length - a.length);
  const pythonFolders = [...new Set(files.filter(file => file.endsWith('.py')).map(file => path.posix.dirname(file)))].sort();
  const numeric = `${appVersion.split(/[^\d.]/)[0].split('.').concat(['0', '0', '0']).slice(0, 3).join('.')}.0`;
  return `; Generated by scripts/package.mjs
Unicode true
!include "MUI2.nsh"
Name "Level Select"
OutFile "${nsisString(output)}"
InstallDir "$LOCALAPPDATA\\Programs\\Level Select"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Level Select ${appVersion}"
VIProductVersion "${numeric}"
VIAddVersionKey "ProductName" "Level Select"
VIAddVersionKey "FileDescription" "Level Select installer"
VIAddVersionKey "FileVersion" "${appVersion}"
VIAddVersionKey "ProductVersion" "${appVersion}"
VIAddVersionKey "LegalCopyright" "Level Select"
!define MUI_ICON "${nsisString(path.join(stage, 'LevelSelect.ico'))}"
!define MUI_UNICON "${nsisString(path.join(stage, 'LevelSelect.ico'))}"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Start Level Select"
!define MUI_FINISHPAGE_RUN_FUNCTION StartLevelSelect
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

!define LAUNCH '"$WINDIR\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"'
!define LAUNCH_ARGS '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\\app\\launcher\\windows\\LevelSelect.ps1"'
!define UNINSTALL_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LevelSelect"

; A running Level Select keeps node.exe in use: stop it before files are replaced or removed,
; then end anything still running from its folder (an update step, say). Its icon by the
; clock runs in Windows PowerShell from the app folder, which keeps that folder in use: it
; goes first, found by its script.
!macro StopLevelSelect
  System::Call 'Kernel32::SetEnvironmentVariable(t "RETRO_LIBRARY_PORT", t "8790")'
  System::Call 'Kernel32::SetEnvironmentVariable(t "LEVEL_SELECT_RUNTIME", t "$INSTDIR\\runtime\\")'
  System::Call 'Kernel32::SetEnvironmentVariable(t "LEVEL_SELECT_TRAY", t "$INSTDIR\\app\\launcher\\windows\\LevelSelect.ps1")'
  nsExec::Exec \`"$WINDIR\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'powershell.exe' -and $$_.CommandLine -and $$_.CommandLine.IndexOf($$env:LEVEL_SELECT_TRAY, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"\`
  IfFileExists "$INSTDIR\\runtime\\node\\node.exe" 0 +2
    nsExec::Exec '"$INSTDIR\\runtime\\node\\node.exe" "$INSTDIR\\app\\scripts\\library-control.mjs" stop'
  nsExec::Exec \`"$WINDIR\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -Command "Get-Process | Where-Object { $$_.Path -and $$_.Path.StartsWith($$env:LEVEL_SELECT_RUNTIME, 'OrdinalIgnoreCase') } | Stop-Process -Force"\`
!macroend

Function StartLevelSelect
  Exec '\${LAUNCH} \${LAUNCH_ARGS}'
FunctionEnd

Section "Level Select"
  !insertmacro StopLevelSelect
  SetOutPath "$INSTDIR"
  File "${nsisString(path.join(stage, 'LevelSelect.ico'))}"
  SetOutPath "$INSTDIR\\app"
  File /r "${nsisString(path.join(stage, 'app', '*.*'))}"
  SetOutPath "$INSTDIR\\runtime"
  File /r "${nsisString(path.join(stage, 'runtime', '*.*'))}"
  SetOutPath "$INSTDIR\\app"
  CreateShortcut "$SMPROGRAMS\\Level Select.lnk" \${LAUNCH} '\${LAUNCH_ARGS}' "$INSTDIR\\LevelSelect.ico" 0 SW_SHOWMINIMIZED
  CreateShortcut "$DESKTOP\\Level Select.lnk" \${LAUNCH} '\${LAUNCH_ARGS}' "$INSTDIR\\LevelSelect.ico" 0 SW_SHOWMINIMIZED
  WriteUninstaller "$INSTDIR\\Uninstall Level Select.exe"
  WriteRegStr HKCU "\${UNINSTALL_KEY}" "DisplayName" "Level Select"
  WriteRegStr HKCU "\${UNINSTALL_KEY}" "DisplayVersion" "${appVersion}"
  WriteRegStr HKCU "\${UNINSTALL_KEY}" "Publisher" "Level Select"
  WriteRegStr HKCU "\${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\\LevelSelect.ico"
  WriteRegStr HKCU "\${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "\${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\\Uninstall Level Select.exe"'
  WriteRegDWORD HKCU "\${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "\${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  ; A folder a program is working in can't be removed, the uninstaller's own included.
  SetOutPath "$TEMP"
  !insertmacro StopLevelSelect
  Delete "$SMPROGRAMS\\Level Select.lnk"
  Delete "$DESKTOP\\Level Select.lnk"
  DeleteRegKey HKCU "\${UNINSTALL_KEY}"
  MessageBox MB_YESNO|MB_ICONQUESTION "Also delete the games and settings Level Select imported (library, connected accounts, Steam key)?$\\r$\\n$\\r$\\nChoose No to keep them for a later install. Your play tracking lives in your browser either way." /SD IDNO IDYES everything
${files.map(file => `  Delete "$INSTDIR\\app\\${win(file)}"`).join('\n')}
  Delete "$INSTDIR\\app\\.payload-version"
  RMDir /r "$INSTDIR\\app\\.runtime"
${pythonFolders.map(folder => `  RMDir /r "$INSTDIR\\app\\${win(folder)}\\__pycache__"`).join('\n')}
${folders.map(folder => `  RMDir "$INSTDIR\\app\\${win(folder)}"`).join('\n')}
  RMDir "$INSTDIR\\app"
  RMDir /r "$INSTDIR\\runtime"
  Delete "$INSTDIR\\LevelSelect.ico"
  Delete "$INSTDIR\\Uninstall Level Select.exe"
  RMDir "$INSTDIR"
  Goto done
  everything:
  RMDir /r "$INSTDIR"
  done:
SectionEnd
`;
}
function makensis() {
  for (const candidate of [process.env.MAKENSIS, 'makensis', 'C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe'].filter(Boolean)) {
    try { execFileSync(candidate, ['-VERSION'], { stdio: 'ignore' }); return candidate; } catch {}
  }
  throw new Error('NSIS (makensis) is needed to build the Windows installer. On a Mac: brew install makensis. GitHub’s Windows runners have it.');
}
async function packageWindows() {
  const stage = path.join(BUILD, 'windows');
  await rm(stage, { recursive: true, force: true });
  const { files, stamp } = await stagePayload(path.join(stage, 'app'));
  await windowsRuntimes(path.join(stage, 'runtime'));
  await cp(path.join(root, 'launcher/windows/LevelSelect.ico'), path.join(stage, 'LevelSelect.ico'));
  await mkdir(OUT, { recursive: true });
  const output = path.join(OUT, `Level-Select-Setup-${version}.exe`);
  const script = path.join(stage, 'installer.nsi');
  await writeFile(script, nsisScript({ version, stage, output, files }));
  execFileSync(makensis(), ['-V2', script], { stdio: 'inherit' });
  console.log(`Built ${path.relative(root, output)} (${stamp}, ${Math.round((await stat(output)).size / 1e6)} MB)`);
  return output;
}

// ---------- macOS ----------
async function packageMac() {
  if (process.platform !== 'darwin') throw new Error('The Mac app is built on a Mac (it needs Xcode’s Swift compiler).');
  const { node } = RUNTIMES, arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const stage = path.join(BUILD, 'mac'), app = path.join(stage, 'Level Select.app'), contents = path.join(app, 'Contents');
  await rm(stage, { recursive: true, force: true });
  await mkdir(path.join(contents, 'MacOS'), { recursive: true }); await mkdir(path.join(contents, 'Resources/node'), { recursive: true });
  const swiftc = execFileSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' }).trim(), sdk = execFileSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim();
  const modules = path.join(stage, 'module-cache');
  execFileSync(swiftc, ['-swift-version', '5', '-O', '-target', `${arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`, '-sdk', sdk, '-module-cache-path', modules, '-framework', 'AppKit',
    path.join(root, 'launcher/RetroLibrary.swift'), '-o', path.join(contents, 'MacOS/RetroLibrary')], { stdio: 'inherit' });
  execFileSync(swiftc, ['-swift-version', '5', '-sdk', sdk, '-module-cache-path', modules, '-framework', 'AppKit', path.join(root, 'launcher/RetroIcon.swift'), '-o', path.join(stage, 'icon')], { stdio: 'inherit' });
  execFileSync(path.join(stage, 'icon'), [path.join(contents, 'Resources/RetroLibrary.icns')]);
  await rm(modules, { recursive: true, force: true }); await rm(path.join(stage, 'icon'), { force: true });
  // Its own identity and version, apart from the project's own launcher.
  const plist = (await readFile(path.join(root, 'launcher/Info.plist'), 'utf8'))
    .replace('local.retro-library.dashboard', 'app.level-select.mac')
    .replace(/(<key>CFBundleShortVersionString<\/key><string>)[^<]*/, `$1${version}`).replace(/(<key>CFBundleVersion<\/key><string>)[^<]*/, `$1${version}`);
  await writeFile(path.join(contents, 'Info.plist'), plist);
  const { stamp } = await stagePayload(path.join(contents, 'Resources/app'));
  // Node.js for this Mac's processor: the one running this build when it's the pinned
  // release (nvm and the nodejs.org installer use the official builds), else the official
  // build, checked against its published checksum.
  const bundledNode = path.join(contents, 'Resources/node/node');
  if (process.version === `v${node.version}` && process.arch === arch) await cp(process.execPath, bundledNode);
  else {
    const archive = `node-v${node.version}-darwin-${arch}.tar.gz`;
    await verified(`https://nodejs.org/dist/v${node.version}/${archive}`, archive, await nodeChecksum(node.version, archive));
    execFileSync('tar', ['-xzf', path.join(CACHE, archive), '-C', path.dirname(bundledNode), '--strip-components=2', `node-v${node.version}-darwin-${arch}/bin/node`]);
  }
  await chmod(bundledNode, 0o755);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  // A disk image with the app and a shortcut to Applications, to drag it across.
  const image = path.join(stage, 'image');
  await mkdir(image); await cp(app, path.join(image, 'Level Select.app'), { recursive: true, verbatimSymlinks: true }); await symlink('/Applications', path.join(image, 'Applications'));
  await mkdir(OUT, { recursive: true });
  const output = path.join(OUT, `Level-Select-${version}-mac-${arch}.dmg`);
  await rm(output, { force: true });
  // hdiutil now and then fails with "Resource busy" while Spotlight looks at the new files.
  for (let attempt = 1; ; attempt++) {
    try { execFileSync('hdiutil', ['create', '-volname', 'Level Select', '-srcfolder', image, '-ov', '-format', 'UDZO', output], { stdio: 'pipe' }); break; }
    catch (error) { if (attempt === 3) throw new Error(`hdiutil couldn't create the disk image: ${String(error.stderr ?? error.message).trim()}`); await new Promise(resolve => setTimeout(resolve, 3000)); }
  }
  console.log(`Built ${path.relative(root, output)} (${stamp}, ${Math.round((await stat(output)).size / 1e6)} MB)`);
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const targets = process.argv.slice(2);
  if (!targets.length || targets.some(target => !['--mac', '--windows'].includes(target))) throw new Error('Usage: npm run package -- --mac | --windows');
  if (targets.includes('--mac')) await packageMac();
  if (targets.includes('--windows')) await packageWindows();
}

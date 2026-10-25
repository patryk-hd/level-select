import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { payloadFiles, nsisScript, unzip } from '../scripts/package.mjs';

test('installers carry the app, never tests, docs, the showcase site or other tools’ sources', () => {
  const files = ['index.html', 'library/index.html', 'scripts/serve.mjs', 'launcher/windows/LevelSelect.ps1', 'launcher/windows/LevelSelect.ico', 'launcher/RetroLibrary.swift',
    'tests/lists.test.js', 'docs/STATUS.md', '.github/workflows/checks.yml', 'promo/source/promo.js', 'site/index.html', 'site/media/tour.mp4', 'CONTRIBUTING.md', 'retro-library.command'];
  assert.deepEqual(payloadFiles(files), ['index.html', 'library/index.html', 'scripts/serve.mjs', 'launcher/windows/LevelSelect.ps1', 'retro-library.command']);
});

test('the Windows uninstaller removes what it installed and keeps imported games unless asked', () => {
  const script = nsisScript({ version: '2.0.0', stage: 'C:\\build', output: 'C:\\out\\Setup.exe', files: ['index.html', 'library/tools/build_site.py'] });
  assert.match(script, /RequestExecutionLevel user/);
  assert.match(script, /InstallDir "\$LOCALAPPDATA\\Programs\\Level Select"/);
  assert.match(script, /Delete "\$INSTDIR\\app\\library\\tools\\build_site\.py"/);
  assert.match(script, /RMDir "\$INSTDIR\\app\\library\\tools"\n  RMDir "\$INSTDIR\\app\\library"/);
  // What running it made goes too, and then the empty folders, so nothing is left behind.
  assert.match(script, /RMDir \/r "\$INSTDIR\\app\\\.runtime"/);
  assert.match(script, /RMDir \/r "\$INSTDIR\\app\\library\\tools\\__pycache__"/);
  assert.match(script, /RMDir "\$INSTDIR\\app"\n/);
  assert.match(script, /RMDir "\$INSTDIR"\n  Goto done/);
  // Its icon by the clock works in the app folder: it's stopped, and the uninstaller leaves it.
  assert.match(script, /LEVEL_SELECT_TRAY", t "\$INSTDIR\\app\\launcher\\windows\\LevelSelect\.ps1"/);
  assert.match(script, /Section "Uninstall"\n(?:  ;.*\n)*  SetOutPath "\$TEMP"\n  !insertmacro StopLevelSelect/);
  // Removing everything happens only after "Yes"; silent uninstalls answer No.
  const [keep, everything] = script.split('everything:\n');
  assert.ok(!/RMDir \/r "\$INSTDIR"/.test(keep) && /RMDir \/r "\$INSTDIR"/.test(everything));
  assert.match(script, /\/SD IDNO IDYES everything/);
  assert.match(script, /VIProductVersion "2\.0\.0\.0"/);
});

test('the zip reader unpacks stored and compressed entries', () => {
  const entries = [['node-v22/node.exe', Buffer.from('binary'), 0], ['node-v22/LICENSE', Buffer.from('MIT '.repeat(50)), 8], ['node-v22/docs/', Buffer.alloc(0), 0]];
  const locals = [], central = [];
  let offset = 0;
  for (const [name, data, method] of entries) {
    const body = method ? deflateRawSync(data) : data, nameBuffer = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(method, 10); record.writeUInt32LE(body.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(nameBuffer.length, 28); record.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, body); central.push(record, nameBuffer); offset += 30 + nameBuffer.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const files = unzip(Buffer.concat([...locals, directory, end]), () => true);
  assert.deepEqual([...files.keys()], ['node-v22/node.exe', 'node-v22/LICENSE']);
  assert.equal(files.get('node-v22/LICENSE').toString(), 'MIT '.repeat(50));
  assert.equal(unzip(Buffer.concat([...locals, directory, end]), name => name.endsWith('.exe')).size, 1);
  assert.throws(() => unzip(Buffer.from('not a zip at all, just text that is long enough')), /Not a zip/);
});

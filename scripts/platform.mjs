// What differs between macOS, Windows and Linux: which Python to run, how to open a page in
// the default browser, how to ask Windows' registry where an app lives, and what command a
// process is running. The installers bundle their own Node and (on Windows) Python and say
// where with LEVEL_SELECT_PYTHON / RETRO_LIBRARY_NODE.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// The Python that rebuilds the library and wishlist. Apps started from the Dock or Start menu
// don't load your shell's PATH, so on a Mac the usual install places are looked at: Homebrew,
// python.org's installer and Apple's developer tools. /usr/bin/python3 is never run: on a Mac
// without the developer tools it's only a stand-in that pops up an offer to install them.
// null means a Mac without Python (Import games then shows how to install it).
const MAC_PYTHONS = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3'];
const developerDir = () => { try { return execFileSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; } };
export function findPython({ env = process.env, platform = process.platform, exists = existsSync, developer = developerDir } = {}) {
  if (env.LEVEL_SELECT_PYTHON) return env.LEVEL_SELECT_PYTHON;
  if (platform === 'win32') return 'python';
  if (platform !== 'darwin') return 'python3';
  const installed = MAC_PYTHONS.find(file => exists(file));
  if (installed) return installed;
  const tools = developer();
  return tools && exists(`${tools}/usr/bin/python3`) ? `${tools}/usr/bin/python3` : null;
}
export const pythonCommand = options => findPython(options) ?? 'python3';
export const MISSING_PYTHON = 'Python 3 isn’t installed on this Mac, and Level Select needs it to build your library. Open Import games: the “Python 3” card shows how to install it (about two minutes), then choose Update data again.';

// Python reads and writes files and prints as UTF-8 everywhere (Windows would use its
// regional code page otherwise, and fail on game names like Pokémon or ✓ in its output).
export const PYTHON_ENV = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' };

export function openUrl(url, platform = process.platform) {
  const [command, args] = platform === 'darwin' ? ['/usr/bin/open', [url]]
    : platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
  child.on('error', () => {});
  child.unref();
  return child;
}

// One value from the Windows registry (reg.exe ships with every Windows); null elsewhere,
// or when the key or value isn't there.
export function registryValue(key, name, { platform = process.platform, run = execFile } = {}) {
  if (platform !== 'win32') return Promise.resolve(null);
  return new Promise(resolve => run('reg', ['query', key, '/v', name], { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? null : parseRegistryValue(stdout, name))));
}
export function parseRegistryValue(output, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(output ?? '').match(new RegExp(`^\\s*${escaped}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+?)\\s*$`, 'mi'))?.[1] ?? null;
}

// The command line a process is running, or null (it has ended, or isn't ours to see).
export function commandLine(pid, { platform = process.platform, run = execFile } = {}) {
  if (!pid) return Promise.resolve(null);
  const [command, args] = platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`]]
    : ['ps', ['-o', 'command=', '-p', String(pid)]];
  return new Promise(resolve => run(command, args, { timeout: 8000, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout).trim() || null)));
}
// Is that command one of the update's own steps (a script of this project)? Windows writes
// paths with backslashes and quotes, so both are evened out first.
export const isProjectCommand = line => Boolean(line) && /(?:^|[\s/])(?:scripts\/[\w-]+\.mjs|library\/tools\/\w+\.py)(?:\s|$)/.test(String(line).replace(/\\/g, '/').replace(/"/g, ' '));

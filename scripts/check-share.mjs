import { execFileSync } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import { userInfo, homedir } from 'node:os';

// Check tracked files too: .gitignore does not protect files already in Git.
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
const privatePath = /(^|\/)(?:library\/(?:data|assets|playnite_library_backup)\/|(?:dist|dist-local|backups|\.runtime)\/|\.env(?:\.|$)|[^/]+\.(?:pem|key|p12|sqlite3?|db)$|(?:playnite_library.*\.csv|steam-wishlist.*\.json|(?:playnite-library-backup|library-recovery|wishlist-removals|wishlist-acquisitions|retro-library-backup|retro-library-recovery|retro-tracking-).*\.json)$)/i;
const secrets = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/,
  /\b(?:AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})/,
];
// Who you are on this computer, read here rather than written down: your Git names and emails
// (this repository's and your global ones), your user name and home folder. No shared file should contain them.
const gitConfig = (...args) => { try { return execFileSync('git', ['config', ...args], { encoding: 'utf8' }).trim(); } catch { return ''; } };
// The repository owner's name is public (it's in the repository's address), so it may appear.
const owner = gitConfig('remote.origin.url').match(/[:/]([^/:]+)\/[^/]+?(?:\.git)?$/)?.[1]?.toLowerCase();
const identity = [gitConfig('user.name'), gitConfig('--global', 'user.name'), gitConfig('user.email'), gitConfig('--global', 'user.email'), process.env.CI ? '' : userInfo().username, homedir()]
  .filter(value => value && value.length >= 4 && !['root', 'user', 'admin', owner].includes(value.toLowerCase()));
const errors = [];
const isPrivate = file => privatePath.test(file) && !file.endsWith('/.env.example') && file !== '.env.example';
for (const file of files) {
  if (isPrivate(file)) errors.push(`${file}: private/generated file would be committed`);
  let info;
  try { info = await lstat(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (info.isSymbolicLink()) { errors.push(`${file}: review symbolic link before sharing`); continue; }
  if (!info.isFile()) continue;
  if (info.size > 10 * 1024 * 1024) errors.push(`${file}: larger than the project's 10 MiB source-file budget`);
  const body = await readFile(file, 'utf8');
  if (secrets.some(pattern => pattern.test(body))) errors.push(`${file}: possible credential (value withheld)`);
  if (identity.some(value => body.toLowerCase().includes(value.toLowerCase()))) errors.push(`${file}: contains your name, email, user name or home folder`);
}
// Include ordinary publishable refs, not tool-owned checkpoint refs under refs/codex/.
const history = execFileSync('git', ['rev-list', '--objects', '--branches', '--tags', '--remotes'], { encoding:'utf8', maxBuffer:16 * 1024 * 1024 }).split('\n');
for (const entry of history) {
  const separator = entry.indexOf(' ');
  if (separator === -1) continue;
  const file = entry.slice(separator + 1);
  if (isPrivate(file)) errors.push(`${file}: private/generated file exists in branch or tag history`);
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Checked ${files.length} candidate files: no known personal-data paths, common credential tokens or oversized files. Review your staged diff too; this is not an exhaustive secret scanner.`);

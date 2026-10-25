import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';
import { openUrl } from './platform.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const projectId = createHash('sha256').update(root).digest('hex');
const port = Number(process.env.RETRO_LIBRARY_PORT || 8765);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid library port');
const base = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function occupied() {
  return new Promise(resolve => {
    const socket = net.connect({ host:'127.0.0.1', port });
    const finish = result => { socket.destroy(); resolve(result); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(true));
  });
}

async function status() {
  try {
    const response = await fetch(`${base}/__retro_library_health`, { signal:AbortSignal.timeout(1000) });
    if (response.ok) {
      const info = await response.json();
      if (info.app === 'retro-library' && info.projectId === projectId && Number.isInteger(info.pid) && info.pid > 1) return { state:'RUNNING', pid:info.pid };
    }
  } catch { /* A different service on the port must never be stopped. */ }
  return { state:await occupied() ? 'BLOCKED' : 'STOPPED' };
}

async function start() {
  const current = await status();
  if (current.state !== 'STOPPED') return current;
  await stat(path.join(root, 'library/index.html'));
  const runtime = path.join(root, '.runtime');
  await mkdir(runtime, { recursive:true });
  const log = await open(path.join(runtime, 'library-server.log'), 'a', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs')], {
      cwd:root, detached:true, windowsHide:true, stdio:['ignore',log.fd,log.fd], env:process.env,
    });
    // Catch spawn failures instead of letting an unhandled event exit the helper.
    child.on('error', () => {});
    child.unref();
  } finally { await log.close(); }
  // A port that's open but not yet answering as the library is usually a server still starting
  // (this one, or another launcher's started at the same moment), so it gets a moment longer.
  let blocked = 0;
  for (let attempt=0; attempt<40; attempt++) {
    await delay(150);
    const next = await status();
    if (next.state === 'RUNNING') return next;
    if (next.state === 'BLOCKED' && child.exitCode !== null && ++blocked >= 10) return next;
    if (next.state === 'STOPPED' && child.exitCode !== null) break;
  }
  const last = await status();
  if (last.state === 'RUNNING' || last.state === 'BLOCKED' && child.exitCode !== null) return last;
  // Only terminate the process created by this invocation.
  if (child.pid && child.exitCode === null) child.kill('SIGTERM');
  throw new Error('The library could not start. See .runtime/library-server.log in the project folder.');
}

async function stop() {
  const current = await status();
  if (current.state !== 'RUNNING') return current;
  try { process.kill(current.pid, 'SIGTERM'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  for (let attempt=0; attempt<40; attempt++) {
    await delay(100);
    const next = await status();
    if (next.state !== 'RUNNING') return next;
    if (next.pid !== current.pid) throw new Error('The library was started by another launcher while stopping.');
  }
  throw new Error('The library has not stopped yet. No other application was stopped.');
}

const action = process.argv[2] || 'status';
try {
  let result;
  if (action === 'status') result = await status();
  else if (action === 'stop') result = await stop();
  else if (action === 'start' || action === 'open') result = await start();
  else if (action === 'restart') { result = await stop(); if (result.state === 'STOPPED') result = await start(); }
  else throw new Error('Use start, stop, restart, status or open.');
  if (result.state === 'RUNNING') {
    console.log('RUNNING Your library is ready. Closing the dashboard stops the local site.');
    // "open" shows a section in the default browser: open [route], Library by default.
    if (action === 'open') openUrl(`${base}/${/^[\w./?=&-]+$/.test(process.argv[3] ?? '') ? process.argv[3] : 'library/index.html'}`);
  } else if (result.state === 'BLOCKED') {
    console.log(`BLOCKED Port ${port} is used by another application. It was left running.`);
    process.exitCode=4;
  } else { console.log('STOPPED Open a section to start your library.'); process.exitCode=action==='status' ? 3 : 0; }
} catch(error) { console.error(`ERROR ${error.message}`); process.exitCode=2; }

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
const root = fileURLToPath(new URL('../', import.meta.url));
const env = {...process.env, ...dotenv.parse(fs.readFileSync(path.join(root,'.env'))), NODE_ENV:'development'};
// OpenCV on Windows must inherit transport options before Python/OpenCV starts.
env.OPENCV_FFMPEG_CAPTURE_OPTIONS ??= 'rtsp_transport;tcp|analyzeduration;1000000|probesize;32768';
if (env.INSTALLATION_ID !== 'malang') throw new Error('Wrong installation');
// Check every port first; never reuse a Trangkil or other application's process.
for (const port of [4111,5176,8011]) await new Promise((resolve,reject) => {
  const probe = net.createServer();
  probe.once('error', () => reject(new Error(`Port ${port} is occupied. No existing process stopped.`)));
  probe.listen(port,'127.0.0.1',() => probe.close(resolve));
});
const python = fs.existsSync(path.join(root,'.venv/Scripts/python.exe')) ? path.join(root,'.venv/Scripts/python.exe') : 'python';
const children = [];
let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  await Promise.all(children.map(child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform !== 'win32') { child.kill('SIGTERM'); return; }
    // Restrict cleanup to a process spawned by this launcher and its children.
    return new Promise(resolve => {
      const cleanup = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      cleanup.once('exit', resolve);
      cleanup.once('error', resolve);
    });
  }));
}
function run(name, executable, args, cwd) {
  console.log(`[dev:${name}] Starting`);
  const child = spawn(executable, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.once('error', error => {
    console.error(`[dev:${name}] Could not start: ${error.code ?? error.name}`);
    void stop(1);
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[dev:${name}] Unexpected exit: code=${code}, signal=${signal ?? 'none'}`);
    void stop(code || 1);
  });
  return child;
}
async function waitReady(name, child, url, timeoutMs = 120000) {
  console.log(`[dev:${name}] Waiting for ${url}`);
  const deadline = Date.now() + timeoutMs;
  while (!stopping && Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${name} exited before ready`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      const health = await response.json();
      if (response.ok && health.installation === 'malang' && health.status === 'ok') {
        console.log(`[dev:${name}] Ready`);
        return;
      }
    } catch { /* The process can still be importing dependencies. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(stopping ? 'Startup interrupted' : `${name} health timed out; inspect its output above`);
}
process.once('SIGINT', () => { void stop(130); });
process.once('SIGTERM', () => { void stop(143); });
try {
  const api = run('api', process.execPath, ['--import','tsx','src/server.ts'], path.join(root,'apps/api'));
  await waitReady('api', api, 'http://127.0.0.1:4111/health');
  const ai = run('ai', python, ['-m','uvicorn','main:app','--app-dir',path.join(root,'apps/ai-service'),'--host','127.0.0.1','--port','8011'], root);
  await waitReady('ai', ai, 'http://127.0.0.1:8011/health');
  if (!stopping) run('web', process.execPath, [path.join(root,'node_modules/vite/bin/vite.js'),'--port','5176','--strictPort'], path.join(root,'apps/web'));
} catch (error) {
  if (!stopping) console.error(`[dev] ${error.message}`);
  await stop(1);
}

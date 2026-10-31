import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
const root = fileURLToPath(new URL('../', import.meta.url));
const env = {...process.env, ...dotenv.parse(fs.readFileSync(path.join(root,'.env'))), NODE_ENV:'development'};
if (env.INSTALLATION_ID !== 'malang') throw new Error('Wrong installation');
// Check every port first; never reuse a Trangkil or other application's process.
for (const port of [4111,5176,8011]) await new Promise((resolve,reject) => {
  const probe = net.createServer();
  probe.once('error', () => reject(new Error(`Port ${port} is occupied. No existing process stopped.`)));
  probe.listen(port,'127.0.0.1',() => probe.close(resolve));
});
const python = fs.existsSync(path.join(root,'.venv/Scripts/python.exe')) ? path.join(root,'.venv/Scripts/python.exe') : 'python';
const children = [];
function run(executable,args,cwd) {
  const child = spawn(executable,args,{cwd,env,stdio:'inherit',windowsHide:true});
  children.push(child);
  child.once('error', error => { console.error(error.message); stop(1); });
  child.once('exit', code => stop(code ?? 1));
}
let stopping = false;
function stop(code) { if(stopping)return; stopping=true; for(const child of children) child.kill(); process.exitCode=code; }
process.once('SIGINT',()=>stop(130)); process.once('SIGTERM',()=>stop(143));
run(process.execPath,['--import','tsx','src/server.ts'],path.join(root,'apps/api'));
run(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--port','5176','--strictPort'],path.join(root,'apps/web'));
run(python,['-m','uvicorn','main:app','--app-dir',path.join(root,'apps/ai-service'),'--host','127.0.0.1','--port','8011'],root);

// Exercises the actual Windows launcher. Cameras are temporarily disabled;
// no external camera connection, Auto cycle, tunnel or DNS change is performed.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
const root=fileURLToPath(new URL('../',import.meta.url));
const env=dotenv.parse(fs.readFileSync(path.join(root,'.env')));
assert.equal(new URL(env.DATABASE_URL).pathname,'/sugarcane_malang');
assert.ok(!fs.existsSync(path.join(root,'.runtime/malang/processes.json')),'Stop the existing Malang runtime first');
const db=new pg.Client({connectionString:env.DATABASE_URL});await db.connect();
const cameras=(await db.query('SELECT id,enabled FROM cameras')).rows;
const fixtures=[];let wrongRequests=0;
function run(script,args=[]) {
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts',script),...args],{cwd:root,stdio:'inherit',windowsHide:true});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${script} exited ${code}`)));
  });
}
try {
  for(const port of [4110,8010,8080,5175]) {
    const server=http.createServer((_req,res)=>{wrongRequests++;res.end('Trangkil test fixture');});
    const bound=await new Promise(resolve=>{server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>resolve(true));});
    if(bound)fixtures.push(server);
  }
  await db.query('UPDATE cameras SET enabled=false');
  await run('start-malang.ps1',['-SkipBuild']);
  for(const port of [4111,8011,8081]) {
    const result=await(await fetch(`http://127.0.0.1:${port}/health`)).json();assert.equal(result.installation,'malang');
  }
  assert.match(await(await fetch('http://127.0.0.1:8081')).text(),/TebuAI Malang/);
  const login=await fetch('http://127.0.0.1:8081/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:env.USER_KEBONAGUNG_OPERATOR,password:env.PASSWORD_KEBONAGUNG_OPERATOR})});
  assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/^sugarcane_malang_session=/);
  const session=await login.json();
  await new Promise((resolve,reject)=>{
    const socket=new WebSocket(`ws://127.0.0.1:8081/ws?token=${encodeURIComponent(session.token)}`);
    const timer=setTimeout(()=>{socket.close();reject(new Error('Gateway WebSocket timeout'));},5000);
    socket.onopen=()=>{clearTimeout(timer);socket.close();resolve();};
    socket.onerror=()=>{clearTimeout(timer);reject(new Error('Gateway WebSocket failed'));};
  });
  assert.equal((await fetch('http://127.0.0.1:8011/roi/1')).status,401);
  assert.equal(wrongRequests,0,'Malang contacted a reserved Trangkil service');
  await run('stop-malang.ps1');
  await new Promise(resolve=>setTimeout(resolve,1500));
  for(const port of [4111,8011,8081]) {
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1000)}),'Malang left an orphan service running');
  }
  assert.ok(fixtures.every(server=>server.listening));
  console.log(`PASS: actual start/health/UI/AI auth/stop; ${fixtures.length} Trangkil-port fixtures remain untouched`);
} finally {
  try {
    if(fs.existsSync(path.join(root,'.runtime/malang/processes.json')))await run('stop-malang.ps1');
  } finally {
    for(const camera of cameras)await db.query('UPDATE cameras SET enabled=$2 WHERE id=$1',[camera.id,camera.enabled]);
    await db.end();
    for(const server of fixtures)await new Promise(resolve=>server.close(resolve));
    const restored=spawnSync(path.join(root,'.venv/Scripts/python.exe'),['-c',"import sys; sys.path.insert(0,'apps/ai-service'); from db.repository import AIRepository; AIRepository.sync_application_cameras()"],{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true});
    assert.equal(restored.status,0,'Camera configuration restore failed');
  }
}

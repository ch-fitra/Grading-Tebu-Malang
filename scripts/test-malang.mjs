import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import pg from 'pg';
const root=fileURLToPath(new URL('../',import.meta.url));
const env=dotenv.parse(fs.readFileSync(path.join(root,'.env')));
assert.equal(env.INSTALLATION_ID,'malang');
for(const [key,name] of [['DATABASE_URL','sugarcane_malang'],['AI_DATABASE_URL','sugarcane_ai_malang']]) assert.equal(new URL(env[key]).pathname,'/'+name);
// A malicious/inherited environment must fail before opening a database connection.
const refused=spawn(process.execPath,[path.join(root,'apps/api/dist/server.js')],{cwd:root,env:{...process.env,...env,DATABASE_URL:env.DATABASE_URL.replace('/sugarcane_malang','/sugarcane_trangkil')},stdio:'ignore',windowsHide:true});
const [refusedCode]=await once(refused,'exit'); assert.notEqual(refusedCode,0);
console.log('PASS: shared Trangkil database rejected before startup');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(4111,'127.0.0.1',()=>probe.close(resolve));});
const api=spawn(process.execPath,[path.join(root,'apps/api/dist/server.js')],{cwd:root,env:{...process.env,...env},stdio:'ignore',windowsHide:true});
let token;
try {
  let ready=false;
  for(let i=0;i<80;i++) {
    if(api.exitCode!==null) throw new Error('Malang API exited before ready');
    try {const h=await(await fetch('http://127.0.0.1:4111/health')).json(); assert.equal(h.installation,'malang');ready=true;break;}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  assert.ok(ready,'API startup timed out');
  const response=await fetch('http://127.0.0.1:4111/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:env.USER_KEBONAGUNG_OPERATOR,password:env.PASSWORD_KEBONAGUNG_OPERATOR})});
  assert.equal(response.status,200); assert.match(response.headers.get('set-cookie'),/^sugarcane_malang_session=/);
  token=(await response.json()).token;
  const cameras=await(await fetch('http://127.0.0.1:4111/api/cameras',{headers:{Authorization:`Bearer ${token}`}})).json();
  assert.ok(Array.isArray(cameras));assert.ok(cameras.some(c=>c.station===2&&c.name.includes('Kebon Agung')));
  const forgedCookie=await fetch('http://127.0.0.1:4111/api/cameras/999999/snapshot',{headers:{Cookie:`sugarcane_session=${token}`}});
  assert.equal(forgedCookie.status,401);
  const cors=await fetch('http://127.0.0.1:4111/health',{headers:{Origin:'http://127.0.0.1:5175'}});
  assert.equal(cors.headers.get('access-control-allow-origin'),null);
  const publicOrigin='https://pgmalang.aisugarcanembs.com';
  const publicCors=await fetch('http://127.0.0.1:4111/health',{headers:{Origin:publicOrigin}});
  assert.equal(publicCors.headers.get('access-control-allow-origin'),publicOrigin);
  const publicLogin=await fetch('http://127.0.0.1:4111/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:publicOrigin,'X-Forwarded-Proto':'https'},body:JSON.stringify({username:env.USER_KEBONAGUNG_OPERATOR,password:env.PASSWORD_KEBONAGUNG_OPERATOR})});
  assert.equal(publicLogin.status,200);assert.match(publicLogin.headers.get('set-cookie'),/; Secure/);
  console.log('PASS: Malang public origin allowed and HTTPS session cookie is Secure');
  const require=createRequire(import.meta.url);
  const {startRendererServer}=require('../apps/desktop/dist/renderer-server.js');
  const renderer=await startRendererServer(path.join(root,'apps/web/dist'),'http://127.0.0.1:4111');
  try {
    const html=await(await fetch(renderer.url)).text();assert.match(html,/TebuAI Malang/);
    const health=await(await fetch(renderer.url+'/health')).json();assert.equal(health.installation,'malang');
    const proxied=await fetch(renderer.url+'/api/cameras',{headers:{Authorization:`Bearer ${token}`}});assert.equal(proxied.status,200);
    console.log('PASS: packaged desktop serves Malang UI and proxies to Malang API');
  } finally {await renderer.close();}
  const logout=await fetch('http://127.0.0.1:4111/api/auth/logout',{method:'POST',headers:{Authorization:`Bearer ${token}`}});
  assert.match(logout.headers.get('set-cookie'),/^sugarcane_malang_session=;.*Max-Age=0/);
  console.log('PASS: login/logout cookie isolation, old cookie rejected, Trangkil origin excluded, Meja 2 camera');
  const manifest=path.join(root,'.runtime/malang/processes.json');
  assert.ok(!fs.existsSync(manifest),'A production runtime manifest already exists; stop it before testing');
  fs.mkdirSync(path.dirname(manifest),{recursive:true});
  fs.writeFileSync(manifest,JSON.stringify([{Id:api.pid,Kind:'api',Executable:process.execPath,Created:'2099-01-01T00:00:00Z',Command:'wrong-process-identity'}]));
  try {
    const stop=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/stop-malang.ps1')],{cwd:root,stdio:'ignore',windowsHide:true});
    const [code]=await once(stop,'exit');assert.notEqual(code,0);assert.equal(api.exitCode,null);
    console.log('PASS: stop refuses a mismatched process identity and leaves API running');
  } finally {fs.unlinkSync(manifest);}
} finally {if(api.exitCode===null){api.kill();await once(api,'exit');}}
const db=new pg.Client({connectionString:env.DATABASE_URL});await db.connect();
try {
  await db.query('BEGIN');
  await db.query("INSERT INTO cameras(name,rtsp_url,location,status,station,enabled) VALUES('isolation-test','rtsp://example.invalid/test','test','offline',99,false)");
  await assert.rejects(db.query("INSERT INTO cameras(name,rtsp_url,station) VALUES('duplicate','rtsp://example.invalid/test',99)"),e=>e.code==='23505');
  await db.query('ROLLBACK');
  console.log('PASS: unique physical station enforced; test camera rolled back');
} finally {await db.end();}

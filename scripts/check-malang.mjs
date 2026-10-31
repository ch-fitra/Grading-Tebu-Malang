import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
const root=fileURLToPath(new URL('../',import.meta.url));
const env=dotenv.parse(fs.readFileSync(path.join(root,'.env')));
for(const [key,db] of [['DATABASE_URL','sugarcane_malang'],['AI_DATABASE_URL','sugarcane_ai_malang']]) {
  if(new URL(env[key]).pathname!=='/'+db) throw new Error(`${key} points to an incorrect database`);
  const client=new pg.Client({connectionString:env[key],connectionTimeoutMillis:5000});
  await client.connect();
  try { const {rows}=await client.query('SELECT current_database() AS db,current_user AS role'); console.log(`${key}: ${rows[0].db} (${rows[0].role})`); }
  finally {await client.end();}
}
for(const port of [4111,8011,8081]) {
  try {
    const result=await (await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(3000)})).json();
    if(result.installation!=='malang'||result.status!=='ok') throw new Error('unexpected installation');
    console.log(`Port ${port}: Malang healthy`);
  } catch { console.log(`Port ${port}: not running or not Malang`); process.exitCode=1; }
}

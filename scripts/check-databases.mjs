import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
const env=dotenv.parse(fs.readFileSync(fileURLToPath(new URL('../.env',import.meta.url))));
if(env.INSTALLATION_ID!=='malang')throw new Error('INSTALLATION_ID harus malang');
for(const [key,name] of [['DATABASE_URL','sugarcane_malang'],['AI_DATABASE_URL','sugarcane_ai_malang']]) {
  if(!env[key]||new URL(env[key]).pathname!=='/'+name)throw new Error(`${key} harus memakai database Malang`);
  const client=new pg.Client({connectionString:env[key],connectionTimeoutMillis:5000});
  await client.connect();
  try {
    const actual=(await client.query('SELECT current_database() AS name')).rows[0].name;
    if(actual!==name)throw new Error('Identitas database tidak sesuai');
    console.log(`Database siap: ${name}`);
  } finally {await client.end();}
}

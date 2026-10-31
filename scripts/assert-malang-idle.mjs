import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
const root=fileURLToPath(new URL('../',import.meta.url));
const env=dotenv.parse(fs.readFileSync(path.join(root,'.env')));
for(const [key,table,condition,name] of [
  ['DATABASE_URL','truck_inspections',"status='active'",'sugarcane_malang'],
  ['AI_DATABASE_URL','ai_results',"status='running'",'sugarcane_ai_malang']
]) {
  if(new URL(env[key]).pathname!=='/'+name)throw new Error('Database Malang tidak sesuai');
  const client=new pg.Client({connectionString:env[key],connectionTimeoutMillis:5000});await client.connect();
  try {
    const exists=await client.query('SELECT to_regclass($1) AS table_name',[table]);
    if(exists.rows[0].table_name) {
      const result=await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${condition}`);
      if(result.rows[0].count)throw new Error('Masih ada siklus Malang aktif. Matikan Auto dan selesaikan inspeksi sebelum stop/restart.');
    }
  } finally {await client.end();}
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import pg from 'pg';
test('AI frames mirror once, retain cycle links, and deleted captures do not return', async () => {
 dotenv.config();
 const original=process.env.DATABASE_URL!;
 const schema='sync_test_'+randomUUID().replaceAll('-','');
 const admin=new pg.Pool({connectionString:original});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const url=new URL(original); url.searchParams.set('options', '-c search_path='+schema);
 process.env.DATABASE_URL=url.href; process.env.AI_DATABASE_URL=url.href;
 const db=new pg.Pool({connectionString:url.href});
 let backend: any;
 try {
  await db.query(await readFile('database/postgres/001_initial.sql','utf8'));
  await db.query(`CREATE TABLE ai_inference_results(id bigserial PRIMARY KEY,camera_id bigint,cycle_code text,created_at timestamptz DEFAULT now(),detected_class text,classes_score jsonb,confidence float,snapshot_path text)`);
  backend=await import('../apps/api/src/db.ts');
  const {store}=await import('../apps/api/src/store.ts'); await store.initialize();
  const cycle=randomUUID();
  await db.query("INSERT INTO truck_inspections(id,truck_code,line,status) VALUES($1,'test',1,'completed')",[cycle]);
  for(let i=0;i<3;i++) await db.query("INSERT INTO ai_inference_results(camera_id,cycle_code,detected_class,classes_score,confidence,snapshot_path) VALUES(1,$1,'T',$2,1,$3)",[cycle,JSON.stringify({A:0,B:0,T:100}),`storage/snapshots/${cycle}/frame${i}.jpg`]);
  assert.equal(await store.syncModelCaptures(),3);
  assert.equal(await store.syncModelCaptures(),0);
  assert.equal((await store.listInference()).length,3);
  assert.equal(Number((await db.query('SELECT count(*) FROM truck_inspection_captures')).rows[0].count),3);
  const frame=(await store.listInference())[0];
  assert.equal(frame.grade,'T');
  const {id,...capture}=frame; await store.addInference(capture);
  assert.equal((await store.listInference()).length,3);
  await store.deleteInference(id); await store.syncModelCaptures();
  assert.equal((await store.listInference()).length,2);
 } finally { await backend?.pool.end(); await db.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});

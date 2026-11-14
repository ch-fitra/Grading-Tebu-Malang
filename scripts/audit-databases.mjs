import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

// Read-only by construction. No migrations, updates, VACUUM, or deletion.
const root=fileURLToPath(new URL('../',import.meta.url));
const env=dotenv.parse(fs.readFileSync(path.join(root,'.env')));
const installation=env.INSTALLATION_ID;
if(!['malang','trangkil'].includes(installation))throw new Error('Identitas instalasi tidak valid');
const quote=name=>'"'+name.replaceAll('"','""')+'"';
for(const [key,expected] of [['DATABASE_URL',`sugarcane_${installation}`],['AI_DATABASE_URL',`sugarcane_ai_${installation}`]]) {
  if(!env[key] || new URL(env[key]).pathname!=='/'+expected)throw new Error(`${key}: identitas database tidak sesuai`);
  const client=new pg.Client({connectionString:env[key],connectionTimeoutMillis:5000,query_timeout:20000,statement_timeout:15000,application_name:'xoora-readonly-integrity'});
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL lock_timeout='2s'");
    const identity=(await client.query('SELECT current_database() AS name, pg_database_size(current_database()) AS bytes')).rows[0];
    if(identity.name!==expected)throw new Error('Database aktual berbeda');
    console.log(JSON.stringify({installation,database:identity.name,bytes:identity.bytes,mode:'read-only'}));
    const tables=(await client.query("SELECT c.relname AS name,c.reltuples::bigint AS estimated_rows,pg_total_relation_size(c.oid) AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY pg_total_relation_size(c.oid) DESC")).rows;
    console.table(tables);
    for(const table of ['inference_results','truck_inspections','ai_results','ai_inference_results']) {
      if(!tables.some(item=>item.name===table))continue;
      const columns=new Set((await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",[table])).rows.map(row=>row.column_name));
      const checks=[];
      if(columns.has('confidence'))checks.push(['confidence_out_of_range',"confidence < 0 OR confidence > 1 OR confidence::text IN ('NaN','Infinity','-Infinity')"]);
      if(columns.has('start_time')&&columns.has('end_time'))checks.push(['end_before_start','end_time < start_time']);
      if(columns.has('started_at')&&columns.has('completed_at'))checks.push(['end_before_start','completed_at < started_at']);
      if(columns.has('status')){
        console.log(JSON.stringify({table,statuses:(await client.query(`SELECT status,count(*)::text AS count FROM public.${quote(table)} GROUP BY status`)).rows}));
        // These are review candidates, not proof of invalid data or permission to delete.
        if(columns.has('end_time'))checks.push(['completed_without_end_review',"status='completed' AND end_time IS NULL"]);
        if(columns.has('completed_at'))checks.push(['completed_without_end_review',"status='completed' AND completed_at IS NULL"]);
      }
      for(const [check,condition] of checks){
        const result=(await client.query(`SELECT count(*)::text AS count FROM public.${quote(table)} WHERE ${condition}`)).rows[0];
        const sample=columns.has('id')?(await client.query(`SELECT id FROM public.${quote(table)} WHERE ${condition} ORDER BY id LIMIT 20`)).rows.map(row=>row.id):[];
        console.log(JSON.stringify({table,check,count:result.count,sample_ids:sample,action:'review-only'}));
      }
    }
    const has = name => tables.some(item => item.name === name);
    const relations = [];
    if (has('inference_results') && has('cameras')) relations.push(['inference_camera_orphans', 'SELECT count(*)::text AS count FROM public.inference_results i LEFT JOIN public.cameras c ON c.id=i.camera_id WHERE i.camera_id IS NOT NULL AND c.id IS NULL']);
    if (has('truck_inspection_captures') && has('truck_inspections') && has('inference_results')) relations.push(['capture_link_orphans', 'SELECT count(*)::text AS count FROM public.truck_inspection_captures l LEFT JOIN public.truck_inspections t ON t.id=l.inspection_id LEFT JOIN public.inference_results i ON i.id=l.inference_id WHERE t.id IS NULL OR i.id IS NULL']);
    if (has('ai_inference_results') && has('ai_cameras')) relations.push(['ai_frame_camera_orphans', 'SELECT count(*)::text AS count FROM public.ai_inference_results i LEFT JOIN public.ai_cameras c ON c.id=i.camera_id WHERE i.camera_id IS NOT NULL AND c.id IS NULL']);
    if (has('ai_inference_results') && has('ai_results')) {
      const cols = new Set((await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_inference_results'")).rows.map(row=>row.column_name));
      if (cols.has('cycle_id')) relations.push(['ai_cycle_id_orphans', 'SELECT count(*)::text AS count FROM public.ai_inference_results i LEFT JOIN public.ai_results r ON r.id=i.cycle_id WHERE i.cycle_id IS NOT NULL AND r.id IS NULL']);
      if (cols.has('cycle_code')) relations.push(['ai_cycle_code_unmatched_review', "SELECT count(*)::text AS count FROM public.ai_inference_results i LEFT JOIN public.ai_results r ON r.cycle_code=i.cycle_code WHERE i.cycle_code IS NOT NULL AND i.cycle_code<>'' AND r.id IS NULL"]);
    }
    for (const [check,sql] of relations) console.log(JSON.stringify({check,...(await client.query(sql)).rows[0],action:'review-only'}));
    await client.query('ROLLBACK');
  } catch(error) {
    // Avoid printing DSNs, credentials, operational notes or full query payloads.
    console.error(JSON.stringify({database:expected,error:error.code??error.name,status:'audit-incomplete'}));
    process.exitCode=1;
  } finally {await client.end().catch(()=>{});}
}
console.log('Tidak ada data diubah. Data uji memerlukan penanda/ID yang terverifikasi; hasil grading kosong atau confidence rendah bukan alasan otomatis menghapus riwayat.');

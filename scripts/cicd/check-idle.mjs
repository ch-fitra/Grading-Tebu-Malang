import path from 'node:path';
import { createRequire } from 'node:module';
const root = process.argv[2];
if (!root) throw new Error('Production path required');
const require = createRequire(path.join(root, 'package.json'));
require('dotenv').config({ path: path.join(root, '.env'), quiet: true, override: true });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 });
try {
  const result = await pool.query("SELECT count(*)::int AS count FROM truck_inspections WHERE status='active'");
  if (result.rows[0].count) throw new Error('Active inspections exist. Finish inspections before deployment.');
  console.log('PASS no active inspections');
} catch {
  console.error('Deployment blocked: active inspections or database readiness check failed.');
  process.exitCode = 1;
} finally { await pool.end(); }

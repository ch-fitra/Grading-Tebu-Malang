import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = path.join(root, '.env');
const env = dotenv.parse(fs.readFileSync(envPath));
const option = process.argv.indexOf('--admin-env');
const admin = option >= 0 ? dotenv.parse(fs.readFileSync(process.argv[option + 1])).DATABASE_URL : process.env.ADMIN_DATABASE_URL;
if (!admin) throw new Error('Set ADMIN_DATABASE_URL or provide --admin-env <local admin env file>. No databases changed.');
if (env.INSTALLATION_ID !== 'malang') throw new Error('Wrong installation');
const names = ['sugarcane_malang', 'sugarcane_ai_malang'];
const role = 'sugarcane_malang';
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const target = new URL(admin); target.pathname = '/postgres';
const client = new pg.Client({ connectionString: target.href, connectionTimeoutMillis: 5000 });
await client.connect();
try {
  // Preflight both databases before making any change. Never adopt an unrelated database.
  for (const name of names) {
    const result = await client.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1', [name]);
    if (result.rows[0] && result.rows[0].owner !== role) throw new Error(`Database ${name} already exists with a different owner; no takeover allowed.`);
  }
  const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount;
  const password = exists ? decodeURIComponent(new URL(env.DATABASE_URL).password) : crypto.randomBytes(32).toString('hex');
  if (exists && decodeURIComponent(new URL(env.DATABASE_URL).username) !== role) throw new Error('Role exists but local credentials do not match. Supply its credentials first.');
  if (!exists) await client.query(`CREATE ROLE ${quote(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  for (const name of names) {
    if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount) {
      await client.query(`CREATE DATABASE ${quote(name)} OWNER ${quote(role)}`);
    }
    await client.query(`REVOKE ALL ON DATABASE ${quote(name)} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${quote(name)} TO ${quote(role)}`);
  }
  for (const [index, key] of ['DATABASE_URL', 'AI_DATABASE_URL'].entries()) {
    const url = new URL(env[key]); url.username = role; url.password = password; url.pathname = '/' + names[index];
    env[key] = url.href;
  }
  fs.writeFileSync(envPath, '# Malang only. Local secrets; do not commit.\n' + Object.entries(env).map(([k,v]) => `${k}=${v}`).join('\n') + '\n');
  console.log('Malang databases and dedicated login ready. Credentials saved only in local .env.');
} finally { await client.end(); }

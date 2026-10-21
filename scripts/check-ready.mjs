import { readFile, access } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { createHmac } from "node:crypto";

const root = process.cwd();
const checks = [];
const record = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`); };
let env;
try { env = { ...dotenv.parse(await readFile(path.join(root, ".env"))), ...process.env }; }
catch { console.error("FAIL .env: salin .env.example dan isi konfigurasi lokal terlebih dahulu"); process.exit(1); }
record("JWT secret", (env.JWT_SECRET?.length ?? 0) >= 32 && !/ganti|change|replace|example|development/i.test(env.JWT_SECRET ?? ""), "nilai secret tidak ditampilkan");
if (process.argv.includes("--public")) record("Production mode", env.NODE_ENV === "production", "NODE_ENV harus production untuk deployment publik");
for (const key of ["DATABASE_URL", "AI_DATABASE_URL"]) {
  const client = new pg.Client({ connectionString: env[key], connectionTimeoutMillis: 5000, query_timeout: 5000 });
  try {
    if (!env[key]) throw new Error("not configured");
    await client.connect();
    const expected = key === "DATABASE_URL" ? ["app_users", "roles", "cameras", "inference_results", "truck_inspections", "deletion_requests"] : ["ai_cameras", "ai_results", "ai_inference_results"];
    const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(row => row.table_name);
    const missing = expected.filter(table => !tables.includes(table));
    record(key, !missing.length, missing.length ? `tabel belum tersedia: ${missing.join(", ")}` : "terhubung dan tabel aplikasi tersedia");
    if (key === "DATABASE_URL") {
      const columns = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inference_results' AND column_name='impurity_measured'");
      record("Provenance hasil AI", columns.rowCount === 1, "migrasi 006 untuk membedakan klasifikasi dan pengukuran kotoran");
    }
  } catch { record(key, false, "periksa koneksi database dan migrasi; kredensial tidak ditampilkan"); }
  finally { await client.end().catch(() => {}); }
}
for (const name of ["config.json", "frame_config.json"]) {
  try {
    const config = JSON.parse(await readFile(path.join(root, "apps/ai-service/models/active", name), "utf8"));
    const value = config.model_path.replaceAll("\\", "/");
    const base = value.startsWith("apps/ai-service/") || value.startsWith("models/archive/") ? root : path.join(root, "apps/ai-service");
    await access(path.resolve(base, value));
    record(name, true, "konfigurasi dan file model tersedia");
  } catch { record(name, false, "konfigurasi/file model belum tersedia"); }
}
const api = `http://127.0.0.1:${env.API_PORT ?? env.BACKEND_PORT ?? 4110}`;
const ai = env.AI_SERVICE_URL ?? "http://127.0.0.1:8010";
for (const [name, url] of [["API", api], ["AI", ai]]) {
  try {
    const response = await fetch(`${url}/health`, {signal:AbortSignal.timeout(10000)});
    const status = await response.json();
    record(name, response.ok && status.status === "ok", response.ok ? "layanan merespons" : `HTTP ${response.status}`);
    if (name === "AI") {
      const serviceToken = env.AI_SERVICE_TOKEN ?? createHmac("sha256", env.JWT_SECRET ?? "local-development-secret-change-me").update("sugarcane-ai-service").digest("hex");
      const internal = await fetch(`${ai}/roi/2`, { headers: { "X-Sugarcane-Service-Token": serviceToken }, signal: AbortSignal.timeout(10000) });
      await internal.arrayBuffer();
      record("Backend → AI", internal.status === 200 || internal.status === 404, "autentikasi layanan internal; token tidak ditampilkan");
      record("Model aktif", status.model?.available === true, "status ketersediaan model dari layanan AI");
      const required = (env.REQUIRED_CAMERA_IDS ?? "2").split(",").map(Number);
      for (const id of required) record(`CCTV ${id}`, status[`camera_${id}_live`] === true, "kamera yang diwajibkan untuk instalasi ini");
      console.log(`INFO CCTV 1: ${status.camera_1_live ? "terhubung" : "tidak terhubung"}; CCTV 2: ${status.camera_2_live ? "terhubung" : "tidak terhubung"}`);
    }
  } catch { record(name, false, `layanan belum berjalan di ${url}`); }
}
try { await access(path.join(root, "apps/web/dist/index.html")); record("Build UI", true, "hasil build web/desktop tersedia"); }
catch { record("Build UI", false, "jalankan npm run build"); }
console.log(`\n${checks.filter(check => check.ok).length}/${checks.length} pemeriksaan lulus. Pemeriksaan ini tidak mengubah data.`);
if (checks.some(check => !check.ok)) process.exitCode = 1;

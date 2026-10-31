// Integration regression checks run in a disposable PostgreSQL schema.
// No live camera, inference model, or operational records are modified.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";

const local = dotenv.parse(await readFile(new URL("../.env", import.meta.url)));
const databaseUrl = process.env.DATABASE_URL ?? local.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL wajib tersedia");
const primaryStation = local.INSTALLATION_ID === "malang" ? 2 : 5;
const aiScoped = new URL(local.AI_DATABASE_URL);
const schema = `camera_test_${process.pid}_${Date.now()}`;
const scoped = new URL(databaseUrl);
scoped.searchParams.set("options", `-csearch_path=${schema}`);
const owner = new pg.Client({ connectionString: databaseUrl });
const db = new pg.Client({ connectionString: scoped.href });
let backend;
let testEnv;
let ownerConnected = false;
const registered = new Map();
const mockAi = createServer(async (request, response) => {
  let input = "";
  for await (const chunk of request) input += chunk;
  if (request.url === "/cameras/register") {
    const camera = JSON.parse(input);
    registered.set(camera.camera_id, camera);
  }
  if (request.method === "DELETE") registered.delete(Number(request.url.split("/").pop()));
  if (request.url?.startsWith("/snapshot/")) {
    response.writeHead(503, { "Content-Type": "application/json" });
    return response.end(JSON.stringify({ detail: "No test frame" }));
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ status: "ok", cameras: {}, model: { available: true } }));
});
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const password = randomBytes(24).toString("hex");
let apiUrl;
const call = async (path, token, method = "GET", body) => {
  const response = await fetch(`${apiUrl}${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json() };
};

try {
  await owner.connect();
  ownerConnected = true;
  await owner.query(`CREATE SCHEMA "${schema}"`);
  await db.connect();
  for (const file of ["001_initial.sql", "002_rbac.sql", "003_role_visibility.sql", "004_active_truck_line.sql", "005_deletion_requests.sql", "006_impurity_measurement.sql", "007_camera_configuration.sql"]) {
    await db.query(await readFile(new URL(`../database/postgres/${file}`, import.meta.url), "utf8"));
  }
  aiScoped.searchParams.set("options", `-csearch_path=${schema}`);
  const aiPort = await listen(mockAi);
  const probe = createServer();
  const apiPort = await listen(probe);
  await new Promise(resolve => probe.close(resolve));
  apiUrl = `http://127.0.0.1:${apiPort}`;
  testEnv = { ...process.env, NODE_ENV: "test", DATABASE_URL: scoped.href, AI_DATABASE_URL: aiScoped.href,
      API_PORT: String(apiPort), API_HOST: "127.0.0.1", AI_SERVICE_URL: `http://127.0.0.1:${aiPort}`,
      JWT_SECRET: randomBytes(32).toString("hex"), CCTV_TRANGKIL_RTSP_URL: "rtsp://ignored.invalid/legacy",
      INSTALLATION_ID: local.INSTALLATION_ID ?? "trangkil",
      USER_KEBONAGUNG_ADMIN: "qa_admin", PASSWORD_KEBONAGUNG_ADMIN: password,
      USER_KEBONAGUNG_OPERATOR: "qa_operator", PASSWORD_KEBONAGUNG_OPERATOR: password,
      APP_ADMIN_USER: "qa_admin", APP_ADMIN_PASSWORD: password, APP_DEVELOPER_PASSWORD: "",
      USER_TRANGKIL_ADMIN: "qa_admin", PASSWORD_TRANGKIL_ADMIN: password,
      USER_TRANGKIL_OPERATOR: "qa_operator", PASSWORD_TRANGKIL_OPERATOR: password };
  backend = spawn(process.execPath, ["--import", "tsx", "apps/api/src/server.ts"], {
    cwd: new URL("../", import.meta.url), windowsHide: true, env: testEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  backend.stdout.resume();
  let startupErrors = "";
  backend.stderr.on("data", chunk => { startupErrors = (startupErrors + chunk).slice(-6000); });
  for (let attempt = 0; ; attempt++) {
    try { if ((await call("/health")).status === 200) break; } catch { /* server starting */ }
    if (attempt >= 150 || backend.exitCode !== null) throw new Error("Test API gagal dimulai: " + startupErrors.replace(/(?:rtsps?|postgresql?):\/\/\S+/g, "[redacted endpoint]"));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const admin = (await call("/api/auth/login", null, "POST", { username: "qa_admin", password })).data.token;
  const operator = (await call("/api/auth/login", null, "POST", { username: "qa_operator", password })).data.token;
  assert.ok(admin); assert.ok(operator);
  assert.equal((await call("/api/cameras")).status, 401);
  const original = (await call("/api/cameras", admin)).data;
  assert.equal(original.length, 0, "A new database must not bootstrap cameras from environment");
  const baseline = await call("/api/cameras", admin, "POST", {name:"Primary QA",station:primaryStation,location:"QA",enabled:false,rtspUrl:"rtsp://qa:primary@127.0.0.1/primary"});
  assert.equal(baseline.status,200);
  assert.equal((await call("/api/users", admin)).data.length, 2);
  const draft = { name: "CCTV QA", location: "Meja QA", station: 7, enabled: false, rtspUrl: "rtsp://qa:private@127.0.0.1:554/test" };
  assert.equal((await call("/api/cameras", operator, "POST", draft)).status, 403);
  assert.equal((await call("/api/cameras", admin, "POST", { ...draft, rtspUrl: "https://invalid.test" })).status, 400);
  const created = await call("/api/cameras", admin, "POST", draft);
  assert.equal(created.status, 200);
  const id = created.data.id;
  assert.equal(created.data.enabled, false); assert.equal(registered.has(id), false);
  assert.equal((await call("/api/cameras", admin, "POST", draft)).status, 409);
  const visible = (await call("/api/cameras", operator)).data.find(camera => camera.id === id);
  assert.equal(visible.rtspUrl, draft.rtspUrl, "camera.read must be able to view the saved RTSP URL");
  assert.equal((await db.query("SELECT rtsp_url FROM cameras WHERE id=$1",[id])).rows[0].rtsp_url,draft.rtspUrl);
  assert.equal((await call(`/api/cameras/${id}`, operator, "PUT", { enabled: true })).status, 403);
  assert.equal((await call(`/api/cameras/${id}`, admin, "PUT", { station: primaryStation })).status, 409);
  const enabled = await call(`/api/cameras/${id}`, admin, "PUT", { enabled: true });
  assert.equal(enabled.status, 200); assert.equal(enabled.data.station, 7);
  assert.equal(enabled.data.rtspUrl, draft.rtspUrl); assert.equal(registered.get(id)?.rtsp_url, draft.rtspUrl);
  const changed = await call(`/api/cameras/${id}`, admin, "PUT", { station: 8, rtspUrl: "rtsps://qa:new@127.0.0.1/test" });
  assert.equal(changed.data.station, 8); assert.equal(registered.get(id)?.rtsp_url, changed.data.rtspUrl);
  const tested = await call(`/api/cameras/${id}/test`, admin, "POST");
  assert.equal(tested.status, 200); assert.equal(tested.data.connected, false);
  await db.query("INSERT INTO truck_inspections(id,truck_code,line,status) VALUES('00000000-0000-4000-8000-000000000001','QA',$1,'active')", [id]);
  assert.equal((await call(`/api/cameras/${id}`, admin, "PUT", { enabled: false })).status, 409);
  assert.equal((await call(`/api/cameras/${id}`, admin, "DELETE")).status, 409);
  await db.query("UPDATE truck_inspections SET status='completed'");
  assert.equal((await call(`/api/cameras/${id}`, admin, "DELETE")).status, 409);
  const disabled = await call(`/api/cameras/${id}`, admin, "PUT", { enabled: false });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.data));
  assert.equal(disabled.data.enabled, false); assert.equal(disabled.data.station, 8);
  assert.equal(registered.has(id), false);
  await db.query("DELETE FROM truck_inspections");
  assert.equal((await call(`/api/cameras/${id}`, admin, "DELETE")).status, 200);
  // Deleting all cameras must stay empty across initialization; legacy env is ignored.
  assert.equal((await call(`/api/cameras/${baseline.data.id}`, admin, "DELETE")).status, 200);
  assert.equal((await call("/api/cameras", admin)).data.length, 0);
  const bootstrap = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    "const {store}=await import('./apps/api/src/store.ts'); const {pool}=await import('./apps/api/src/db.ts'); await store.initialize(); await pool.end();"],
    { cwd: new URL("../", import.meta.url), env: testEnv, windowsHide: true, stdio: "ignore" });
  assert.equal((await once(bootstrap, "exit"))[0], 0);
  assert.equal((await call("/api/cameras", admin)).data.length, 0);
  console.log("PASS: auth, one-factory accounts, CRUD, station uniqueness, database-only RTSP validation and reader visibility, AI sync, active-cycle protection, history preservation, deletion, and restart persistence.");
} finally {
  if (backend && backend.exitCode === null) { backend.kill(); await once(backend, "exit"); }
  await new Promise(resolve => mockAi.close(resolve));
  await db.end().catch(() => {});
  if (ownerConnected) { await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await owner.end(); }
}

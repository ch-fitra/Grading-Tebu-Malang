import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import dotenv from "dotenv";
import pg from "pg";

test("API and PostgreSQL regression checks in an isolated schema", async t => {
  dotenv.config();
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for integration checks");
  const connection = process.env.DATABASE_URL;
  const admin = new pg.Pool({ connectionString: connection });
  const schema = `regression_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^regression_[a-f0-9]{32}$/);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const databaseUrl = new URL(connection);
  databaseUrl.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = databaseUrl.href;
  process.env.API_TEST_MODE = "true";
  process.env.NODE_ENV = "test";
  process.env.APP_DEVELOPER_PASSWORD = "regression-developer";
  process.env.APP_ADMIN_PASSWORD = "regression-admin";
  process.env.JWT_SECRET = "isolated-regression-secret";
  const ai = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.statusCode = req.url?.includes("/roi") ? 422 : 503;
    res.end(JSON.stringify({ detail: "isolated test AI" }));
  });
  await new Promise<void>(resolve => ai.listen(0, "127.0.0.1", resolve));
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${(ai.address() as { port: number }).port}`;
  let app: any;
  const db = new pg.Pool({ connectionString: databaseUrl.href });
  try {
    for (const name of ["001_initial.sql", "002_rbac.sql", "003_role_visibility.sql", "004_active_truck_line.sql", "005_deletion_requests.sql"]) {
      await db.query(await readFile(`database/postgres/${name}`, "utf8"));
    }
    const server = await import("../apps/api/src/server.ts");
    app = server.app;
    const { auth } = await import("../apps/api/src/auth.ts");
    const { store } = await import("../apps/api/src/store.ts");
    const roles = await auth.listRoles();
    const adminRole = roles.find(role => role.code === "admin")!;
    const operatorRole = roles.find(role => role.code === "operator")!;
    const root = await auth.login(process.env.APP_DEVELOPER_USER ?? "developer", "regression-developer");
    assert.ok(root);
    const localAdmin = await auth.createUser({ username: "test_admin_trangkil", password: "regression-admin-local", roleId: adminRole.id, active: true });
    await auth.createUser({ username: "test_operator_trangkil", password: "regression-operator", roleId: operatorRole.id, active: true });
    const local = await auth.login("test_admin_trangkil", "regression-admin-local");
    const op = await auth.login("test_operator_trangkil", "regression-operator");
    assert.ok(local && op && localAdmin);
    const headers = (token = root.token) => ({ authorization: `Bearer ${token}` });
    const request = (method: string, url: string, payload?: object, token = root.token) => app.inject({ method, url, payload, headers: headers(token) });

    await t.test("bootstrap administrator remains visible in user management", async () => {
      const response = await request("GET", "/api/users");
      assert.equal(response.statusCode, 200);
      assert.ok(response.json().some((user: { username: string }) => user.username === (process.env.APP_ADMIN_USER ?? "admin")));
      const factoryUsers = (await request("GET", "/api/users", undefined, local.token)).json();
      assert.ok(factoryUsers.some((user: { username: string }) => user.username === local.user.username));
      assert.ok(factoryUsers.every((user: { username: string }) => user.username.includes("trangkil")));
    });

    await t.test("query parameters cannot bypass authentication or ROI permissions", async () => {
      assert.equal((await app.inject({ method: "GET", url: "/api/users?query=/stream" })).statusCode, 401);
      assert.equal((await app.inject({ method: "GET", url: "/api/users?query=/reconnect" })).statusCode, 401);
      assert.equal((await request("POST", "/api/cameras/2/roi", {}, op.token)).statusCode, 403);
      assert.equal((await request("GET", "/api/cameras/2/roi", undefined, op.token)).statusCode, 422);
    });
    await t.test("factory scope applies to camera mutations and numeric/UUID IDs are validated", async () => {
      assert.equal((await request("PUT", "/api/cameras/1", { name: "cross-factory" }, local.token)).statusCode, 403);
      assert.equal((await request("POST", "/api/cameras/1/capture", {}, op.token)).statusCode, 403);
      assert.equal((await request("PATCH", "/api/truck-inspections/not-a-uuid", {})).statusCode, 400);
      assert.equal((await request("DELETE", "/api/cameras/NaN")).statusCode, 400);
    });
    await t.test("admins cannot assign hidden developer privileges through custom roles", async () => {
      const elevated = await auth.createRole({ code: "elevated_test", name: "Elevated", description: "regression", permissions: ["role.write"] });
      const response = await request("POST", "/api/users", { username: "elevated_trangkil", password: "regression-elevated", roleId: elevated.id }, local.token);
      assert.equal(response.statusCode, 403);
      assert.equal((await request("PATCH", `/api/users/${root.user.id}`, { roleId: adminRole.id }, local.token)).statusCode, 403);
    });
    const created = await request("POST", "/api/truck-inspections", { truckCode: "regression", line: 2 });
    assert.equal(created.statusCode, 200);
    const truck = created.json();
    await t.test("concurrent starts respect one active cycle per camera", async () => {
      assert.equal((await request("POST", "/api/truck-inspections", { truckCode: "duplicate", line: 2 })).statusCode, 409);
      assert.equal(Number((await db.query("SELECT count(*) FROM truck_inspections")).rows[0].count), 1);
    });
    await t.test("tapping validation and batch rollback prevent partial writes", async () => {
      assert.equal((await request("POST", "/api/truck-inspections/sync-tapping", { matches: [{ id: "invalid" }] })).statusCode, 400);
      assert.equal((await request("POST", "/api/truck-inspections/sync-tapping", { matches: [{ id: truck.id }, { id: truck.id }] })).statusCode, 400);
      const response = await request("POST", "/api/truck-inspections/sync-tapping", { matches: [{ id: truck.id, truckCode: "must rollback" }, { id: randomUUID(), truckCode: "missing" }] });
      assert.equal(response.statusCode, 404);
      assert.equal((await db.query("SELECT truck_code FROM truck_inspections WHERE id=$1", [truck.id])).rows[0].truck_code, "regression");
    });
    await t.test("completion persists captures, empty notes, and the measured decision", async () => {
      await store.addInference({ cameraId: 2, classes: { daun: 6, pucuk: 3, sampah: 3 }, grade: "D", confidence: 0.9, timestamp: new Date(Date.now() + 10).toISOString(), snapshot: null });
      await new Promise(resolve => setTimeout(resolve, 25));
      const response = await request("PATCH", `/api/truck-inspections/${truck.id}/complete`, { notes: "" });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().totalCaptures, 1);
      assert.equal(response.json().finalDecision, "NON_MBS");
      assert.equal(response.json().notes, "");
      assert.equal((await request("PATCH", `/api/truck-inspections/${truck.id}/complete`, {})).statusCode, 404);
    });
    await t.test("unknown model activation preserves the active model", async () => {
      assert.equal(await store.activateModel(999999), null);
      assert.ok((await store.listModels()).some(model => model.active));
      assert.equal((await request("POST", "/api/models/activate", { id: 1 })).statusCode, 502);
      assert.ok((await store.listModels()).some(model => model.id === 1 && model.active));
    });
    await t.test("administrator approval reads current database passwords", async () => {
      await auth.updateUser(localAdmin.id, { password: "changed-regression-password" });
      assert.equal(await auth.verifyAdmin("trangkil", "regression-admin-local"), null);
      assert.equal((await auth.verifyAdmin("trangkil", "changed-regression-password"))?.id, localAdmin.id);
      assert.equal(await auth.current(`${local.token}.extra`), null);
    });
    await t.test("deletion requests persist and approve/delete atomically only once", async () => {
      const response = await request("POST", "/api/deletion-requests", { targetType: "truck_inspection", targetId: truck.id, targetTitle: "regression", reason: "regression" }, op.token);
      assert.equal(response.statusCode, 200);
      const id = response.json().id;
      assert.equal(Number((await db.query("SELECT count(*) FROM deletion_requests WHERE id=$1", [id])).rows[0].count), 1);
      assert.equal((await request("POST", `/api/deletion-requests/${id}/review`, { decision: "approved" }, local.token)).statusCode, 200);
      assert.equal(Number((await db.query("SELECT count(*) FROM truck_inspections WHERE id=$1", [truck.id])).rows[0].count), 0);
      assert.equal((await request("POST", `/api/deletion-requests/${id}/review`, { decision: "approved" }, local.token)).statusCode, 409);
    });
    await t.test("factory admins cannot clear another factory's inferences", async () => {
      await store.addInference({ cameraId: 1, classes: { daun: 1, pucuk: 0, sampah: 0 }, grade: "S", confidence: 0.9, timestamp: new Date().toISOString(), snapshot: null });
      assert.equal((await request("DELETE", "/api/inference", undefined, local.token)).statusCode, 200);
      assert.deepEqual((await store.listInference()).map(item => item.cameraId), [1]);
    });
    await t.test("database failures surface instead of inventing successful operational records", async () => {
      await db.query("ALTER TABLE truck_inspections RENAME TO offline_trucks");
      try { assert.equal((await request("POST", "/api/truck-inspections", { truckCode: "must fail", line: 2 })).statusCode, 500); }
      finally { await db.query("ALTER TABLE offline_trucks RENAME TO truck_inspections"); }
    });
  } finally {
    if (app) await app.close();
    await db.end();
    await new Promise<void>(resolve => ai.close(() => resolve()));
    // The generated schema is the only cleanup target; production data is never touched.
    assert.match(schema, /^regression_[a-f0-9]{32}$/);
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

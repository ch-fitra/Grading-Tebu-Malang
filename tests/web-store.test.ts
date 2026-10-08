import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSync } from "esbuild";
import vm from "node:vm";

function storeModule(fetch: typeof globalThis.fetch) {
  const compiled = buildSync({ entryPoints: ["apps/web/src/store.ts"], platform: "node", bundle: true, write: false, format: "cjs", define: { "import.meta.env": "{}" } });
  const session = { token: "session-token", user: { id: 1, username: "regression", role: "viewer", permissions: ["history.read"] } };
  const saved = new Map([["tebu-session", JSON.stringify(session)]]);
  const localStorage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) };
  const module = { exports: {} as any };
  vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, Headers, FormData, fetch, console, process: { env: { NODE_ENV: "test" } }, localStorage, window: { localStorage } });
  return { store: module.exports.useAppStore, saved };
}
test("refresh results cannot repopulate state after logout", async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>(done => resolve = done);
  const { store } = storeModule(async () => pending);
  const refresh = store.getState().refresh();
  store.getState().logout();
  resolve(Response.json([{ id: "private-data" }]));
  await refresh;
  assert.equal(store.getState().session, null);
  assert.equal(store.getState().history.length, 0);
});
test("temporary connection errors preserve existing history", async () => {
  const { store } = storeModule(async () => { throw new Error("offline"); });
  store.setState({ history: [{ id: "kept" }] });
  await store.getState().refresh();
  assert.equal(store.getState().history[0].id, "kept");
  assert.ok(store.getState().session);
});
test("expired sessions log out during polling", async () => {
  const { store } = storeModule(async () => Response.json({ message: "expired" }, { status: 401 }));
  await store.getState().refresh();
  assert.equal(store.getState().session, null);
});
test("legacy history is preserved on the first read", async () => {
  const { store, saved } = storeModule(async () => Response.json([]));
  saved.set("tebu-truck-sessions", JSON.stringify([{ id: "session_legacy", status: "completed" }]));
  await store.getState().refresh();
  assert.equal(store.getState().truckSessions[0].id, "session_legacy");
  assert.ok(saved.has("tebu-truck-sessions"));
});
test("older polling results cannot overwrite newer data", async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>(done => resolve = done);
  let calls = 0;
  const { store } = storeModule(async () => ++calls <= 2 ? pending : Response.json([{ id: "new" }]));
  const old = store.getState().refresh();
  await store.getState().refresh();
  resolve(Response.json([{ id: "old" }]));
  await old;
  assert.equal(store.getState().history[0].id, "new");
});
test("failed backend tapping sync cannot modify legacy records", async () => {
  const { store, saved } = storeModule(async () => Response.json({ message: "failed" }, { status: 500 }));
  saved.set("tebu-truck-sessions", JSON.stringify([{ id: "session_legacy", truckCode: "old" }]));
  await assert.rejects(store.getState().syncTappingData([{ id: "session_legacy", truckCode: "changed" }, { id: "backend", truckCode: "failed" }]));
  assert.equal(JSON.parse(saved.get("tebu-truck-sessions")!)[0].truckCode, "old");
});

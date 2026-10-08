import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSync } from "esbuild";
import vm from "node:vm";

function apiModule(fetch: typeof globalThis.fetch) {
  const compiled = buildSync({ entryPoints: ["apps/web/src/utils/api.ts"], bundle: true, write: false, format: "cjs", define: { "import.meta.env": "{}" } });
  const module = { exports: {} as any };
  vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, Headers, FormData, fetch, window: { localStorage: { getItem: () => '{"token":"session-token"}' } } });
  return module.exports;
}

test("API merges custom deletion headers without losing bearer auth or JSON content type", async () => {
  const { api } = apiModule(async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer session-token");
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(headers.get("x-admin-approval"), "approved");
    return Response.json({ ok: true });
  });
  await api("/api/test", { method: "POST", body: "{}", headers: { "x-admin-approval": "approved" } });
});
test("API respects Headers objects and explicit caller authorization", async () => {
  const { api } = apiModule(async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer explicit");
    return Response.json({ ok: true });
  });
  await api("/api/test", { headers: new Headers({ Authorization: "Bearer explicit" }) });
});
test("API exposes HTTP status and readable backend errors", async () => {
  const { api, ApiError } = apiModule(async () => Response.json({ message: "Akses ditolak" }, { status: 403 }));
  await assert.rejects(api("/api/test"), (error: any) => error instanceof ApiError && error.status === 403 && error.message === "Akses ditolak");
});
test("API supports empty successful responses", async () => {
  const { api } = apiModule(async () => new Response(null, { status: 204 }));
  assert.equal(await api("/api/test"), undefined);
});

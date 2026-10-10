import "./env.js";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { config } from "./config.js";
import { store, DEFAULT_CAMERAS } from "./store.js";
import { auth, PERMISSIONS, type Permission, type User } from "./auth.js";
import { trucks } from "./trucks.js";
import { calculateGrade } from "./rule-engine.js";
import { pool } from "./db.js";

const app = Fastify({ logger: process.env.API_TEST_MODE === "true" ? false : { redact: { paths: ["req.url"], censor: "[redacted]" } } });
const clients = new Set<{ send: (payload: string) => void }>();
app.addHook("onClose", async () => { await pool.end(); });

await store.initialize();
await auth.initialize();

const allowedOrigins = new Set((process.env.PUBLIC_ORIGINS ?? "http://127.0.0.1:5175,http://localhost:5175,http://127.0.0.1:8080,http://localhost:8080,https://pgtrangkil.aisugarcanembs.com,https://pgmalang.aisugarcanembs.com").split(","));
await app.register(cors, { origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)), credentials: true });
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 1 } });
await app.register(websocket);

const access: Record<string, Permission> = {
  "GET /api/system/status": "dashboard.read", "GET /api/cameras": "camera.read", "POST /api/cameras": "camera.write",
  "PUT /api/cameras/:id": "camera.write", "DELETE /api/cameras/:id": "camera.write", "GET /api/models": "model.read",
  "POST /api/models/upload": "model.write", "POST /api/models/activate": "model.write",
  "GET /api/inference/latest": "dashboard.read", "GET /api/inference/history": "history.read", "GET /api/inference/model-frames": "dashboard.read",
  "GET /api/users": "user.read", "POST /api/users": "user.write", "PATCH /api/users/:id": "user.write",
  "POST /api/auth/verify-admin": "dashboard.read",
  "GET /api/deletion-requests": "dashboard.read",
  "POST /api/deletion-requests": "inspection.write",
  "POST /api/deletion-requests/:id/review": "dashboard.read",
  "GET /api/roles": "role.read", "POST /api/roles": "role.write", "PUT /api/roles/:id": "role.write", "DELETE /api/roles/:id": "role.write",
  "GET /api/truck-inspections": "history.read", "POST /api/truck-inspections": "inspection.write",
  "DELETE /api/truck-inspections": "inspection.write",
  "PATCH /api/truck-inspections/:id/complete": "inspection.write", "PATCH /api/truck-inspections/:id": "inspection.write",
  "POST /api/truck-inspections/sync-tapping": "inspection.write", "DELETE /api/truck-inspections/:id": "inspection.write",
  "POST /api/cameras/:id/capture": "inspection.write",
  "POST /api/cameras/:id/roi": "camera.write",
  "GET /api/cameras/:id/roi": "camera.read",
  "POST /api/cameras/:id/reconnect": "camera.read",
  "DELETE /api/inference/:id": "inspection.write",
  "DELETE /api/inference": "inspection.write"
};

app.addHook("preHandler", async (request, reply) => {
  const route = request.routeOptions.url;
  if (route === "/api/auth/logout") return;
  const isMedia = request.method === "GET" && ["/api/cameras/:id/stream", "/api/cameras/:id/snapshot", "/storage/snapshots/*"].includes(route ?? "");
  if (isMedia) {
    const cookieToken = request.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith("sugarcane_session="))?.slice("sugarcane_session=".length) ?? "";
    const mediaUser = await auth.current(request.headers.authorization?.replace(/^Bearer /i, "") ?? cookieToken);
    if (!mediaUser) return reply.code(401).send({ message: "Login diperlukan untuk mengakses media" });
    if (!mediaUser.permissions.includes("camera.read")) return reply.code(403).send({ message: "Akses media ditolak" });
    const factory = getFactoryFilter(mediaUser.username);
    if (factory !== "all") {
      const cameras = (await store.listCameras()).filter(camera => cameraInFactory(camera, factory));
      const mediaParams = request.params as { id?: string; "*"?: string };
      if (mediaParams.id && !cameras.some(camera => camera.id === Number(mediaParams.id))) return reply.code(403).send({ message: "Kamera berada di luar akses pabrik" });
      if (mediaParams["*"]) {
        const records = await store.listInference();
        if (!records.some(record => record.snapshot === `/storage/snapshots/${mediaParams["*"]}` && cameras.some(camera => camera.id === record.cameraId))) return reply.code(403).send({ message: "Snapshot berada di luar akses pabrik" });
      }
    }
    return;
  }
  if (route === "/health" || route === "/api/auth/login" || route === "/ws" ||
      (request.method === "GET" && ["/api/cameras/:id/stream", "/api/cameras/:id/snapshot", "/storage/snapshots/*"].includes(route ?? ""))) return;

  const token = request.headers.authorization?.replace(/^Bearer /i, "") ?? "";
  const user = await auth.current(token);
  if (!user) return reply.code(401).send({ message: "Sesi tidak valid atau telah berakhir" });
  // Restore the media cookie for sessions created before cookie authentication.
  if (!request.headers.cookie?.split(";").some(value => value.trim().startsWith("sugarcane_session="))) {
    const secure = request.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    reply.header("Set-Cookie", `sugarcane_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure}`);
  }
  const key = `${request.method} ${request.routeOptions.url ?? request.url.split("?")[0]}`;
  if (key === "GET /api/auth/me") return;
  const permission = access[key];
  if (!permission || !user.permissions.includes(permission)) return reply.code(403).send({ message: "Akses ditolak" });
  const params = request.params as { id?: string };
  if (params.id && route?.startsWith("/api/truck-inspections/") && !z.string().uuid().safeParse(params.id).success)
    return reply.code(400).send({ message: "ID inspeksi tidak valid" });
  if (params.id && ["/api/cameras/", "/api/inference/", "/api/users/", "/api/roles/"].some(prefix => route?.startsWith(prefix)) && !z.coerce.number().int().positive().safeParse(params.id).success)
    return reply.code(400).send({ message: "ID tidak valid" });
  const factory = getFactoryFilter(user.username);
  if (factory !== "all") {
    const cameras = await store.listCameras();
    const allowed = new Set(cameras.filter(camera => cameraInFactory(camera, factory)).map(camera => camera.id));
    if (params.id && route?.startsWith("/api/cameras/") && !allowed.has(Number(params.id)))
      return reply.code(403).send({ message: "Kamera berada di luar akses pabrik" });
    if (params.id && route?.startsWith("/api/truck-inspections/")) {
      const truck = await trucks.get(params.id);
      if (truck && !allowed.has(truck.line)) return reply.code(403).send({ message: "Inspeksi berada di luar akses pabrik" });
    }
    if (params.id && route === "/api/inference/:id") {
      const inference = await store.getInference(Number(params.id));
      if (inference && !allowed.has(inference.cameraId)) return reply.code(403).send({ message: "Data berada di luar akses pabrik" });
    }
    if (route === "/api/truck-inspections" && request.method === "POST" && !allowed.has(Number((request.body as { line?: number })?.line)))
      return reply.code(403).send({ message: "Jalur berada di luar akses pabrik" });
    if (route === "/api/truck-inspections/sync-tapping") {
      const matches = (request.body as { matches?: { id: string }[] })?.matches;
      if (Array.isArray(matches)) {
        if (matches.some(match => !z.string().uuid().safeParse(match?.id).success)) return reply.code(400).send({ message: "ID inspeksi tidak valid" });
        const all = (await pool.query("SELECT id,line FROM truck_inspections WHERE id=ANY($1::uuid[])", [matches.map(match => match.id)])).rows;
        if (all.some(truck => !allowed.has(Number(truck.line))))
          return reply.code(403).send({ message: "Inspeksi berada di luar akses pabrik" });
      }
    }
    if (route === "/api/cameras" && request.method === "POST" && !cameraInFactory((request.body ?? {}) as { name: string; location: string }, factory))
      return reply.code(403).send({ message: "Kamera berada di luar akses pabrik" });
    if (route === "/api/cameras/:id" && request.method === "PUT") {
      const camera = cameras.find(item => item.id === Number(params.id));
      if (camera && !cameraInFactory({ ...camera, ...(request.body as object) }, factory))
        return reply.code(403).send({ message: "Kamera tidak dapat dipindahkan ke pabrik lain" });
    }
    if (route === "/api/users" && request.method === "POST" && getFactoryFilter(String((request.body as { username?: string })?.username ?? "")) !== factory)
      return reply.code(403).send({ message: "User berada di luar akses pabrik" });
    if (route === "/api/users/:id") {
      const target = (await auth.listUsers()).find(item => item.id === Number(params.id));
      if (target && getFactoryFilter(target.username) !== factory) return reply.code(403).send({ message: "User berada di luar akses pabrik" });
    }
  }
});

function broadcast(event: string, data: unknown) {
  const payload = JSON.stringify({ event, data });
  for (const client of clients) {
    client.send(payload);
  }
}

app.get("/health", async () => ({ status: "ok", service: "backend" }));

const snapshotsDir = fileURLToPath(new URL("../../../storage/snapshots/", import.meta.url));

// Serve saved snapshot images
app.get("/storage/snapshots/*", async (request, reply) => {
  const safeName = (request.params as { "*": string })["*"];
  if (!safeName || safeName.split("/").some(part => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..")) return reply.code(400).send({ message: "Invalid snapshot path" });
  const filePath = join(snapshotsDir, safeName);
  try {
    const file = await readFile(filePath).catch(() => readFile(fileURLToPath(new URL(`../../ai-service/storage/snapshots/${safeName}`, import.meta.url))));
    reply.header("Content-Type", "image/jpeg");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(file);
  } catch {
    return reply.code(404).send({ message: "Snapshot image not found" });
  }
});

app.post("/api/auth/login", async (request, reply) => {
  const parsed = z.object({
    username: z.string().min(1),
    password: z.string().min(1)
  }).safeParse(request.body);

  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

  const session = await auth.login(parsed.data.username, parsed.data.password);
  if (!session) return reply.code(401).send({ message: "Username atau password salah" });
  const secure = request.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  reply.header("Set-Cookie", `sugarcane_session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure}`);
  return session;
});
app.post("/api/auth/logout", async (_request, reply) => {
  reply.header("Set-Cookie", "sugarcane_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  return { ok: true };
});
app.get("/api/auth/me", async request => await currentUser(request.headers.authorization));

app.get("/ws", { websocket: true }, async (socket, request) => {
  const token = new URL(request.url, "http://localhost").searchParams.get("token") ?? "";
  const user = await auth.current(token);
  if (!user) { socket.close(1008, "Unauthorized"); return; }
  clients.add(socket); socket.on("close", () => clients.delete(socket));
});

const currentUser = async (authorization?: string) => auth.current(authorization?.replace(/^Bearer /i, "") ?? "");
function getFactoryFilter(username: string): "trangkil" | "kebonagung" | "all" {
  const u = username.toLowerCase();
  if (u.includes("kebonagung") || u.includes("malang")) return "kebonagung";
  if (u.includes("trangkil")) return "trangkil";
  return "all";
}
function cameraInFactory(camera: { name: string; location: string }, factory: string): boolean {
  const text = `${camera.name ?? ""} ${camera.location ?? ""}`.toLowerCase();
  return factory === "all" || (factory === "trangkil" ? text.includes("trangkil") : text.includes("kebon agung") || text.includes("malang"));
}
async function factoryCameraIds(actor: User): Promise<number[] | undefined> {
  const factory = getFactoryFilter(actor.username);
  return factory === "all" ? undefined : (await store.listCameras()).filter(camera => cameraInFactory(camera, factory)).map(camera => camera.id);
}
const roleInput = z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{2,49}$/), name: z.string().min(2).max(100), description: z.string().max(500).default(""), permissions: z.array(z.enum(PERMISSIONS)).default([]) });
app.get("/api/roles", async request => auth.listVisibleRoles((await currentUser(request.headers.authorization))!));
app.post("/api/roles", async (request, reply) => {
  const parsed = roleInput.safeParse(request.body); if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const actor = (await currentUser(request.headers.authorization))!;
  if (actor.role !== "developer" && parsed.data.permissions.some(permission => !actor.permissions.includes(permission))) return reply.code(403).send({ message: "Tidak diizinkan memberikan hak akses yang lebih tinggi" });
  try { return await auth.createRole({ ...parsed.data, permissions: [...new Set(parsed.data.permissions)] }); }
  catch { return reply.code(409).send({ message: "Kode role sudah digunakan" }); }
});
app.put("/api/roles/:id", async (request, reply) => {
  const parsed = roleInput.omit({ code: true }).safeParse(request.body); if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const actor = (await currentUser(request.headers.authorization))!;
  if (actor.role !== "developer" && parsed.data.permissions.some(permission => !actor.permissions.includes(permission))) return reply.code(403).send({ message: "Tidak diizinkan memberikan hak akses yang lebih tinggi" });
  const role = await auth.updateRole(Number((request.params as { id: string }).id), { ...parsed.data, permissions: [...new Set(parsed.data.permissions)] });
  return role ?? reply.code(403).send({ message: "Role sistem tidak dapat diubah" });
});
app.delete("/api/roles/:id", async (request, reply) => {
  const deleted = await auth.deleteRole(Number((request.params as { id: string }).id));
  return deleted ? { ok: true } : reply.code(409).send({ message: "Role sistem atau masih digunakan" });
});
const userInput = z.object({ username: z.string().regex(/^[a-zA-Z0-9._-]{3,100}$/), password: z.string().min(8).max(128), roleId: z.number().int().positive(), active: z.boolean().default(true) });
app.get("/api/users", async (request) => {
  const actor = (await currentUser(request.headers.authorization))!;
  const factory = getFactoryFilter(actor.username);
  const allUsers = await auth.listUsers();
  
  const cleanUsers = allUsers;

  if (actor.role === "developer") {
    return cleanUsers;
  }
  if (factory === "trangkil") {
    return cleanUsers.filter(u => u.username.toLowerCase().includes("trangkil"));
  }
  if (factory === "kebonagung") {
    return cleanUsers.filter(u => u.username.toLowerCase().includes("kebonagung") || u.username.toLowerCase().includes("malang"));
  }
  return cleanUsers.filter(u => u.role !== "developer");
});

app.post("/api/users", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  const parsed = userInput.safeParse(request.body); if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const role = (await auth.listRoles()).find(r => r.id === parsed.data.roleId);
  if (!role) return reply.code(400).send({ message: "Role tidak ditemukan" });
  if (actor.role !== "developer" && (role.code === "developer" || role.permissions.some(permission => !actor.permissions.includes(permission)))) return reply.code(403).send({ message: "Tidak diizinkan memberikan hak akses yang lebih tinggi" });
  try { return await auth.createUser(parsed.data); } catch { return reply.code(409).send({ message: "Username sudah digunakan" }); }
});

app.patch("/api/users/:id", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  const id = Number((request.params as { id: string }).id);
  const parsed = userInput.pick({ roleId: true, active: true, password: true }).partial().safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const target = (await auth.listUsers()).find(u => u.id === id); if (!target) return reply.code(404).send({ message: "User tidak ditemukan" });
  const role = (await auth.listRoles()).find(r => r.id === (parsed.data.roleId ?? target.roleId));
  if (!role) return reply.code(400).send({ message: "Role tidak ditemukan" });
  if (actor.role !== "developer" && (target.role === "developer" || role.code === "developer" || role.permissions.some(permission => !actor.permissions.includes(permission)))) return reply.code(403).send({ message: "Tidak diizinkan mengubah akun developer atau memberikan hak akses lebih tinggi" });
  if (actor.id === id && parsed.data.active === false) return reply.code(400).send({ message: "Tidak dapat menonaktifkan akun sendiri" });
  if (target.role === "developer" && (parsed.data.active === false || role.code !== "developer")) {
    const developers = (await auth.listUsers()).filter(u => u.role === "developer" && u.active);
    if (developers.length <= 1) return reply.code(400).send({ message: "Developer aktif terakhir tidak dapat dinonaktifkan" });
  }
  return auth.updateUser(id, parsed.data);
});

// Endpoint Verifikasi Persetujuan 2FA Direksi / Admin
app.post("/api/auth/verify-admin", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  const body = (request.body as { password?: string; reason?: string }) ?? {};
  if (!body.password) {
    return reply.code(400).send({ message: "Password atau PIN Otorisasi Direksi wajib diisi" });
  }
  const factory = getFactoryFilter(actor.username);
  const admin = await auth.verifyAdmin(factory, body.password);
  if (!admin) {
    return reply.code(401).send({ message: "Password / PIN Otorisasi Direksi tidak valid" });
  }
  return {
    ok: true,
    admin: {
      id: admin.id,
      username: admin.username,
      role: admin.role
    },
    message: `Otorisasi disetujui oleh Direksi / Admin (${admin.username})`
  };
});

// Helper Otorisasi Penghapusan: Operator dilarang menghapus langsung, wajib melalui permohonan persetujuan Direksi
async function checkAdminApproval(request: FastifyRequest, actor: User, reply: FastifyReply): Promise<boolean> {
  if (actor.role === "admin" || actor.role === "developer") {
    return true; // Direksi / Developer memiliki otoritas langsung
  }
  
  // Operator DILARANG menghapus secara langsung
  reply.code(403).send({
    error: "APPROVAL_REQUIRED",
    message: "Akun Operator tidak dapat menghapus data mutu secara sepihak. Silakan ajukan permohonan penghapusan kepada Direksi / Admin melalui tombol Ajukan Penghapusan."
  });
  return false;
}

// ─── Fitur Pengajuan & Otorisasi Penghapusan (Maker-Checker / Persetujuan Direksi) ───
app.get("/api/deletion-requests", async (request) => {
  const user = await currentUser(request.headers.authorization);
  const factory = user ? getFactoryFilter(user.username) : "all";
  return store.listDeletionRequests(factory);
});

const createDeletionRequestInput = z.object({
  targetType: z.enum(["inference", "truck_inspection", "all_inferences"]),
  targetId: z.union([z.number(), z.string()]),
  targetTitle: z.string().min(1).max(250),
  targetSubtitle: z.string().max(250).optional(),
  snapshotPath: z.string().max(500).optional(),
  reason: z.string().min(1).max(250),
  notes: z.string().max(1000).optional()
});

app.post("/api/deletion-requests", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  const parsed = createDeletionRequestInput.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

  const factory = getFactoryFilter(actor.username);
  const input = parsed.data;
  if (input.targetType === "truck_inspection" && !z.string().uuid().safeParse(input.targetId).success)
    return reply.code(400).send({ message: "ID inspeksi tidak valid" });
  if (input.targetType === "inference" && !z.coerce.number().int().positive().safeParse(input.targetId).success)
    return reply.code(400).send({ message: "ID inferensi tidak valid" });
  if (input.targetType !== "all_inferences") {
    const target = input.targetType === "truck_inspection"
      ? await trucks.get(String(input.targetId))
      : await store.getInference(Number(input.targetId));
    if (!target) return reply.code(404).send({ message: "Data yang diajukan tidak ditemukan" });
    const allowed = await factoryCameraIds(actor);
    const cameraId = "line" in target ? target.line : target.cameraId;
    if (allowed && !allowed.includes(cameraId)) return reply.code(403).send({ message: "Data berada di luar akses pabrik" });
  }
  const created = await store.createDeletionRequest({
    ...parsed.data,
    factory,
    requestedBy: actor.username
  });

  broadcast("deletion_request.created", created);
  return created;
});

const reviewDeletionRequestInput = z.object({
  decision: z.enum(["approved", "rejected"]),
  reviewNotes: z.string().max(1000).optional()
});

app.post("/api/deletion-requests/:id/review", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  if (actor.role !== "admin" && actor.role !== "developer") {
    return reply.code(403).send({
      message: "Hanya Akun Admin (Direksi) yang berwenang menyetujui atau menolak permohonan penghapusan."
    });
  }

  const { id } = request.params as { id: string };
  const parsed = reviewDeletionRequestInput.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

  const reviewed = await store.reviewDeletionRequest(
    id,
    parsed.data.decision,
    actor.username,
    parsed.data.reviewNotes,
    getFactoryFilter(actor.username)
  );

  if (!reviewed) {
    return reply.code(404).send({ message: "Permohonan penghapusan tidak ditemukan" });
  }

  if (reviewed.status === "approved") {
    if (reviewed.targetType === "truck_inspection") {
      broadcast("truck.deleted", { id: String(reviewed.targetId) });
    } else if (reviewed.targetType === "inference") {
      broadcast("inference.deleted", { id: Number(reviewed.targetId) });
    } else if (reviewed.targetType === "all_inferences") {
      broadcast("inference.cleared", {});
    }
  }

  broadcast("deletion_request.reviewed", reviewed);
  return { ok: true, request: reviewed };
});

app.get("/api/system/status", async () => {
  let ai = { status: "offline" };
  try {
    const response = await fetch(`${config.aiServiceUrl}/health`, { signal: AbortSignal.timeout(5000) });
    ai = response.ok ? await response.json() : { status: "degraded" };
  } catch {
    ai = { status: "offline" };
  }

  return {
    backend: { status: "ok" },
    ai,
    database: { status: store.databaseStatus() === "postgresql" ? "ok" : "dev-memory" },
    websocket: { clients: clients.size }
  };
});

const cameraSchema = z.object({
  name: z.string().min(1),
  rtspUrl: z.string().min(1),
  location: z.string().default("")
});

app.get("/api/cameras", async (request) => {
  const user = await currentUser(request.headers.authorization);
  const factory = user ? getFactoryFilter(user.username) : "all";
  const allCameras = await store.listCameras();
  if (factory === "kebonagung") {
    return allCameras.filter(c => {
      const t = `${c.name} ${c.location}`.toLowerCase();
      return t.includes("kebon agung") || t.includes("malang");
    });
  }
  if (factory === "trangkil") {
    return allCameras.filter(c => {
      const t = `${c.name} ${c.location}`.toLowerCase();
      return t.includes("trangkil");
    });
  }
  return allCameras;
});

app.post("/api/cameras", async (request, reply) => {
  const parsed = cameraSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const camera = await store.createCamera(parsed.data);
  // Register with Python streaming service
  fetch(`${config.aiServiceUrl}/cameras/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ camera_id: camera.id, rtsp_url: camera.rtspUrl, camera_name: camera.name })
  }).catch(() => {});
  broadcast("camera.created", camera);
  return camera;
});

app.put("/api/cameras/:id", async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const parsed = cameraSchema.partial().extend({ status: z.enum(["online", "offline"]).optional() }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const camera = await store.updateCamera(id, parsed.data);
  if (!camera) return reply.code(404).send({ message: "Camera not found" });
  if (camera.rtspUrl) {
    fetch(`${config.aiServiceUrl}/cameras/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ camera_id: camera.id, rtsp_url: camera.rtspUrl, camera_name: camera.name })
    }).catch(() => {});
  }
  broadcast("camera.updated", camera);
  return camera;
});

app.delete("/api/cameras/:id", async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!(await store.deleteCamera(id))) return reply.code(404).send({ message: "Camera not found" });
  broadcast("camera.deleted", { id });
  return { ok: true };
});

// Video Stream Proxy from Python MJPEG Streamer
app.get("/api/cameras/:id/stream", async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = request.raw.url?.split("?")[1] ?? "";
  const targetUrl = `${config.aiServiceUrl}/stream/${id}${query ? `?${query}` : ""}`;
  try {
    const upstream = await fetch(targetUrl);
    if (!upstream.ok || !upstream.body) {
      return reply.code(upstream.status).send({ message: "Stream tidak tersedia" });
    }
    reply.raw.setHeader("Content-Type", upstream.headers.get("content-type") ?? "multipart/x-mixed-replace; boundary=frame");
    reply.raw.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    reply.raw.setHeader("Connection", "close");
    const nodeStream = Readable.fromWeb(upstream.body as any);
    return reply.send(nodeStream);
  } catch {
    return reply.code(502).send({ message: "Gagal terhubung ke AI video stream service" });
  }
});

// Reconnect Stream Trigger
app.post("/api/cameras/:id/reconnect", async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const upstream = await fetch(`${config.aiServiceUrl}/stream/${id}/reconnect`, { method: "POST", signal: AbortSignal.timeout(10000) });
    return reply.send({ ok: upstream.ok });
  } catch {
    return reply.send({ ok: false });
  }
});

// Snapshot Proxy from Python
app.get("/api/cameras/:id/snapshot", async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = request.raw.url?.split("?")[1] ?? "";
  const targetUrl = `${config.aiServiceUrl}/snapshot/${id}${query ? `?${query}` : ""}`;
  try {
    const upstream = await fetch(targetUrl);
    if (!upstream.ok) return reply.code(upstream.status).send({ message: "Snapshot tidak tersedia" });
    const buf = Buffer.from(await upstream.arrayBuffer());
    reply.header("Content-Type", "image/jpeg");
    return reply.send(buf);
  } catch {
    return reply.code(502).send({ message: "Gagal mengambil snapshot dari AI service" });
  }
});

// ROI Get & Update Proxy
app.get("/api/cameras/:id/roi", async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const res = await fetch(`${config.aiServiceUrl}/roi/${id}`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return reply.code(res.status).send(data);
  } catch {
    return reply.code(502).send({ message: "Gagal memuat konfigurasi ROI" });
  }
});

app.post("/api/cameras/:id/roi", async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const res = await fetch(`${config.aiServiceUrl}/roi/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    return reply.code(res.status).send(data);
  } catch {
    return reply.code(502).send({ message: "Gagal menyimpan konfigurasi ROI" });
  }
});

// Trigger Live Capture & AI Inference on Camera
app.post("/api/cameras/:id/capture", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  if (actor.role === "admin") {
    return reply.code(403).send({ message: "Akun Admin (Direksi) dibatasi dari pemicuan pemindaian manual. Pemicuan pemindaian hanya dilakukan oleh Akun Operator lapangan." });
  }
  const id = Number((request.params as { id: string }).id);
  let camera = (await store.listCameras()).find(c => c.id === id);
  if (!camera) {
    const fallback = DEFAULT_CAMERAS.find(c => c.id === id);
    if (fallback) {
      camera = await store.createCamera(fallback);
    }
  }
  if (!camera) return reply.code(404).send({ message: "Kamera tidak ditemukan" });

  if ((await trucks.list()).some(cycle => cycle.line === id && cycle.status === "active")) return reply.code(409).send({ message: "Capture otomatis satu detik sedang berjalan; tidak perlu capture manual tambahan" });
  try {
    const aiRes = await fetch(`${config.aiServiceUrl}/infer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ camera_id: id, crop_roi: true })
    });

    if (!aiRes.ok) return reply.code(502).send({ message: "Gagal memproses inferensi AI" });
    const data = await aiRes.json() as {
      classes: { daun?: number; pucuk?: number; sampah?: number; A?: number; B?: number; T?: number };
      grade?: string;
      detected_class?: string;
      confidence: number;
      snapshot_path: string;
      timestamp: string;
    };

    // Match the existing AI engine's A/B/T mapping used by its grading rule.
    const classes = {
      daun: data.classes.daun ?? data.classes.A,
      pucuk: data.classes.pucuk ?? data.classes.B,
      sampah: data.classes.sampah ?? data.classes.T,
    };
    const validatedClasses = z.object({
      daun: z.number().finite().min(0).max(100),
      pucuk: z.number().finite().min(0).max(100),
      sampah: z.number().finite().min(0).max(100),
    }).safeParse(classes);
    if (!validatedClasses.success) return reply.code(502).send({ message: "Format keluaran kelas AI tidak valid" });
    const grade = data.detected_class && ["S", "M", "A", "D", "B", "T", "G", "X"].includes(data.detected_class)
      ? data.detected_class as import("./rule-engine.js").Grade : calculateGrade(validatedClasses.data);

    const added = await store.addInference({
      cameraId: id,
      grade,
      classes: validatedClasses.data,
      confidence: data.confidence,
      snapshot: `/${data.snapshot_path}`,
      timestamp: data.timestamp
    });

    broadcast("inference.created", added);
    return reply.send(added);
  } catch (err) {
    return reply.code(500).send({ message: "Gagal menjalankan capture", detail: String(err) });
  }
});

app.get("/api/models", async () => await store.listModels());

app.post("/api/models/upload", async (request, reply) => {
  const parts = request.parts();
  let name = "", version = "", path = "";
  const archive = new URL("../../../models/archive/", import.meta.url);
  await mkdir(archive, { recursive: true });
  try {
    for await (const part of parts) {
      if (part.type === "field" && part.fieldname === "name") name = String(part.value).trim();
      if (part.type === "field" && part.fieldname === "version") version = String(part.value).trim();
      if (part.type === "file") {
        if (!part.filename.toLowerCase().endsWith(".onnx")) {
          part.file.resume();
          return reply.code(400).send({ message: "File model harus berformat .onnx" });
        }
        const filename = `${randomUUID()}.onnx`;
        path = `models/archive/${filename}`;
        await pipeline(part.file, createWriteStream(new URL(filename, archive), { flags: "wx" }));
        if (part.file.truncated) throw new Error("File model melebihi 200 MB");
      }
    }
    if (!name || !version || !path) {
      if (path) await unlink(new URL(path.split("/").at(-1)!, archive)).catch(() => {});
      return reply.code(400).send({ message: "Nama, versi, dan file model wajib diisi" });
    }
    const model = await store.addModel({ name, version, path });
    broadcast("model.created", model);
    return model;
  } catch (error) {
    if (path) await unlink(new URL(path.split("/").at(-1)!, archive)).catch(() => {});
    throw error;
  }
});

app.post("/api/models/activate", async (request, reply) => {
  const parsed = z.object({ id: z.number().int().positive() }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const model = await store.activateModel(parsed.data.id, async selected => {
    const response = await fetch(`${config.aiServiceUrl}/models/activate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: selected.name, version: selected.version, model_path: selected.path }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw Object.assign(new Error("Model tidak dapat diaktifkan oleh AI service"), { statusCode: 502 });
  });
  if (!model) return reply.code(404).send({ message: "Model not found" });
  broadcast("model.activated", model);
  return model;
});

app.get("/api/inference/latest", async (request) => {
  const user = await currentUser(request.headers.authorization);
  const factory = user ? getFactoryFilter(user.username) : "all";
  if (factory === "all") return await store.latestInference();
  const allCameras = await store.listCameras();
  const allowedCameraIds = new Set(
    allCameras
      .filter(c => {
        const t = `${c.name} ${c.location}`.toLowerCase();
        return factory === "kebonagung" ? (t.includes("kebon agung") || t.includes("malang")) : t.includes("trangkil");
      })
      .map(c => c.id)
  );
  const history = await store.listInference();
  return history.find(item => allowedCameraIds.has(item.cameraId)) ?? null;
});

app.get("/api/inference/history", async (request) => {
  await store.syncModelCaptures();
  const user = await currentUser(request.headers.authorization);
  const factory = user ? getFactoryFilter(user.username) : "all";
  const history = await store.listInference();
  if (factory === "all") return history;
  const allCameras = await store.listCameras();
  const allowedCameraIds = new Set(
    allCameras
      .filter(c => {
        const t = `${c.name} ${c.location}`.toLowerCase();
        return factory === "kebonagung" ? (t.includes("kebon agung") || t.includes("malang")) : t.includes("trangkil");
      })
      .map(c => c.id)
  );
  return history.filter(item => allowedCameraIds.has(item.cameraId));
});

app.get("/api/inference/model-frames", async (request) => {
  const user = await currentUser(request.headers.authorization);
  const factory = user ? getFactoryFilter(user.username) : "all";
  const history = await store.listModelFrames();
  if (factory === "all") return history;
  const allCameras = await store.listCameras();
  const allowedCameraIds = new Set(
    allCameras
      .filter(c => {
        const t = `${c.name} ${c.location}`.toLowerCase();
        return factory === "kebonagung" ? (t.includes("kebon agung") || t.includes("malang")) : t.includes("trangkil");
      })
      .map(c => c.id)
  );
  return history.filter(item => allowedCameraIds.has(item.cameraId));
});

app.delete("/api/inference/:id", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  if (!(await checkAdminApproval(request, actor, reply))) return;
  const id = Number((request.params as { id: string }).id);
  if (!(await store.deleteInference(id))) return reply.code(404).send({ message: "Data inferensi tidak ditemukan" });
  broadcast("inference.deleted", { id });
  return { ok: true, id };
});

app.delete("/api/inference", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  if (!(await checkAdminApproval(request, actor, reply))) return;
  await store.clearAllInferences(await factoryCameraIds(actor));
  broadcast("inference.cleared", {});
  return { ok: true };
});

const truckInput = z.object({ truckCode: z.string().trim().min(1).max(100), plateNumber: z.string().max(30).optional(), driverName: z.string().max(100).optional(), supplier: z.string().max(150).optional(), line: z.number().int().positive(), notes: z.string().max(2000).optional() });
app.get("/api/truck-inspections", async (request) => {
  const user = await currentUser(request.headers.authorization);
  const factory = user ? getFactoryFilter(user.username) : "all";
  const allTrucks = await trucks.list();
  if (factory === "all") return allTrucks;
  const allCameras = await store.listCameras();
  const allowedCameraIds = new Set(
    allCameras
      .filter(c => {
        const t = `${c.name} ${c.location}`.toLowerCase();
        return factory === "kebonagung" ? (t.includes("kebon agung") || t.includes("malang")) : t.includes("trangkil");
      })
      .map(c => c.id)
  );
  return allTrucks.filter(t => allowedCameraIds.has(t.line));
});
app.post("/api/truck-inspections", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  if (actor.role === "admin") {
    return reply.code(403).send({ message: "Akun Admin (Direksi) dibatasi dari kontrol fisik conveyor. Hanya Akun Operator lapangan yang dapat memulai siklus pemindaian." });
  }
  const parsed = truckInput.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const allCams = await store.listCameras();
  const camera = allCams.find(item => item.id === parsed.data.line) ||
                 (parsed.data.line === 5 ? allCams.find(item => item.name.includes("MBS 5") || item.id === 2) : null);
  if (!camera) return reply.code(400).send({ message: "Kamera/jalur tidak ditemukan" });
  let created;
  try { created = await trucks.create({ ...parsed.data, line: camera.id }); }
  catch (error) {
    if ((error as { code?: string }).code === "23505") return reply.code(409).send({ message: "Masih ada inspeksi aktif pada jalur ini" });
    throw error;
  }

  // Notify AI Engine in database sugarcane_ai to start cycle scanning
  try {
    const started = await fetch(`${config.aiServiceUrl}/cycle/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ camera_id: camera.id, cycle_code: created.id }),
      signal: AbortSignal.timeout(30000)
    });
    if (!started.ok) throw new Error(`AI start failed: ${started.status}`);
  } catch (err) {
    await trucks.delete(created.id);
    return reply.code(502).send({ message: "AI service gagal memulai siklus", detail: String(err) });
  }

  broadcast("truck.created", created);
  return created;
});
app.patch("/api/truck-inspections/:id/complete", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  if (actor.role === "admin") {
    return reply.code(403).send({ message: "Akun Admin (Direksi) dibatasi dari kontrol fisik conveyor. Penghentian siklus dilakukan oleh Akun Operator lapangan." });
  }
  const id = (request.params as { id: string }).id;
  if (!z.string().uuid().safeParse(id).success) return reply.code(400).send({ message: "ID inspeksi tidak valid" });
  const parsed = z.object({ notes: z.string().max(2000).optional() }).safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const active = await trucks.get(id);
  if (!active || active.status !== "active") return reply.code(404).send({ message: "Inspeksi aktif tidak ditemukan" });

  // Notify AI Engine in database sugarcane_ai to stop cycle scanning & aggregate ai_results
  try {
    const stopped = await fetch(`${config.aiServiceUrl}/cycle/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cycle_code: id }),
      signal: AbortSignal.timeout(35000)
    });
    if (!stopped.ok) throw new Error(`AI stop failed: ${stopped.status}`);
  } catch (err) {
    return reply.code(502).send({ message: "AI service belum berhasil menghentikan siklus; ulangi Stop", detail: String(err) });
  }

  await store.syncModelCaptures();
  const completed = await trucks.complete(id, parsed.data.notes);
  broadcast("truck.completed", completed);
  return completed;
});
app.post("/api/truck-inspections/sync-tapping", async (request, reply) => {
  const syncSchema = z.object({
    matches: z.array(z.object({
      id: z.string().uuid(),
      truckCode: z.string().trim().min(1).max(100).optional(),
      plateNumber: z.string().max(30).optional(),
      driverName: z.string().max(100).optional(),
      supplier: z.string().max(150).optional(),
      notes: z.string().max(2000).optional()
    })).min(1).max(500).refine(matches => new Set(matches.map(item => item.id)).size === matches.length, "ID inspeksi duplikat")
  });
  const parsed = syncSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const results = await trucks.batchSync(parsed.data.matches);
  broadcast("truck.synced", { count: results.length });
  return { success: true, count: results.length, data: results };
});
app.patch("/api/truck-inspections/:id", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const patchSchema = z.object({
    truckCode: z.string().trim().min(1).max(100).optional(),
    plateNumber: z.string().max(30).optional(),
    driverName: z.string().max(100).optional(),
    supplier: z.string().max(150).optional(),
    notes: z.string().max(2000).optional()
  });
  const parsed = patchSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const updated = await trucks.update(id, parsed.data);
  if (!updated) return reply.code(404).send({ message: "Inspeksi tidak ditemukan" });
  broadcast("truck.updated", updated);
  return updated;
});
app.delete("/api/truck-inspections", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  if (!(await checkAdminApproval(request, actor, reply))) return;
  await trucks.clearAll(await factoryCameraIds(actor));
  broadcast("truck.cleared", {});
  return { ok: true };
});
app.delete("/api/truck-inspections/:id", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  if (!(await checkAdminApproval(request, actor, reply))) return;
  const id = (request.params as { id: string }).id;
  if (!id || id.trim() === "") return reply.code(400).send({ message: "ID inspeksi tidak valid" });
  if (!(await trucks.delete(id))) return reply.code(404).send({ message: "Inspeksi tidak ditemukan" });
  broadcast("truck.deleted", { id });
  return { ok: true };
});

if (process.env.API_TEST_MODE !== "true") {
  await store.syncModelCaptures();
  let syncRunning = false;
  const syncTimer = setInterval(async () => {
    if (syncRunning) return;
    syncRunning = true;
    try { if (await store.syncModelCaptures()) broadcast("inference.synced", {}); }
    catch (error) { app.log.error(error, "AI capture synchronization failed"); }
    finally { syncRunning = false; }
  }, 1000);
  syncTimer.unref();
  app.addHook("onClose", async () => clearInterval(syncTimer));
}
export { app };
if (process.env.API_TEST_MODE !== "true") await app.listen({ host: config.host, port: config.port });

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

const app = Fastify({ logger: { redact: { paths: ["req.url"], censor: "[redacted]" } } });
const clients = new Set<{ send: (payload: string) => void }>();

await store.initialize();
await auth.initialize();

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 1 } });
await app.register(websocket);

const access: Record<string, Permission> = {
  "GET /api/system/status": "dashboard.read", "GET /api/cameras": "camera.read", "POST /api/cameras": "camera.write",
  "PUT /api/cameras/:id": "camera.write", "DELETE /api/cameras/:id": "camera.write", "GET /api/models": "model.read",
  "POST /api/models/upload": "model.write", "POST /api/models/activate": "model.write",
  "GET /api/inference/latest": "dashboard.read", "GET /api/inference/history": "history.read",
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
  "DELETE /api/inference/:id": "inspection.write",
  "DELETE /api/inference": "inspection.write"
};

app.addHook("preHandler", async (request, reply) => {
  const url = request.url;
  // Exempt public stream/snapshot/health/auth endpoints
  if (
    url === "/health" ||
    url === "/api/auth/login" ||
    url.startsWith("/ws") ||
    url.includes("/stream") ||
    url.includes("/reconnect") ||
    url.includes("/snapshot") ||
    url.startsWith("/storage/snapshots")
  ) {
    return;
  }

  const token = request.headers.authorization?.replace(/^Bearer /i, "") ?? "";
  const user = await auth.current(token);
  if (!user) return reply.code(401).send({ message: "Sesi tidak valid atau telah berakhir" });
  const key = `${request.method} ${request.routeOptions.url ?? request.url.split("?")[0]}`;
  if (key === "GET /api/auth/me" || key.endsWith("/roi")) return;
  const permission = access[key];
  if (!permission || !user.permissions.includes(permission)) return reply.code(403).send({ message: "Akses ditolak" });
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
app.get("/storage/snapshots/:filename", async (request, reply) => {
  const { filename } = request.params as { filename: string };
  const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, "");
  const filePath = join(snapshotsDir, safeName);
  try {
    const file = await readFile(filePath);
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
  return session;
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
const roleInput = z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{2,49}$/), name: z.string().min(2).max(100), description: z.string().max(500).default(""), permissions: z.array(z.enum(PERMISSIONS)).default([]) });
app.get("/api/roles", async request => auth.listVisibleRoles((await currentUser(request.headers.authorization))!));
app.post("/api/roles", async (request, reply) => {
  const parsed = roleInput.safeParse(request.body); if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  try { return await auth.createRole({ ...parsed.data, permissions: [...new Set(parsed.data.permissions)] }); }
  catch { return reply.code(409).send({ message: "Kode role sudah digunakan" }); }
});
app.put("/api/roles/:id", async (request, reply) => {
  const parsed = roleInput.omit({ code: true }).safeParse(request.body); if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
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
  
  // Sembunyikan alias internal singkat agar tabel rapi menampilkan 2 akun per PT
  const cleanUsers = allUsers.filter(u => u.username !== "trangkil" && u.username !== "kebonagung" && u.username !== "admin");

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
  if (actor.role !== "developer" && role.code === "developer") return reply.code(403).send({ message: "Hanya developer yang dapat membuat akun developer" });
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
  if (actor.role !== "developer" && role.code === "developer") return reply.code(403).send({ message: "Tidak diizinkan mengubah ke role developer" });
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
    parsed.data.reviewNotes
  );

  if (!reviewed) {
    return reply.code(404).send({ message: "Permohonan penghapusan tidak ditemukan" });
  }

  if (reviewed.status === "approved") {
    if (reviewed.targetType === "truck_inspection") {
      await trucks.delete(String(reviewed.targetId));
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
    const response = await fetch(`${config.aiServiceUrl}/health`);
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
    const upstream = await fetch(`${config.aiServiceUrl}/stream/${id}/reconnect`, { method: "POST" });
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
    const res = await fetch(`${config.aiServiceUrl}/roi/${id}`);
    const data = await res.json();
    return reply.send(data);
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
      body: JSON.stringify(request.body)
    });
    const data = await res.json();
    return reply.send(data);
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

  try {
    const aiRes = await fetch(`${config.aiServiceUrl}/infer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ camera_id: id, crop_roi: true })
    });

    if (!aiRes.ok) return reply.code(502).send({ message: "Gagal memproses inferensi AI" });
    const data = await aiRes.json() as {
      classes: { daun: number; pucuk: number; sampah: number };
      grade?: string;
      confidence: number;
      snapshot_path: string;
      timestamp: string;
    };

    const grade = calculateGrade(data.classes);

    const added = await store.addInference({
      cameraId: id,
      grade,
      classes: data.classes,
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
  const parsed = z.object({ id: z.number() }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const model = await store.activateModel(parsed.data.id);
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

app.delete("/api/inference/:id", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  if (!(await checkAdminApproval(request, actor, reply))) return;
  const id = Number((request.params as { id: string }).id);
  await store.deleteInference(id);
  broadcast("inference.deleted", { id });
  return { ok: true, id };
});

app.delete("/api/inference", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  if (!(await checkAdminApproval(request, actor, reply))) return;
  await store.clearAllInferences();
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
  const completed = await trucks.complete(id, parsed.data.notes);
  if (!completed) return reply.code(404).send({ message: "Inspeksi aktif tidak ditemukan" });
  broadcast("truck.completed", completed);
  return completed;
});
app.post("/api/truck-inspections/sync-tapping", async (request, reply) => {
  const syncSchema = z.object({
    matches: z.array(z.object({
      id: z.string(),
      truckCode: z.string().optional(),
      plateNumber: z.string().optional(),
      driverName: z.string().optional(),
      supplier: z.string().optional(),
      notes: z.string().optional()
    }))
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
    truckCode: z.string().optional(),
    plateNumber: z.string().optional(),
    driverName: z.string().optional(),
    supplier: z.string().optional(),
    notes: z.string().optional()
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
  await trucks.clearAll();
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

app.listen({ host: config.host, port: config.port });

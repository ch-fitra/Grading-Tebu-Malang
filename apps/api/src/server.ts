import "./env.js";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { config } from "./config.js";
import { store } from "./store.js";
import { auth, PERMISSIONS, type Permission } from "./auth.js";
import { trucks } from "./trucks.js";

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
  "GET /api/roles": "role.read", "POST /api/roles": "role.write", "PUT /api/roles/:id": "role.write", "DELETE /api/roles/:id": "role.write",
  "GET /api/truck-inspections": "history.read", "POST /api/truck-inspections": "inspection.write",
  "PATCH /api/truck-inspections/:id/complete": "inspection.write", "DELETE /api/truck-inspections/:id": "inspection.write"
};
app.addHook("preHandler", async (request, reply) => {
  if (request.url === "/health" || request.url === "/api/auth/login" || request.url.startsWith("/ws")) return;
  const token = request.headers.authorization?.replace(/^Bearer /i, "") ?? "";
  const user = await auth.current(token);
  if (!user) return reply.code(401).send({ message: "Sesi tidak valid atau telah berakhir" });
  const key = `${request.method} ${request.routeOptions.url ?? request.url.split("?")[0]}`;
  if (key === "GET /api/auth/me") return;
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
const safeForAdmin = (permissions: Permission[]) => !permissions.some(p => ["user.read", "user.write", "role.read", "role.write", "model.write", "settings.read"].includes(p));
app.get("/api/users", async (request) => {
  const actor = (await currentUser(request.headers.authorization))!;
  const users = await auth.listUsers(); return actor.role === "developer" ? users : users.filter(u => u.role !== "developer" && safeForAdmin(u.permissions));
});
app.post("/api/users", async (request, reply) => {
  const actor = (await currentUser(request.headers.authorization))!;
  const parsed = userInput.safeParse(request.body); if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const role = (await auth.listRoles()).find(r => r.id === parsed.data.roleId);
  if (!role) return reply.code(400).send({ message: "Role tidak ditemukan" });
  if (actor.role !== "developer" && !safeForAdmin(role.permissions)) return reply.code(403).send({ message: "Admin hanya dapat membuat pengguna operasional" });
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
  if (actor.role !== "developer" && (!safeForAdmin(target.permissions) || !safeForAdmin(role.permissions))) return reply.code(403).send({ message: "Admin hanya dapat mengelola pengguna operasional" });
  if (actor.id === id && parsed.data.active === false) return reply.code(400).send({ message: "Tidak dapat menonaktifkan akun sendiri" });
  if (target.role === "developer" && (parsed.data.active === false || role.code !== "developer")) {
    const developers = (await auth.listUsers()).filter(u => u.role === "developer" && u.active);
    if (developers.length <= 1) return reply.code(400).send({ message: "Developer aktif terakhir tidak dapat dinonaktifkan" });
  }
  return auth.updateUser(id, parsed.data);
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
    database: { status: store.databaseStatus() },
    websocket: { clients: clients.size }
  };
});

const cameraSchema = z.object({
  name: z.string().min(1),
  rtspUrl: z.string().min(1),
  location: z.string().default("")
});

app.get("/api/cameras", async () => await store.listCameras());

app.post("/api/cameras", async (request, reply) => {
  const parsed = cameraSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const camera = await store.createCamera(parsed.data);
  broadcast("camera.created", camera);
  return camera;
});

app.put("/api/cameras/:id", async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const parsed = cameraSchema.partial().extend({ status: z.enum(["online", "offline"]).optional() }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const camera = await store.updateCamera(id, parsed.data);
  if (!camera) return reply.code(404).send({ message: "Camera not found" });
  broadcast("camera.updated", camera);
  return camera;
});

app.delete("/api/cameras/:id", async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!(await store.deleteCamera(id))) return reply.code(404).send({ message: "Camera not found" });
  broadcast("camera.deleted", { id });
  return { ok: true };
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

app.get("/api/inference/latest", async () => await store.latestInference());
app.get("/api/inference/history", async () => await store.listInference());

const truckInput = z.object({ truckCode: z.string().trim().min(1).max(100), plateNumber: z.string().max(30).optional(), driverName: z.string().max(100).optional(), supplier: z.string().max(150).optional(), line: z.number().int().positive(), notes: z.string().max(2000).optional() });
app.get("/api/truck-inspections", async () => trucks.list());
app.post("/api/truck-inspections", async (request, reply) => {
  const parsed = truckInput.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const camera = (await store.listCameras()).find(item => item.id === parsed.data.line);
  if (!camera) return reply.code(400).send({ message: "Kamera/jalur tidak ditemukan" });
  let created;
  try { created = await trucks.create(parsed.data); }
  catch (error) {
    if ((error as { code?: string }).code === "23505") return reply.code(409).send({ message: "Masih ada inspeksi aktif pada jalur ini" });
    throw error;
  }
  broadcast("truck.created", created);
  return created;
});
app.patch("/api/truck-inspections/:id/complete", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  if (!z.string().uuid().safeParse(id).success) return reply.code(400).send({ message: "ID inspeksi tidak valid" });
  const parsed = z.object({ notes: z.string().max(2000).optional() }).safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const completed = await trucks.complete(id, parsed.data.notes);
  if (!completed) return reply.code(404).send({ message: "Inspeksi aktif tidak ditemukan" });
  broadcast("truck.completed", completed);
  return completed;
});
app.delete("/api/truck-inspections/:id", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  if (!z.string().uuid().safeParse(id).success) return reply.code(400).send({ message: "ID inspeksi tidak valid" });
  if (!(await trucks.delete(id))) return reply.code(404).send({ message: "Inspeksi tidak ditemukan" });
  broadcast("truck.deleted", { id });
  return { ok: true };
});

app.listen({ host: config.host, port: config.port });

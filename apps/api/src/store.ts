import "./env.js";
import pg from "pg";
import type { ClassPercentages, Grade } from "./rule-engine.js";

export type Camera = { id: number; name: string; rtspUrl: string; location: string; status: "online" | "offline"; createdAt: string };
export type AiModel = { id: number; name: string; version: string; path: string; active: boolean; createdAt: string };
export type InferenceResult = { id: number; timestamp: string; cameraId: number; classes: Required<Pick<ClassPercentages, "daun" | "pucuk" | "sampah">>; grade: Grade; confidence: number; snapshot: string | null };
export type DeletionRequest = {
  id: string;
  targetType: "inference" | "truck_inspection" | "all_inferences";
  targetId: number | string;
  targetTitle: string;
  targetSubtitle?: string;
  snapshotPath?: string;
  factory: "trangkil" | "kebonagung" | "all";
  requestedBy: string;
  requestedAt: string;
  reason: string;
  notes?: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
};

const now = () => new Date().toISOString();
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
let connected = false;
let nextCameraId = 2, nextModelId = 2, nextInferenceId = 1;
const cameras: Camera[] = [];
const models: AiModel[] = [];
const inferenceResults: InferenceResult[] = [];
const deletionRequests: DeletionRequest[] = [];

const cameraRow = (r: Record<string, unknown>): Camera => ({ id: Number(r.id), name: String(r.name), rtspUrl: String(r.rtsp_url), location: String(r.location ?? ""), status: r.status as Camera["status"], createdAt: new Date(String(r.created_at)).toISOString() });
const modelRow = (r: Record<string, unknown>): AiModel => ({ id: Number(r.id), name: String(r.name), version: String(r.version), path: String(r.path), active: Boolean(r.active), createdAt: new Date(String(r.created_at)).toISOString() });
const inferenceRow = (r: Record<string, unknown>): InferenceResult => ({ id: Number(r.id), timestamp: new Date(String(r.created_at)).toISOString(), cameraId: Number(r.camera_id ?? 0), classes: { daun: Number(r.daun_percent), pucuk: Number(r.pucuk_percent), sampah: Number(r.sampah_percent) }, grade: r.grade as Grade, confidence: Number(r.confidence), snapshot: r.snapshot_path ? String(r.snapshot_path) : null });

export const DEFAULT_CAMERAS: Omit<Camera, "createdAt">[] = [
  { id: 1, name: "MBS 1 - PT Kebon Agung (Malang)", rtspUrl: "rtsp://admin:qc_12345@123.255.202.132:10554/Streaming/Channels/101", location: "PG Kebon Agung (Malang)", status: "online" },
  { id: 2, name: "MBS 5 - PT Trangkil (Wisenet Meja 5)", rtspUrl: "rtsp://admin:XNOAdmin123@192.168.33.86:554/profile2/media.smp", location: "PG Trangkil (Pati)", status: "online" }
];

export const DEFAULT_MODELS: Omit<AiModel, "createdAt">[] = [
  { id: 1, name: "Tebu Segmentation V1", version: "1.0.0", path: "models/active/model.onnx", active: true }
];

export const store = {
  async initialize() {
    if (cameras.length === 0) {
      for (const c of DEFAULT_CAMERAS) {
        cameras.push({ ...c, createdAt: now() });
      }
      nextCameraId = Math.max(...cameras.map(c => c.id), 0) + 1;
    } else {
      // Pastikan di memory tidak tersisa kamera PT Trangkil selain MBS 5
      const validIds = new Set(DEFAULT_CAMERAS.map(c => c.id));
      for (let i = cameras.length - 1; i >= 0; i--) {
        if (!validIds.has(cameras[i].id) && cameras[i].location.toLowerCase().includes("trangkil")) {
          cameras.splice(i, 1);
        }
      }
    }
    if (models.length === 0) {
      for (const m of DEFAULT_MODELS) {
        models.push({ ...m, createdAt: now() });
      }
      nextModelId = Math.max(...models.map(m => m.id), 0) + 1;
    }
    if (!pool) return;
    try {
      await pool.query("SELECT 1");
      connected = true;
      // Khusus PT Trangkil: Hanya kamera MBS 5 (id: 2) yang diizinkan aktif
      await pool.query("DELETE FROM cameras WHERE id IN (3, 4) OR (location ILIKE '%trangkil%' AND id != 2)");
      for (const c of DEFAULT_CAMERAS) {
        const found = await pool.query("SELECT id FROM cameras WHERE id=$1", [c.id]);
        if (!found.rowCount) {
          await pool.query(
            "INSERT INTO cameras(id, name, rtsp_url, location, status) VALUES($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
            [c.id, c.name, c.rtspUrl, c.location, c.status]
          );
        }
      }
      try {
        await pool.query("SELECT setval(pg_get_serial_sequence('cameras', 'id'), coalesce(max(id), 1)) FROM cameras;");
      } catch {}

      for (const m of DEFAULT_MODELS) {
        const found = await pool.query("SELECT id FROM ai_models WHERE id=$1", [m.id]);
        if (!found.rowCount) {
          await pool.query(
            "INSERT INTO ai_models(id, name, version, path, active) VALUES($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
            [m.id, m.name, m.version, m.path, m.active]
          );
        }
      }
      try {
        await pool.query("SELECT setval(pg_get_serial_sequence('ai_models', 'id'), coalesce(max(id), 1)) FROM ai_models;");
      } catch {}
    } catch {
      connected = false;
      console.warn("PostgreSQL offline, running in development memory mode");
    }
  },
  databaseStatus: () => connected ? "postgresql" : "memory-dev",
  async listCameras() {
    if (!connected || !pool) return cameras;
    try {
      const rows = (await pool.query("SELECT * FROM cameras ORDER BY id")).rows.map(cameraRow);
      return rows.length > 0 ? rows : cameras;
    } catch {
      return cameras;
    }
  },
  async createCamera(camera: Omit<Camera, "id" | "createdAt" | "status"> & { id?: number }) {
    const id = camera.id ?? nextCameraId++;
    if (!connected || !pool) {
      const existing = cameras.find(c => c.id === id);
      if (existing) { Object.assign(existing, camera); return existing; }
      const row = { id, status: "online" as const, createdAt: now(), ...camera };
      cameras.push(row);
      return row;
    }
    try {
      return cameraRow((await pool.query("INSERT INTO cameras(id,name,rtsp_url,location,status) VALUES($1,$2,$3,$4,'online') ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, rtsp_url=EXCLUDED.rtsp_url, location=EXCLUDED.location RETURNING *", [id, camera.name, camera.rtspUrl, camera.location])).rows[0]);
    } catch {
      const row = { id, status: "online" as const, createdAt: now(), ...camera };
      cameras.push(row);
      return row;
    }
  },
  async updateCamera(id: number, patch: Partial<Omit<Camera, "id" | "createdAt">>) {
    if (!connected || !pool) { const camera = cameras.find(item => item.id === id); if (!camera) return null; Object.assign(camera, patch); return camera; }
    try {
      const found = await pool.query("SELECT * FROM cameras WHERE id=$1", [id]); if (!found.rowCount) return null;
      const value = { ...cameraRow(found.rows[0]), ...patch };
      return cameraRow((await pool.query("UPDATE cameras SET name=$2,rtsp_url=$3,location=$4,status=$5,updated_at=NOW() WHERE id=$1 RETURNING *", [id, value.name, value.rtspUrl, value.location, value.status])).rows[0]);
    } catch {
      const camera = cameras.find(item => item.id === id); if (!camera) return null; Object.assign(camera, patch); return camera;
    }
  },
  async deleteCamera(id: number) {
    if (!connected || !pool) { const index = cameras.findIndex(item => item.id === id); if (index < 0) return false; cameras.splice(index, 1); return true; }
    try {
      return Boolean((await pool.query("DELETE FROM cameras WHERE id=$1", [id])).rowCount);
    } catch {
      const index = cameras.findIndex(item => item.id === id); if (index < 0) return false; cameras.splice(index, 1); return true;
    }
  },
  async listModels() {
    if (!connected || !pool) return models;
    try {
      const rows = (await pool.query("SELECT * FROM ai_models ORDER BY id")).rows.map(modelRow);
      return rows.length > 0 ? rows : models;
    } catch {
      return models;
    }
  },
  async addModel(model: Omit<AiModel, "id" | "createdAt" | "active">) {
    if (!connected || !pool) { const row = { id: nextModelId++, active: false, createdAt: now(), ...model }; models.push(row); return row; }
    try {
      return modelRow((await pool.query("INSERT INTO ai_models(name,version,path) VALUES($1,$2,$3) RETURNING *", [model.name, model.version, model.path])).rows[0]);
    } catch {
      const row = { id: nextModelId++, active: false, createdAt: now(), ...model }; models.push(row); return row;
    }
  },
  async activateModel(id: number) {
    if (!connected || !pool) { const model = models.find(item => item.id === id); if (!model) return null; models.forEach(item => item.active = item.id === id); return model; }
    try {
      const client = await pool.connect();
      try { await client.query("BEGIN"); await client.query("UPDATE ai_models SET active=FALSE"); const result = await client.query("UPDATE ai_models SET active=TRUE WHERE id=$1 RETURNING *", [id]); await client.query("COMMIT"); return result.rowCount ? modelRow(result.rows[0]) : null; }
      catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    } catch {
      const model = models.find(item => item.id === id); if (!model) return null; models.forEach(item => item.active = item.id === id); return model;
    }
  },
  async latestInference() {
    if (!connected || !pool) return inferenceResults.at(-1) ?? null;
    try {
      const result = await pool.query("SELECT * FROM inference_results ORDER BY created_at DESC LIMIT 1");
      return result.rowCount ? inferenceRow(result.rows[0]) : (inferenceResults.at(-1) ?? null);
    } catch {
      return inferenceResults.at(-1) ?? null;
    }
  },
  async listInference() {
    if (!connected || !pool) return inferenceResults.slice().reverse();
    try {
      const rows = (await pool.query("SELECT * FROM inference_results ORDER BY created_at DESC LIMIT 1000")).rows.map(inferenceRow);
      return rows.length > 0 ? rows : inferenceResults.slice().reverse();
    } catch {
      return inferenceResults.slice().reverse();
    }
  },
  async addInference(result: Omit<InferenceResult, "id">) {
    if (!connected || !pool) { const row = { id: nextInferenceId++, ...result }; inferenceResults.push(row); return row; }
    try {
      const sql = "INSERT INTO inference_results(camera_id,grade,daun_percent,pucuk_percent,sampah_percent,confidence,snapshot_path,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *";
      return inferenceRow((await pool.query(sql, [result.cameraId, result.grade, result.classes.daun, result.classes.pucuk, result.classes.sampah, result.confidence, result.snapshot, result.timestamp])).rows[0]);
    } catch (err) {
      console.warn("PostgreSQL addInference fallback to memory:", err);
      const row = { id: nextInferenceId++, ...result };
      inferenceResults.push(row);
      return row;
    }
  },
  async deleteInference(id: number) {
    const idx = inferenceResults.findIndex(item => item.id === id);
    if (idx !== -1) {
      inferenceResults.splice(idx, 1);
    }
    if (connected && pool) {
      try {
        await pool.query("DELETE FROM inference_results WHERE id=$1", [id]);
      } catch (err) {
        console.warn("PostgreSQL deleteInference error:", err);
      }
    }
    return true;
  },
  async clearAllInferences() {
    inferenceResults.length = 0;
    if (connected && pool) {
      try {
        await pool.query("DELETE FROM inference_results");
      } catch (err) {
        console.warn("PostgreSQL clearAllInferences error:", err);
      }
    }
    return true;
  },
  async listDeletionRequests(factory?: "trangkil" | "kebonagung" | "all") {
    if (!factory || factory === "all") return [...deletionRequests];
    return deletionRequests.filter(r => r.factory === factory || r.factory === "all");
  },
  async createDeletionRequest(input: Omit<DeletionRequest, "id" | "status" | "requestedAt">) {
    const record: DeletionRequest = {
      id: "del-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      ...input,
      status: "pending",
      requestedAt: now()
    };
    deletionRequests.unshift(record);
    return record;
  },
  async reviewDeletionRequest(id: string, decision: "approved" | "rejected", reviewer: string, reviewNotes?: string) {
    const req = deletionRequests.find(r => r.id === id);
    if (!req) return null;
    req.status = decision;
    req.reviewedBy = reviewer;
    req.reviewedAt = now();
    if (reviewNotes !== undefined) req.reviewNotes = reviewNotes;

    if (decision === "approved") {
      if (req.targetType === "inference") {
        await this.deleteInference(Number(req.targetId));
      } else if (req.targetType === "all_inferences") {
        await this.clearAllInferences();
      }
    }
    return req;
  },
};


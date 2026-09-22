import "./env.js";
import pg from "pg";
import type { ClassPercentages, Grade } from "./rule-engine.js";

export type Camera = { id: number; name: string; rtspUrl: string; location: string; status: "online" | "offline"; createdAt: string };
export type AiModel = { id: number; name: string; version: string; path: string; active: boolean; createdAt: string };
export type InferenceResult = { id: number; timestamp: string; cameraId: number; classes: Required<Pick<ClassPercentages, "daun" | "pucuk" | "sampah">>; grade: Grade; confidence: number; snapshot: string | null };

const now = () => new Date().toISOString();
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
let connected = false;
let nextCameraId = 2, nextModelId = 2, nextInferenceId = 1;
const cameras: Camera[] = [];
const models: AiModel[] = [];
const inferenceResults: InferenceResult[] = [];

const cameraRow = (r: Record<string, unknown>): Camera => ({ id: Number(r.id), name: String(r.name), rtspUrl: String(r.rtsp_url), location: String(r.location ?? ""), status: r.status as Camera["status"], createdAt: new Date(String(r.created_at)).toISOString() });
const modelRow = (r: Record<string, unknown>): AiModel => ({ id: Number(r.id), name: String(r.name), version: String(r.version), path: String(r.path), active: Boolean(r.active), createdAt: new Date(String(r.created_at)).toISOString() });
const inferenceRow = (r: Record<string, unknown>): InferenceResult => ({ id: Number(r.id), timestamp: new Date(String(r.created_at)).toISOString(), cameraId: Number(r.camera_id ?? 0), classes: { daun: Number(r.daun_percent), pucuk: Number(r.pucuk_percent), sampah: Number(r.sampah_percent) }, grade: r.grade as Grade, confidence: Number(r.confidence), snapshot: r.snapshot_path ? String(r.snapshot_path) : null });

export const store = {
  async initialize() {
    if (!pool) throw new Error("DATABASE_URL wajib diisi. Data operasional hanya boleh memakai PostgreSQL.");
    try { await pool.query("SELECT 1"); connected = true; }
    catch { throw new Error("PostgreSQL tidak dapat dihubungkan. Periksa DATABASE_URL."); }
  },
  databaseStatus: () => connected ? "postgresql" : "memory-dev",
  async listCameras() { if (!connected || !pool) return cameras; return (await pool.query("SELECT * FROM cameras ORDER BY id")).rows.map(cameraRow); },
  async createCamera(camera: Omit<Camera, "id" | "createdAt" | "status">) {
    if (!connected || !pool) { const row = { id: nextCameraId++, status: "offline" as const, createdAt: now(), ...camera }; cameras.push(row); return row; }
    return cameraRow((await pool.query("INSERT INTO cameras(name,rtsp_url,location) VALUES($1,$2,$3) RETURNING *", [camera.name, camera.rtspUrl, camera.location])).rows[0]);
  },
  async updateCamera(id: number, patch: Partial<Omit<Camera, "id" | "createdAt">>) {
    if (!connected || !pool) { const camera = cameras.find(item => item.id === id); if (!camera) return null; Object.assign(camera, patch); return camera; }
    const found = await pool.query("SELECT * FROM cameras WHERE id=$1", [id]); if (!found.rowCount) return null;
    const value = { ...cameraRow(found.rows[0]), ...patch };
    return cameraRow((await pool.query("UPDATE cameras SET name=$2,rtsp_url=$3,location=$4,status=$5,updated_at=NOW() WHERE id=$1 RETURNING *", [id, value.name, value.rtspUrl, value.location, value.status])).rows[0]);
  },
  async deleteCamera(id: number) {
    if (!connected || !pool) { const index = cameras.findIndex(item => item.id === id); if (index < 0) return false; cameras.splice(index, 1); return true; }
    return Boolean((await pool.query("DELETE FROM cameras WHERE id=$1", [id])).rowCount);
  },
  async listModels() { if (!connected || !pool) return models; return (await pool.query("SELECT * FROM ai_models ORDER BY id")).rows.map(modelRow); },
  async addModel(model: Omit<AiModel, "id" | "createdAt" | "active">) {
    if (!connected || !pool) { const row = { id: nextModelId++, active: false, createdAt: now(), ...model }; models.push(row); return row; }
    return modelRow((await pool.query("INSERT INTO ai_models(name,version,path) VALUES($1,$2,$3) RETURNING *", [model.name, model.version, model.path])).rows[0]);
  },
  async activateModel(id: number) {
    if (!connected || !pool) { const model = models.find(item => item.id === id); if (!model) return null; models.forEach(item => item.active = item.id === id); return model; }
    const client = await pool.connect();
    try { await client.query("BEGIN"); await client.query("UPDATE ai_models SET active=FALSE"); const result = await client.query("UPDATE ai_models SET active=TRUE WHERE id=$1 RETURNING *", [id]); await client.query("COMMIT"); return result.rowCount ? modelRow(result.rows[0]) : null; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  },
  async latestInference() { if (!connected || !pool) return inferenceResults.at(-1) ?? null; const result = await pool.query("SELECT * FROM inference_results ORDER BY created_at DESC LIMIT 1"); return result.rowCount ? inferenceRow(result.rows[0]) : null; },
  async listInference() { if (!connected || !pool) return inferenceResults.slice().reverse(); return (await pool.query("SELECT * FROM inference_results ORDER BY created_at DESC LIMIT 1000")).rows.map(inferenceRow); },
  async addInference(result: Omit<InferenceResult, "id">) {
    if (!connected || !pool) { const row = { id: nextInferenceId++, ...result }; inferenceResults.push(row); return row; }
    const sql = "INSERT INTO inference_results(camera_id,grade,daun_percent,pucuk_percent,sampah_percent,confidence,snapshot_path,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *";
    return inferenceRow((await pool.query(sql, [result.cameraId, result.grade, result.classes.daun, result.classes.pucuk, result.classes.sampah, result.confidence, result.snapshot, result.timestamp])).rows[0]);
  }
};

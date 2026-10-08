import "./env.js";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "./db.js";
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
    await pool.query("SELECT 1");
    // Seed missing defaults without removing or replacing configured cameras.
    for (const camera of DEFAULT_CAMERAS) {
      await pool.query("INSERT INTO cameras(id,name,rtsp_url,location,status) VALUES($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING", [camera.id, camera.name, camera.rtspUrl, camera.location, camera.status]);
    }
    for (const model of DEFAULT_MODELS) {
      await pool.query("INSERT INTO ai_models(id,name,version,path,active) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [model.id, model.name, model.version, model.path, model.active]);
    }
    for (const table of ["cameras", "ai_models"]) {
      await pool.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}),1), (SELECT last_value FROM ${table}_id_seq)))`);
    }
  },
  databaseStatus: () => "postgresql",
  async listCameras(): Promise<Camera[]> {
    return (await pool.query("SELECT * FROM cameras ORDER BY id")).rows.map(cameraRow);
  },
  async createCamera(camera: Omit<Camera, "id" | "createdAt" | "status"> & { id?: number }) {
    const result = camera.id === undefined
      ? await pool.query("INSERT INTO cameras(name,rtsp_url,location,status) VALUES($1,$2,$3,'online') RETURNING *", [camera.name, camera.rtspUrl, camera.location])
      : await pool.query("INSERT INTO cameras(id,name,rtsp_url,location,status) VALUES($1,$2,$3,$4,'online') RETURNING *", [camera.id, camera.name, camera.rtspUrl, camera.location]);
    return cameraRow(result.rows[0]);
  },
  async updateCamera(id: number, patch: Partial<Omit<Camera, "id" | "createdAt">>) {
    const result = await pool.query("UPDATE cameras SET name=COALESCE($2,name),rtsp_url=COALESCE($3,rtsp_url),location=COALESCE($4,location),status=COALESCE($5,status),updated_at=NOW() WHERE id=$1 RETURNING *", [id, patch.name, patch.rtspUrl, patch.location, patch.status]);
    return result.rowCount ? cameraRow(result.rows[0]) : null;
  },
  async deleteCamera(id: number) {
    return Boolean((await pool.query("DELETE FROM cameras WHERE id=$1", [id])).rowCount);
  },
  async listModels(): Promise<AiModel[]> {
    return (await pool.query("SELECT * FROM ai_models ORDER BY id")).rows.map(modelRow);
  },
  async addModel(model: Omit<AiModel, "id" | "createdAt" | "active">) {
    return modelRow((await pool.query("INSERT INTO ai_models(name,version,path) VALUES($1,$2,$3) RETURNING *", [model.name, model.version, model.path])).rows[0]);
  },
  async activateModel(id: number, activate?: (model: AiModel) => Promise<void>) {
    return transaction(async client => {
      // Serialize activation and verify the target before clearing the current model.
      await client.query("LOCK TABLE ai_models IN EXCLUSIVE MODE");
      const found = await client.query("SELECT * FROM ai_models WHERE id=$1", [id]);
      if (!found.rowCount) return null;
      if (activate) await activate(modelRow(found.rows[0]));
      await client.query("UPDATE ai_models SET active=FALSE WHERE active=TRUE");
      return modelRow((await client.query("UPDATE ai_models SET active=TRUE WHERE id=$1 RETURNING *", [id])).rows[0]);
    });
  },
  async latestInference() {
    const result = await pool.query("SELECT * FROM inference_results ORDER BY created_at DESC LIMIT 1");
    return result.rowCount ? inferenceRow(result.rows[0]) : null;
  },
  async getInference(id: number) {
    const result = await pool.query("SELECT * FROM inference_results WHERE id=$1", [id]);
    return result.rowCount ? inferenceRow(result.rows[0]) : null;
  },
  async listInference(): Promise<InferenceResult[]> {
    return (await pool.query("SELECT * FROM inference_results ORDER BY created_at DESC LIMIT 1000")).rows.map(inferenceRow);
  },
  async addInference(result: Omit<InferenceResult, "id">) {
    const sql = "INSERT INTO inference_results(camera_id,grade,daun_percent,pucuk_percent,sampah_percent,confidence,snapshot_path,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *";
    return inferenceRow((await pool.query(sql, [result.cameraId, result.grade, result.classes.daun, result.classes.pucuk, result.classes.sampah, result.confidence, result.snapshot, result.timestamp])).rows[0]);
  },
  async deleteInference(id: number) {
    return Boolean((await pool.query("DELETE FROM inference_results WHERE id=$1", [id])).rowCount);
  },
  async clearAllInferences(cameraIds?: number[]) {
    await pool.query("DELETE FROM inference_results WHERE ($1::bigint[] IS NULL OR camera_id=ANY($1))", [cameraIds ?? null]);
    return true;
  },
  async listDeletionRequests(factory?: "trangkil" | "kebonagung" | "all"): Promise<DeletionRequest[]> {
    const result = await pool.query("SELECT payload FROM deletion_requests WHERE ($1::text IS NULL OR payload->>'factory'=$1) ORDER BY created_at DESC", [!factory || factory === "all" ? null : factory]);
    return result.rows.map(row => row.payload as DeletionRequest);
  },
  async createDeletionRequest(input: Omit<DeletionRequest, "id" | "status" | "requestedAt">) {
    const record: DeletionRequest = { ...input, id: randomUUID(), status: "pending", requestedAt: new Date().toISOString() };
    await pool.query("INSERT INTO deletion_requests(id,payload) VALUES($1,$2)", [record.id, record]);
    return record;
  },
  async reviewDeletionRequest(id: string, decision: "approved" | "rejected", reviewer: string, reviewNotes?: string, factory: "trangkil" | "kebonagung" | "all" = "all") {
    return transaction(async client => {
      const found = await client.query("SELECT payload FROM deletion_requests WHERE id=$1 FOR UPDATE", [id]);
      if (!found.rowCount) return null;
      const record = found.rows[0].payload as DeletionRequest;
      if (factory !== "all" && record.factory !== factory) return null;
      if (record.status !== "pending") throw Object.assign(new Error("Permohonan sudah ditinjau"), { statusCode: 409 });
      if (decision === "approved") {
        if (record.targetType === "inference") await client.query("DELETE FROM inference_results WHERE id=$1", [Number(record.targetId)]);
        if (record.targetType === "truck_inspection") await client.query("DELETE FROM truck_inspections WHERE id=$1", [record.targetId]);
        if (record.targetType === "all_inferences") {
          if (record.factory === "all") await client.query("DELETE FROM inference_results");
          else await client.query("DELETE FROM inference_results WHERE camera_id IN (SELECT id FROM cameras WHERE lower(name || ' ' || location) ~ $1)", [record.factory === "trangkil" ? "trangkil" : "kebon agung|malang"]);
        }
      }
      const reviewed: DeletionRequest = { ...record, status: decision, reviewedBy: reviewer, reviewedAt: new Date().toISOString(), reviewNotes };
      await client.query("UPDATE deletion_requests SET payload=$2 WHERE id=$1", [id, reviewed]);
      return reviewed;
    });
  }
};

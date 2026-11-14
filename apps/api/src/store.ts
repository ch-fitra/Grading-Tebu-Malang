import "./env.js";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "./db.js";
import type { ClassPercentages, Grade } from "./rule-engine.js";

export type Camera = { id: number; name: string; rtspUrl: string; location: string; status: "online" | "offline"; station: number; enabled: boolean; createdAt: string };
export type AiModel = { id: number; name: string; version: string; path: string; active: boolean; createdAt: string };
export type InferenceResult = { id: number; timestamp: string; cameraId: number; classes: Required<Pick<ClassPercentages, "daun" | "pucuk" | "sampah">>; impurityMeasured?: boolean; classScores?: Partial<Record<Grade, number>>; grade: Grade; confidence: number; snapshot: string | null };
export type DeletionRequest = {
  id: string;
  targetType: "inference" | "truck_inspection" | "all_inferences";
  targetId: number | string;
  targetTitle: string;
  targetSubtitle?: string;
  snapshotPath?: string;
  factory: "kebonagung";
  requestedBy: string;
  requestedAt: string;
  reason: string;
  notes?: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
};

const cameraRow = (r: Record<string, unknown>): Camera => ({ id: Number(r.id), name: String(r.name), rtspUrl: String(r.rtsp_url), location: String(r.location ?? ""), status: r.status as Camera["status"], station: Number(r.station), enabled: Boolean(r.enabled), createdAt: new Date(String(r.created_at)).toISOString() });
const modelRow = (r: Record<string, unknown>): AiModel => ({ id: Number(r.id), name: String(r.name), version: String(r.version), path: String(r.path), active: Boolean(r.active), createdAt: new Date(String(r.created_at)).toISOString() });
const inferenceRow = (r: Record<string, unknown>): InferenceResult => ({ id: Number(r.id), timestamp: new Date(String(r.created_at)).toISOString(), cameraId: Number(r.camera_id ?? 0), classes: { daun: Number(r.daun_percent), pucuk: Number(r.pucuk_percent), sampah: Number(r.sampah_percent) }, impurityMeasured: r.impurity_measured === true, grade: r.grade as Grade, confidence: Number(r.confidence), snapshot: r.snapshot_path ? String(r.snapshot_path) : null });

// Read the model's persisted class without rewriting historical or AI records.
const aiPool = process.env.AI_DATABASE_URL ? new pg.Pool({ connectionString: process.env.AI_DATABASE_URL, allowExitOnIdle: true, connectionTimeoutMillis: 5000, query_timeout: 10000 }) : null;
aiPool?.on("error", () => console.error("Koneksi database AI terputus; riwayat tersimpan tetap tersedia"));
async function withDetectedClasses(rows: InferenceResult[]): Promise<InferenceResult[]> {
  if (!aiPool || !rows.length) return rows;
  const paths = rows.flatMap(r => r.snapshot ? [r.snapshot.replace(/^\/+/, "")] : []);
  const result = await aiPool.query("SELECT DISTINCT ON (snapshot_path) snapshot_path, detected_class, classes_score FROM ai_inference_results WHERE snapshot_path = ANY($1::text[]) ORDER BY snapshot_path, id DESC", [paths]).catch(() => null);
  if (!result) return rows;
  const byPath = new Map(result.rows.map(r => [r.snapshot_path, r]));
  return rows.map(row => {
    const detection = byPath.get(row.snapshot?.replace(/^\/+/, ""));
    return detection && ["ATPSD", "Akar Tanah", "Daduk", "Kocok Air", "MBS", "MBS Bintang", "MBS Plus", "Non MBS", "Sogolan Pucuk", "Tebu Muda", "Terbakar", "S", "M", "A", "D", "B", "T", "G", "X"].includes(detection.detected_class)
      ? { ...row, grade: detection.detected_class as Grade, classScores: Object.keys(detection.classes_score ?? {}).some(code => ["daun", "pucuk", "sampah"].includes(code)) ? undefined : detection.classes_score }
      : row;
  });
}

export const DEFAULT_MODELS: Omit<AiModel, "createdAt">[] = [
  { id: 1, name: "Sugarcane Malang 11 Classes", version: "malang-1", path: "apps/ai-service/models/active/model_sugarcane_malang.keras", active: true }
];

export const store = {
  async close() { await aiPool?.end(); },
  async initialize() {
    await pool.query("SELECT 1");
    await pool.query("CREATE TABLE IF NOT EXISTS ai_capture_sync (id integer PRIMARY KEY CHECK (id=1), last_ai_id bigint NOT NULL DEFAULT 0)");
    await pool.query("INSERT INTO ai_capture_sync(id,last_ai_id) VALUES(1,0) ON CONFLICT DO NOTHING");
    // Cameras and RTSP URLs are managed exclusively in PostgreSQL through camera CRUD.
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
  async createCamera(camera: Omit<Camera, "id" | "createdAt" | "status">) {
    return cameraRow((await pool.query("INSERT INTO cameras(name,rtsp_url,location,status,station,enabled) VALUES($1,$2,$3,'offline',$4,$5) RETURNING *", [camera.name, camera.rtspUrl, camera.location, camera.station, camera.enabled])).rows[0]);
  },
  async updateCamera(id: number, patch: Partial<Omit<Camera, "id" | "createdAt">>) {
    const result = await pool.query("UPDATE cameras SET name=COALESCE($2,name),rtsp_url=COALESCE($3,rtsp_url),location=COALESCE($4,location),station=COALESCE($5,station),enabled=COALESCE($6,enabled),updated_at=NOW() WHERE id=$1 RETURNING *", [id, patch.name, patch.rtspUrl, patch.location, patch.station, patch.enabled]);
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
  async syncModelCaptures() {
    if (!aiPool) return 0;
    return transaction(async client => {
      const marker = await client.query("SELECT last_ai_id FROM ai_capture_sync WHERE id=1 FOR UPDATE");
      const frames = (await aiPool.query("SELECT id, camera_id, cycle_code, created_at, detected_class, classes_score, confidence, snapshot_path FROM ai_inference_results WHERE id>$1 ORDER BY id LIMIT 5000", [marker.rows[0].last_ai_id])).rows;
      let imported = 0;
      for (const frame of frames) {
        const snapshot = `/${String(frame.snapshot_path).replace(/^\/+/, "")}`;
        const found = await client.query("SELECT id FROM inference_results WHERE snapshot_path=$1 AND camera_id=$2 LIMIT 1", [snapshot, frame.camera_id]);
        let inferenceId = found.rows[0]?.id;
        if (!inferenceId) {
          const scores = frame.classes_score;
          const measured = ["daun", "pucuk", "sampah"].every(code => typeof scores?.[code] === "number");
          const added = await client.query("INSERT INTO inference_results(camera_id,grade,daun_percent,pucuk_percent,sampah_percent,confidence,snapshot_path,created_at,impurity_measured) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id", [frame.camera_id, frame.detected_class, measured ? scores.daun : 0, measured ? scores.pucuk : 0, measured ? scores.sampah : 0, frame.confidence, snapshot, frame.created_at, measured]);
          inferenceId = added.rows[0].id;
          imported++;
        }
        if (typeof frame.cycle_code === "string" && /^[0-9a-f-]{36}$/i.test(frame.cycle_code)) {
          await client.query("INSERT INTO truck_inspection_captures(inspection_id,inference_id) SELECT id,$2 FROM truck_inspections WHERE id=$1 AND line=$3 ON CONFLICT DO NOTHING", [frame.cycle_code,inferenceId,frame.camera_id]);
        }
      }
      if (frames.length) await client.query("UPDATE ai_capture_sync SET last_ai_id=$1 WHERE id=1", [frames.at(-1).id]);
      return imported;
    });
  },
  async listModelFrames(): Promise<InferenceResult[]> {
    const result = await pool.query("SELECT * FROM inference_results ORDER BY created_at DESC LIMIT 5000");
    return withDetectedClasses(result.rows.map(inferenceRow));
  },
  async latestInference() {
    const result = await pool.query("SELECT * FROM inference_results ORDER BY created_at DESC LIMIT 1");
    return result.rowCount ? (await withDetectedClasses([inferenceRow(result.rows[0])]))[0] : null;
  },
  async getInference(id: number) {
    const result = await pool.query("SELECT * FROM inference_results WHERE id=$1", [id]);
    return result.rowCount ? (await withDetectedClasses([inferenceRow(result.rows[0])]))[0] : null;
  },
  async listInference(): Promise<InferenceResult[]> {
    return withDetectedClasses((await pool.query("SELECT * FROM inference_results ORDER BY created_at DESC LIMIT 1000")).rows.map(inferenceRow));
  },
  async addInference(result: Omit<InferenceResult, "id">) {
    const row = await transaction(async client => {
      await client.query("SELECT last_ai_id FROM ai_capture_sync WHERE id=1 FOR UPDATE");
      const existing = await client.query("SELECT * FROM inference_results WHERE snapshot_path=$1 AND camera_id=$2 LIMIT 1", [result.snapshot,result.cameraId]);
      if (existing.rowCount) return inferenceRow(existing.rows[0]);
      const sql = "INSERT INTO inference_results(camera_id,grade,daun_percent,pucuk_percent,sampah_percent,confidence,snapshot_path,created_at,impurity_measured) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *";
      return inferenceRow((await client.query(sql, [result.cameraId, result.grade, result.classes.daun, result.classes.pucuk, result.classes.sampah, result.confidence, result.snapshot, result.timestamp, result.impurityMeasured === true])).rows[0]);
    });
    return (await withDetectedClasses([row]))[0];
  },

  async deleteInference(id: number) {
    return Boolean((await pool.query("DELETE FROM inference_results WHERE id=$1", [id])).rowCount);
  },
  async clearAllInferences(cameraIds?: number[]) {
    await pool.query("DELETE FROM inference_results WHERE ($1::bigint[] IS NULL OR camera_id=ANY($1))", [cameraIds ?? null]);
    return true;
  },
  async listDeletionRequests(factory?: "kebonagung"): Promise<DeletionRequest[]> {
    const result = await pool.query("SELECT payload FROM deletion_requests WHERE ($1::text IS NULL OR payload->>'factory'=$1) ORDER BY created_at DESC", [factory ?? "kebonagung"]);
    return result.rows.map(row => row.payload as DeletionRequest);
  },
  async createDeletionRequest(input: Omit<DeletionRequest, "id" | "status" | "requestedAt">) {
    const record: DeletionRequest = { ...input, id: randomUUID(), status: "pending", requestedAt: new Date().toISOString() };
    await pool.query("INSERT INTO deletion_requests(id,payload) VALUES($1,$2)", [record.id, record]);
    return record;
  },
  async reviewDeletionRequest(id: string, decision: "approved" | "rejected", reviewer: string, reviewNotes?: string, factory: "kebonagung" = "kebonagung") {
    return transaction(async client => {
      const found = await client.query("SELECT payload FROM deletion_requests WHERE id=$1 FOR UPDATE", [id]);
      if (!found.rowCount) return null;
      const record = found.rows[0].payload as DeletionRequest;
      if (record.factory !== factory) return null;
      if (record.status !== "pending") throw Object.assign(new Error("Permohonan sudah ditinjau"), { statusCode: 409 });
      if (decision === "approved") {
        if (record.targetType === "inference") await client.query("DELETE FROM inference_results WHERE id=$1", [Number(record.targetId)]);
        if (record.targetType === "truck_inspection") {
          const target = await client.query("SELECT status FROM truck_inspections WHERE id=$1 FOR UPDATE", [record.targetId]);
          if (target.rows[0]?.status === "active") throw Object.assign(new Error("Hentikan inspeksi aktif sebelum menyetujui penghapusan"), { statusCode: 409 });
          await client.query("DELETE FROM truck_inspections WHERE id=$1", [record.targetId]);
        }
        if (record.targetType === "all_inferences") {
          await client.query("DELETE FROM inference_results");
        }
      }
      const reviewed: DeletionRequest = { ...record, status: decision, reviewedBy: reviewer, reviewedAt: new Date().toISOString(), reviewNotes };
      await client.query("UPDATE deletion_requests SET payload=$2 WHERE id=$1", [id, reviewed]);
      return reviewed;
    });
  }
};

import "./env.js";
import pg from "pg";
import type { HistoryQuery } from "./history-query.js";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "./db.js";
import type { ClassPercentages, Grade } from "./rule-engine.js";

export type Camera = { id: number; name: string; rtspUrl: string; location: string; status: "online" | "offline"; station: number; enabled: boolean; createdAt: string };
export type AiModel = { id: number; name: string; version: string; path: string; active: boolean; createdAt: string };
export type InferenceResult = { id: number; timestamp: string; cameraId: number; classes: Required<Pick<ClassPercentages, "daun" | "pucuk" | "sampah">>; impurityMeasured?: boolean; classScores?: Partial<Record<Grade, number>>; candidateGrade?: Grade; predictionAccepted?: boolean; confidenceThreshold?: number; grade: Grade; confidence: number; modelOutput?: unknown; snapshot: string | null };
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
const inferenceRow = (r: Record<string, unknown>): InferenceResult => ({ id: Number(r.id), timestamp: new Date(String(r.created_at)).toISOString(), cameraId: Number(r.camera_id ?? 0), classes: { daun: Number(r.daun_percent), pucuk: Number(r.pucuk_percent), sampah: Number(r.sampah_percent) }, impurityMeasured: r.impurity_measured === true, grade: r.grade as Grade, confidence: Number(r.confidence), modelOutput: r.model_output, snapshot: r.snapshot_path ? String(r.snapshot_path) : null });

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
    // Historical model labels must survive class additions/removals in today's model.
    return detection && typeof detection.detected_class === "string" && detection.detected_class.trim()
      ? { ...row, grade: detection.detected_class as Grade, classScores: Object.keys(detection.classes_score ?? {}).some(code => ["daun", "pucuk", "sampah"].includes(code)) ? undefined : detection.classes_score }
      : row;
  });
}

export const store = {
  async close() { await aiPool?.end(); },
  async initialize() {
    await pool.query("SELECT 1");
    await pool.query("ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS model_output JSONB");
    await pool.query("UPDATE ai_models SET active=FALSE WHERE active=TRUE");
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
  async listModelFrames(): Promise<InferenceResult[]> {
    const result = await pool.query("SELECT * FROM inference_results ORDER BY created_at DESC, id DESC LIMIT 5000");
    return withDetectedClasses(result.rows.map(inferenceRow));
  },
  async latestInference() {
    const result = await pool.query("SELECT * FROM inference_results ORDER BY created_at DESC, id DESC LIMIT 1");
    return result.rowCount ? (await withDetectedClasses([inferenceRow(result.rows[0])]))[0] : null;
  },
  async getInference(id: number) {
    const result = await pool.query("SELECT * FROM inference_results WHERE id=$1", [id]);
    return result.rowCount ? (await withDetectedClasses([inferenceRow(result.rows[0])]))[0] : null;
  },
  async listInference(range?: HistoryQuery): Promise<InferenceResult[]> {
    return withDetectedClasses((await pool.query(`SELECT * FROM inference_results
      WHERE ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at < $2)
      ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`, [range?.start_at ?? null, range?.end_at ?? null, range?.limit ?? 1000, range?.offset ?? 0])).rows.map(inferenceRow));
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

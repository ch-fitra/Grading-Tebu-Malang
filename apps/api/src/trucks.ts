import pg from "pg";
import type { HistoryQuery } from "./history-query.js";
import { pool, transaction } from "./db.js";

type TruckRecord = {
  id: string; truckCode: string; plateNumber: string; driverName: string; supplier: string;
  line: number; status: string; finalDecision: string; averageImpurity: number;
  averageConfidence: number; totalCaptures: number; captureIds: number[]; notes: string;
  startedAt: string; completedAt: string | null; detectedGrade: string | null; impurityMeasured: boolean;
};


type Queryable = Pick<pg.Pool, "query"> | pg.PoolClient;

async function read(id?: string, db: Queryable = pool, range?: HistoryQuery): Promise<TruckRecord[]> {
  const result = await db.query(`SELECT t.*,
    COALESCE(array_agg(i.id ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '{}') AS capture_ids,
    COUNT(i.id)::int AS total_captures,
    COALESCE(AVG(i.daun_percent+i.pucuk_percent+i.sampah_percent) FILTER (WHERE i.impurity_measured),0)::float AS measured_impurity,
    BOOL_AND(i.impurity_measured IS TRUE) FILTER (WHERE i.id IS NOT NULL) AS impurity_measured,
    COALESCE(AVG(i.confidence),0)::float AS measured_confidence,
    COALESCE(array_agg(i.grade ORDER BY i.created_at DESC, i.id DESC) FILTER (WHERE i.id IS NOT NULL), '{}') AS detected_grades
    FROM truck_inspections t
    LEFT JOIN truck_inspection_captures c ON c.inspection_id=t.id
    LEFT JOIN inference_results i ON i.id=c.inference_id
    WHERE ($1::uuid IS NULL OR t.id=$1)
      AND ($2::timestamptz IS NULL OR t.started_at >= $2)
      AND ($3::timestamptz IS NULL OR t.started_at < $3)
    GROUP BY t.id ORDER BY t.started_at DESC, t.id DESC LIMIT $4 OFFSET $5`, [id ?? null, range?.start_at ?? null, range?.end_at ?? null, range?.limit ?? 500, range?.offset ?? 0]);
  return result.rows.map(r => {
    const impurity = Number(r.measured_impurity);
    const count = Number(r.total_captures);
    return {
      id: String(r.id), truckCode: String(r.truck_code), plateNumber: String(r.plate_number ?? ""),
      driverName: String(r.driver_name ?? ""), supplier: String(r.supplier ?? ""), line: Number(r.line),
      status: String(r.status), finalDecision: String(r.final_decision ?? "PENDING"), averageImpurity: impurity,
      detectedGrade: r.detected_grades[0] ?? null,
      impurityMeasured: r.impurity_measured === true,
      averageConfidence: Number(r.measured_confidence), totalCaptures: count,
      captureIds: (r.capture_ids as unknown[]).map(Number), notes: String(r.notes ?? ""),
      startedAt: new Date(r.started_at).toISOString(),
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null
    };
  });
}

type TruckPatch = Partial<{ truckCode: string; plateNumber: string; driverName: string; supplier: string; notes: string }>;
async function update(db: Queryable, id: string, patch: TruckPatch) {
  const result = await db.query(`UPDATE truck_inspections SET truck_code=COALESCE($2,truck_code),
    plate_number=COALESCE($3,plate_number),driver_name=COALESCE($4,driver_name),
    supplier=COALESCE($5,supplier),notes=COALESCE($6,notes) WHERE id=$1 RETURNING id`,
    [id, patch.truckCode, patch.plateNumber, patch.driverName, patch.supplier, patch.notes]);
  return result.rowCount ? (await read(id, db))[0] : null;
}

export const trucks = {
  async list(range?: HistoryQuery) { return read(undefined, pool, range); },
  async get(id: string) { return (await read(id))[0] ?? null; },
  async update(id: string, patch: TruckPatch) { return update(pool, id, patch); },
  async batchSync(items: Array<TruckPatch & { id: string }>) {
    return transaction(async client => {
      const results: TruckRecord[] = [];
      for (const item of items) {
        const updated = await update(client, item.id, item);
        if (!updated) throw Object.assign(new Error("Inspeksi tidak ditemukan"), { statusCode: 404 });
        results.push(updated);
      }
      return results;
    });
  },
  async delete(id: string, discardUnstarted = false) {
    return transaction(async client => {
      const found = await client.query("SELECT status FROM truck_inspections WHERE id=$1 FOR UPDATE", [id]);
      if (!found.rowCount) return false;
      if (found.rows[0].status === "active" && !discardUnstarted) throw Object.assign(new Error("Hentikan inspeksi aktif sebelum menghapusnya"), { statusCode: 409 });
      return Boolean((await client.query("DELETE FROM truck_inspections WHERE id=$1", [id])).rowCount);
    });
  },
  async clearAll(cameraIds?: number[]) {
    const active = await pool.query("SELECT 1 FROM truck_inspections WHERE status='active' AND ($1::int[] IS NULL OR line=ANY($1)) LIMIT 1", [cameraIds ?? null]);
    if (active.rowCount) throw Object.assign(new Error("Hentikan inspeksi aktif sebelum menghapus semua siklus"), { statusCode: 409 });
    await pool.query("DELETE FROM truck_inspections WHERE status='completed' AND ($1::int[] IS NULL OR line=ANY($1))", [cameraIds ?? null]);
    return true;
  }
};

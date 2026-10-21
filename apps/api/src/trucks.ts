import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, transaction } from "./db.js";

type Input = { truckCode: string; plateNumber?: string; driverName?: string; supplier?: string; line: number; notes?: string };
type TruckRecord = {
  id: string; truckCode: string; plateNumber: string; driverName: string; supplier: string;
  line: number; status: string; finalDecision: string; averageImpurity: number;
  averageConfidence: number; totalCaptures: number; captureIds: number[]; notes: string;
  startedAt: string; completedAt: string | null; detectedGrade: string | null; impurityMeasured: boolean;
};


type Queryable = Pick<pg.Pool, "query"> | pg.PoolClient;

async function syncCaptures(db: Queryable, id?: string) {
  await db.query(`INSERT INTO truck_inspection_captures(inspection_id,inference_id)
    SELECT t.id,i.id FROM truck_inspections t JOIN inference_results i
      ON i.camera_id=t.line AND i.created_at>=t.started_at
      AND i.created_at<=COALESCE(t.completed_at,NOW())
    WHERE (($1::uuid IS NULL AND t.status='active') OR t.id=$1) ON CONFLICT DO NOTHING`, [id ?? null]);
}

async function read(id?: string, db: Queryable = pool): Promise<TruckRecord[]> {
  await syncCaptures(db, id);
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
    WHERE ($1::uuid IS NULL OR t.id=$1) GROUP BY t.id ORDER BY t.started_at DESC LIMIT 500`, [id ?? null]);
  return result.rows.map(r => {
    const impurity = Number(r.measured_impurity);
    const count = Number(r.total_captures);
    const votes = new Map<string, number>();
    for (const grade of r.detected_grades as string[]) votes.set(grade, (votes.get(grade) ?? 0) + 1);
    const grade = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
    const decision = ["S", "M", "A"].includes(grade ?? "") ? "MBS" : ["D", "B"].includes(grade ?? "") ? "NON_MBS" : ["G", "X"].includes(grade ?? "") ? "DITOLAK_DO" : "PENDING";
    return {
      id: String(r.id), truckCode: String(r.truck_code), plateNumber: String(r.plate_number ?? ""),
      driverName: String(r.driver_name ?? ""), supplier: String(r.supplier ?? ""), line: Number(r.line),
      status: String(r.status), finalDecision: decision, averageImpurity: impurity,
      detectedGrade: grade ?? null,
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
  async list() { return read(); },
  async get(id: string) { return (await read(id))[0] ?? null; },
  async create(data: Input) {
    return transaction(async client => {
      const id = randomUUID();
      await client.query(`INSERT INTO truck_inspections(id,truck_code,plate_number,driver_name,supplier,line,status,notes)
        VALUES($1,$2,$3,$4,$5,$6,'active',$7)`, [id, data.truckCode, data.plateNumber ?? "", data.driverName ?? "", data.supplier ?? "", data.line, data.notes ?? ""]);
      return (await read(id, client))[0];
    });
  },
  async complete(id: string, notes?: string) {
    return transaction(async client => {
      const result = await client.query("UPDATE truck_inspections SET status='completed',completed_at=NOW(),notes=COALESCE($2,notes) WHERE id=$1 AND status='active' RETURNING id", [id, notes]);
      if (!result.rowCount) return null;
      const completed = (await read(id, client))[0];
      await client.query("UPDATE truck_inspections SET final_decision=$2,average_impurity=$3,average_confidence=$4 WHERE id=$1", [id, completed.finalDecision, completed.averageImpurity, completed.averageConfidence]);
      return completed;
    });
  },
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

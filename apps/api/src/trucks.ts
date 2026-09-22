import { randomUUID } from "node:crypto";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
type Input = { truckCode: string; plateNumber?: string; driverName?: string; supplier?: string; line: number; notes?: string };

async function syncCaptures(id?: string) {
  await pool.query(`INSERT INTO truck_inspection_captures(inspection_id,inference_id)
    SELECT t.id,i.id FROM truck_inspections t JOIN inference_results i
      ON i.camera_id=t.line AND i.created_at>=t.started_at
      AND i.created_at<=COALESCE(t.completed_at,NOW())
    WHERE ($1::uuid IS NULL AND t.status='active' OR t.id=$1) ON CONFLICT DO NOTHING`, [id ?? null]);
}

async function read(id?: string) {
  await syncCaptures(id);
  const result = await pool.query(`SELECT t.*,
    COALESCE(array_agg(i.id ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '{}') AS capture_ids,
    COUNT(i.id)::int AS total_captures,
    COALESCE(AVG(i.daun_percent+i.pucuk_percent+i.sampah_percent),0)::float AS measured_impurity,
    COALESCE(AVG(i.confidence),0)::float AS measured_confidence
    FROM truck_inspections t
    LEFT JOIN truck_inspection_captures c ON c.inspection_id=t.id
    LEFT JOIN inference_results i ON i.id=c.inference_id
    WHERE ($1::uuid IS NULL OR t.id=$1) GROUP BY t.id ORDER BY t.started_at DESC LIMIT 500`, [id ?? null]);
  return result.rows.map(r => {
    const impurity = Number(r.measured_impurity);
    const count = Number(r.total_captures);
    const decision = count === 0 ? "PENDING" : impurity <= 10 ? "MBS" : impurity <= 20 ? "NON_MBS" : "DITOLAK_DO";
    return {
    id: String(r.id), truckCode: String(r.truck_code), plateNumber: String(r.plate_number ?? ""),
    driverName: String(r.driver_name ?? ""), supplier: String(r.supplier ?? ""), line: Number(r.line),
    status: String(r.status), finalDecision: decision, averageImpurity: impurity,
    averageConfidence: Number(r.measured_confidence), totalCaptures: count,
    captureIds: (r.capture_ids as unknown[]).map(Number), notes: String(r.notes ?? ""),
    startedAt: new Date(r.started_at).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null
    };
  });
}

export const trucks = {
  async list() { return read(); },
  async create(data: Input) {
    const id = randomUUID();
    await pool.query(`INSERT INTO truck_inspections(id,truck_code,plate_number,driver_name,supplier,line,status,notes)
      VALUES($1,$2,$3,$4,$5,$6,'active',$7)`, [id, data.truckCode, data.plateNumber ?? "", data.driverName ?? "", data.supplier ?? "", data.line, data.notes ?? ""]);
    return (await read(id))[0];
  },
  async complete(id: string, notes?: string) {
    const result = await pool.query("UPDATE truck_inspections SET status='completed',completed_at=NOW(),notes=COALESCE($2,notes) WHERE id=$1 AND status='active' RETURNING id", [id, notes]);
    if (!result.rowCount) return null;
    const completed = (await read(id))[0];
    if (completed) await pool.query("UPDATE truck_inspections SET final_decision=$2,average_impurity=$3,average_confidence=$4 WHERE id=$1", [id, completed.finalDecision, completed.averageImpurity, completed.averageConfidence]);
    return completed;
  },
  async delete(id: string) { return Boolean((await pool.query("DELETE FROM truck_inspections WHERE id=$1", [id])).rowCount); }
};

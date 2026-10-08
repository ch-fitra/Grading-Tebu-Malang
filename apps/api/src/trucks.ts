import { randomUUID } from "node:crypto";
import pg from "pg";
import { store } from "./store.js";

const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
type Input = { truckCode: string; plateNumber?: string; driverName?: string; supplier?: string; line: number; notes?: string };
type TruckRecord = {
  id: string; truckCode: string; plateNumber: string; driverName: string; supplier: string;
  line: number; status: string; finalDecision: string; averageImpurity: number;
  averageConfidence: number; totalCaptures: number; captureIds: number[]; notes: string;
  startedAt: string; completedAt: string | null;
};


const memoryTrucks: TruckRecord[] = [];


async function syncCaptures(id?: string) {
  if (!pool) return;
  try {
    await pool.query(`INSERT INTO truck_inspection_captures(inspection_id,inference_id)
      SELECT t.id,i.id FROM truck_inspections t JOIN inference_results i
        ON i.camera_id=t.line AND i.created_at>=t.started_at
        AND i.created_at<=COALESCE(t.completed_at,NOW())
      WHERE ($1::uuid IS NULL AND t.status='active' OR t.id=$1) ON CONFLICT DO NOTHING`, [id ?? null]);
  } catch {
    // DB offline, skip capture sync
  }
}

async function read(id?: string): Promise<TruckRecord[]> {
  if (pool) {
    try {
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
      if (result.rows.length > 0) {
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
    } catch {
      // Fallback to in-memory store
    }
  }

  const inferences = await store.listInference();
  const list = id ? memoryTrucks.filter(t => t.id === id) : memoryTrucks;
  for (const t of list) {
    const matching = inferences.filter(i => {
      const ts = new Date(i.timestamp).getTime();
      const start = new Date(t.startedAt).getTime();
      const end = t.completedAt ? new Date(t.completedAt).getTime() : Date.now();
      return i.cameraId === t.line && ts >= start - 1000 && ts <= end + 1000;
    });
    t.captureIds = matching.map(i => i.id);
    t.totalCaptures = matching.length;
    if (matching.length > 0) {
      const sumImp = matching.reduce((acc, i) => acc + (i.classes.daun + i.classes.pucuk + i.classes.sampah), 0);
      const sumConf = matching.reduce((acc, i) => acc + (i.confidence || 0.88), 0);
      t.averageImpurity = Number((sumImp / matching.length).toFixed(1));
      t.averageConfidence = Number((sumConf / matching.length).toFixed(2));
      t.finalDecision = t.averageImpurity <= 10 ? "MBS" : t.averageImpurity <= 20 ? "NON_MBS" : "DITOLAK_DO";
    }
  }
  return list;
}

export const trucks = {
  async list() { return read(); },
  async create(data: Input) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: TruckRecord = {
      id, truckCode: data.truckCode, plateNumber: data.plateNumber ?? "",
      driverName: data.driverName ?? "", supplier: data.supplier ?? "",
      line: data.line, status: "active", finalDecision: "PENDING",
      averageImpurity: 0, averageConfidence: 0, totalCaptures: 0,
      captureIds: [], notes: data.notes ?? "", startedAt: now, completedAt: null
    };
    memoryTrucks.unshift(record);

    if (pool) {
      try {
        await pool.query(`INSERT INTO truck_inspections(id,truck_code,plate_number,driver_name,supplier,line,status,notes)
          VALUES($1,$2,$3,$4,$5,$6,'active',$7)`, [id, data.truckCode, data.plateNumber ?? "", data.driverName ?? "", data.supplier ?? "", data.line, data.notes ?? ""]);
        const fromDb = await read(id);
        if (fromDb.length) return fromDb[0];
      } catch {
        // Keep in-memory record
      }
    }
    return record;
  },
  async complete(id: string, notes?: string) {
    const memItem = memoryTrucks.find(t => t.id === id && t.status === "active");
    if (memItem) {
      memItem.status = "completed";
      memItem.completedAt = new Date().toISOString();
      if (notes) memItem.notes = notes;
    }
    if (pool) {
      try {
        const result = await pool.query("UPDATE truck_inspections SET status='completed',completed_at=NOW(),notes=COALESCE($2,notes) WHERE id=$1 AND status='active' RETURNING id", [id, notes]);
        if (result.rowCount) {
          const completed = (await read(id))[0];
          if (completed) await pool.query("UPDATE truck_inspections SET final_decision=$2,average_impurity=$3,average_confidence=$4 WHERE id=$1", [id, completed.finalDecision, completed.averageImpurity, completed.averageConfidence]);
          return completed;
        }
      } catch {
        // Return memory version
      }
    }
    return memItem ?? null;
  },
  async update(id: string, updates: Partial<{ truckCode: string; plateNumber: string; driverName: string; supplier: string; notes: string }>) {
    const memItem = memoryTrucks.find(t => t.id === id);
    if (memItem) {
      if (updates.truckCode !== undefined) memItem.truckCode = updates.truckCode;
      if (updates.plateNumber !== undefined) memItem.plateNumber = updates.plateNumber;
      if (updates.driverName !== undefined) memItem.driverName = updates.driverName;
      if (updates.supplier !== undefined) memItem.supplier = updates.supplier;
      if (updates.notes !== undefined) memItem.notes = updates.notes;
    }
    if (pool) {
      try {
        const fields: string[] = [];
        const values: unknown[] = [id];
        let idx = 2;
        if (updates.truckCode !== undefined) { fields.push(`truck_code=$${idx++}`); values.push(updates.truckCode); }
        if (updates.plateNumber !== undefined) { fields.push(`plate_number=$${idx++}`); values.push(updates.plateNumber); }
        if (updates.driverName !== undefined) { fields.push(`driver_name=$${idx++}`); values.push(updates.driverName); }
        if (updates.supplier !== undefined) { fields.push(`supplier=$${idx++}`); values.push(updates.supplier); }
        if (updates.notes !== undefined) { fields.push(`notes=$${idx++}`); values.push(updates.notes); }
        if (fields.length > 0) {
          await pool.query(`UPDATE truck_inspections SET ${fields.join(", ")} WHERE id=$1`, values);
        }
        const updated = await read(id);
        if (updated.length) return updated[0];
      } catch {
        // Return memory version
      }
    }
    return memItem ?? null;
  },
  async batchSync(items: Array<{ id: string; truckCode?: string; plateNumber?: string; driverName?: string; supplier?: string; notes?: string }>) {
    const results = [];
    for (const item of items) {
      const updated = await this.update(item.id, item);
      if (updated) results.push(updated);
    }
    return results;
  },
  async delete(id: string) {
    const idx = memoryTrucks.findIndex(t => t.id === id);
    if (idx >= 0) memoryTrucks.splice(idx, 1);
    if (pool) {
      try { return Boolean((await pool.query("DELETE FROM truck_inspections WHERE id=$1", [id])).rowCount); }
      catch { return true; }
    }
    return true;
  },
  async clearAll() {
    memoryTrucks.length = 0;
    if (pool) {
      try {
        await pool.query("DELETE FROM truck_inspection_captures");
        await pool.query("DELETE FROM truck_inspections");
      } catch {}
    }
    return true;
  }
};


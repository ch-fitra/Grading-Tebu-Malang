import type { TruckInspectionSession } from "../types";

export function matchTappingRecords(cycles: TruckInspectionSession[], records: TappingRecord[], station: (cycle: TruckInspectionSession) => number, previous: ReconciliationRow[] = []): ReconciliationRow[] {
  const byId = new Map(records.map(record => [record.id, record]));
  const overrides = new Map(previous.filter(row => row.isManualOverride).map(row => [row.cycle.id, row]));
  const used = new Set<string>();
  const result = cycles.map(cycle => {
    const override = overrides.get(cycle.id);
    const tap = override?.assignedTappingId ? byId.get(override.assignedTappingId) : null;
    const valid = override && (!override.assignedTappingId || (tap && (tap.noMeja === undefined || tap.noMeja === station(cycle)) && !used.has(tap.id)));
    const assignedTappingId = valid ? override.assignedTappingId : null;
    if (assignedTappingId) used.add(assignedTappingId);
    return { cycle, assignedTappingId, isManualOverride: Boolean(valid) };
  });
  for (const row of result) {
    if (row.isManualOverride) continue;
    const start = new Date(row.cycle.startedAt).getTime();
    let best: TappingRecord | null = null;
    let distance = Infinity;
    for (const tap of records) {
      if (used.has(tap.id) || tap.noMeja !== station(row.cycle) || !tap.tappingTime) continue;
      const delta = start - tap.tappingTime.getTime();
      const diff = Math.abs(delta);
      if ((diff <= 25 * 60000 || (delta >= 0 && delta <= 90 * 60000)) && diff < distance) {
        best = tap;
        distance = diff;
      }
    }
    if (best) { row.assignedTappingId = best.id; used.add(best.id); }
  }
  return result;
}

export function reassignTapping(rows: ReconciliationRow[], cycleId: string, tappingId: string | null): ReconciliationRow[] {
  return rows.map(row => row.cycle.id === cycleId
    ? { ...row, assignedTappingId: tappingId, isManualOverride: true }
    : tappingId && row.assignedTappingId === tappingId
      ? { ...row, assignedTappingId: null, isManualOverride: true } : row);
}

export function swapTapping(rows: ReconciliationRow[], idA: string, idB: string): ReconciliationRow[] {
  const a = rows.find(row => row.cycle.id === idA);
  const b = rows.find(row => row.cycle.id === idB);
  if (!a || !b) return rows;
  return rows.map(row => row.cycle.id === idA ? { ...row, assignedTappingId: b.assignedTappingId, isManualOverride: true }
    : row.cycle.id === idB ? { ...row, assignedTappingId: a.assignedTappingId, isManualOverride: true } : row);
}

export interface TappingRecord {
  id: string;
  queueNumber: string;
  tappingTimeStr: string;
  tappingTime: Date | null;
  plateNumber: string;
  driverName: string;
  supplier: string;
  spatNumber: string;
  notes?: string;
  // PT Trangkil Specific Metadata
  noMeja?: number;
  mbsRaw?: string | number;
  factoryGrade?: string;
  tglNilaiStr?: string;
  tglDaftarStr?: string;
  tglNilaiDate?: Date | null;
  tglDaftarDate?: Date | null;
}

export interface ReconciliationRow {
  cycle: TruckInspectionSession;
  assignedTappingId: string | null;
  isManualOverride: boolean;
}

export interface FileImportStats {
  fileName: string;
  totalRecords: number;
  byMeja: Record<number, number>;
  unassignedMeja: number;
}

// Excel serials represent wall-clock dates, not UTC instants.
export function parseTrangkilDate(raw: unknown, fallbackDate?: Date, date1904 = false): Date | null {
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null;
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" || /^\d{5}(?:\.\d+)?$/.test(String(raw).trim())) {
    const serial = Number(raw);
    if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return null;
    if (serial < 1 && fallbackDate) {
      const date = new Date(fallbackDate);
      date.setHours(0, 0, 0, Math.round(serial * 86400000));
      return date;
    }
    if ((serial < 1 && !date1904) || (!date1904 && Math.floor(serial) === 60)) return null;
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : serial < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
    const utc = new Date(epoch + Math.round(serial * 86400000));
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds(), utc.getUTCMilliseconds());
  }
  const str = String(raw).trim();
  const time = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (time) {
    if (!fallbackDate || !Number.isFinite(fallbackDate.getTime())) return null;
    const [, h, m, sec = "0", ms = "0"] = time;
    if (+h > 23 || +m > 59 || +sec > 59) return null;
    const date = new Date(fallbackDate);
    date.setHours(+h, +m, +sec, Number(ms.padEnd(3, "0")));
    return date;
  }
  const local = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/);
  if (local) {
    const [, y, m, d, h = "0", min = "0", sec = "0", ms = "0"] = local;
    const date = new Date(+y, +m - 1, +d, +h, +min, +sec, Number(ms.padEnd(3, "0")));
    return date.getFullYear() === +y && date.getMonth() === +m - 1 && date.getDate() === +d && +h < 24 && +min < 60 && +sec < 60 ? date : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(str)) return null;
  const date = new Date(str);
  return Number.isFinite(date.getTime()) ? date : null;
}

// Universal parser for .xlsx, .xls, .csv, .txt files
export async function parseExcelOrCsv(file: Pick<File, "name" | "arrayBuffer">): Promise<{
  records: TappingRecord[];
  stats: FileImportStats;
}> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", raw: true });

  // Priority sheet: "DATA" (case-insensitive) or first sheet
  const targetSheetName =
    workbook.SheetNames.find((s) => s.trim().toUpperCase() === "DATA") || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[targetSheetName];

  if (!worksheet) {
    throw new Error(`Lembar kerja "${targetSheetName}" tidak dapat dibaca.`);
  }

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "" });
  if (!rawRows || rawRows.length === 0) {
    throw new Error("File Excel kosong atau tidak memiliki baris data.");
  }

  // Scan headers across the first 5 rows
  let headerRowIdx = -1;
  let kdAntrianIdx = -1;
  let noMejaIdx = -1;
  let mbsIdx = -1;
  let kodeIdx = -1;
  let tglNilaiIdx = -1;
  let tglDaftarIdx = -1;
  let plateIdx = -1;
  const date1904 = workbook.Workbook?.WBProps?.date1904 ?? false;

  for (let r = 0; r < Math.min(5, rawRows.length); r++) {
    const row = (rawRows[r] as unknown[]).map((c) =>
      String(c ?? "").toLowerCase().trim().replace(/[^a-z0-9_]/g, "")
    );
    const findCol = (keys: string[]) => row.findIndex((c) => keys.includes(c));

    const kA = findCol(["kd_antrian", "kdantrian", "antrian", "queue", "queuenumber"]);
    const nM = findCol(["no_meja", "nomeja", "meja"]);

    if (kA !== -1) {
      headerRowIdx = r;
      kdAntrianIdx = kA;
      plateIdx = findCol(["nopol", "plat", "plate", "platenumber", "nomorpolisi"]);
      noMejaIdx = nM;
      mbsIdx = findCol(["mbs", "kategori", "cat"]);
      kodeIdx = findCol(["kode", "grade", "mutu", "kelas"]);
      tglNilaiIdx = findCol(["tgl_nilai", "tglnilai", "waktu_nilai", "nilai"]);
      tglDaftarIdx = findCol(["tgl_daftar", "tgldaftar", "waktu_daftar", "daftar", "timbang"]);
      break;
    }
  }

  // Fallback defaults if header row wasn't explicitly named
  if (headerRowIdx === -1) {
    headerRowIdx = 0;
    const firstCell = String(rawRows[0]?.[0] || "").trim();
    // If first cell looks like queue data (alphanumeric like 26K175531), row 0 is already data!
    const isFirstCellData = /^\d+[a-zA-Z0-9]+$/.test(firstCell) && rawRows[0].length >= 6;
    if (!isFirstCellData) throw new Error("Kolom kd_antrian tidak ditemukan. Gunakan template tapping yang tersedia.");
    kdAntrianIdx = 0;
    noMejaIdx = 1;
    mbsIdx = 2;
    kodeIdx = 3;
    tglNilaiIdx = 4;
    tglDaftarIdx = 5;
    headerRowIdx = isFirstCellData ? -1 : 0;
  }

  const startRow = headerRowIdx + 1;
  const records: TappingRecord[] = [];
  const byMeja: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let unassignedMeja = 0;

  for (let i = startRow; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    if (!row || row.length === 0 || row.every((c) => String(c ?? "").trim() === "")) continue;

    const rawQueue =
      kdAntrianIdx !== -1 && row[kdAntrianIdx] !== undefined
        ? String(row[kdAntrianIdx]).trim()
        : `Q-${i}`;
    if (!rawQueue) continue;

    const rawMejaVal = noMejaIdx !== -1 ? row[noMejaIdx] : undefined;
    const parsedMeja =
      rawMejaVal !== undefined && rawMejaVal !== ""
        ? Number(String(rawMejaVal).trim().replace(/^(?:MBS|Meja)\s*/i, ""))
        : undefined;
    const noMeja = parsedMeja && Number.isInteger(parsedMeja) && parsedMeja >= 1 && parsedMeja <= 5 ? parsedMeja : undefined;

    if (noMeja) {
      byMeja[noMeja] = (byMeja[noMeja] || 0) + 1;
    } else {
      unassignedMeja++;
    }

    const rawMbs = mbsIdx !== -1 && row[mbsIdx] !== undefined ? String(row[mbsIdx]).trim() : "";
    const rawKode =
      kodeIdx !== -1 && row[kodeIdx] !== undefined ? String(row[kodeIdx]).trim().toUpperCase() : "";
    const rawTglNilai =
      tglNilaiIdx !== -1 && row[tglNilaiIdx] !== undefined ? String(row[tglNilaiIdx]).trim() : "";
    const rawTglDaftar =
      tglDaftarIdx !== -1 && row[tglDaftarIdx] !== undefined ? String(row[tglDaftarIdx]).trim() : "";

    const dateDaftar = parseTrangkilDate(row[tglDaftarIdx], undefined, date1904);
    const dateNilai = parseTrangkilDate(row[tglNilaiIdx], dateDaftar ?? undefined, date1904);

    // Primary timestamp: prefer tgl_nilai (actual conveyor hoist time), fallback to tgl_daftar
    const primaryDate = dateNilai || dateDaftar;
    const timeDisplay = primaryDate
      ? primaryDate.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        })
      : rawTglNilai || rawTglDaftar;

    records.push({
      id: `trangkil_${i}_${rawQueue}`,
      queueNumber: rawQueue,
      tappingTimeStr: timeDisplay,
      tappingTime: primaryDate,
      plateNumber: plateIdx !== -1 ? String(row[plateIdx] ?? "").trim() : rawQueue,
      driverName: `Armada ${rawQueue}`,
      supplier: noMeja ? `PT Trangkil — Meja Tebu ${noMeja}` : "PT Trangkil",
      spatNumber: rawMbs ? `SPAT-MBS${noMeja || ""}-${rawMbs}` : "",
      noMeja,
      mbsRaw: rawMbs,
      factoryGrade: rawKode,
      tglNilaiStr: rawTglNilai,
      tglDaftarStr: rawTglDaftar,
      tglNilaiDate: dateNilai,
      tglDaftarDate: dateDaftar,
      notes: `Data Pos Timbang PT Trangkil (Meja ${noMeja || "-"}, Grade Pabrik: ${rawKode || "-"})`
    });
  }

  return {
    records,
    stats: {
      fileName: file.name,
      totalRecords: records.length,
      byMeja,
      unassignedMeja
    }
  };
}


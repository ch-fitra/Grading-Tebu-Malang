import { useState, useMemo, useEffect } from "react";
import {
  X,
  RefreshCw,
  UploadCloud,
  FileSpreadsheet,
  Download,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Truck,
  Clock,
  Layers,
  Info,
  Check,
  Building2
} from "lucide-react";
import * as XLSX from "xlsx";
import { useAppStore } from "../store";
import { downloadCsv } from "../utils/csv";
import { resolveMbsStation } from "./HistoryPage";
import type { TruckInspectionSession } from "../types";

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

interface ReconciliationRow {
  cycle: TruckInspectionSession;
  assignedTappingId: string | null;
  isManualOverride: boolean;
}

interface TappingSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (syncedCount: number) => void;
}

interface FileImportStats {
  fileName: string;
  totalRecords: number;
  byMeja: Record<number, number>;
  unassignedMeja: number;
}

// Helper to determine AI Grade from average impurity percent
function getAiGrade(impurity: number): string {
  if (impurity <= 2) return "S";
  if (impurity <= 5) return "M";
  if (impurity <= 10) return "A";
  if (impurity <= 15) return "D";
  if (impurity <= 20) return "B";
  return "G";
}

// Date parsing for PT Trangkil timestamp format (e.g., "2026-09-30 12:20:32.000")
function parseTrangkilDate(raw: unknown, fallbackDate?: Date): Date | null {
  if (!raw) return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
  if (typeof raw === "number" && raw > 30000) {
    const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return d;
  }
  const str = String(raw).trim();
  if (!str) return null;

  // Format: "YYYY-MM-DD HH:mm:ss.SSS" or "YYYY-MM-DD HH:mm:ss"
  const isoCandidate = str.replace(" ", "T");
  const direct = new Date(isoCandidate);
  if (!isNaN(direct.getTime())) return direct;

  const fallbackCandidate = new Date(str);
  if (!isNaN(fallbackCandidate.getTime())) return fallbackCandidate;

  // Time-only format: "12:20:32"
  const timeParts = str.split(":").map(Number);
  if (timeParts.length >= 2 && !isNaN(timeParts[0]) && !isNaN(timeParts[1])) {
    const base = fallbackDate ? new Date(fallbackDate) : new Date();
    base.setHours(timeParts[0], timeParts[1], timeParts[2] || 0, 0);
    return base;
  }

  return null;
}

// Universal parser for .xlsx, .xls, .csv, .txt files
async function parseExcelOrCsv(file: File): Promise<{
  records: TappingRecord[];
  stats: FileImportStats;
}> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

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

  for (let r = 0; r < Math.min(5, rawRows.length); r++) {
    const row = (rawRows[r] as unknown[]).map((c) =>
      String(c ?? "").toLowerCase().trim().replace(/[^a-z0-9_]/g, "")
    );
    const findCol = (keys: string[]) => row.findIndex((c) => keys.some((k) => c.includes(k)));

    const kA = findCol(["kd_antrian", "kdantrian", "antrian", "queue", "nopol", "plat"]);
    const nM = findCol(["no_meja", "nomeja", "meja"]);

    if (kA !== -1 || nM !== -1) {
      headerRowIdx = r;
      kdAntrianIdx = kA;
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
    const isFirstCellData = /^\d+[a-zA-Z0-9]+$/.test(firstCell);
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
        ? Number(String(rawMejaVal).replace(/[^0-9]/g, ""))
        : undefined;
    const noMeja = parsedMeja && parsedMeja >= 1 && parsedMeja <= 5 ? parsedMeja : undefined;

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

    const dateNilai = parseTrangkilDate(rawTglNilai);
    const dateDaftar = parseTrangkilDate(rawTglDaftar);

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
      plateNumber: rawQueue,
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

export function TappingSyncModal({ isOpen, onClose, onSuccess }: TappingSyncModalProps) {
  const { truckSessions, cameras, syncTappingData } = useAppStore();

  // All imported records (e.g. 5,894 across meja 1-5)
  const [allImportedRecords, setAllImportedRecords] = useState<TappingRecord[]>([]);
  const [fileStats, setFileStats] = useState<FileImportStats | null>(null);

  // Settings & Filters: DEFAULT TO MBS 5 (since PT Trangkil only has MBS 5 active)
  const [targetLine, setTargetLine] = useState<number | "all">(5);
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [dateFilter, setDateFilter] = useState<"today" | "all">("all");
  const [searchFilter, setSearchFilter] = useState("");

  // Matching & Submission State
  const [reconciliationRows, setReconciliationRows] = useState<ReconciliationRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccessCount, setSubmitSuccessCount] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Candidate cycles filtered by line and date
  const candidateCycles = useMemo(() => {
    return truckSessions
      .filter((s) => {
        if (targetLine !== "all") {
          const station = resolveMbsStation(s.line, cameras);
          if (station.mbsNum !== targetLine) return false;
        }
        if (
          onlyUnassigned &&
          s.plateNumber &&
          s.plateNumber.trim() !== "" &&
          s.plateNumber !== "-" &&
          !s.plateNumber.toLowerCase().includes("belum")
        ) {
          return false;
        }
        if (dateFilter === "today") {
          const sessionDate = new Date(s.startedAt).toDateString();
          const today = new Date().toDateString();
          if (sessionDate !== today) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  }, [truckSessions, targetLine, onlyUnassigned, dateFilter, cameras]);

  // Active records: Filter allImportedRecords according to selected targetLine
  // (Defaults to MBS 5, giving the exact ~1,487 records from PT Trangkil!)
  const activeRecords = useMemo(() => {
    if (allImportedRecords.length === 0) return [];
    if (targetLine === "all") return allImportedRecords;
    return allImportedRecords.filter((r) => r.noMeja === targetLine);
  }, [allImportedRecords, targetLine]);

  // Reset state when modal closes/opens so user starts with a clean upload state
  useEffect(() => {
    if (!isOpen) {
      setAllImportedRecords([]);
      setFileStats(null);
      setErrorMessage(null);
      setSubmitSuccessCount(null);
    }
  }, [isOpen]);

  // Intelligent Auto-Match Engine
  // Matches camera cycle startedAt with tgl_nilai (actual crane hoist time on the table)
  useEffect(() => {
    if (activeRecords.length === 0 || candidateCycles.length === 0) {
      setReconciliationRows(
        candidateCycles.map((c) => ({
          cycle: c,
          assignedTappingId: null,
          isManualOverride: false
        }))
      );
      return;
    }

    const usedTappingIds = new Set<string>();
    const rows: ReconciliationRow[] = [];

    // Sort candidate cycles chronologically
    const sortedCycles = [...candidateCycles].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );

    // Sort active tapping records chronologically
    const sortedTappings = [...activeRecords].sort((a, b) => {
      if (a.tappingTime && b.tappingTime) return a.tappingTime.getTime() - b.tappingTime.getTime();
      return a.queueNumber.localeCompare(b.queueNumber);
    });

    sortedCycles.forEach((cycle) => {
      const cycleStart = new Date(cycle.startedAt).getTime();

      // Priority 1: High-confidence match where |cycleStart - tglNilai| <= 25 minutes
      let bestMatch: TappingRecord | null = null;
      let minDiff = Infinity;

      for (const tap of sortedTappings) {
        if (usedTappingIds.has(tap.id)) continue;
        if (tap.tappingTime) {
          const diff = Math.abs(cycleStart - tap.tappingTime.getTime());
          if (diff <= 25 * 60000 && diff < minDiff) {
            minDiff = diff;
            bestMatch = tap;
          }
        }
      }

      // Priority 2: Antecedent tapping within 90 minutes prior to cycle
      if (!bestMatch) {
        for (const tap of sortedTappings) {
          if (usedTappingIds.has(tap.id)) continue;
          if (tap.tappingTime) {
            const tapTime = tap.tappingTime.getTime();
            if (tapTime <= cycleStart && cycleStart - tapTime <= 90 * 60000) {
              bestMatch = tap;
              break;
            }
          }
        }
      }

      // Priority 3: Fallback first available chronological record
      if (!bestMatch) {
        bestMatch = sortedTappings.find((t) => !usedTappingIds.has(t.id)) || null;
      }

      if (bestMatch) {
        usedTappingIds.add(bestMatch.id);
        rows.push({
          cycle,
          assignedTappingId: bestMatch.id,
          isManualOverride: false
        });
      } else {
        rows.push({
          cycle,
          assignedTappingId: null,
          isManualOverride: false
        });
      }
    });

    setReconciliationRows(rows);
  }, [activeRecords, candidateCycles]);

  if (!isOpen) return null;

  // Actions
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setErrorMessage(null);
      const parsed = await parseExcelOrCsv(file);
      if (parsed.records.length === 0) {
        setErrorMessage("Format file tidak terbaca atau tidak ada data yang valid.");
        return;
      }
      setAllImportedRecords(parsed.records);
      setFileStats(parsed.stats);
      // Ensure targetLine is default MBS 5 (the active line at PT Trangkil)
      setTargetLine(5);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Gagal memproses file Excel/CSV.");
    } finally {
      // Reset input value so re-uploading the same file triggers change
      e.target.value = "";
    }
  };

  const handleDownloadTemplate = () => {
    const header = ["kd_antrian", "no_meja", "mbs", "kode", "tgl_nilai", "tgl_daftar"];
    const rows = [
      ["26K175617", "5", "3", "A", "2026-09-30 12:20:32.000", "2026-09-30 12:13:24.326"],
      ["26K175615", "5", "3", "A", "2026-09-30 12:23:53.000", "2026-09-30 12:19:45.986"],
      ["26K175619", "5", "3", "A", "2026-09-30 12:29:02.000", "2026-09-30 12:24:07.730"],
      ["26K175548", "5", "5", "B", "2026-09-30 12:33:04.000", "2026-09-30 12:28:45.523"],
      ["26K175623", "5", "4", "D", "2026-09-30 12:54:57.000", "2026-09-30 12:51:25.300"]
    ];
    downloadCsv("DATA_CONTOH_PT_TRANGKIL.csv", [header, ...rows]);
  };

  const handleReassign = (cycleId: string, newTappingId: string | null) => {
    setReconciliationRows((prev) =>
      prev.map((row) => {
        if (row.cycle.id === cycleId) {
          return {
            ...row,
            assignedTappingId: newTappingId === "" ? null : newTappingId,
            isManualOverride: true
          };
        }
        return row;
      })
    );
  };

  // Swap two adjacent cycles if crane hoisted out of physical order
  const handleSwapAdjacent = (idxA: number, idxB: number) => {
    if (idxA < 0 || idxB < 0 || idxA >= reconciliationRows.length || idxB >= reconciliationRows.length) return;
    setReconciliationRows((prev) => {
      const next = [...prev];
      const tapA = next[idxA].assignedTappingId;
      const tapB = next[idxB].assignedTappingId;
      next[idxA] = { ...next[idxA], assignedTappingId: tapB, isManualOverride: true };
      next[idxB] = { ...next[idxB], assignedTappingId: tapA, isManualOverride: true };
      return next;
    });
  };

  // Submit Reconciliation to PostgreSQL
  const handleConfirmSync = async () => {
    const validMatches: Array<{
      id: string;
      truckCode?: string;
      plateNumber?: string;
      driverName?: string;
      supplier?: string;
      notes?: string;
    }> = [];

    reconciliationRows.forEach((row) => {
      if (!row.assignedTappingId) return;
      const tap = activeRecords.find((t) => t.id === row.assignedTappingId);
      if (!tap) return;

      const station = resolveMbsStation(row.cycle.line, cameras);
      const queueNote = tap.queueNumber ? `[Antrean: ${tap.queueNumber}]` : "";
      const mejaNote = tap.noMeja ? `[MBS ${tap.noMeja}]` : "";
      const gradeNote = tap.factoryGrade ? `[Grade Pabrik: ${tap.factoryGrade}]` : "";
      const timeNote = tap.tglNilaiStr ? `[Tgl Nilai: ${tap.tglNilaiStr}]` : "";
      const fullNotes = [row.cycle.notes, mejaNote, queueNote, gradeNote, timeNote].filter(Boolean).join(" ");

      validMatches.push({
        id: row.cycle.id,
        truckCode: `${tap.plateNumber} (${station.label})`,
        plateNumber: tap.plateNumber,
        driverName: tap.driverName,
        supplier: tap.supplier,
        notes: fullNotes
      });
    });

    if (validMatches.length === 0) {
      setErrorMessage("Tidak ada siklus yang dipasangkan dengan data tapping.");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      const count = await syncTappingData(validMatches);
      setSubmitSuccessCount(count);
      setTimeout(() => {
        onSuccess?.(count);
        onClose();
      }, 1600);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Gagal menyinkronkan data ke server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Summary Metrics
  const totalMatched = reconciliationRows.filter((r) => r.assignedTappingId !== null).length;
  const matchPercentage =
    candidateCycles.length > 0 ? Math.round((totalMatched / candidateCycles.length) * 100) : 0;

  // Filtered rows for search
  const visibleRows = reconciliationRows.filter((row) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    const tap = activeRecords.find((t) => t.id === row.assignedTappingId);
    return (
      row.cycle.truckCode.toLowerCase().includes(q) ||
      (tap && tap.plateNumber.toLowerCase().includes(q)) ||
      (tap && tap.queueNumber.toLowerCase().includes(q)) ||
      (tap && tap.factoryGrade && tap.factoryGrade.toLowerCase().includes(q))
    );
  });

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-modal-title"
    >
      <div className="tappingSyncModalCard" onClick={(e) => e.stopPropagation()}>
        {/* ─── Header ─── */}
        <div className="tappingSyncHeader">
          <div className="tappingSyncTitleGroup">
            <div className="tappingSyncIconBadge">
              <RefreshCw size={18} className="syncSpinIcon" />
            </div>
            <div>
              <div className="tappingSyncHeaderTags">
                <span className="tappingSyncTagPG">PT TRANGKIL (PATI)</span>
                <span className="tappingSyncTagOption">IMPORT DATA EXCEL PABRIK</span>
              </div>
              <h2 id="sync-modal-title" className="tappingSyncTitle">
                Rekonsiliasi Otomatis Data Excel Pabrik (Auto-Sync Tapping)
              </h2>
              <p className="tappingSyncSubtitle">
                Unggah langsung file Excel asli PT Trangkil (seluruh MBS 1–5). Sistem otomatis memfilter dan mencocokkan Meja 5 (MBS 5 aktif) serta membandingkan Grade Pabrik vs AI.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="tappingSyncCloseBtn"
            onClick={onClose}
            aria-label="Tutup modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* ─── Body ─── */}
        <div className="tappingSyncBody">
          {errorMessage && (
            <div className="tappingSyncErrorAlert">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {submitSuccessCount !== null && (
            <div className="tappingSyncSuccessAlert">
              <CheckCircle size={18} />
              <div>
                <strong>Berhasil Menyinkronkan!</strong>
                <p>
                  Sebanyak {submitSuccessCount} siklus inspeksi Meja Tebu telah diperbarui dengan nomor antrean dan grade pabrik PT Trangkil.
                </p>
              </div>
            </div>
          )}

          {/* ─── Top Control Bar: Upload & Helper Actions ─── */}
          <div className="tappingSyncTopPanel">
            <div className="tappingSyncUploadBox">
              <label className="tappingSyncFileLabel">
                <UploadCloud size={16} />
                <span>Upload Excel Pabrik (.xlsx / .csv)</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt"
                  className="tappingSyncFileInput"
                  onChange={handleFileUpload}
                />
              </label>

              <button
                type="button"
                className="tappingSyncHelperBtn ghost"
                onClick={handleDownloadTemplate}
                title="Download template file CSV sesuai format resmi PT Trangkil"
              >
                <Download size={14} />
                <span>Format Kolom Excel / CSV</span>
              </button>
            </div>

            {/* Filter Target Cycles */}
            <div className="tappingSyncFiltersWrap">
              <div className="tappingFilterGroup">
                <span className="filterLabel">Periode:</span>
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value as "today" | "all")}
                  className="tappingSelect"
                >
                  <option value="today">Hari Ini</option>
                  <option value="all">Semua Tanggal</option>
                </select>
              </div>

              <label
                className="tappingCheckboxLabel"
                title="Hanya tampilkan siklus yang belum memiliki plat nomor"
              >
                <input
                  type="checkbox"
                  checked={onlyUnassigned}
                  onChange={(e) => setOnlyUnassigned(e.target.checked)}
                />
                <span>Hanya Siklus Belum Terisi Plat</span>
              </label>
            </div>
          </div>

          {/* ─── Empty State: Prompt Upload Excel ─── */}
          {!fileStats && (
            <div className="tappingEmptyUploadCard">
              <div className="emptyUploadIconWrap">
                <FileSpreadsheet size={26} />
              </div>
              <div className="emptyUploadTextWrap">
                <h4>Belum Ada File Excel yang Dimuat</h4>
                <p>
                  Silakan klik tombol <strong>"Upload Excel Pabrik (.xlsx / .csv)"</strong> di atas dan pilih file Excel asli Anda (seperti <code>DATA TGL 30 SEPT - 5 OKT.xlsx</code>). Sistem otomatis membaca data, memfilter Meja 5, dan mencocokkannya dengan 12 siklus inspeksi di bawah.
                </p>
              </div>
            </div>
          )}

          {/* ─── PT Trangkil Multi-Meja Import Banner & Chips ─── */}
          {fileStats && (
            <div className="tappingTrangkilImportBanner">
              <div className="importBannerTop">
                <div className="importBannerFileDetails">
                  <FileSpreadsheet size={18} className="excelFileIcon" />
                  <div>
                    <div className="importFileNameRow">
                      <strong className="importFileName">{fileStats.fileName}</strong>
                      <span className="importRecordCountTag">
                        {fileStats.totalRecords.toLocaleString("id-ID")} Baris Data Dimuat
                      </span>
                      <span className="importTrangkilTag">Format PT Trangkil Terdeteksi ✓</span>
                    </div>
                    <p className="importBannerNote">
                      Seluruh data Meja 1–5 tersimpan di memori sistem. Karena saat ini baru{" "}
                      <strong>MBS 5</strong> yang aktif di PT Trangkil, sistem secara otomatis
                      memilih <strong>no_meja = 5</strong> ({fileStats.byMeja[5] || 0} data) untuk
                      rekonsiliasi langsung.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  className="btnRemoveFile"
                  onClick={() => {
                    setAllImportedRecords([]);
                    setFileStats(null);
                  }}
                  title="Hapus data file ini dan upload file baru"
                >
                  <X size={12} />
                  <span>Hapus File</span>
                </button>
              </div>

              {/* Interactive Meja Filter Chips */}
              <div className="importMejaDistributionBar">
                <span className="mejaChipsLabel">PILIH JALUR MEJA (MBS):</span>
                <div className="mejaChipsList">
                  {/* Default Active MBS 5 Button */}
                  <button
                    type="button"
                    className={`importMejaChip activeLineChip ${targetLine === 5 ? "selected" : ""}`}
                    onClick={() => setTargetLine(5)}
                    title="Tampilkan dan cocokkan khusus Meja 5 (MBS 5 aktif)"
                  >
                    <span className="chipLiveDot" />
                    <strong>MBS 5 (Aktif)</strong>
                    <span className="chipBadgeCount">{fileStats.byMeja[5] || 0} Truk</span>
                  </button>

                  {[1, 2, 3, 4].map((lineNum) => (
                    <button
                      key={lineNum}
                      type="button"
                      className={`importMejaChip ${targetLine === lineNum ? "selected" : ""}`}
                      onClick={() => setTargetLine(lineNum)}
                      title={`Tampilkan data Meja ${lineNum} (disiapkan untuk aktivasi mendatang)`}
                    >
                      <span>MBS {lineNum}</span>
                      <span className="chipBadgeCount">{fileStats.byMeja[lineNum] || 0} Truk</span>
                    </button>
                  ))}

                  <button
                    type="button"
                    className={`importMejaChip allChip ${targetLine === "all" ? "selected" : ""}`}
                    onClick={() => setTargetLine("all")}
                    title="Tampilkan seluruh meja 1-5 sekaligus"
                  >
                    <span>Semua Meja</span>
                    <span className="chipBadgeCount">{fileStats.totalRecords} Truk</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Stats KPI Strip ─── */}
          <div className="tappingSyncKpiStrip">
            <div className="syncKpiItem">
              <span className="kpiLabel">SIKLUS INSPEKSI DITEMUKAN</span>
              <strong className="kpiValue blue">{candidateCycles.length} Siklus</strong>
            </div>
            <div className="syncKpiItem">
              <span className="kpiLabel">DATA EXCEL TERFILTER (MBS {targetLine})</span>
              <strong className="kpiValue cyan">{activeRecords.length} Truk</strong>
            </div>
            <div className="syncKpiItem">
              <span className="kpiLabel">BERHASIL DIPASANGKAN</span>
              <strong className="kpiValue green">
                {totalMatched} / {candidateCycles.length} ({matchPercentage}%)
              </strong>
            </div>
            <div className="syncKpiItem">
              <span className="kpiLabel">SIKLUS BELUM TERPASANG</span>
              <strong className="kpiValue amber">
                {Math.max(0, candidateCycles.length - totalMatched)} Siklus
              </strong>
            </div>
          </div>

          {/* ─── Search & Table Controls ─── */}
          <div className="tappingSyncTableControls">
            <div className="tappingSearchWrap">
              <input
                type="text"
                placeholder="Cari kode siklus, no antrean (26K...), grade pabrik (A/B/D), atau waktu..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="tappingSearchInput"
              />
            </div>
            <div className="tappingTableGuideText">
              <Info size={13} />
              <span>
                Pencocokan didasarkan pada <strong>tgl_nilai</strong> (waktu bongkar meja). Jika terjadi{" "}
                <strong>salip antrean derek</strong>, ubah pilihan truk pada dropdown atau tukar posisi.
              </span>
            </div>
          </div>

          {/* ─── Main Comparison & Reconciliation Table ─── */}
          <div className="tappingTableWrap">
            {candidateCycles.length === 0 ? (
              <div className="tappingEmptyState">
                <Layers size={32} />
                <h4>Tidak Ada Siklus yang Perlu Direkonsiliasi</h4>
                <p>
                  Semua siklus pada filter saat ini sudah terisi plat nomor atau tidak ada rekaman pemindaian pada Meja MBS {targetLine}.
                </p>
              </div>
            ) : (
              <table className="tappingComparisonTable">
                <thead>
                  <tr>
                    <th style={{ width: "35px" }}>#</th>
                    <th>Siklus AI Meja Tebu</th>
                    <th style={{ width: "120px" }}>Jeda Waktu</th>
                    <th>Data Truk & Grade PT Trangkil</th>
                    <th style={{ width: "140px", textAlign: "right" }}>Koreksi Urutan</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, idx) => {
                    const cycle = row.cycle;
                    const station = resolveMbsStation(cycle.line, cameras);
                    const cycleStart = new Date(cycle.startedAt);
                    const matchedTap = activeRecords.find((t) => t.id === row.assignedTappingId);
                    const aiGrade = getAiGrade(cycle.averageImpurity);

                    // Compute time difference in minutes
                    let gapMinutes: number | null = null;
                    let gapStatus: "optimal" | "fast" | "delayed" | "reverse" | "none" = "none";

                    if (matchedTap && matchedTap.tappingTime) {
                      gapMinutes = Math.round(
                        (cycleStart.getTime() - matchedTap.tappingTime.getTime()) / 60000
                      );
                      if (gapMinutes < 0) {
                        gapStatus = "reverse";
                      } else if (gapMinutes < 5) {
                        gapStatus = "fast";
                      } else if (gapMinutes <= 45) {
                        gapStatus = "optimal";
                      } else {
                        gapStatus = "delayed";
                      }
                    }

                    // Compare Factory Grade vs AI Grade
                    const isGradeMatch =
                      matchedTap && matchedTap.factoryGrade
                        ? matchedTap.factoryGrade === aiGrade
                        : null;

                    return (
                      <tr key={cycle.id} className={row.assignedTappingId ? "matched" : "unmatched"}>
                        {/* Index */}
                        <td className="rowIdxCell">{idx + 1}</td>

                        {/* Left: AI Inspection Cycle */}
                        <td>
                          <div className="cycleInfoCell">
                            <div className="cycleMainTitle">
                              <span className="cycleCode">{cycle.truckCode}</span>
                              <span className="cycleStationBadge">{station.label}</span>
                              <span className="cycleAiGradeBadge">Grade AI: {aiGrade}</span>
                            </div>
                            <div className="cycleMetaSub">
                              <Clock size={11} />
                              <span>
                                Jam Mulai:{" "}
                                <strong>
                                  {cycleStart.toLocaleTimeString("id-ID", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit"
                                  })}
                                </strong>
                              </span>
                              <span>•</span>
                              <span>
                                {cycle.totalCaptures} Frame • Impurity:{" "}
                                <strong>{cycle.averageImpurity.toFixed(1)}%</strong>
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Middle: Delay / Time Gap */}
                        <td>
                          {matchedTap && gapMinutes !== null ? (
                            <div className="timeGapWrap">
                              <span className={`timeGapBadge ${gapStatus}`}>
                                {gapStatus === "reverse" ? (
                                  <>
                                    <AlertTriangle size={11} />
                                    <span>{gapMinutes}m</span>
                                  </>
                                ) : (
                                  <>
                                    <ArrowRight size={11} />
                                    <span>+{gapMinutes}m</span>
                                  </>
                                )}
                              </span>
                              <span className="timeGapHint">
                                {gapStatus === "optimal"
                                  ? "Wajar (Antrean Normal)"
                                  : gapStatus === "fast"
                                  ? "Langsung Giling"
                                  : gapStatus === "delayed"
                                  ? "Antrean Panjang"
                                  : "Cek Jam"}
                              </span>
                            </div>
                          ) : (
                            <span className="timeGapBadge empty">
                              {allImportedRecords.length === 0 ? "— Menunggu File —" : "— Belum Ada —"}
                            </span>
                          )}
                        </td>

                        {/* Right: Matched PT Trangkil Record & Dropdown Selector */}
                        <td>
                          {allImportedRecords.length === 0 ? (
                            <div className="tappingWaitingUpload">
                              <span className="waitingUploadBadge">Menunggu File Excel</span>
                              <span className="waitingUploadSub">Unggah file Excel pabrik untuk mencocokkan nopol & grade</span>
                            </div>
                          ) : (
                            <div className="tappingMatchCell">
                              <div className="tappingSelectorRow">
                                <select
                                  className={`tappingRecordSelect ${row.assignedTappingId ? "selected" : ""}`}
                                  value={row.assignedTappingId ?? ""}
                                  onChange={(e) => handleReassign(cycle.id, e.target.value)}
                                >
                                  <option value="">— Lewati / Tidak Dipasangkan —</option>
                                  {activeRecords.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      [{t.queueNumber}] Meja {t.noMeja ?? 5} — Grade: {t.factoryGrade || "-"} ({t.tappingTimeStr})
                                    </option>
                                  ))}
                                </select>
                                {row.isManualOverride && (
                                  <span className="manualOverrideBadge" title="Dipilih manual oleh mandor">
                                    Manual
                                  </span>
                                )}
                              </div>

                            {matchedTap ? (
                              <div className="matchedTruckDetailCard">
                                <div className="matchedPlateRow">
                                  <strong className="plateNumberText">{matchedTap.plateNumber}</strong>
                                  <span className="queueBadge">Antrean {matchedTap.queueNumber}</span>
                                  {matchedTap.noMeja && (
                                    <span className="mejaBadge">Meja {matchedTap.noMeja}</span>
                                  )}
                                  {matchedTap.factoryGrade && (
                                    <span className="factoryGradeBadge">
                                      Grade Pabrik: <strong>{matchedTap.factoryGrade}</strong>
                                    </span>
                                  )}
                                  {isGradeMatch !== null && (
                                    <span
                                      className={`gradeMatchTag ${isGradeMatch ? "match" : "diff"}`}
                                      title={
                                        isGradeMatch
                                          ? "Grade AI dan Grade Pabrik Cocok Sama"
                                          : `Grade AI (${aiGrade}) berbeda dengan Grade Pabrik (${matchedTap.factoryGrade})`
                                      }
                                    >
                                      {isGradeMatch ? (
                                        <>
                                          <Check size={10} />
                                          <span>Grade Cocok ({matchedTap.factoryGrade})</span>
                                        </>
                                      ) : (
                                        <span>
                                          AI: {aiGrade} vs Pabrik: {matchedTap.factoryGrade}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </div>
                                <div className="matchedSubRow">
                                  <span>
                                    Waktu Bongkar Meja (tgl_nilai):{" "}
                                    <strong>{matchedTap.tglNilaiStr || matchedTap.tappingTimeStr}</strong>
                                  </span>
                                  {matchedTap.tglDaftarStr && (
                                    <>
                                      <span>•</span>
                                      <span>
                                        Registrasi (tgl_daftar):{" "}
                                        <strong>{matchedTap.tglDaftarStr}</strong>
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="noMatchNotice">
                                <span>Pilih data antrean Excel di atas untuk menghubungkan siklus ini</span>
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                        {/* Action: Quick Swap Adjacent */}
                        <td style={{ textAlign: "right" }}>
                          <div className="quickSwapButtons">
                            <button
                              type="button"
                              className="swapBtn"
                              onClick={() => handleSwapAdjacent(idx, idx - 1)}
                              disabled={idx === 0}
                              title="Tukar pasangan dengan siklus di atasnya"
                            >
                              <ArrowUpDown size={11} />
                              <span>Tukar Atas</span>
                            </button>
                            <button
                              type="button"
                              className="swapBtn"
                              onClick={() => handleSwapAdjacent(idx, idx + 1)}
                              disabled={idx === visibleRows.length - 1}
                              title="Tukar pasangan dengan siklus di bawahnya"
                            >
                              <ArrowUpDown size={11} />
                              <span>Tukar Bawah</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ─── Footer ─── */}
        <div className="tappingSyncFooter">
          <div className="tappingFooterLeft">
            <span className="footerSummary">
              Siap menautkan <strong>{totalMatched}</strong> dari{" "}
              <strong>{candidateCycles.length}</strong> siklus inspeksi Meja Tebu MBS {targetLine}.
            </span>
          </div>

          <div className="tappingFooterRight">
            <button
              type="button"
              className="tappingCancelBtn"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Batal
            </button>

            <button
              type="button"
              className="tappingSubmitBtn"
              onClick={handleConfirmSync}
              disabled={isSubmitting || totalMatched === 0}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={14} className="syncSpinIcon" />
                  <span>Menyimpan Rekonsiliasi...</span>
                </>
              ) : (
                <>
                  <CheckCircle size={14} />
                  <span>Terapkan Rekonsiliasi ({totalMatched} Siklus)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

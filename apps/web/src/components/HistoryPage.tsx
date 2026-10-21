import { usePanelSize } from "../hooks/usePanelSize";
import { frameNumbers, dominantGrade } from "../utils/grade-data";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  History,
  Calendar,
  Camera,
  Filter,
  Search,
  X,
  RotateCcw,
  Download,
  Truck,
  Clock,
  Building2,
  Sun,
  Moon,
  ShieldCheck,
  CheckCircle,
  Eye,
  Trash2,
  Layers,
  Lock,
  ChevronDown,
  SlidersHorizontal,
  FileSpreadsheet
} from "lucide-react";
import { useAppStore } from "../store";
import { downloadCsv } from "../utils/csv";
import { TruckInspectionDetailModal } from "./TruckInspectionDetailModal";
import { TappingSyncModal } from "./TappingSyncModal";
import { RequestDeletionModal } from "./RequestDeletionModal";
import { AdminApprovalQueueModal } from "./AdminApprovalQueueModal";
import { TRANGKIL_GRADES, normalizeGrade } from "../utils/grade-guide";
import { aiApi, backendUrl } from "../utils/api";
import type { TruckInspectionSession, InferenceResult } from "../types";

import { resolveMbsStation } from "../utils/stations";

type HistorySummary = {
  total_captures: number;
  average_confidence: number | null;
  average_impurity: number | null;
};

export function HistoryPage() {
  const { history, truckSessions, cameras, session, status, deleteTruckInspection, deleteInference, deletionRequests } = useAppStore();
  const frameNumberMap = frameNumbers(history, truckSessions || []);
  const frameNumber = (id: number) => frameNumberMap.get(id) ?? 1;
  const cycleGrade = (row: TruckInspectionSession) => {
    const ids = new Set(row.captureIds || []);
    const start = new Date(row.startedAt).getTime();
    const end = row.completedAt ? new Date(row.completedAt).getTime() : Date.now();
    return dominantGrade(history.filter(item => ids.size ? ids.has(item.id) :
      new Date(item.timestamp).getTime() >= start - 1000 && new Date(item.timestamp).getTime() <= end + 1000)) ?? "M";
  };
  const canWrite = useAppStore(s => s.session?.user.permissions?.includes("inspection.write") ?? false);
  const isAdmin = session?.user.role === "admin";
  const isOperator = session?.user.role === "operator";
  const [requestDeletionTarget, setRequestDeletionTarget] = useState<{
    targetType: "inference" | "truck_inspection";
    targetId: string | number;
    title: string;
    subtitle?: string;
    snapshotPath?: string;
  } | null>(null);
  const [isApprovalQueueOpen, setIsApprovalQueueOpen] = useState(false);

  const pendingRequestsCount = deletionRequests.filter(r => r.status === "pending").length;
  const pendingInferenceIds = useMemo(() => new Set(
    deletionRequests
      .filter(r => r.status === "pending" && r.targetType === "inference")
      .map(r => Number(r.targetId))
  ), [deletionRequests]);

  const [activeTab, setActiveTab] = useState<"trucks" | "captures">("trucks");
  const [selectedTruckSession, setSelectedTruckSession] = useState<TruckInspectionSession | null>(null);
  const [selectedCapture, setSelectedCapture] = useState<InferenceResult | null>(null);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  // Search & Filtering States
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDateFilter, setSelectedDateFilter] = useState<"all" | "today" | "7d" | "30d">("all");
  const [selectedLineFilter, setSelectedLineFilter] = useState<number | "all">("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string | "all">("all");

  const panelSize = usePanelSize<HTMLElement>();
  const compactLayout = panelSize.width < 1050 || panelSize.height < 560;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [compactCyclePageSize, setCompactCyclePageSize] = useState(5);
  const [captureDetailPanel, setCaptureDetailPanel] = useState("image");
  useEffect(() => { setCaptureDetailPanel("image"); }, [selectedCapture?.id]);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [capturePageSize, setCapturePageSize] = useState(5);
  const [historyRowHeight, setHistoryRowHeight] = useState(52);
  const historyPageSize = activeTab === "trucks" ? (compactLayout ? compactCyclePageSize : 5) : capturePageSize;
  useEffect(() => {
    setHistoryPage(1);
  }, [activeTab, searchQuery, selectedDateFilter, selectedLineFilter, selectedStatusFilter]);
  useEffect(() => {
    const table = tableWrapRef.current;
    if (!table) return;
    const observer = new ResizeObserver(([entry]) => {
      setCapturePageSize(Math.max(1, Math.floor((entry.contentRect.height - (compactLayout ? 0 : 38)) / (compactLayout ? 72 : 52))));
      setCompactCyclePageSize(Math.max(1, Math.min(5, Math.floor(entry.contentRect.height / 68))));
      setHistoryRowHeight(Math.max(1, Math.floor((entry.contentRect.height - 38) / 5)));
    });
    observer.observe(table);
    return () => observer.disconnect();
  }, [compactLayout]);

  // Clock ticker & theme
  const [clock, setClock] = useState(new Date());
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (document.documentElement.dataset.theme as "light" | "dark") || "dark";
  });

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("tebu-ui-theme", next);
  };

  const userFactory = (() => {
    const u = (session?.user.username || "").toLowerCase();
    if (u.includes("kebonagung") || u.includes("malang")) return "kebonagung";
    if (u.includes("trangkil")) return "trangkil";
    return null;
  })();

  const visibleCameras = cameras.filter((c) => {
    if (!userFactory) return true;
    const text = `${c.name} ${c.location}`.toLowerCase();
    return userFactory === "kebonagung" ? (text.includes("kebon agung") || text.includes("malang")) : text.includes("trangkil");
  });
  const availableLines = new Set(visibleCameras.map(camera => resolveMbsStation(camera.id, cameras).mbsNum));
  const allowedCameraIds = new Set(visibleCameras.map(c => c.id));
  const visibleHistory = history.filter(h => !userFactory || allowedCameraIds.has(h.cameraId));
  const visibleTrucks = truckSessions.filter(t => !userFactory || allowedCameraIds.has(t.line));
  const summaryCameraScope = visibleCameras
    .filter(camera => selectedLineFilter === "all" || resolveMbsStation(camera.id, cameras).mbsNum === selectedLineFilter)
    .map(camera => camera.id).sort((a, b) => a - b).join(",");
  const [captureSummary, setCaptureSummary] = useState<HistorySummary | null>(null);
  const [summaryUnavailable, setSummaryUnavailable] = useState(false);

  useEffect(() => {
    setCaptureSummary(null);
    setSummaryUnavailable(false);
    if (!session || !summaryCameraScope) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const loadSummary = async () => {
      const params = new URLSearchParams();
      for (const id of summaryCameraScope.split(",")) params.append("camera_ids", id);
      const now = new Date();
      if (selectedDateFilter === "today") {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        params.set("start_at", start.toISOString());
        params.set("end_at", end.toISOString());
      } else if (selectedDateFilter !== "all") {
        const days = selectedDateFilter === "7d" ? 7 : 30;
        params.set("start_at", new Date(now.getTime() - days * 86400000).toISOString());
      }
      if (searchQuery.trim()) params.set("search", searchQuery.trim().slice(0, 500));
      try {
        const summary = await aiApi<HistorySummary>(`/inference/history-summary?${params}`, {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)])
        });
        if (!cancelled) {
          setCaptureSummary(summary);
          setSummaryUnavailable(false);
        }
      } catch {
        if (!cancelled) setSummaryUnavailable(true);
      } finally {
        if (!cancelled) timer = setTimeout(loadSummary, 3000);
      }
    };
    // Debounce typing and keep aggregate requests independent of the preview limit.
    timer = setTimeout(loadSummary, 200);
    return () => { cancelled = true; abort.abort(); clearTimeout(timer); };
  }, [session?.token, summaryCameraScope, selectedDateFilter, searchQuery]);

  // Close modals on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedCapture(null);
        setSelectedTruckSession(null);
        setIsSyncModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Filtered truck cycles list
  const filteredTrucks = useMemo(() => {
    return visibleTrucks.filter((truck) => {
      // Date filter
      if (selectedDateFilter !== "all") {
        const itemTime = new Date(truck.startedAt).getTime();
        const now = Date.now();
        if (selectedDateFilter === "today") {
          const isToday = new Date(truck.startedAt).toDateString() === new Date().toDateString();
          if (!isToday) return false;
        } else if (selectedDateFilter === "7d") {
          if (now - itemTime > 7 * 86400000) return false;
        } else if (selectedDateFilter === "30d") {
          if (now - itemTime > 30 * 86400000) return false;
        }
      }
      // Search query (truck code, plate number, driver name)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchCode = (truck.truckCode || "").toLowerCase().includes(q);
        const matchPlate = (truck.plateNumber || "").toLowerCase().includes(q);
        const matchDriver = (truck.driverName || "").toLowerCase().includes(q);
        if (!matchCode && !matchPlate && !matchDriver) return false;
      }
      // Line filter with resolveMbsStation mapping
      if (selectedLineFilter !== "all") {
        const mbsNum = resolveMbsStation(truck.line, cameras).mbsNum;
        if (mbsNum !== selectedLineFilter) return false;
      }
      // Status filter
      if (selectedStatusFilter !== "all" && truck.status !== selectedStatusFilter) {
        return false;
      }
      return true;
    });
  }, [visibleTrucks, searchQuery, selectedDateFilter, selectedLineFilter, selectedStatusFilter, cameras]);

  // Filtered raw frame captures list
  const filteredHistory = useMemo(() => {
    return visibleHistory.filter((item) => {
      // Date filter
      if (selectedDateFilter !== "all") {
        const itemTime = new Date(item.timestamp).getTime();
        const now = Date.now();
        if (selectedDateFilter === "today") {
          const isToday = new Date(item.timestamp).toDateString() === new Date().toDateString();
          if (!isToday) return false;
        } else if (selectedDateFilter === "7d") {
          if (now - itemTime > 7 * 86400000) return false;
        } else if (selectedDateFilter === "30d") {
          if (now - itemTime > 30 * 86400000) return false;
        }
      }
      if (searchQuery.trim()) {
        const truck = visibleTrucks.find(truck => truck.captureIds?.includes(item.id));
        const text = [item.id, item.grade, item.timestamp, cameras.find(camera => camera.id === item.cameraId)?.name, truck?.truckCode, truck?.plateNumber, truck?.driverName].join(" ").toLowerCase();
        if (!text.includes(searchQuery.trim().toLowerCase())) return false;
      }
      // Line filter with resolveMbsStation mapping
      if (selectedLineFilter !== "all") {
        const mbsNum = resolveMbsStation(item.cameraId, cameras).mbsNum;
        if (mbsNum !== selectedLineFilter) return false;
      }
      return true;
    });
  }, [visibleHistory, visibleTrucks, searchQuery, selectedDateFilter, selectedLineFilter, cameras]);

  // Summary KPIs based on filtered or active records
  const historyRecordCount = activeTab === "trucks" ? filteredTrucks.length : filteredHistory.length;
  const historyPages = Math.max(1, Math.ceil(historyRecordCount / historyPageSize));
  const safeHistoryPage = Math.min(historyPage, historyPages);
  const historyPageStart = (safeHistoryPage - 1) * historyPageSize;
  const pagedTrucks = filteredTrucks.slice(historyPageStart, historyPageStart + historyPageSize);
  const pagedCaptures = filteredHistory.slice(historyPageStart, historyPageStart + historyPageSize);
  const totalCyclesCount = filteredTrucks.length;
  const completedCyclesCount = filteredTrucks.filter(t => t.status === "completed").length;
  const totalCapturesCount = captureSummary?.total_captures;

  const averageConfidence = captureSummary?.average_confidence != null
    ? `${Math.round(captureSummary.average_confidence * 100)}%`
    : "—";

  const averageImpurity = captureSummary?.average_impurity != null
    ? `${captureSummary.average_impurity.toFixed(1)}%`
    : "—";

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
    selectedDateFilter !== "all" ||
    (selectedLineFilter !== "all") ||
    selectedStatusFilter !== "all"
  );

  const activeFiltersCount = [
    Boolean(searchQuery.trim()),
    selectedDateFilter !== "all",
    selectedLineFilter !== "all",
    selectedStatusFilter !== "all"
  ].filter(Boolean).length;

  const handleResetFilters = () => {
    setSearchQuery("");
    setSelectedDateFilter("all");
    setSelectedLineFilter("all");
    setSelectedStatusFilter("all");
  };

  function exportCsv() {
    const header = [
      "Timestamp",
      "Meja Tebu (MBS)",
      "Predicted Grade",
      "Karakteristik & Simbol",
      "Ambang Toleransi",
      "Kebijakan Rafaksi",
      "Status Giling",
      "Akurasi AI (%)"
    ];
    const body = filteredHistory.map((row) => {
      const station = resolveMbsStation(row.cameraId, cameras);
      const capGrade = normalizeGrade(row.grade);
      const curConfig = TRANGKIL_GRADES.find(g => g.code === capGrade) || TRANGKIL_GRADES[1];
      return [
        new Date(row.timestamp).toLocaleString("id-ID"),
        `${station.label} (${station.subLabel})`,
        `MBS ${capGrade}`,
        curConfig.name,
        curConfig.tol,
        curConfig.rafaksi,
        curConfig.status,
        Math.round((row.confidence ?? 0) * 100)
      ];
    });
    downloadCsv(`tebu-frame-log-${Date.now()}.csv`, [header, ...body]);
  }

  function exportTruckCsv() {
    const header = [
      "Kode Siklus / Truk",
      "Plat Armada",
      "Nama Supir",
      "Petani / Vendor",
      "Stasiun MBS",
      "Waktu Mulai",
      "Waktu Selesai",
      "Total Frame",
      "Rata-rata Kotoran (%)",
      "Predicted Grade AI",
      "Rata-rata Akurasi (%)",
      "Keputusan Pabrik",
      "Status",
      "Catatan / SPAT"
    ];
    const body = filteredTrucks.map((row) => {
      const station = resolveMbsStation(row.line, cameras);
      return [
        row.truckCode,
        row.plateNumber || "-",
        row.driverName || "-",
        row.supplier || "-",
        `${station.label} (${station.subLabel})`,
        new Date(row.startedAt).toLocaleString("id-ID"),
        row.completedAt ? new Date(row.completedAt).toLocaleString("id-ID") : "Aktif",
        row.totalCaptures,
        row.impurityMeasured ? `${row.averageImpurity.toFixed(2)}%` : "Tidak diukur",
        `MBS ${cycleGrade(row)}`,
        `${Math.round((row.averageConfidence ?? 0) * 100)}%`,
        TRANGKIL_GRADES.find(g => g.code === cycleGrade(row))?.decision ?? "Belum ditetapkan",
        row.status,
        row.notes || "-"
      ];
    });
    downloadCsv(`rekap-siklus-tebu-${Date.now()}.csv`, [header, ...body]);
  }

  const isDbOnline = status?.database.status === "ok" || status?.database.status === "dev-memory";

  return (
    <section ref={panelSize.ref} className="historyPageContainer" data-view={activeTab} data-compact={compactLayout} data-short={panelSize.height < 500}>
      {/* ─── Top Station Header (Matches Dashboard Cockpit) ─── */}
      <div className="stationHeader">
        <div className="stationHeaderLeft">
          <div className="stationLogoBadge" title={userFactory === "kebonagung" ? "PG Kebon Agung (Malang)" : userFactory === "trangkil" ? "PG Trangkil (Pati)" : "Semua Pabrik"}>
            {userFactory !== "kebonagung" && <img
              src={`${import.meta.env.BASE_URL}logo-trangkil.png`}
              alt="Pabrik Gula Trangkil"
              className="stationTrangkilLogo"
            />}
            <span className="stationFactoryCity">{userFactory === "kebonagung" ? "PG Kebon Agung, Malang" : userFactory === "trangkil" ? "Pati, Jawa Tengah" : "Riwayat Semua Pabrik"}</span>
          </div>

          <div className="historyTitleBadge">
            <History size={12} />
            <span>LOG MUTU AI</span>
          </div>

          {/* Quick Line Selector Filters */}
          <div className="stationMbsTabs">
            <button
              type="button"
              className="stationMbsTab locked"
              disabled
              title="Semua Meja — Jalur Terkunci (Hanya MBS 5 yang aktif di PG Trangkil)"
            >
              <Layers size={10} />
              <span>Semua Meja</span>
            </button>
            {[1, 2, 3, 4, 5].map((lineNum) => {
              const isLocked = !availableLines.has(lineNum);
              const isSelected = selectedLineFilter === lineNum;
              return (
                <button
                  key={lineNum}
                  type="button"
                  className={`stationMbsTab ${isSelected ? "active" : ""} ${isLocked ? "locked" : ""}`}
                  onClick={() => { if (!isLocked) setSelectedLineFilter(lineNum); }}
                  disabled={isLocked}
                  title={isLocked ? `MBS ${lineNum} — Jalur Terkunci` : `MBS 5 (Wisenet) — Kamera Aktif Online`}
                >
                  {isLocked && <Lock size={10} />}
                  <span>MBS {lineNum}</span>
                  {!isLocked && <span className="stationMbsDot live" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="stationHeaderRight">
          <div className="stationStatusChips">
            <div className={`stChip ${isDbOnline ? "ok" : "err"}`} title="Status Koneksi Database Server">
              <CheckCircle size={11} />
              <span>Database Log</span>
            </div>
            {isAdmin && (
              <button
                type="button"
                className="stChip"
                onClick={() => setIsApprovalQueueOpen(true)}
                title="Pusat Otorisasi & Persetujuan Direksi (Maker-Checker)"
                style={{
                  background: pendingRequestsCount > 0 ? "rgba(245, 158, 11, 0.25)" : "rgba(30, 41, 59, 0.7)",
                  borderColor: pendingRequestsCount > 0 ? "rgba(245, 158, 11, 0.5)" : "rgba(255, 255, 255, 0.15)",
                  color: pendingRequestsCount > 0 ? "#fbbf24" : "#cbd5e1",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                <ShieldCheck size={12} />
                <span>Persetujuan Direksi</span>
                {pendingRequestsCount > 0 && (
                  <span style={{
                    background: "#ef4444",
                    color: "#fff",
                    fontSize: "10px",
                    padding: "1px 5px",
                    borderRadius: "6px",
                    fontWeight: 700
                  }}>
                    {pendingRequestsCount}
                  </span>
                )}
              </button>
            )}
          </div>

          <div className="stationClock">
            <Clock size={12} />
            <span>{clock.toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          </div>

          <button
            type="button"
            className="stationThemeToggleBtn"
            onClick={toggleTheme}
            title={theme === "light" ? "Beralih ke Mode Gelap" : "Beralih ke Mode Terang"}
          >
            {theme === "light" ? <Moon size={12} /> : <Sun size={12} />}
            <span>{theme === "light" ? "Dark" : "Light"}</span>
          </button>
        </div>
      </div>

      {/* ─── Main Content Body ─── */}
      <div className="historyContentBody">
        {/* Navigation Mode Switcher Tabs & Action Toolbar */}
        <div className="historyModeTabsRow">
          <div className="historyModeTabs">
            <button
              type="button"
              className={`historyModeBtn ${activeTab === "trucks" ? "active" : ""}`}
              onClick={() => setActiveTab("trucks")}
            >
              <RotateCcw size={13} />
              <span className="historyModeFullLabel">Riwayat Siklus Pemindaian ({filteredTrucks.length} Siklus)</span><span className="historyModeShortLabel">Siklus ({filteredTrucks.length})</span>
            </button>
            <button
              type="button"
              className={`historyModeBtn ${activeTab === "captures" ? "active" : ""}`}
              onClick={() => setActiveTab("captures")}
            >
              <Camera size={13} />
              <span className="historyModeFullLabel">Tangkapan Frame Kamera ({filteredHistory.length} Frame)</span><span className="historyModeShortLabel">Frame ({filteredHistory.length})</span>
            </button>
          </div>

          <div className="historyHeaderActions">
            <button type="button" className="responsiveFilterToggle" aria-label="Filter history" aria-expanded={filtersOpen} aria-controls="history-filters" onClick={() => setFiltersOpen(open => !open)}><Filter size={14} /><span>Filter {activeFiltersCount > 0 ? `(${activeFiltersCount})` : ""}</span></button>
            {activeTab === "trucks" && (
              <button
                type="button"
                className="historySyncBtn"
                onClick={() => setIsSyncModalOpen(true)}
                title="Unggah langsung file Excel asli PT Trangkil dan cocokkan secara otomatis dengan siklus inspeksi Meja Tebu"
              >
                <FileSpreadsheet size={13} />
                <span>Upload Excel Pabrik</span>
              </button>
            )}

            <button
              type="button"
              className="historyExportBtn"
              onClick={activeTab === "trucks" ? exportTruckCsv : exportCsv}
              title="Download file CSV hasil rekap data ini"
            >
              <Download size={13} />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* ─── Cockpit KPI Summary Cards (Balanced 4-Column Grid) ─── */}
        <div className="historyKpiGrid">
          <div className="historyKpiCard">
            <span className="historyKpiLabel">TOTAL SIKLUS PEMINDAIAN</span>
            <strong className="historyKpiValue blue">
              {totalCyclesCount}
              <span className="historyKpiUnit">Siklus</span>
            </strong>
            <span className="historyKpiSub">
              {completedCyclesCount} siklus telah selesai digiling
            </span>
          </div>

          <div className="historyKpiCard">
            <span className="historyKpiLabel">TOTAL TANGKAPAN FRAME AI</span>
            <strong className="historyKpiValue cyan" title={summaryUnavailable ? "Total frame belum berhasil diperbarui" : undefined}>
              {totalCapturesCount?.toLocaleString("id-ID") ?? "—"}
              <span className="historyKpiUnit">Frame</span>
            </strong>
            <span className="historyKpiSub">
              Tersimpan di local storage server
            </span>
          </div>

          <div className="historyKpiCard">
            <span className="historyKpiLabel">RATA-RATA AKURASI MODEL</span>
            <strong className="historyKpiValue green">
              {averageConfidence}
            </strong>
            <span className="historyKpiSub">
              {status?.ai.model?.available ? "Model ONNX Aktif" : "Model ONNX Belum Tersedia"}
            </span>
          </div>

          <div className="historyKpiCard">
            <span className="historyKpiLabel">RATA-RATA KOTORAN (IMPURITY)</span>
            <strong className="historyKpiValue amber">
              {averageImpurity}
            </strong>
            <span className="historyKpiSub">
              Toleransi standar pabrik PG Trangkil
            </span>
          </div>
        </div>

        {/* ─── Cockpit Filter & Search Console ─── */}
        <div id="history-filters" className="historyCockpitFilterCard" data-open={filtersOpen}>
          {/* Top Console Bar */}
          <div className="filterCardHeader">
            <div className="filterHeaderLeft">
              <span className="filterConsoleBadge">
                <SlidersHorizontal size={11} />
                <span>KONSOL FILTER & PENCARIAN MUTU</span>
              </span>
              {activeFiltersCount > 0 && (
                <span className="filterActiveCounterBadge">
                  <span className="activeDotPulse" />
                  <span>{activeFiltersCount} Filter Aktif</span>
                </span>
              )}
            </div>

            <div className="filterHeaderRight">
              <button type="button" className="responsiveFilterClose" onClick={() => setFiltersOpen(false)} aria-label="Tutup filter"><X size={16} /></button>
              <span className="filterResultsBadge">
                Ditemukan <strong>{activeTab === "trucks" ? filteredTrucks.length : filteredHistory.length}</strong> {activeTab === "trucks" ? "Siklus" : "Frame"}
              </span>

              {hasActiveFilters && (
                <button
                  type="button"
                  className="filterResetBtnCockpit"
                  onClick={handleResetFilters}
                  title="Reset seluruh parameter pencarian ke default"
                >
                  <RotateCcw size={11} />
                  <span>Reset Filter</span>
                </button>
              )}
            </div>
          </div>

          {/* Controls Grid (Seamless 1-Row Cockpit Grid) */}
          <div className={`cockpitFilterGrid ${activeTab === "trucks" ? "cols-4" : "cols-3"}`}>
            {/* 1. Search Field */}
            <div className={`cockpitField ${searchQuery.trim() ? "hasValue" : ""}`}>
              <label className="cockpitFieldLabel">
                <Search size={10} />
                <span>PENCARIAN CEPAT</span>
              </label>
              <div className="cockpitInputWrap">
                <input
                  type="text"
                  placeholder="Cari nopol, supir, kode siklus..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="cockpitInput"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="cockpitInputClear"
                    onClick={() => setSearchQuery("")}
                    title="Hapus teks"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* 2. Date Range Field */}
            <div className={`cockpitField ${selectedDateFilter !== "all" ? "hasValue" : ""}`}>
              <label className="cockpitFieldLabel">
                <Calendar size={10} />
                <span>RENTANG WAKTU</span>
              </label>
              <div className="cockpitSelectWrap">
                <select
                  value={selectedDateFilter}
                  onChange={(e) => setSelectedDateFilter(e.target.value as any)}
                  className="cockpitSelect"
                >
                  <option value="all">Semua Waktu</option>
                  <option value="today">Hari Ini (24 Jam)</option>
                  <option value="7d">7 Hari Terakhir</option>
                  <option value="30d">30 Hari Terakhir</option>
                </select>
                <ChevronDown size={11} className="selectChevronIcon" />
              </div>
            </div>

            {/* 3. MBS Station Field (Hanya MBS 5 Aktif, Lainnya Terkunci) */}
            <div className={`cockpitField ${selectedLineFilter !== "all" ? "hasValue" : ""}`}>
              <label className="cockpitFieldLabel">
                <Building2 size={10} />
                <span>MEJA TEBU (MBS)</span>
              </label>
              <div className="cockpitSelectWrap">
                <select
                  value={selectedLineFilter}
                  onChange={(e) => setSelectedLineFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                  className="cockpitSelect"
                >
                  <option value="all">Semua Meja</option>
                  {[1, 2, 3, 4, 5].map(line => <option key={line} value={line} disabled={!availableLines.has(line)}>MBS {line}{availableLines.has(line) ? "" : " (Tidak tersedia)"}</option>)}
                </select>
                <ChevronDown size={11} className="selectChevronIcon" />
              </div>
            </div>

            {/* 4. Status Sesi (Only on Trucks Tab) */}
            {activeTab === "trucks" && (
              <div className={`cockpitField ${selectedStatusFilter !== "all" ? "hasValue" : ""}`}>
                <label className="cockpitFieldLabel">
                  <Layers size={10} />
                  <span>STATUS SIKLUS</span>
                </label>
                <div className="cockpitSelectWrap">
                  <select
                    value={selectedStatusFilter}
                    onChange={(e) => setSelectedStatusFilter(e.target.value)}
                    className="cockpitSelect"
                  >
                    <option value="all">Semua Status</option>
                    <option value="completed">Selesai (Completed)</option>
                    <option value="active">Sedang Berjalan</option>
                  </select>
                  <ChevronDown size={11} className="selectChevronIcon" />
                </div>
              </div>
            )}
          </div>

          {/* Active Filter Chips Console (Bottom Strip) */}
          {hasActiveFilters && (
            <div className="historyActiveFiltersRow">
              <span className="historyActiveFiltersTitle">Filter Diterapkan:</span>
              {searchQuery.trim() && (
                <span className="historyFilterChip">
                  <span>Cari: "{searchQuery}"</span>
                  <button type="button" onClick={() => setSearchQuery("")} title="Hapus pencarian">
                    <X size={11} />
                  </button>
                </span>
              )}
              {selectedDateFilter !== "all" && (
                <span className="historyFilterChip">
                  <span>
                    Waktu: {selectedDateFilter === "today" ? "Hari Ini" : selectedDateFilter === "7d" ? "7 Hari" : "30 Hari"}
                  </span>
                  <button type="button" onClick={() => setSelectedDateFilter("all")} title="Hapus filter waktu">
                    <X size={11} />
                  </button>
                </span>
              )}
              {selectedStatusFilter !== "all" && (
                <span className="historyFilterChip">
                  <span>Status: {selectedStatusFilter === "completed" ? "Selesai" : "Aktif"}</span>
                  <button type="button" onClick={() => setSelectedStatusFilter("all")} title="Hapus filter status">
                    <X size={11} />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* ─── Main Cockpit Data Table ─── */}
        <div className="historyCockpitTableCard">
          <div className="historyTableCardHeader">
            <div className="historyTableTitleLeft">
              <span className="historyTableBadge">
                {activeTab === "trucks" ? <Layers size={11} /> : <Camera size={11} />}
                <span>
                  {activeTab === "trucks"
                    ? "LOG SIKLUS PEMINDAIAN MEJA TEBU"
                    : "LOG TANGKAPAN FRAME CITRA AI"}
                </span>
              </span>
            </div>
            <div className="historyTableMetaRight">
              <span className="historyRecordCountBadge">
                {historyRecordCount === 0 ? "Belum ada data" : `${historyPageStart + 1}–${Math.min(historyPageStart + historyPageSize, historyRecordCount)} dari ${historyRecordCount} data`}
              </span>
            </div>
          </div>

          <div className="historyTableWrap" ref={tableWrapRef}>
            {activeTab === "trucks" ? (
              filteredTrucks.length === 0 ? (
                <div className="historyEmptyState">
                  <div className="historyEmptyRadar">
                    <RotateCcw size={28} />
                  </div>
                  <h3>Tidak Ada Rekaman Siklus Pemindaian</h3>
                  <p>
                    {hasActiveFilters
                      ? "Tidak ada siklus yang sesuai dengan filter pencarian saat ini."
                      : "Mulai pemindaian dari Dashboard dengan menekan tombol Start Cycle / Start Scan."}
                  </p>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      className="historyEmptyActionBtn"
                      onClick={handleResetFilters}
                    >
                      Reset Filter
                    </button>
                  )}
                </div>
              ) : (
                <table className="historyDataTable">
                  <thead>
                    <tr>
                      <th>Kode Siklus / Truk</th>
                      <th>Plat Armada</th>
                      <th>Stasiun MBS</th>
                      <th>Waktu Mulai</th>
                      <th>Waktu Selesai</th>
                      <th>Total Frame</th>
                      <th>Grade Mutu AI</th>
                      <th>Keputusan Pabrik</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody style={compactLayout ? { gridTemplateRows: `repeat(${historyPageSize}, minmax(0, 1fr))` } : undefined}>
                    {pagedTrucks.map((row) => {
                      const gradeCode = cycleGrade(row);
                      const startTime = new Date(row.startedAt).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
                      const endTime = row.completedAt
                        ? new Date(row.completedAt).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
                        : null;

                      const durationMinutes = row.completedAt
                        ? Math.max(1, Math.round((new Date(row.completedAt).getTime() - new Date(row.startedAt).getTime()) / 60000))
                        : null;

                      return (
                        <tr key={row.id} style={{ height: historyRowHeight }}>
                          <td>
                            <div className="truckCodeCell">
                              <Truck size={13} className="truckIcon" />
                              <strong>{row.truckCode}</strong>
                            </div>
                          </td>
                          <td>
                            {row.plateNumber ? (
                              <div className="plateCellWrap">
                                <span className="plateNumberBadge active">
                                  {row.plateNumber}
                                </span>
                                {row.driverName && (
                                  <span className="plateDriverSubText" title={`Supir: ${row.driverName}`}>
                                    {row.driverName}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="plateNumberBadge unassigned">
                                Belum Terisi
                              </span>
                            )}
                          </td>
                          <td>
                            {(() => {
                              const station = resolveMbsStation(row.line, cameras);
                              return (
                                <div className="stationBadgeWrap">
                                  <span className={`stationPillBadge ${station.isPrimaryLive ? "primary-active" : ""}`}>
                                    {station.isPrimaryLive && <span className="statusDotLiveMini" />}
                                    <strong>{station.label}</strong>
                                  </span>
                                  <span className="stationSubText">{station.subLabel}</span>
                                </div>
                              );
                            })()}
                          </td>
                          <td>
                            <span className="timeText">{startTime}</span>
                          </td>
                          <td>
                            {endTime ? (
                              <div className="endTimeWrap">
                                <span className="timeText">{endTime}</span>
                                {durationMinutes && <span className="durationBadge">({durationMinutes}m)</span>}
                              </div>
                            ) : (
                              <span className="runningBadge">
                                <span className="pulse-dot-red" />
                                <span>Sedang Berjalan</span>
                              </span>
                            )}
                          </td>
                          <td>
                            <span className="frameCountText">
                              <strong>{row.totalCaptures}</strong> frame
                            </span>
                          </td>
                          <td>
                            <span className={`dailyCycleGradeBadge grade-${gradeCode.toLowerCase()}`}>
                              MBS {gradeCode}
                            </span>
                          </td>
                          <td>
                            {<span className={`decision-badge ${["G", "X"].includes(gradeCode) ? "reject" : ["D", "B"].includes(gradeCode) ? "non-mbs" : gradeCode === "T" ? "pending" : "mbs"}`}>{TRANGKIL_GRADES.find(g => g.code === gradeCode)?.decision ?? "Belum ditetapkan"}</span>}
                          </td>
                          <td>
                            <span className={`sessionStatusPill ${row.status}`}>
                              {row.status === "completed" ? "SELESAI" : "AKTIF"}
                            </span>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <div className="tableActionRow">
                              <button
                                type="button"
                                className="historyDetailBtn"
                                onClick={() => setSelectedTruckSession(row)}
                                title="Lihat galeri tangkapan frame dan grafik siklus"
                              >
                                <Eye size={12} />
                                <span>Detail Frame</span>
                              </button>
                              {canWrite && (
                                <button
                                  type="button"
                                  className="historyDeleteBtn"
                                  onClick={() => {
                                    if (isOperator) {
                                      setRequestDeletionTarget({
                                        targetType: "truck_inspection",
                                        targetId: row.id,
                                        title: `Siklus ${row.truckCode || row.id}`,
                                        subtitle: `MBS ${row.line === 2 ? 5 : row.line} • ${row.totalCaptures} Frame Terekam`
                                      });
                                    } else {
                                      if (confirm(`Apakah Anda yakin ingin menghapus data siklus ${row.truckCode} secara langsung sebagai Direksi?`)) {
                                        void deleteTruckInspection(row.id).catch(err => alert(`Gagal: ${err}`));
                                      }
                                    }
                                  }}
                                  title={isOperator ? "Ajukan permohonan hapus siklus ke Direksi" : "Hapus rekaman siklus ini"}
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            ) : (
              filteredHistory.length === 0 ? (
                <div className="historyEmptyState">
                  <div className="historyEmptyRadar">
                    <Camera size={28} />
                  </div>
                  <h3>Tidak Ada Rekaman Frame Kamera</h3>
                  <p>Hubungkan kamera CCTV aktif dan lakukan pemindaian untuk menghasilkan data frame citra AI.</p>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      className="historyEmptyActionBtn"
                      onClick={handleResetFilters}
                    >
                      Reset Filter
                    </button>
                  )}
                </div>
              ) : (
                <table className="historyDataTable">
                  <thead>
                    <tr>
                      <th style={{ width: "92px" }}>Preview</th>
                      <th>Waktu Deteksi</th>
                      <th>Kamera MBS</th>
                      <th>Grade Mutu</th>
                      <th>Karakteristik Mutu</th>
                      <th>Ambang Toleransi</th>
                      <th>Kebijakan Rafaksi</th>
                      <th>Status Giling</th>
                      <th>Akurasi AI</th>
                      <th style={{ textAlign: "right" }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedCaptures.map((row) => {
                      const g = normalizeGrade(row.grade);
                      const curConfig = TRANGKIL_GRADES.find(item => item.code === g) || TRANGKIL_GRADES[1];
                      const confPct = Math.round((row.confidence ?? 0) * 100);

                      return (
                        <tr key={row.id}>
                          <td>
                            <div
                              className="thumbPreviewCell"
                              onClick={() => setSelectedCapture(row)}
                              title="Klik untuk memperbesar gambar frame"
                            >
                              {row.snapshot ? (
                                <img
                                  src={row.snapshot.startsWith("http") ? row.snapshot : `${backendUrl}${row.snapshot}`}
                                  alt={`Capture #${row.id}`}
                                />
                              ) : (
                                <Camera size={14} />
                              )}
                            </div>
                          </td>
                          <td>
                            <span className="timeText">
                              {new Date(row.timestamp).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </span>
                          </td>
                          <td>
                            {(() => {
                              const station = resolveMbsStation(row.cameraId, cameras);
                              return (
                                <div className="stationBadgeWrap">
                                  <span className={`stationPillBadge ${station.isPrimaryLive ? "primary-active" : ""}`}>
                                    {station.isPrimaryLive && <span className="statusDotLiveMini" />}
                                    <strong>{station.label}</strong>
                                  </span>
                                  <span className="stationSubText">{station.subLabel}</span>
                                </div>
                              );
                            })()}
                          </td>
                          <td>
                            <span className={`dailyCycleGradeBadge grade-${g.toLowerCase()}`}>
                              MBS {g}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontWeight: 650, color: "var(--color-text)", fontSize: "12px" }}>
                              {curConfig.name}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontWeight: 600, color: "var(--color-muted)", fontSize: "12px" }}>
                              {curConfig.tol}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontWeight: 700, color: curConfig.color, fontSize: "12px" }}>
                              {curConfig.rafaksi}
                            </span>
                          </td>
                          <td>
                            <span className={`decision-badge ${curConfig.tier === "bebas" ? "mbs" : curConfig.tier === "rafaksi" ? "non-mbs" : curConfig.tier === "manual" ? "pending" : "reject"}`}>
                              {curConfig.status}
                            </span>
                          </td>
                          <td>
                            <div className="confidenceCell">
                              <span>{confPct}%</span>
                              <div className="confidenceBarTrack">
                                <div className="confidenceBarFill" style={{ width: `${confPct}%` }} />
                              </div>
                            </div>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className="historyDetailBtn"
                              onClick={() => setSelectedCapture(row)}
                              title="Buka rincian analisis citra frame ini"
                            >
                              <Eye size={12} />
                              <span>Lihat Detail</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            )}
          </div>
        </div>
      </div>

      <nav className="historyPagination" aria-label="Halaman riwayat">
        <span>{historyRecordCount} {activeTab === "trucks" ? "siklus" : "frame"} · {historyPageSize} data per halaman</span>
        <div>
          <button type="button" disabled={safeHistoryPage === 1} onClick={() => setHistoryPage(safeHistoryPage - 1)}>Sebelumnya</button>
          <strong>Halaman {safeHistoryPage} / {historyPages}</strong>
          <button type="button" disabled={safeHistoryPage === historyPages} onClick={() => setHistoryPage(safeHistoryPage + 1)}>Berikutnya</button>
        </div>
      </nav>

      {/* ─── Truck Inspection Detail Modal ─── */}
      {selectedTruckSession && (
        <TruckInspectionDetailModal
          session={selectedTruckSession}
          history={visibleHistory}
          onClose={() => setSelectedTruckSession(null)}
          onViewCapture={(cap) => setSelectedCapture(cap)}
        />
      )}

      {/* ─── Retroactive Tapping Auto-Sync Modal ─── */}
      {isSyncModalOpen && (
        <TappingSyncModal
          isOpen={isSyncModalOpen}
          onClose={() => setIsSyncModalOpen(false)}
        />
      )}

      {/* ─── Single Capture Modal Preview ─── */}
      {selectedCapture && (() => {
        const capGrade = normalizeGrade(selectedCapture.grade);
        const curConfig = TRANGKIL_GRADES.find(g => g.code === capGrade) || TRANGKIL_GRADES[1];
        const confPct = Math.round((selectedCapture.confidence ?? 0) * 100);
        const station = resolveMbsStation(selectedCapture.cameraId, cameras);
        const dateStr = new Date(selectedCapture.timestamp).toLocaleDateString("id-ID", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric"
        });
        const timeStr = new Date(selectedCapture.timestamp).toLocaleTimeString("id-ID", { hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });

        return (
          <div
            className="modal-backdrop"
            onClick={() => setSelectedCapture(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="capture-modal-title"
            style={{ zIndex: 10000 }}
          >
            <div className="capture-detail-modal capture-frame-popup" data-panel={captureDetailPanel} onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="capture-detail-modal__header">
                <div className="modal-title-with-badge">
                  <div className="modal-title-row">
                    <span className="modal-badge-icon">
                      <Camera size={15} />
                    </span>
                    <h2 id="capture-modal-title">Detail Tangkapan Citra AI</h2>
                    <span className="modal-batch-pill">Frame {frameNumber(selectedCapture.id)}</span>
                  </div>
                  <p>Hasil pemindaian citra frame meja tebu (PG Trangkil) • Anotasi Klasifikasi Mutu Meja Tebu</p>
                </div>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setSelectedCapture(null)}
                  aria-label="Tutup"
                >
                  <X size={19} />
                </button>
              </div>

              {/* Body */}
              <nav className="responsiveDetailTabs" aria-label="Tampilan detail frame">
                <button aria-pressed={captureDetailPanel === "image"} onClick={() => setCaptureDetailPanel("image")}>Gambar</button>
                <button aria-pressed={captureDetailPanel === "decision"} onClick={() => setCaptureDetailPanel("decision")}>Informasi & Keputusan</button>
                <button aria-pressed={captureDetailPanel === "analysis"} onClick={() => setCaptureDetailPanel("analysis")}>Analisis Mutu</button>
              </nav>
              <div className="capture-frame-popup__body">
                {/* Left Column: Image + Metadata Chips + Factory Decision */}
                <div className="capture-frame-popup__left">
                  {/* Snapshot Media Card */}
                  <div className="capture-snapshot-card">
                    {selectedCapture.snapshot ? (
                      <div className="snapshot-preview-container">
                        <img
                          src={selectedCapture.snapshot.startsWith("http") ? selectedCapture.snapshot : `${backendUrl}${selectedCapture.snapshot}`}
                          alt={`Snapshot #${selectedCapture.id}`}
                          className="snapshot-preview-img"
                        />
                        <div className="snapshot-overlay-top">
                          <span className="snapshot-cam-tag">
                            <span className="snapshot-live-dot" />
                            {station.label} • {station.subLabel}
                          </span>
                          <span className="snapshot-conf-tag">AI Conf: {confPct}%</span>
                        </div>
                        <div className="snapshot-overlay-bottom">
                          <span className="snapshot-time-tag">
                            <Clock size={10} />
                            {dateStr} • {timeStr} WIB
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="no-snapshot-placeholder">
                        <Camera size={38} className="no-snapshot-icon" />
                        <h3>Citra Snapshot Tidak Tersedia</h3>
                        <p>File frame tebu belum terekam pada storage.</p>
                      </div>
                    )}
                  </div>

                  {/* 4-Item Compact Metadata Grid */}
                  <div className="capture-meta-strip">
                    <div className="meta-strip-item">
                      <span className="meta-label">ID RECORD</span>
                      <strong className="meta-val">{frameNumber(selectedCapture.id)}</strong>
                    </div>
                    <div className="meta-strip-item">
                      <span className="meta-label">SUMBER CCTV</span>
                      <strong className="meta-val">Kamera {selectedCapture.cameraId || station.mbsNum}</strong>
                    </div>
                    <div className="meta-strip-item">
                      <span className="meta-label">STASIUN MEJA</span>
                      <strong className="meta-val">{station.label}</strong>
                    </div>
                    <div className="meta-strip-item">
                      <span className="meta-label">WAKTU DETEKSI</span>
                      <strong className="meta-val">{timeStr}</strong>
                    </div>
                  </div>

                  {/* Factory Decision Card */}
                  <div className={`capture-decision-card ${curConfig.badgeCls}`}>
                    <div className="decision-header-row">
                      <div className="decision-title-group">
                        <ShieldCheck size={14} className="decision-shield-icon" />
                        <strong>KEPUTUSAN OPERASIONAL PABRIK</strong>
                      </div>
                      <span className={`decision-status-pill ${curConfig.badgeCls}`}>
                        {curConfig.decision.toUpperCase()}
                      </span>
                    </div>
                    <div className="decision-metrics-row">
                      <div className="decision-metric">
                        <span>Toleransi Mutu:</span>
                        <strong>{curConfig.tol}</strong>
                      </div>
                      <div className="decision-metric-divider" />
                      <div className="decision-metric">
                        <span>Kebijakan Rafaksi:</span>
                        <strong style={{ color: curConfig.color }}>{curConfig.rafaksi}</strong>
                      </div>
                      <div className="decision-metric-divider" />
                      <div className="decision-metric">
                        <span>Status Giling:</span>
                        <strong>{curConfig.status}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: AI Grade Evaluation & Compact Class Distribution */}
                <div className="capture-frame-popup__right">
                  {/* Hero Grade Assessment Card */}
                  <div className="capture-hero-grade-card" style={{ borderColor: `${curConfig.color}45` }}>
                    <div className="hero-grade-main">
                      <div className="hero-grade-badge-wrap">
                        <span className={`hero-grade-pill ${curConfig.badgeCls}`}>
                          MBS {capGrade}
                        </span>
                      </div>
                      <div className="hero-grade-titles">
                        <span className="hero-grade-badge-tag">
                          <CheckCircle size={10} />
                          <span>PREDICTED GRADE (AI)</span>
                        </span>
                        <strong className="hero-grade-title">{curConfig.label} ({curConfig.name})</strong>
                        <span className="hero-grade-sub">{curConfig.kriteria}</span>
                      </div>
                    </div>
                  </div>

                  {/* 7-Grade Compact Distribution Section (Softmax Multiclass Frame Output) */}
                  <div className="capture-grades-dist-card">
                    <div className="dist-card-header">
                      <div className="dist-card-title-wrap">
                        <Layers size={13} />
                        <strong>DISTRIBUSI PROBABILITAS KELAS MUTU (AI)</strong>
                      </div>
                      <span className="dist-card-sub">Standar 7 Kelas Mutu PG Trangkil</span>
                    </div>

                    <div className="dist-compact-list">
                      {TRANGKIL_GRADES.map((item, idx) => {
                        const isMatch = item.code === capGrade;
                        const prob = isMatch ? confPct : Math.max(1, Math.round((100 - confPct) / 6));
                        return (
                          <div
                            key={item.code}
                            className={`dist-compact-row ${isMatch ? "active-match" : ""}`}
                            style={{
                              borderColor: isMatch ? `${item.color}60` : undefined,
                              background: isMatch ? `${item.color}0d` : undefined
                            }}
                          >
                            <div className="dist-row-left">
                              <span className={`dist-code-badge ${item.badgeCls}`}>
                                {item.code}
                              </span>
                              <div className="dist-row-labels">
                                <span className="dist-row-name">
                                  {idx + 1}. {item.label}
                                </span>
                                <span className="dist-row-desc">{item.name}</span>
                              </div>
                            </div>

                            <div className="dist-row-center">
                              <div className="dist-bar-track">
                                <div
                                  className="dist-bar-fill"
                                  style={{
                                    width: `${prob}%`,
                                    background: isMatch ? item.grad : "var(--color-border-strong)"
                                  }}
                                />
                              </div>
                            </div>

                            <div className="dist-row-right">
                              <strong
                                className="dist-row-pct"
                                style={{ color: isMatch ? item.color : "var(--color-text)" }}
                              >
                                {prob}%
                              </strong>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="capture-detail-modal__footer capture-frame-popup__footer">
                {canWrite ? (
                  <button
                    type="button"
                    className="modal-footer-btn danger"
                    onClick={async () => {
                      if (pendingInferenceIds.has(selectedCapture.id)) {
                        alert("Permohonan penghapusan frame ini sedang menunggu persetujuan Direksi.");
                        return;
                      }
                      if (isOperator) {
                        setRequestDeletionTarget({
                          targetType: "inference",
                          targetId: selectedCapture.id,
                          title: `Frame #${selectedCapture.id} (Grade ${selectedCapture.grade})`,
                          subtitle: `Terekam: ${selectedCapture.timestamp}`,
                          snapshotPath: selectedCapture.snapshot ? (selectedCapture.snapshot.startsWith("http") ? selectedCapture.snapshot : `${backendUrl}${selectedCapture.snapshot}`) : undefined
                        });
                      } else {
                        if (confirm(`Hapus rekaman frame #${selectedCapture.id} secara langsung sebagai Direksi?`)) {
                          await deleteInference(selectedCapture.id);
                          setSelectedCapture(null);
                        }
                      }
                    }}
                    title={pendingInferenceIds.has(selectedCapture.id) ? "Menunggu persetujuan Direksi" : isOperator ? "Ajukan permohonan hapus frame ke Direksi" : "Hapus rekaman frame ini"}
                    style={pendingInferenceIds.has(selectedCapture.id) ? { opacity: 0.5, cursor: "not-allowed" } : {}}
                  >
                    <Trash2 size={13} />
                    <span>{pendingInferenceIds.has(selectedCapture.id) ? "Menunggu Persetujuan Direksi" : isOperator ? "Ajukan Hapus ke Direksi" : "Hapus Frame"}</span>
                  </button>
                ) : <div />}

                <div className="modal-footer-actions-right">
                  <button
                    type="button"
                    className="modal-footer-btn primary"
                    onClick={() => setSelectedCapture(null)}
                  >
                    <span>Tutup</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Modal Pengajuan Penghapusan oleh Operator (Maker) ─── */}
      {requestDeletionTarget && (
        <RequestDeletionModal
          isOpen={Boolean(requestDeletionTarget)}
          onClose={() => setRequestDeletionTarget(null)}
          targetType={requestDeletionTarget.targetType}
          targetId={requestDeletionTarget.targetId}
          targetTitle={requestDeletionTarget.title}
          targetSubtitle={requestDeletionTarget.subtitle}
          snapshotPath={requestDeletionTarget.snapshotPath}
          onSubmitted={() => {
            if (requestDeletionTarget.targetType === "inference" && selectedCapture?.id === requestDeletionTarget.targetId) {
              setSelectedCapture(null);
            }
            if (requestDeletionTarget.targetType === "truck_inspection" && selectedTruckSession?.id === String(requestDeletionTarget.targetId)) {
              setSelectedTruckSession(null);
            }
          }}
        />
      )}

      {/* ─── Modal Pusat Persetujuan & Otorisasi Direksi (Checker / Admin) ─── */}
      {isApprovalQueueOpen && (
        <AdminApprovalQueueModal
          isOpen={isApprovalQueueOpen}
          onClose={() => setIsApprovalQueueOpen(false)}
        />
      )}

    </section>
  );
}

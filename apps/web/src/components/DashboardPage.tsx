import { usePanelSize } from "../hooks/usePanelSize";
import { frameNumbers, dominantGrade, meanClassScores } from "../utils/grade-data";
import { findFactoryCamera } from "../utils/stations";
import { Clock, Camera, Radio, Activity, CheckCircle, ShieldCheck, ShieldAlert, Layers, X, Sliders, Building2, CameraOff, Lock, Maximize2, Minimize2, TrendingUp, BarChart3, Trash2, Sun, Moon, Play, Square, RotateCcw, ChevronDown, Truck, Check, RefreshCw, FileSpreadsheet } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { useAppStore } from "../store";
import { InferenceResult, Grade } from "../types";
import { api, aiApi, backendUrl, getCameraStreamUrl } from "../utils/api";
import { TappingSyncModal } from "./TappingSyncModal";
import { RequestDeletionModal } from "./RequestDeletionModal";
import { AdminApprovalQueueModal } from "./AdminApprovalQueueModal";

export type FactoryKey = "trangkil" | "kebonagung";

type AutoCycleStatus = {
  camera_id: number;
  enabled: boolean;
  model_available: boolean;
  phase: "off" | "waiting_full" | "confirming" | "starting" | "grading" | "finishing" | "waiting_clear" | "camera_unavailable" | "uncertain" | "error";
  confirmed_seconds: number;
  confirmation_seconds: number;
  remaining_seconds: number;
  grading_seconds: number;
  cycle_code: string | null;
  full_frame_confidence: number | null;
  error: string | null;
};

type DetectionPage = {
  items: (InferenceResult & { frameNumber: number })[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
};

interface FactoryDefinition {
  id: FactoryKey;
  name: string;
  fullName: string;
  city: string;
  shortName: string;
  lines: {
    line: number;
    title: string;
    subtext: string;
    locked?: boolean;
  }[];
}

const FACTORIES: Record<FactoryKey, FactoryDefinition> = {
  trangkil: {
    id: "trangkil",
    name: "PT Trangkil (Pati)",
    fullName: "Pabrik Gula Trangkil",
    city: "Pati, Jawa Tengah",
    shortName: "PG Trangkil",
    lines: [
      { line: 1, title: "MBS 1", subtext: "Meja Tebu 1", locked: true },
      { line: 2, title: "MBS 2", subtext: "Meja Tebu 2", locked: true },
      { line: 3, title: "MBS 3", subtext: "Meja Tebu 3", locked: true },
      { line: 4, title: "MBS 4", subtext: "Meja Tebu 4", locked: true },
      { line: 5, title: "MBS 5", subtext: "Meja Tebu 5 (Wisenet)", locked: false },
    ]
  },
  kebonagung: {
    id: "kebonagung",
    name: "PT Kebon Agung (Malang)",
    fullName: "Pabrik Gula Kebon Agung",
    city: "Malang, Jawa Timur",
    shortName: "PG Kebon Agung",
    lines: [
      { line: 1, title: "MBS 1", subtext: "Meja Tebu 1 (Utama)", locked: false },
      { line: 2, title: "MBS 2", subtext: "Meja Tebu 2", locked: false },
      { line: 3, title: "MBS 3", subtext: "Meja Tebu 3", locked: false },
      { line: 4, title: "MBS 4", subtext: "Meja Tebu 4", locked: false },
      { line: 5, title: "MBS 5", subtext: "Meja Tebu 5", locked: false },
    ]
  }
};

function getDefaultLine(factoryKey: FactoryKey): number {
  const unlocked = FACTORIES[factoryKey]?.lines.find((l) => !l.locked);
  return unlocked ? unlocked.line : (factoryKey === "trangkil" ? 5 : 1);
}

// Mini donut chart SVG component with Gemini fluid gradient
function DonutGauge({ value, size = 58, strokeWidth = 6 }: { value: number; size?: number; color?: string; strokeWidth?: number }) {
  const r = (size - strokeWidth - 2) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (value / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
      <defs>
        <linearGradient id="donutGeminiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1d4ed8" />
          <stop offset="40%" stopColor="#2563eb" />
          <stop offset="75%" stopColor="#00e5ff" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-muted)" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="url(#donutGeminiGrad)" strokeWidth={strokeWidth}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 600ms ease" }}
      />
    </svg>
  );
}

import { TRANGKIL_GRADES, normalizeGrade } from "../utils/grade-guide";

export function DashboardPage() {
  const { latest, status, refresh, history, cameras, session, truckSessions, startTruckInspection, completeTruckInspection, deleteInference, deletionRequests } = useAppStore();
  const [modelFrames, setModelFrames] = useState<InferenceResult[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refreshFrames = async () => {
      try { const frames = await api<InferenceResult[]>("/api/inference/model-frames"); if (!cancelled) setModelFrames(frames); }
      catch { /* Preserve the last confirmed database data during a temporary outage. */ }
    };
    void refreshFrames();
    const interval = setInterval(refreshFrames, 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [session?.user.id]);
  const isAdmin = session?.user.role === "admin";
  const canInspect = !isAdmin && (session?.user.permissions.includes("inspection.write") ?? false);
  const captureInFlight = useRef(false);
  const isOperator = session?.user.role === "operator";
  const [requestDeletionTarget, setRequestDeletionTarget] = useState<{
    id: number;
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

  const userFactory: FactoryKey | null = (() => {
    const username = (session?.user.username || "").toLowerCase();
    if (username.includes("kebonagung") || username.includes("malang")) return "kebonagung";
    if (username.includes("trangkil")) return "trangkil";
    return null;
  })();

  const isFactoryLocked = userFactory !== null;

  const initialFactory: FactoryKey = (() => {
    if (userFactory) return userFactory;
    const saved = localStorage.getItem("active-factory") as FactoryKey | null;
    if (saved === "trangkil" || saved === "kebonagung") return saved;
    return "kebonagung";
  })();

  const [activeFactory, setActiveFactory] = useState<FactoryKey>(initialFactory);
  const [activeLine, setActiveLine] = useState<number>(() => getDefaultLine(initialFactory));
  const [capturePage, setCapturePage] = useState(1);
  const [dashboardPane, setDashboardPane] = useState("camera");
  const [eventPage, setEventPage] = useState(1);
  const [detectionPage, setDetectionPage] = useState<{ scope: string; result: DetectionPage } | null>(null);
  const [detectionError, setDetectionError] = useState(false);
  const [timelinePage, setTimelinePage] = useState(1);
  const [selectedCapture, setSelectedCapture] = useState<(InferenceResult & { frameNumber?: number }) | null>(null);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (document.documentElement.dataset.theme as "light" | "dark") || "light";
  });

  // Cycle / Scanning State
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  useEffect(() => setEventPage(1), [selectedCycleId, activeLine]);
  const [cyclePickerOpen, setCyclePickerOpen] = useState(false);
  const cyclePickerRef = useRef<HTMLDivElement>(null);
  const [cycleElapsedSeconds, setCycleElapsedSeconds] = useState(0);
  const [autoMode, setAutoMode] = useState<AutoCycleStatus | null>(null);
  const [autoModeBusy, setAutoModeBusy] = useState(false);
  const [autoModeError, setAutoModeError] = useState<string | null>(null);
  const autoMutationVersion = useRef(0);
  const autoMutationBusy = useRef(false);
  const autoCameraRef = useRef<number | undefined>(undefined);
  const [cycleFeedback, setCycleFeedback] = useState<string | null>(null);
  const autoScanTimerRef = useRef<NodeJS.Timeout | null>(null);
  const emptyFrameCountRef = useRef(0);

  // Close cycle picker on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (cyclePickerRef.current && !cyclePickerRef.current.contains(event.target as Node)) {
        setCyclePickerOpen(false);
      }
    }
    if (cyclePickerOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [cyclePickerOpen]);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("tebu-ui-theme", next);
  };

  // Strictly sync factory when session user changes
  useEffect(() => {
    if (userFactory) {
      setActiveFactory(userFactory);
      setActiveLine(getDefaultLine(userFactory));
    }
  }, [userFactory]);

  // Clock ticker
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Live video streaming & ROI states
  // Live video streaming display states
  const [showHud, setShowHud] = useState(true);
  const [isStreaming, setIsStreaming] = useState(true);
  const [streamReconnecting, setStreamReconnecting] = useState(false);
  const [streamKey, setStreamKey] = useState(Date.now());
  const [capturing, setCapturing] = useState(false);
  const [captureFeedback, setCaptureFeedback] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const streamCanvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fsElement = document.fullscreenElement || (document as any).webkitFullscreenElement;
      setIsFullscreen(Boolean(fsElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!isFullscreen) {
        if (streamCanvasRef.current?.requestFullscreen) {
          await streamCanvasRef.current.requestFullscreen();
        } else if ((streamCanvasRef.current as any)?.webkitRequestFullscreen) {
          await (streamCanvasRef.current as any).webkitRequestFullscreen();
        } else {
          setIsFullscreen(true);
        }
      } else {
        if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if ((document as any).webkitExitFullscreen) {
            await (document as any).webkitExitFullscreen();
          }
        } else {
          setIsFullscreen(false);
        }
      }
    } catch {
      setIsFullscreen((prev) => !prev);
    }
  };

  const currentFactory = useMemo(() => ({
    ...FACTORIES[activeFactory],
    lines: FACTORIES[activeFactory].lines.map(line => ({
      ...line,
      cameraId: line.locked ? undefined : findFactoryCamera(cameras, activeFactory, line.line)?.id,
    })),
  }), [activeFactory, cameras]);
  const currentLineDef = currentFactory.lines.find((l) => l.line === activeLine);
  const targetCameraId = currentLineDef?.cameraId;
  autoCameraRef.current = targetCameraId;
  const currentAutoMode = autoMode?.camera_id === targetCameraId ? autoMode : null;
  const autoEnabled = currentAutoMode?.enabled === true;
  const manualLocked = autoEnabled || autoModeBusy || !currentAutoMode || Boolean(autoModeError);

  useEffect(() => {
    setAutoMode(null);
    setAutoModeError(null);
    if (!targetCameraId || !session) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let previousCode: string | null | undefined;
    const poll = async () => {
      const version = autoMutationVersion.current;
      try {
        const result = await aiApi<AutoCycleStatus>(`/cycle/auto/${targetCameraId}`, { signal: AbortSignal.timeout(10000) });
        if (!cancelled && !autoMutationBusy.current && version === autoMutationVersion.current) {
          setAutoMode(result);
          setAutoModeError(null);
          if (previousCode !== undefined && previousCode !== result.cycle_code) void refresh();
          previousCode = result.cycle_code;
        }
      } catch (error) {
        if (!cancelled && !autoMutationBusy.current && version === autoMutationVersion.current) {
          setAutoModeError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, 750);
      }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [targetCameraId, session?.token, refresh]);

  async function handleToggleAuto() {
    if (!canInspect || !targetCameraId || !currentAutoMode || autoMutationBusy.current) return;
    const cameraId = targetCameraId;
    autoMutationBusy.current = true;
    autoMutationVersion.current += 1;
    setAutoModeBusy(true);
    try {
      const result = await aiApi<AutoCycleStatus>(`/cycle/auto/${cameraId}`, {
        method: "PUT", body: JSON.stringify({ enabled: !currentAutoMode.enabled }), signal: AbortSignal.timeout(60000)
      });
      if (autoCameraRef.current === cameraId) {
        setAutoMode(result);
        setAutoModeError(null);
        setSelectedCycleId(null);
      }
      await refresh();
    } catch (error) {
      if (autoCameraRef.current === cameraId) setAutoModeError(error instanceof Error ? error.message : String(error));
    } finally {
      autoMutationVersion.current += 1;
      autoMutationBusy.current = false;
      setAutoModeBusy(false);
    }
  }

  const autoStatusError = autoModeError || currentAutoMode?.error;

  // Active & historical cycles for current station
  const frameNumberMap = frameNumbers(history, truckSessions || []);
  const frameNumber = (id: number) => (selectedCapture?.id === id ? selectedCapture.frameNumber : undefined) ?? frameNumberMap.get(id) ?? 1;
  const activeCycle = (truckSessions || []).find((s) => s.line === targetCameraId && s.status === "active") || null;
  const lineCycles = (truckSessions || []).filter((s) => s.line === targetCameraId);
  const selectedCycle = selectedCycleId ? lineCycles.find((s) => s.id === selectedCycleId) : null;

  // Cycle timer
  useEffect(() => {
    if (!activeCycle) {
      setCycleElapsedSeconds(0);
      return;
    }
    const started = new Date(activeCycle.startedAt).getTime();
    const updateElapsed = () => {
      setCycleElapsedSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    };
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [activeCycle?.id]);

  async function handleStopCycle(reason?: string) {
    if (!activeCycle || !canInspect || manualLocked) return;
    try {
      if (autoScanTimerRef.current) {
        clearInterval(autoScanTimerRef.current);
        autoScanTimerRef.current = null;
      }
      await completeTruckInspection(activeCycle.id, reason || "Siklus dihentikan operator");
      setCycleFeedback("Siklus selesai! Hasil grading disimpan.");
      setTimeout(() => setCycleFeedback(null), 4000);
    } catch (err) {
      alert("Gagal menghentikan siklus: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // AI service owns capture timing; browsers only refresh persisted results.
  useEffect(() => {
    if (!activeCycle) return;
    const interval = setInterval(() => { void refresh(); }, 1000);
    return () => clearInterval(interval);
  }, [activeCycle?.id, refresh]);

  async function handleStartCycle() {
    if (!canInspect || manualLocked) return;
    if (isAdmin) {
      alert("Akun Admin (Direksi) dibatasi dari kontrol fisik pemindaian conveyor. Hanya Akun Operator lapangan yang dapat memulai siklus.");
      return;
    }
    if (!targetCameraId) return;
    try {
      const cycleNumber = lineCycles.length + 1;
      const cycleTitle = `Siklus #${cycleNumber} (MBS ${activeLine})`;
      await startTruckInspection({
        line: targetCameraId,
        truckCode: cycleTitle,
        notes: `Pemindaian Otomatis Meja Tebu ${currentFactory.shortName} MBS ${activeLine}`
      });
      emptyFrameCountRef.current = 0;
      setCycleFeedback("Siklus dimulai! Memindai frame tebu otomatis...");
      setTimeout(() => setCycleFeedback(null), 3000);
      setSelectedCycleId(null);
    } catch (err) {
      alert("Gagal memulai siklus: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  const streamErrorTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleStreamError = () => {
    // Grace period debounce: don't blank the screen on transient MJPEG stream switches or connection resets
    if (!streamErrorTimerRef.current) {
      streamErrorTimerRef.current = setTimeout(() => {
        setIsStreaming(false);
        streamErrorTimerRef.current = null;
      }, 2500);
    }
  };

  const handleStreamLoad = () => {
    if (streamErrorTimerRef.current) {
      clearTimeout(streamErrorTimerRef.current);
      streamErrorTimerRef.current = null;
    }
    setIsStreaming(true);
  };

  useEffect(() => {
    return () => {
      if (streamErrorTimerRef.current) {
        clearTimeout(streamErrorTimerRef.current);
      }
    };
  }, []);

  const handleReconnectStream = async () => {
    setStreamReconnecting(true);
    if (streamErrorTimerRef.current) {
      clearTimeout(streamErrorTimerRef.current);
      streamErrorTimerRef.current = null;
    }
    setIsStreaming(true);
    setStreamKey(Date.now());
    if (targetCameraId) {
      try {
        await api(`/api/cameras/${targetCameraId}/reconnect`, { method: "POST" }).catch(() => {});
      } catch {
        // ignore
      }
    }
    setTimeout(() => setStreamReconnecting(false), 1200);
  };

  useEffect(() => {
    if (targetCameraId) {
      setIsStreaming(true);
      setStreamKey(Date.now());
    } else {
      setIsStreaming(false);
    }
  }, [activeFactory, activeLine, targetCameraId]);

  // Auto-retry CCTV connection every 4 seconds if disconnected
  useEffect(() => {
    if (!targetCameraId || currentLineDef?.locked) return;
    if (!isStreaming) {
      const timer = setTimeout(() => {
        setIsStreaming(true);
        setStreamKey(Date.now());
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, targetCameraId, currentLineDef?.locked]);

  async function handleManualCapture() {
    if (capturing || captureInFlight.current || !targetCameraId || !canInspect || activeCycle) return;
    captureInFlight.current = true;
    setCapturing(true);
    try {
      const res = await api<InferenceResult>(`/api/cameras/${targetCameraId}/capture`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setCaptureFeedback("Berhasil!");
      setTimeout(() => setCaptureFeedback(null), 3000);
      await refresh();
      setSelectedCapture(res);
    } catch (err) {
      alert("Gagal melakukan capture AI: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      captureInFlight.current = false;
      setCapturing(false);
    }
  }

  useEffect(() => {
    if (!selectedCapture) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedCapture(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCapture]);

  useEffect(() => {
    setCapturePage(1);
    setTimelinePage(1);
  }, [activeLine, activeFactory, history.length, selectedCycleId]);

  const activeLineHistory = (history || [])
    .filter((item) => (targetCameraId ? item.cameraId === targetCameraId : false));

  const displayedCaptures = useMemo(() => {
    if (!selectedCycle) return activeLineHistory;
    const ids = new Set(selectedCycle.captureIds || []);
    const start = new Date(selectedCycle.startedAt).getTime();
    const end = selectedCycle.completedAt ? new Date(selectedCycle.completedAt).getTime() : Date.now();
    return activeLineHistory.filter((item) => {
      const t = new Date(item.timestamp).getTime();
      return ids.has(item.id) || (t >= start - 1000 && t <= end + 1000);
    });
  }, [selectedCycle, activeLineHistory]);

  const lineModelFrames = modelFrames.filter(item => item.cameraId === targetCameraId);
  const analysisFrames = lineModelFrames.length ? lineModelFrames : activeLineHistory;
  const cycleModelFrames = selectedCycle ? analysisFrames.filter(item => {
    const t = new Date(item.timestamp).getTime();
    return t >= new Date(selectedCycle.startedAt).getTime() - 1000 &&
      t <= (selectedCycle.completedAt ? new Date(selectedCycle.completedAt).getTime() + 1000 : Date.now());
  }) : analysisFrames;
  const detectionScope = `${targetCameraId}:${selectedCycle?.id ?? ""}:${eventPage}`;
  const currentDetectionPage = detectionPage?.scope === detectionScope ? detectionPage.result : null;
  const eventTotal = currentDetectionPage?.total;
  const eventPages = currentDetectionPage?.pages ?? 1;
  const safeEventPage = currentDetectionPage?.page ?? eventPage;
  const visibleEvents = currentDetectionPage?.items ?? [];

  useEffect(() => {
    setDetectionError(false);
    if (!targetCameraId || !session) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const loadPage = async () => {
      const params = new URLSearchParams({ camera_id: String(targetCameraId), page: String(eventPage), page_size: "10" });
      if (selectedCycle?.id) params.set("cycle_code", selectedCycle.id);
      try {
        const result = await aiApi<DetectionPage>(`/inference/history-page?${params}`, {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)])
        });
        if (!cancelled) {
          setDetectionPage({ scope: detectionScope, result });
          setDetectionError(false);
          if (result.page !== eventPage) setEventPage(result.page);
        }
      } catch {
        if (!cancelled) setDetectionError(true);
      } finally {
        if (!cancelled) timer = setTimeout(loadPage, 1000);
      }
    };
    void loadPage();
    return () => { cancelled = true; abort.abort(); clearTimeout(timer); };
  }, [session?.token, targetCameraId, selectedCycle?.id, eventPage, detectionScope]);

  const activeCycleFrames = useMemo(() => {
    if (!activeCycle) return [];
    const start = new Date(activeCycle.startedAt).getTime();
    return analysisFrames.filter((item) => {
      const t = new Date(item.timestamp).getTime();
      return t >= start - 1000;
    });
  }, [activeCycle, analysisFrames]);

  const [captureDetailPanel, setCaptureDetailPanel] = useState("image");
  useEffect(() => { setCaptureDetailPanel("image"); }, [selectedCapture?.id]);
  const [analysisDetailTab, setAnalysisDetailTab] = useState("grades");
  const panelSize = usePanelSize<HTMLElement>();
  const compactLayout = panelSize.width < 1200 || panelSize.height < 600;
  const captureColumns = compactLayout && panelSize.width < 500 ? 2 : 3;
  const captureRows = panelSize.height < 600 ? 2 : 4;
  const captureGridRef = useRef<HTMLDivElement>(null);
  const [captureAspect, setCaptureAspect] = useState(2);
  const [captureCardWidth, setCaptureCardWidth] = useState(200);
  useEffect(() => {
    const grid = captureGridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const columnWidth = (width - (captureColumns - 1) * 10) / captureColumns;
      const rowHeight = (height - (captureRows - 1) * 10) / captureRows;
      // Reserve the card border, padding and timestamp below the original image.
      const imageHeight = Math.max(1, rowHeight - 32);
      setCaptureCardWidth(Math.max(1, Math.min(columnWidth, imageHeight * captureAspect + 12)));
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [captureAspect, captureColumns, captureRows]);
  const pageSize = captureColumns * captureRows;
  const totalPages = Math.max(1, Math.ceil(displayedCaptures.length / pageSize));
  const currentPage = Math.min(capturePage, totalPages);
  const visibleCaptures = displayedCaptures.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const visibleCapturesCount = displayedCaptures.length;

  const placeholdersCount = Math.max(0, pageSize - visibleCaptures.length);
  const placeholders = Array.from({ length: placeholdersCount });

  // Tab mode for right panel: Realtime Cycle vs Daily Cross-Cycle Summary
  const [analysisTab, setAnalysisTab] = useState<"realtime" | "daily">("realtime");

  // Effective inference for category analysis:
  // 1. If currently running an active cycle: AVERAGE ALL FRAMES from the start of the active cycle!
  // 2. If a specific cycle is filtered: AVERAGE ALL FRAMES belonging to that cycle!
  // 3. When scanning has stopped, retain the aggregate for the selected camera/filter.
  const effectiveInference = useMemo(() => {
    if (activeCycle && activeCycleFrames.length > 0) {
      const count = activeCycleFrames.length;
      const sumDaun = activeCycleFrames.reduce((s, c) => s + c.classes.daun, 0);
      const sumPucuk = activeCycleFrames.reduce((s, c) => s + c.classes.pucuk, 0);
      const sumSampah = activeCycleFrames.reduce((s, c) => s + c.classes.sampah, 0);
      const avgDaun = Math.round((sumDaun / count) * 10) / 10;
      const avgPucuk = Math.round((sumPucuk / count) * 10) / 10;
      const avgSampah = Math.round((sumSampah / count) * 10) / 10;
      const avgConf = activeCycleFrames.reduce((s, c) => s + (c.confidence ?? 0), 0) / count;
      return {
        classes: { daun: avgDaun, pucuk: avgPucuk, sampah: avgSampah },
        confidence: avgConf,
        grade: dominantGrade(activeCycleFrames) ?? "M",
        classScores: meanClassScores(activeCycleFrames),
        impurityMeasured: activeCycleFrames.every(frame => frame.impurityMeasured === true),
        id: activeCycleFrames[0]?.id || 0,
        timestamp: activeCycle.startedAt,
        cameraId: targetCameraId || 0,
        snapshot: activeCycleFrames[0]?.snapshot || null,
        isCumulativeCycle: true,
        cycleFrameCount: count,
      };
    }

    if (cycleModelFrames.length > 0) {
      const count = cycleModelFrames.length;
      const sumDaun = cycleModelFrames.reduce((s, c) => s + c.classes.daun, 0);
      const sumPucuk = cycleModelFrames.reduce((s, c) => s + c.classes.pucuk, 0);
      const sumSampah = cycleModelFrames.reduce((s, c) => s + c.classes.sampah, 0);
      const avgDaun = Math.round((sumDaun / count) * 10) / 10;
      const avgPucuk = Math.round((sumPucuk / count) * 10) / 10;
      const avgSampah = Math.round((sumSampah / count) * 10) / 10;
      return {
        classes: { daun: avgDaun, pucuk: avgPucuk, sampah: avgSampah },
        confidence: cycleModelFrames.reduce((sum, frame) => sum + frame.confidence, 0) / count,
        grade: dominantGrade(cycleModelFrames) ?? "M",
        classScores: meanClassScores(cycleModelFrames),
        impurityMeasured: cycleModelFrames.every(frame => frame.impurityMeasured === true),
        id: cycleModelFrames[0]?.id || 0,
        timestamp: selectedCycle?.startedAt ?? cycleModelFrames[0].timestamp,
        cameraId: targetCameraId || 0,
        snapshot: cycleModelFrames[0]?.snapshot || null,
        isCumulativeCycle: true,
        cycleFrameCount: count,
      };
    }

    return latest;
  }, [activeCycle, activeCycleFrames, selectedCycle, cycleModelFrames, latest, targetCameraId]);

  const cycleGrade = (cycle: typeof lineCycles[number]): Grade => {
    const start = new Date(cycle.startedAt).getTime();
    const end = cycle.completedAt ? new Date(cycle.completedAt).getTime() : Date.now();
    const frames = analysisFrames.filter(item =>
      new Date(item.timestamp).getTime() >= start - 1000 && new Date(item.timestamp).getTime() <= end + 1000);
    return dominantGrade(frames) ?? "M";
  };
  // Agregasi Seluruh Siklus Meja Tebu untuk Stasiun / Pabrik ini
  const dailyCyclesStats = useMemo(() => {
    const cycles = lineCycles || [];
    const totalCycles = cycles.length;
    if (totalCycles === 0) return null;

    const completedCycles = cycles.filter(c => c.status === "completed");
    const totalFrames = analysisFrames.filter(item => cycles.some(c => {
      const t = new Date(item.timestamp).getTime();
      return t >= new Date(c.startedAt).getTime() - 1000 && t <= (c.completedAt ? new Date(c.completedAt).getTime() + 1000 : Date.now());
    })).length;

    // Average impurity across all cycles
    const avgImpurity = cycles.length > 0
      ? cycles.reduce((acc, c) => acc + (c.averageImpurity || 0), 0) / cycles.length
      : 0;

    const avgConfidence = cycles.length > 0
      ? cycles.reduce((acc, c) => acc + (c.averageConfidence ?? 0), 0) / cycles.length
      : 0.88;

    const overallGrade = dominantGrade(cycles.map(c => ({ grade: cycleGrade(c) }))) ?? "M";

    // Hitung distribusi kelas dari seluruh siklus
    const gradeCounts = TRANGKIL_GRADES.map((tg) => {
      const count = cycles.filter(c => {
        const cGrade = cycleGrade(c);
        return cGrade === tg.code;
      }).length;
      const pct = totalCycles > 0 ? Math.round((count / totalCycles) * 100) : 0;
      return {
        ...tg,
        count,
        pct
      };
    });

    // Hitung persentase lolos (S, M, A) vs kena sanksi/reject (D, B, G, X)
    const passCount = cycles.filter(c => ["S", "M", "A"].includes(cycleGrade(c))).length;
    const passPct = Math.round((passCount / totalCycles) * 100);

    // List siklus berurutan dengan info grade dan impuritas masing-masing
    const cycleTimeline = cycles.map((c, idx) => {
      const cGrade = cycleGrade(c);
      const gradeDef = TRANGKIL_GRADES.find(g => g.code === cGrade) || TRANGKIL_GRADES[1];
      return {
        id: c.id,
        number: idx + 1,
        code: c.truckCode,
        startedAt: c.startedAt,
        completedAt: c.completedAt,
        frames: analysisFrames.filter(item => { const t = new Date(item.timestamp).getTime(); return t >= new Date(c.startedAt).getTime() - 1000 && t <= (c.completedAt ? new Date(c.completedAt).getTime() + 1000 : Date.now()); }).length,
        impurity: Math.round((c.averageImpurity || 0) * 10) / 10,
        impurityMeasured: c.impurityMeasured === true,
        grade: cGrade,
        gradeDef,
        decision: c.finalDecision,
        status: c.status,
      };
    });

    return {
      totalCycles,
      completedCount: completedCycles.length,
      totalFrames,
      avgImpurity: Math.round(avgImpurity * 10) / 10,
      impurityMeasured: cycles.length > 0 && cycles.every(c => c.impurityMeasured === true),
      avgConfidence,
      overallGrade,
      passPct,
      gradeCounts,
      cycleTimeline
    };
  }, [lineCycles, analysisFrames]);

  // Pagination untuk Tren Mutu per Setiap Siklus (Zero Scroll)
  const timelinePageSize = 3;
  const totalTimelineCycles = dailyCyclesStats?.cycleTimeline.length || 0;
  const totalTimelinePages = Math.max(1, Math.ceil(totalTimelineCycles / timelinePageSize));
  const currentTimelinePage = Math.min(timelinePage, totalTimelinePages);
  const pagedTimeline = useMemo(() => {
    if (!dailyCyclesStats?.cycleTimeline) return [];
    const start = (currentTimelinePage - 1) * timelinePageSize;
    return dailyCyclesStats.cycleTimeline.slice(start, start + timelinePageSize);
  }, [dailyCyclesStats?.cycleTimeline, currentTimelinePage, timelinePageSize]);

  const hasLatestInference = Boolean(effectiveInference);
  const confidence = effectiveInference?.confidence ?? 0;
  const grade = effectiveInference?.grade;
  const gradeConf = Math.min(1, Math.max(0, confidence ?? 0));

  // Model scores are persisted percentages; no invented neighbouring probabilities.
  const gradeDistribution = useMemo(() => TRANGKIL_GRADES.map(item => ({
    ...item,
    prob: hasLatestInference ? Math.round(effectiveInference?.classScores?.[item.code] ??
      (item.code === grade ? gradeConf * 100 : 0)) : 0
  })), [effectiveInference, grade, gradeConf, hasLatestInference]);

  // Statistik Konsistensi Siklus Meja Tebu (7 Kelas PT Trangkil)
  const cycleConsistency = useMemo(() => {
    if (!cycleModelFrames || cycleModelFrames.length === 0) return null;
    const total = cycleModelFrames.length;
    const counts = TRANGKIL_GRADES.map(tg => ({
      code: tg.label,
      rawCode: tg.code,
      color: tg.color,
      count: cycleModelFrames.filter(c => normalizeGrade(c.grade) === tg.code).length
    }));

    const dominant = counts.reduce((max, cur) => cur.count > max.count ? cur : max, counts[0]);
    const dominantPct = Math.round((dominant.count / total) * 100);

    return { total, counts, dominantGrade: dominant.code, dominantPct };
  }, [cycleModelFrames]);

  // Metrik Tata Kelola Eksekutif Direksi (KPI Agregat & Rasio Mutu Bebas vs Sanksi)
  const execStats = useMemo(() => {
    const cycles = lineCycles || [];
    const totalTrucks = cycles.length;
    const totalFrames = (history || []).filter(item => (targetCameraId ? item.cameraId === targetCameraId : false)).length;

    let freePassCount = 0;
    let penaltyCount = 0;
    let rejectCount = 0;

    cycles.forEach((c) => {
      const g = cycleGrade(c);
      if (["S", "M", "A"].includes(g)) freePassCount++;
      else if (["D", "B"].includes(g)) penaltyCount++;
      else if (["G", "X"].includes(g)) rejectCount++;
    });

    if (totalTrucks === 0 && activeLineHistory.length > 0) {
      activeLineHistory.forEach((item) => {
        const g = item.grade;
        if (["S", "M", "A"].includes(g)) freePassCount++;
        else if (["D", "B"].includes(g)) penaltyCount++;
        else if (["G", "X"].includes(g)) rejectCount++;
      });
      const total = Math.max(1, activeLineHistory.length);
      return {
        totalTrucks: 0,
        totalFrames,
        freePassCount,
        freePassPct: Math.round((freePassCount / total) * 100),
        penaltyCount,
        penaltyPct: Math.round((penaltyCount / total) * 100),
        rejectCount,
        rejectPct: Math.round((rejectCount / total) * 100),
      };
    }

    const total = Math.max(1, totalTrucks);
    return {
      totalTrucks,
      totalFrames,
      freePassCount,
      freePassPct: totalTrucks > 0 ? Math.round((freePassCount / total) * 100) : 100,
      penaltyCount,
      penaltyPct: totalTrucks > 0 ? Math.round((penaltyCount / total) * 100) : 0,
      rejectCount,
      rejectPct: totalTrucks > 0 ? Math.round((rejectCount / total) * 100) : 0,
    };
  }, [lineCycles, activeLineHistory, targetCameraId, history]);

  const isAiOnline = status?.ai.status === "ok";
  const cameraLive = targetCameraId === 1 ? status?.ai.camera_1_live : targetCameraId === 2 ? status?.ai.camera_2_live : false;
  const isDbOnline = status?.database.status === "ok" || status?.database.status === "dev-memory";

  return (
    <section ref={panelSize.ref} className="dashboardPage newLayout" data-compact={compactLayout} data-short={panelSize.height < 600} data-pane={dashboardPane} data-analysis-view={analysisDetailTab}>
      {/* ─── Top Station Header ─── */}
      <div className="stationHeader">
        <div className="stationHeaderLeft">
          {isFactoryLocked ? (
            currentFactory.id === "trangkil" ? (
              <div className="stationLogoBadge" title="Pabrik Gula Trangkil (Pati)">
                <img
                  src="/logo-trangkil.png"
                  alt="Pabrik Gula Trangkil"
                  className="stationTrangkilLogo"
                />
                <span className="stationFactoryCity">Pati, Jawa Tengah</span>
              </div>
            ) : (
              <div className="stationFactoryId">
                <Building2 size={16} />
                <span className="stationFactoryName">{currentFactory.name}</span>
                <span className="stationFactoryCity">{currentFactory.city}</span>
              </div>
            )
          ) : (
            <div className="stationFactorySwitcher">
              {(Object.keys(FACTORIES) as FactoryKey[]).map((fKey) => {
                const f = FACTORIES[fKey];
                const isSelected = activeFactory === fKey;
                return (
                  <button
                    key={fKey}
                    type="button"
                    className={`stationFactoryBtn ${isSelected ? "active" : ""}`}
                    onClick={() => {
                      setActiveFactory(fKey);
                      localStorage.setItem("active-factory", fKey);
                      setActiveLine(getDefaultLine(fKey));
                    }}
                  >
                    <Building2 size={13} />
                    <span>{f.shortName}</span>
                    {isSelected && <span className="stationActiveDot" />}
                  </button>
                );
              })}
            </div>
          )}

          <select className="responsiveMbsSelect" aria-label="Pilih meja tebu" value={activeLine} onChange={event => setActiveLine(Number(event.target.value))}>
            {currentFactory.lines.map(item => <option key={item.line} value={item.line} disabled={Boolean(item.locked)}>{item.title}</option>)}
          </select>
          {/* MBS Tab Pills */}
          <div className="stationMbsTabs">
            {currentFactory.lines.map((item) => {
              const isLocked = Boolean(item.locked);
              const isActive = activeLine === item.line;
              const hasCamera = Boolean(item.cameraId);
              return (
                <button
                  key={item.line}
                  type="button"
                  className={`stationMbsTab ${isActive ? "active" : ""} ${isLocked ? "locked" : ""}`}
                  onClick={() => { if (!isLocked) setActiveLine(item.line); }}
                  disabled={isLocked}
                  title={isLocked ? `${item.title} — Jalur Terkunci` : `${item.title} (${item.subtext})`}
                >
                  {isLocked && <Lock size={10} />}
                  <span>{item.title}</span>
                  {!isLocked && (
                    <span className={`stationMbsDot ${hasCamera ? "live" : "offline"}`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="stationHeaderRight">
          {/* System status chips */}
          <div className="stationStatusChips">
            <div className={`stChip ${isDbOnline ? "ok" : "err"}`} title="Database Server Online">
              <CheckCircle size={11} />
              <span>Database</span>
            </div>
          </div>

          {/* Tombol Otorisasi & Persetujuan Direksi */}
          {isAdmin && (
            <button
              type="button"
              className="stationHeaderActionBtn"
              onClick={() => setIsApprovalQueueOpen(true)}
              title="Pusat Otorisasi & Persetujuan Direksi (Maker-Checker)"
              style={{
                background: pendingRequestsCount > 0 ? "rgba(245, 158, 11, 0.2)" : "rgba(30, 41, 59, 0.7)",
                borderColor: pendingRequestsCount > 0 ? "rgba(245, 158, 11, 0.5)" : "rgba(255, 255, 255, 0.15)",
                color: pendingRequestsCount > 0 ? "#fbbf24" : "#cbd5e1",
                fontWeight: 600
              }}
            >
              <ShieldCheck size={13} />
              <span>Persetujuan Direksi</span>
              {pendingRequestsCount > 0 && (
                <span style={{
                  background: "#ef4444",
                  color: "#fff",
                  fontSize: "10px",
                  padding: "1px 6px",
                  borderRadius: "8px",
                  fontWeight: 700
                }}>
                  {pendingRequestsCount}
                </span>
              )}
            </button>
          )}

          {/* Quick Trigger for Tapping Sync / Upload Excel */}
          <button
            type="button"
            className="stationHeaderActionBtn"
            onClick={() => setIsSyncModalOpen(true)}
            title="Upload Excel Pabrik & Rekonsiliasi Data Antrean PT Trangkil"
          >
            <FileSpreadsheet size={13} />
            <span>Upload Excel Pabrik</span>
          </button>

          <div className="stationClock">
            <Clock size={12} />
            <span>{clock.toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          </div>
          {/* Quick Light/Dark Mode Switcher */}
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

      {/* ─── Main 3-Panel Layout ─── */}
      <nav className="dashboardPaneTabs" aria-label="Panel dashboard">
        {[['camera', 'Kamera & Kontrol'], ['captures', 'Tangkapan Frame'], ['analysis', 'Analisis Mutu'], ['events', 'Log Frame']].map(([id, label]) => (
          <button key={id} aria-pressed={dashboardPane === id} className={dashboardPane === id ? 'active' : ''} onClick={() => setDashboardPane(id)}>{label}</button>
        ))}
      </nav>
      <div className="stationMainGrid">

        {/* ══════ LEFT PANEL: Live Stream + Event Log ══════ */}
        <div className="stationLeftPanel">
          {/* Live Stream Card */}
          <div className="streamCard">
            <div className="streamCardHeader">
              <div className="streamCardTitle">
                <div className={`streamLivePill ${targetCameraId && isStreaming ? "live" : "offline"}`}>
                  <Radio size={9} className={targetCameraId && isStreaming ? "pulse-dot" : ""} />
                  {targetCameraId && isStreaming ? "LIVE STREAM" : "NO SIGNAL"}
                </div>
                <span className="streamCardSubtitle">MBS {activeLine}</span>
              </div>
              <div className="streamCardActions">
                {targetCameraId && isStreaming && (
                  <>
                    <button
                      type="button"
                      className={`stStreamBtn ${showHud ? "active" : ""}`}
                      onClick={() => setShowHud((prev) => !prev)}
                      title={showHud ? "Sembunyikan HUD Overlay (Raw Video)" : "Tampilkan HUD Overlay (ROI + Telemetri)"}
                    >
                      <Sliders size={12} />
                    </button>
                    <button
                      type="button"
                      className={`stStreamBtn captureBtn ${captureFeedback ? "success" : ""}`}
                      onClick={handleManualCapture}
                      disabled={capturing || !canInspect || Boolean(activeCycle) || !status?.ai.model?.available}
                      title="AI Capture"
                    >
                      <Camera size={12} />
                      <span>{capturing ? "Scanning..." : captureFeedback ? "✓" : "Capture"}</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="stStreamBtn"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                </button>
              </div>
            </div>

            {/* Video area */}
            <div className={`streamVideoArea ${isFullscreen ? "fullscreenMode" : ""}`} ref={streamCanvasRef}>
              {targetCameraId && isStreaming ? (
                <div className="streamVideoContainer">
                  <img
                    key={`stream-${activeFactory}-${targetCameraId}`}
                    src={getCameraStreamUrl(targetCameraId, showHud, 80, streamKey)}
                    alt={`Live Stream ${currentFactory.name} MBS ${activeLine}`}
                    className="liveStreamImg"
                    onError={event => { event.currentTarget.style.visibility = "hidden"; handleStreamError(); }}
                    onLoad={event => { event.currentTarget.style.visibility = "visible"; handleStreamLoad(); }}
                  />
                  <div className="streamOverlayTag">
                    {currentFactory.shortName} • MBS {activeLine}
                  </div>
                  {isFullscreen && (
                    <button type="button" className="fullscreenExitFloatingBtn" onClick={toggleFullscreen}>
                      <Minimize2 size={15} />
                      <span>Keluar Full View</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="noStreamPlaceholder">
                  <CameraOff size={36} />
                  <strong>MBS {activeLine} — {currentLineDef?.locked ? "Jalur Terkunci" : "Sinyal CCTV Terputus"}</strong>
                  <span>{currentLineDef?.locked ? "Jalur Terkunci" : "Menghubungkan ke RTSP CCTV... Pastikan VPN Pabrik aktif."}</span>
                  {!currentLineDef?.locked && targetCameraId && (
                    <button
                      type="button"
                      className="stStreamBtn"
                      onClick={handleReconnectStream}
                      style={{ marginTop: "12px", padding: "6px 14px", display: "inline-flex", gap: "6px" }}
                    >
                      <RefreshCw size={13} className={streamReconnecting ? "spin-pulse" : ""} />
                      <span>{streamReconnecting ? "Menyambungkan..." : "Hubungkan Ulang"}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {isAdmin ? (
              /* ─── Mode Pengawasan Mutu & Tata Kelola Direksi (Style Platform PG Trangkil) ─── */
              <>
                {/* 1. Bar Pengawasan Mutu & Otorisasi 2FA (Menggantikan Kontrol Siklus Fisik Operator) */}
                <div className="streamAdminOversightBar">
                  <div className="adminBarStatusRow">
                    <div className="adminBarHeaderBadge">
                      <ShieldCheck size={11} />
                      <span>PENGAWASAN DIREKSI • MEJA TEBU {activeLine}</span>
                    </div>

                    {pendingRequestsCount > 0 ? (
                      <button
                        type="button"
                        className="adminBarApprovalBtn urgent"
                        onClick={() => setIsApprovalQueueOpen(true)}
                        title="Tinjau dan otorisasi permohonan penghapusan frame dengan PIN 2FA"
                      >
                        <ShieldAlert size={12} />
                        <span>Otorisasi 2FA ({pendingRequestsCount} Pending)</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="adminBarApprovalBtn secure"
                        onClick={() => setIsApprovalQueueOpen(true)}
                        title="Buka log audit persetujuan frame anti-fraud"
                      >
                        <Check size={11} />
                        <span>Audit Log Aman (0 Pending)</span>
                      </button>
                    )}
                  </div>

                  {/* Ringkasan Rasio Mutu Eksekutif Meja Tebu Aktif */}
                  <div className="adminBarMetricsRow">
                    <div className="adminMetricItem pass" title="Tebu mutu prima lolos tanpa rafaksi (MBS S, M, A)">
                      <span className="adminMetricDot green" />
                      <span className="adminMetricLabel">Lolos Bebas (0%):</span>
                      <strong className="adminMetricVal">{execStats.freePassPct}%</strong>
                    </div>
                    <div className="adminMetricItem penalty" title="Tebu terkena denda potongan bobot (MBS D, B)">
                      <span className="adminMetricDot amber" />
                      <span className="adminMetricLabel">Rafaksi:</span>
                      <strong className="adminMetricVal">{execStats.penaltyPct}%</strong>
                    </div>
                    <div className="adminMetricItem reject" title="Tebu ditolak/afkir meja giling (MBS G, X)">
                      <span className="adminMetricDot red" />
                      <span className="adminMetricLabel">Afkir/Tolak:</span>
                      <strong className="adminMetricVal">{execStats.rejectPct}%</strong>
                    </div>
                  </div>
                </div>

              </>
            ) : (
              /* ─── Operator Physical Conveyor Controls (Start/Stop Scan) ─── */
              <>
                <div className="streamCycleBar">
                  <div className="cycleControlRow">
                      <button type="button" className="cycleAutoButton" aria-pressed={autoEnabled}
                        disabled={!canInspect || !targetCameraId || !currentAutoMode || autoModeBusy || (!autoEnabled && (!currentAutoMode.model_available || Boolean(activeCycle)))}
                        onClick={handleToggleAuto}
                        title={autoEnabled ? "Matikan Auto dan simpan siklus yang sedang berjalan" : "Aktifkan pemindaian otomatis saat tebu memenuhi seluruh frame"}>
                        {autoModeBusy ? "Memproses..." : autoEnabled ? "Auto Aktif" : "Aktifkan Auto"}
                        <span className="cycleAutoSwitch" aria-hidden="true" />
                      </button>
                      {activeCycle ? (
                        <button type="button" className="stopCycleBtn" disabled={!canInspect || manualLocked}
                          onClick={() => handleStopCycle("Dihentikan secara manual oleh operator")}
                          title={autoEnabled ? "Matikan Auto untuk mengakhiri siklus lebih awal" : "Hentikan pemindaian dan simpan siklus ini"}>
                          <Square size={13} fill="currentColor" />
                          <span>Stop Manual</span>
                        </button>
                      ) : (
                        <button type="button" className="startCycleBtn" onClick={handleStartCycle}
                          disabled={!canInspect || !targetCameraId || !isStreaming || manualLocked}
                          title={autoEnabled ? "Mode Auto aktif; tombol manual dikunci" : "Mulai deteksi siklus saat tebu diletakkan ke meja tebu"}>
                          <Play size={13} fill="currentColor" />
                          <span>Mulai Manual</span>
                        </button>
                      )}
                  </div>
                  {autoStatusError && <div className="cycleAutoStatus" role="alert">{autoStatusError}</div>}
                  {activeCycle && (
                    <div className="cycleBarActiveRow">
                      <div className="cycleActiveMetaRow">
                        <div className="cycleTimerBadge">
                          <Clock size={11} />
                          <span>{String(Math.floor(cycleElapsedSeconds / 60)).padStart(2, "0")}:{String(cycleElapsedSeconds % 60).padStart(2, "0")}</span>
                        </div>
                        <div className="cycleFrameBadge">
                          <span>{activeCycleFrames.length} Frame</span>
                        </div>
                      </div>

                    </div>
                  )}

                  {cycleFeedback && (
                    <div className="cycleFeedbackAlert">
                      <span>{cycleFeedback}</span>
                    </div>
                  )}
                </div>

              </>
            )}

            {/* Telemetry strip below video */}
            <div className="streamTelemetryStrip">
              <div className="telItem">
                <span className="telLabel">STATUS KAMERA</span>
                <strong className={cameraLive ? "telGreen" : "telMuted"}>
                  {cameraLive ? "ONLINE" : "OFFLINE"}
                </strong>
              </div>
              <div className="telItem">
                <span className="telLabel">AI MODEL</span>
                <strong className={status?.ai.model?.available ? "telGreen" : "telMuted"}>
                  {status?.ai.model?.available ? "ACTIVE" : isAiOnline ? "UNAVAILABLE" : "OFFLINE"}
                </strong>
              </div>
              <div className="telItem">
                <span className="telLabel">LAST SCAN</span>
                <strong className="telVal">
                  {latest ? new Date(latest.timestamp).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                </strong>
              </div>
              <div className="telItem">
                <span className="telLabel">DATABASE</span>
                <strong className={isDbOnline ? "telGreen" : "telMuted"}>
                  {isDbOnline ? "CONNECTED" : "OFFLINE"}
                </strong>
              </div>
            </div>
          </div>

          {/* Live Detection Event Feed (Expanded & Structured) */}
          <div className="eventFeedCard">
            <div className="eventFeedHeader">
              <div className="eventFeedTitle">
                <span className="eventFeedTitleBadge">
                  <Radio size={10} className={eventTotal ? "pulse-dot" : ""} />
                  <span>{selectedCycle ? `Siklus: ${selectedCycle.truckCode}` : "Live Detection Event Stream"}</span>
                </span>
                <span className="eventFeedCountBadge">{eventTotal?.toLocaleString("id-ID") ?? "—"}</span>
              </div>
              <div className="eventFeedHeaderRight">
                {selectedCycle ? (
                  <button
                    type="button"
                    className="eventFeedResetBtn"
                    onClick={() => setSelectedCycleId(null)}
                    title="Kembali ke Event Stream Realtime"
                  >
                    <RotateCcw size={11} />
                    <span>Realtime</span>
                  </button>
                ) : (
                  <span className={`eventFeedStatus ${eventTotal && !detectionError ? "active" : "idle"}`}>
                    {detectionError ? "TERPUTUS" : !currentDetectionPage ? "MEMUAT" : eventTotal ? "STREAM LIVE" : "IDLE"}
                  </span>
                )}
              </div>
            </div>

            {/* Structured Column Header */}
            {Boolean(eventTotal) && (
              <div className="eventFeedColHeader">
                <span className="colTime">Waktu</span>
                <span className="colBatch">Frame</span>
                <span className="colGrade">Mutu</span>
                <span className="colImp">Kotoran</span>
                <span className="colConf">Akurasi</span>
              </div>
            )}

            <div className="eventFeedList">
              {visibleEvents.map((item) => {
                const itemImpurity = item.classes.daun + item.classes.pucuk + item.classes.sampah;
                const normG = normalizeGrade(item.grade);
                const gradeColor = (normG === "S" || normG === "M" || normG === "A") ? "eventGradeBlueBright" :
                  normG === "B" ? "eventGradeBlue" :
                  normG === "D" ? "eventGradeSlate" : "eventGradeBlack";
                const barColor = itemImpurity <= 5 ? "#2563eb" : itemImpurity <= 10 ? "#0284c7" : itemImpurity <= 15 ? "#f59e0b" : "#ef4444";
                const confPercent = Math.round((item.confidence ?? 0) * 100);

                return (
                  <button
                    key={item.id}
                    type="button"
                    className="eventFeedRow"
                    onClick={() => setSelectedCapture(item)}
                    title={`Klik untuk melihat detail Frame ${item.frameNumber} (Grade MBS ${item.grade})`}
                  >
                    <span className="eventFeedTime">
                      {new Date(item.timestamp).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span className="eventFeedId">{item.frameNumber}</span>
                    <span className={`eventFeedGrade ${gradeColor}`}>MBS {item.grade}</span>
                    <div className="eventFeedImpWrapper">
                      <span className="eventFeedImpurity">{item.impurityMeasured ? `${itemImpurity.toFixed(1)}%` : "Tidak diukur"}</span>
                      <div className="eventFeedMiniBar">
                        <div
                          className="eventFeedMiniBarFill"
                          style={{
                            width: `${item.impurityMeasured ? Math.min(100, (itemImpurity / 20) * 100) : 0}%`,
                            background: barColor
                          }}
                        />
                      </div>
                    </div>
                    <span className="eventFeedConf">{confPercent}%</span>
                  </button>
                );
              })}
              {visibleEvents.length === 0 && (
                <div className="eventFeedEmpty">
                  <div className="eventFeedEmptyIcon">
                    <Radio size={22} />
                  </div>
                  <div className="eventFeedEmptyText">
                    <strong>{detectionError ? "Data deteksi belum tersedia" : !currentDetectionPage ? "Memuat deteksi..." : selectedCycle ? "Tidak Ada Deteksi pada Siklus Ini" : `Belum Ada Deteksi MBS ${activeLine}`}</strong>
                  </div>
                </div>
              )}
            </div>
            {Boolean(eventTotal) && <div className="eventFeedPagination">
              <button disabled={safeEventPage === 1} onClick={() => setEventPage(safeEventPage - 1)} aria-label="Frame sebelumnya">&lsaquo;</button>
              <span>{safeEventPage} / {eventPages}</span>
              <button disabled={safeEventPage === eventPages} onClick={() => setEventPage(safeEventPage + 1)} aria-label="Frame berikutnya">&rsaquo;</button>
            </div>}
          </div>
        </div>

        {/* ══════ CENTER PANEL: Recent Captures Grid ══════ */}
        <div className="stationCenterPanel">
          <div className="captureGridCard">
            {/* Integrated Header: Title + Station + Cycle Filter Widget + Pagination */}
            <div className="captureGridHeader">
              {/* Left: Title */}
              <div className="captureGridTitle">
                <span className="captureGridTitleBadge">
                  <Camera size={12} className="captureGridTitleIcon" />
                  <strong>Recent Captures</strong>
                </span>
              </div>

              {/* Center: Integrated Custom Smart Cycle Filter Picker */}
              <div className="captureCycleControlGroup">
                <div className="cyclePickerWrapper" ref={cyclePickerRef}>
                  {selectedCycle ? (
                    <div className="cyclePickerSelectedRow">
                      <button
                        type="button"
                        className={`cyclePickerTrigger selected ${cyclePickerOpen ? "open" : ""}`}
                        onClick={() => setCyclePickerOpen(!cyclePickerOpen)}
                        aria-haspopup="listbox"
                        aria-controls="cycle-filter-options"
                        aria-expanded={cyclePickerOpen}
                        title={`Siklus terpilih: ${selectedCycle.truckCode} • Klik untuk mengganti siklus`}
                      >
                        <Truck size={13} className="cyclePickerTruckIcon" />
                        <span className="cyclePickerTriggerText">
                          <strong>{selectedCycle.truckCode}</strong>
                          <span className="cyclePickerSubtext">
                            {selectedCycle.totalCaptures || 0} Frame • {new Date(selectedCycle.startedAt).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </span>
                        <span className={`cyclePickerGradePill grade-${(selectedCycle.finalDecision || "mbs").toLowerCase()}`}>
                          {selectedCycle.finalDecision || "MBS"}
                        </span>
                        <ChevronDown size={12} className={`cyclePickerChevron ${cyclePickerOpen ? "open" : ""}`} />
                      </button>

                      <button
                        type="button"
                        className="cyclePickerResetBtn"
                        onClick={() => {
                          setSelectedCycleId(null);
                          setCyclePickerOpen(false);
                        }}
                        title="Kembalikan tampilan Recent Captures dan Event Stream ke Siaran Realtime"
                      >
                        <RotateCcw size={11} />
                        <span>Kembali Realtime</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`cyclePickerTrigger ${cyclePickerOpen ? "open" : ""}`}
                      onClick={() => setCyclePickerOpen(!cyclePickerOpen)}
                      aria-haspopup="listbox"
                      aria-controls="cycle-filter-options"
                      aria-expanded={cyclePickerOpen}
                      title="Pilih filter siklus pemeriksaan meja tebu"
                    >
                      <span className="cyclePickerTriggerDot" />
                      <span className="cyclePickerTriggerText">
                        <strong>Mode Realtime</strong>
                        <span className="cyclePickerSubtext">Semua Deteksi</span>
                      </span>
                      {lineCycles.length > 0 && (
                        <span className="cyclePickerBadgeCount">{lineCycles.length} Siklus</span>
                      )}
                      <ChevronDown size={12} className={`cyclePickerChevron ${cyclePickerOpen ? "open" : ""}`} />
                    </button>
                  )}

                  {/* Floating Custom Dropdown Popover */}
                  {cyclePickerOpen && (
                    <div className="cyclePickerDropdown" id="cycle-filter-options" role="listbox" aria-label="Pilih siklus meja tebu"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setCyclePickerOpen(false);
                          cyclePickerRef.current?.querySelector<HTMLButtonElement>(".cyclePickerTrigger")?.focus();
                          return;
                        }
                        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                        event.preventDefault();
                        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='option']"));
                        const current = options.indexOf(document.activeElement as HTMLButtonElement);
                        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
                          : event.key === "ArrowDown" ? (current + 1) % options.length : (current - 1 + options.length) % options.length;
                        options[next]?.focus();
                      }}>
                      <div className="cyclePickerDropdownHeader">
                        <span className="cyclePickerDropdownTitle">
                          <Layers size={11} />
                          <span>Pilih siklus</span>
                        </span>
                        <span className="cyclePickerDropdownCount">
                          {lineCycles.length} siklus
                        </span>
                      </div>

                      <div className="cyclePickerDropdownList">
                        {/* Realtime Option */}
                        <button type="button"
                          className={`cyclePickerItem realtime ${!selectedCycleId ? "active" : ""}`}
                          onClick={() => {
                            setSelectedCycleId(null);
                            setCyclePickerOpen(false);
                          }}
                          role="option"
                          aria-selected={!selectedCycleId}
                        >
                          <div className="cyclePickerItemLeft">
                            <div className="cyclePickerItemLiveDotWrap">
                              <span className="realtimeActiveDot" />
                            </div>
                            <div className="cyclePickerItemInfo">
                              <div className="cyclePickerItemMain">
                                <strong>Mode Realtime</strong>
                                <span className="cyclePickerLiveBadge">LIVE</span>
                              </div>
                            </div>
                          </div>
                          {!selectedCycleId && <Check size={14} className="cyclePickerItemCheck" />}
                        </button>

                        {lineCycles.length > 0 && <div className="cyclePickerDivider" />}

                        {/* Historical & Active Cycles */}
                        {lineCycles.length === 0 ? (
                          <div className="cyclePickerEmpty">
                            <span>Belum ada siklus yang tercatat</span>
                          </div>
                        ) : (
                          lineCycles.map((cycle) => {
                            const isSelected = selectedCycleId === cycle.id;
                            const isActive = cycle.status === "active";
                            const timeStr = new Date(cycle.startedAt).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit" });
                            const dateStr = new Date(cycle.startedAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
                            const count = cycle.totalCaptures || 0;
                            const gradeCode = cycle.finalDecision || "MBS";

                            return (
                              <button type="button"
                                key={cycle.id}
                                className={`cyclePickerItem ${isSelected ? "active" : ""} ${isActive ? "running" : ""}`}
                                onClick={() => {
                                  setSelectedCycleId(cycle.id);
                                  setCyclePickerOpen(false);
                                }}
                                role="option"
                                aria-selected={isSelected}
                              >
                                <div className="cyclePickerItemLeft">
                                  <div className="cyclePickerItemIconWrap">
                                    <Truck size={13} />
                                  </div>
                                  <div className="cyclePickerItemInfo">
                                    <div className="cyclePickerItemMain">
                                      <strong className="cyclePickerTruckName" title={cycle.truckCode}>{cycle.truckCode}</strong>
                                      {isActive ? (
                                        <span className="cyclePickerStatusRunning">Aktif</span>
                                      ) : (
                                        <span className="cyclePickerStatusDone">Selesai</span>
                                      )}
                                    </div>
                                    <div className="cyclePickerItemDetails">
                                      <span><Clock size={10} /> {dateStr}, {timeStr}</span>
                                      <span>•</span>
                                      <span><Camera size={10} /> {count.toLocaleString("id-ID")} frame</span>
                                      {cycle.plateNumber && (
                                        <>
                                          <span>•</span>
                                          <span>{cycle.plateNumber}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="cyclePickerItemRight">
                                  <span className={`cyclePickerGradeTag grade-${gradeCode.toLowerCase()}`}>
                                    {gradeCode.replaceAll("_", " ")}
                                  </span>
                                  {isSelected && <Check size={14} className="cyclePickerItemCheck" />}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Meta & Pagination */}
              <div className="captureGridMeta">
                <span className="captureGridCount">
                  <span className="captureGridTotal">{visibleCapturesCount} frame · </span>
                  <span>{currentPage}/{totalPages}</span>
                </span>
                <div className="captureGridPageBtns">
                  <button
                    type="button"
                    className="pgBtn"
                    onClick={() => setCapturePage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    title="Halaman sebelumnya"
                  >‹</button>
                  <button
                    type="button"
                    className="pgBtn"
                    onClick={() => setCapturePage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    title="Halaman berikutnya"
                  >›</button>
                </div>
              </div>
            </div>

            {/* If a cycle is selected, show an executive-grade Cycle Telemetry Banner */}
            {selectedCycle && (
              <div className="cycleActiveBanner">
                <div className="cycleActiveBannerLeft">
                  <div className="cycleBannerTopLine">
                    <span className="cycleBannerGradeBadge">
                      Grade {selectedCycle.finalDecision || "MBS"}
                    </span>
                    <strong className="cycleBannerTitle">{selectedCycle.truckCode}</strong>
                    <span className="cycleBannerFramesBadge">{displayedCaptures.length} Frame Terdeteksi</span>
                  </div>
                  <div className="cycleBannerMetaLine">
                    <span>
                      Mulai: {new Date(selectedCycle.startedAt).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span>•</span>
                    <span>
                      {selectedCycle.completedAt
                        ? `Selesai: ${new Date(selectedCycle.completedAt).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                        : "Siklus Sedang Berlangsung"}
                    </span>
                    <span>•</span>
                    <span>
                      Rata-rata Kotoran: <strong>{selectedCycle.impurityMeasured ? `${selectedCycle.averageImpurity.toFixed(1)}%` : "Tidak diukur"}</strong>
                    </span>
                    <span>•</span>
                    <span>
                      Akurasi AI: <strong>{Math.round((selectedCycle.averageConfidence ?? 0) * 100)}%</strong>
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="cycleBannerResetBtn"
                  onClick={() => setSelectedCycleId(null)}
                  title="Kembalikan tampilan ke mode realtime saat ini"
                >
                  <RotateCcw size={11} />
                  <span>Reset Realtime</span>
                </button>
              </div>
            )}

            <div className="capturePhotoGrid" ref={captureGridRef} style={{ gridTemplateColumns: `repeat(${captureColumns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${captureRows}, minmax(0, 1fr))` }}>
              {visibleCaptures.map((item) => {
                const itemImpurity = item.classes.daun + item.classes.pucuk + item.classes.sampah;
                const normG = normalizeGrade(item.grade);
                const gradeColor = (normG === "S" || normG === "M" || normG === "A") ? "photo-grade-blue-bright" :
                  normG === "B" ? "photo-grade-blue" :
                  normG === "D" ? "photo-grade-slate" : "photo-grade-black";
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="capturePhotoCard"
                    style={{ width: `min(100%, ${captureCardWidth}px)` }}
                    onClick={() => setSelectedCapture(item)}
                    title={`Frame ${frameNumber(item.id)} — MBS ${item.grade}`}
                  >
                    <div className="photoThumb">
                      {item.snapshot ? (
                        <img
                          src={item.snapshot.startsWith("http") ? item.snapshot : `${backendUrl}${item.snapshot}`}
                          alt={`Detection frame ${frameNumber(item.id)}`}
                          className="photoThumbImg"
                          onLoad={event => {
                            const image = event.currentTarget;
                            if (image.naturalWidth && image.naturalHeight) setCaptureAspect(image.naturalWidth / image.naturalHeight);
                          }}
                        />
                      ) : (
                        <div className="photoThumbEmpty">
                          <Camera size={22} />
                        </div>
                      )}
                      <span className={`photoGradeBadge ${gradeColor}`}>MBS {item.grade}</span>
                      <span className="photoImpBadge">{item.impurityMeasured ? `${itemImpurity.toFixed(1)}%` : "Tidak diukur"}</span>
                      {pendingInferenceIds.has(item.id) && (
                        <span style={{
                          position: "absolute",
                          bottom: "6px",
                          left: "6px",
                          background: "rgba(245, 158, 11, 0.95)",
                          color: "#000",
                          fontSize: "9px",
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: "4px",
                          display: "flex",
                          alignItems: "center",
                          gap: "3px",
                          zIndex: 2,
                          boxShadow: "0 1px 4px rgba(0,0,0,0.4)"
                        }}>
                          <Clock size={9} /> Pending Hapus
                        </span>
                      )}
                      <button
                        type="button"
                        className="photoCardDeleteBtn"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (pendingInferenceIds.has(item.id)) {
                            alert("Permohonan penghapusan frame ini sedang menunggu persetujuan Direksi.");
                            return;
                          }
                          if (isOperator) {
                            setRequestDeletionTarget({
                              id: item.id,
                              title: `Frame #${item.id} (${item.impurityMeasured ? `${itemImpurity.toFixed(1)}%` : "Tidak diukur"} Kotoran • Grade ${item.grade})`,
                              subtitle: `Waktu Rekam: ${item.timestamp || "Baru saja"}`,
                              snapshotPath: item.snapshot ? (item.snapshot.startsWith("http") ? item.snapshot : `${backendUrl}${item.snapshot}`) : undefined
                            });
                          } else {
                            if (confirm(`Hapus frame capture Frame ${frameNumber(item.id)} secara langsung sebagai Direksi?`)) {
                              await deleteInference(item.id);
                              if (selectedCapture?.id === item.id) setSelectedCapture(null);
                            }
                          }
                        }}
                        title={pendingInferenceIds.has(item.id) ? "Menunggu persetujuan Direksi" : isOperator ? "Ajukan permohonan hapus frame ke Direksi" : "Hapus frame ini"}
                        style={pendingInferenceIds.has(item.id) ? { opacity: 0.4, cursor: "not-allowed" } : {}}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="photoCardFooter">
                      <span className="photoTime">
                        <Clock size={9} />
                        {new Date(item.timestamp).toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className="photoConf">
                        Conf: {Math.round(item.confidence * 100)}%
                      </span>
                    </div>
                  </button>
                );
              })}

              {placeholders.map((_, index) => (
                <div key={`ph-${index}`} className="capturePhotoCardPlaceholder" style={{ width: `min(100%, ${captureCardWidth}px)` }}>
                  <div className="photoThumbEmpty" style={{ aspectRatio: captureAspect }}>
                    <Camera size={22} className="placeholderCamIcon" />
                  </div>
                  <div className="photoCardFooter muted">
                    <span>Menunggu deteksi...</span>
                  </div>
                </div>
              ))}
            </div>
          </div>


        </div>

        {/* ══════ RIGHT PANEL: Analisis Kategori (Lengkap) ══════ */}
        <div className="stationRightPanel">
          <div className="categoryAnalysisCard">
            <div className="catAnalysisHeader">
              <span className="catAnalysisTitle">
                <BarChart3 size={11} />
                <span>Analisis Kategori Mutu Tebu</span>
              </span>

              {/* Mode Switcher Tabs */}
              <div className="catModeSwitchPills">
                <button
                  type="button"
                  className={`catModePillBtn ${analysisTab === "realtime" && analysisDetailTab === "grades" ? "active" : ""}`}
                  onClick={() => { setAnalysisTab("realtime"); setAnalysisDetailTab("grades"); }}
                  title="Lihat kalkulasi realtime siklus saat ini"
                >
                  <Activity size={10} />
                  <span>Realtime {activeCycle ? `(${activeCycleFrames.length}F)` : ""}</span>
                </button>
                <button
                  type="button"
                  className={`catModePillBtn ${analysisTab === "daily" && analysisDetailTab === "grades" ? "active" : ""}`}
                  onClick={() => { setAnalysisTab("daily"); setAnalysisDetailTab("grades"); }}
                  title="Lihat rekapitulasi chart seluruh siklus harian"
                >
                  <TrendingUp size={10} />
                  <span>Rekap Siklus ({dailyCyclesStats?.totalCycles || 0})</span>
                </button>
                <button type="button" className={`catModePillBtn responsiveAnalysisTab ${analysisDetailTab === "consistency" ? "active" : ""}`} onClick={() => { setAnalysisTab("realtime"); setAnalysisDetailTab("consistency"); }} aria-pressed={analysisDetailTab === "consistency"}>Konsistensi</button>
                <button type="button" className={`catModePillBtn responsiveAnalysisTab ${analysisDetailTab === "timeline" ? "active" : ""}`} onClick={() => { setAnalysisTab("daily"); setAnalysisDetailTab("timeline"); }} aria-pressed={analysisDetailTab === "timeline"}>Tren Siklus</button>
              </div>
            </div>

            {analysisTab === "realtime" ? (
              <div className="realtimeAggregateArea">
                {/* Active Cycle Cumulative Average indicator */}
                {activeCycle && activeCycleFrames.length > 0 && (
                  <div className="cycleLiveKumulatifPill">
                    <span className="pulse-dot-red" />
                    <span>Akumulasi Siklus Berjalan: <strong>{activeCycleFrames.length} Frame Di-Average</strong></span>
                  </div>
                )}

                {/* KPI Row */}
                <div className="catKpiRow">
                  <div className="catKpi">
                    <span className="catKpiLabel">Toleransi Kotoran</span>
                    <strong className={`catKpiValue ${normalizeGrade(grade) === "X" || normalizeGrade(grade) === "G" ? "danger" : normalizeGrade(grade) === "B" || normalizeGrade(grade) === "D" ? "amber" : "blue"}`}>
                      {hasLatestInference ? TRANGKIL_GRADES.find(tg => tg.code === normalizeGrade(grade))?.tol || "—" : "—"}
                    </strong>
                  </div>
                  <div className="catKpi">
                    <span className="catKpiLabel">Kebijakan Rafaksi</span>
                    <strong className={`catKpiValue ${normalizeGrade(grade) === "X" || normalizeGrade(grade) === "G" ? "danger" : normalizeGrade(grade) === "B" || normalizeGrade(grade) === "D" ? "amber" : "blue"}`}>
                      {hasLatestInference ? TRANGKIL_GRADES.find(tg => tg.code === normalizeGrade(grade))?.rafaksi || "—" : "—"}
                    </strong>
                  </div>
                  <div className="catKpi">
                    <span className="catKpiLabel">AI Confidence</span>
                    <strong className="catKpiValue blue">
                      {hasLatestInference ? `${(gradeConf * 100).toFixed(1)}` : "—"}
                      <span className="catKpiUnit">%</span>
                    </strong>
                  </div>
                </div>

                {/* Grade + Donut Display */}
                <div className="catGradeRow">
                  <div className="catDonutWrap">
                    <DonutGauge
                      value={hasLatestInference ? Math.round(gradeConf * 100) : 0}
                      size={58}
                      strokeWidth={6}
                    />
                    <div className="catDonutCenter">
                      <strong>{hasLatestInference ? `${Math.round(gradeConf * 100)}%` : "—"}</strong>
                      <span>Akurasi</span>
                    </div>
                  </div>
                  <div className="catGradeInfo">
                    <span className="catGradeLabel">
                      <Activity size={10} />
                      <span>{effectiveInference && "cycleFrameCount" in effectiveInference ? `DOMINAN (${effectiveInference.cycleFrameCount} FRAME)` : "PREDICTED GRADE"}</span>
                    </span>
                    <div className={`catGradeValue grade-${normalizeGrade(grade).toLowerCase()}`}>
                      MBS {hasLatestInference ? normalizeGrade(grade) : "—"}
                    </div>
                    <span className="catGradeSub">
                      {hasLatestInference ? (TRANGKIL_GRADES.find(tg => tg.code === normalizeGrade(grade))?.decision || "—") : "Menunggu pemindaian AI..."}
                    </span>
                  </div>
                </div>

                {/* Divider */}
                <div className="catDivider" />

                {/* AI Classification Probability Distribution */}
                <div className="catMetricsTitle">
                  <TrendingUp size={11} />
                  <span>Distribusi Probabilitas Kelas Mutu</span>
                </div>
                <div className="catGradeProbList">
                  {gradeDistribution.map((item) => (
                    <div
                      key={item.code}
                      className={`catGradeProbRow ${hasLatestInference && normalizeGrade(grade) === item.code ? "activeMatch" : ""}`}
                    >
                      <div className="catProbHeader">
                        <div className="catProbLeft">
                          <span className="catProbDot" style={{ background: item.color }} />
                          <span className="catProbCode">{item.label}</span>
                          <span className="catProbName">({item.name})</span>
                        </div>
                        <strong className="catProbValue" style={{ color: item.color }}>
                          {hasLatestInference ? `${item.prob}%` : "—"}
                        </strong>
                      </div>
                      <div className="catProbBarTrack">
                        <div
                          className="catProbBarFill"
                          style={{
                            width: `${hasLatestInference ? item.prob : 0}%`,
                            background: item.grad
                          }}
                        />
                      </div>
                      <span className="catProbDesc">{item.kriteria}</span>
                    </div>
                  ))}
                </div>

                {/* Divider */}
                <div className="catDivider" />

                {/* Cycle Consistency Card (Always Present & Anchored to Bottom) */}
                <div className="cycleConsistencyCard">
                  <div className="cycleConsHeader">
                    <span className="cycleConsTitle">
                      <Activity size={10} />
                      <span>Konsistensi Siklus Meja Tebu</span>
                    </span>
                    <span className="cycleConsTotalBadge">
                      {cycleConsistency && cycleConsistency.total > 0
                        ? `${cycleConsistency.total} Frame Dianalisis`
                        : "Standby"}
                    </span>
                  </div>
                  <div className="cycleConsSummary">
                    <span>Dominan:</span>
                    <strong className="cycleConsDominant">
                      {cycleConsistency && cycleConsistency.total > 0
                        ? cycleConsistency.dominantGrade
                        : hasLatestInference ? `MBS ${normalizeGrade(grade)}` : "—"}
                    </strong>
                    <span>
                      {cycleConsistency && cycleConsistency.total > 0
                        ? `(${cycleConsistency.dominantPct}% frame siklus)`
                        : "(Menunggu deteksi)"}
                    </span>
                  </div>
                  <div className="cycleConsMiniBars">
                    {(cycleConsistency?.counts || TRANGKIL_GRADES.map(tg => ({ code: tg.label, color: tg.color, count: 0 }))).map((c) => (
                      <div key={c.code} className="consMiniItem">
                        <span>{c.code}</span>
                        <strong style={{ color: c.color }}>{c.count}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="dailyAggregateScrollArea">
                {/* Daily Factory KPI Summary */}
                <div className="catKpiRow dailyKpiRow">
                  <div className="catKpi">
                    <span className="catKpiLabel">Total Siklus</span>
                    <strong className="catKpiValue blue">
                      {dailyCyclesStats?.totalCycles || 0}
                      <span className="catKpiUnit">Siklus</span>
                    </strong>
                  </div>
                  <div className="catKpi">
                    <span className="catKpiLabel">Rata-rata Mutu</span>
                    <strong className={`catKpiValue ${normalizeGrade(dailyCyclesStats?.overallGrade) === "X" || normalizeGrade(dailyCyclesStats?.overallGrade) === "G" ? "danger" : normalizeGrade(dailyCyclesStats?.overallGrade) === "B" || normalizeGrade(dailyCyclesStats?.overallGrade) === "D" ? "amber" : "blue"}`}>
                      MBS {dailyCyclesStats ? normalizeGrade(dailyCyclesStats.overallGrade) : "—"}
                    </strong>
                  </div>
                  <div className="catKpi">
                    <span className="catKpiLabel">Lolos Bebas Rafaksi</span>
                    <strong className="catKpiValue green">
                      {dailyCyclesStats?.passPct || 0}
                      <span className="catKpiUnit">%</span>
                    </strong>
                  </div>
                </div>

                {/* Banner Mutu Kumulatif Pabrik */}
                <div className="dailyFactorySummaryCard">
                  <div className="dailySummaryLeft">
                    <span className="dailySummaryLabel">STATUS MUTU HARIAN PABRIK</span>
                    <div className={`dailyGradeBadge grade-${normalizeGrade(dailyCyclesStats?.overallGrade).toLowerCase()}`}>
                      MBS {dailyCyclesStats ? normalizeGrade(dailyCyclesStats.overallGrade) : "—"}
                    </div>
                  </div>
                  <div className="dailySummaryRight">
                    <div className="dailyMetaStat">
                      <span>Total Frame:</span>
                      <strong>{dailyCyclesStats?.totalFrames || 0} frame</strong>
                    </div>
                    <div className="dailyMetaStat">
                      <span>Avg Kotoran:</span>
                      <strong>{dailyCyclesStats?.impurityMeasured ? `${dailyCyclesStats.avgImpurity}%` : "Tidak diukur"}</strong>
                    </div>
                    <div className="dailyMetaStat">
                      <span>Siklus Selesai:</span>
                      <strong>{dailyCyclesStats?.completedCount || 0} / {dailyCyclesStats?.totalCycles || 0}</strong>
                    </div>
                  </div>
                </div>

                <div className="catDivider" />

                {/* Chart 1: Distribusi Mutu Kumulatif Pabrik (All Cycles) */}
                <div className="catMetricsTitle">
                  <TrendingUp size={11} />
                  <span>Distribusi Probabilitas Kelas Mutu</span>
                </div>
                <div className="catGradeProbList dailyProbList">
                  {dailyCyclesStats ? dailyCyclesStats.gradeCounts.map((item) => (
                    <div key={item.code} className="catGradeProbRow">
                      <div className="catProbHeader">
                        <div className="catProbLeft">
                          <span className="catProbDot" style={{ background: item.color }} />
                          <span className="catProbCode">{item.label}</span>
                          <span className="catProbName">({item.name})</span>
                        </div>
                        <div className="catProbValueGroup">
                          <span className="catProbCountBadge">{item.count} siklus</span>
                          <strong className="catProbValue" style={{ color: item.color }}>
                            {item.pct}%
                          </strong>
                        </div>
                      </div>
                      <div className="catProbBarTrack">
                        <div
                          className="catProbBarFill"
                          style={{
                            width: `${item.pct}%`,
                            background: item.grad
                          }}
                        />
                      </div>
                    </div>
                  )) : (
                    <div className="dailyEmptyNotice">Belum ada siklus pemindaian yang tersimpan.</div>
                  )}
                </div>

                <div className="catDivider" />

                {/* Chart 2: Riwayat Tren Mutu per Setiap Siklus (Paginated - Zero Scroll) */}
                <div className="dailyTimelineHeader">
                  <div className="catMetricsTitle">
                    <BarChart3 size={11} />
                    <span>Tren Mutu per Setiap Siklus</span>
                  </div>

                  {totalTimelineCycles > 0 && (
                    <div className="dailyTimelinePagination">
                      <span className="dailyTimelinePageInfo">
                        {currentTimelinePage}/{totalTimelinePages}
                      </span>
                      <div className="dailyTimelinePageBtns">
                        <button
                          type="button"
                          className="dailyPgBtn"
                          onClick={() => setTimelinePage((p) => Math.max(1, p - 1))}
                          disabled={currentTimelinePage <= 1}
                          title="Halaman siklus sebelumnya"
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          className="dailyPgBtn"
                          onClick={() => setTimelinePage((p) => Math.min(totalTimelinePages, p + 1))}
                          disabled={currentTimelinePage >= totalTimelinePages}
                          title="Halaman siklus berikutnya"
                        >
                          ›
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="dailyCycleTimelineList">
                  {pagedTimeline.length > 0 ? (
                    pagedTimeline.map((item) => (
                      <div
                        key={item.id}
                        className={`dailyCycleItem ${selectedCycleId === item.id ? "selected" : ""}`}
                        onClick={() => {
                          setSelectedCycleId(item.id);
                          setAnalysisTab("realtime");
                          setAnalysisDetailTab("grades");
                        }}
                        title={`Klik untuk menelaah foto tangkapan ${item.code}`}
                      >
                        <div className="dailyCycleItemLeft">
                          <span className="dailyCycleIndex">#{item.number}</span>
                          <strong className="dailyCycleName">{item.code}</strong>
                          <span className="dailyCycleTime">
                            {new Date(item.startedAt).toLocaleTimeString("id-ID", { hour12: false, hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="dailyCycleItemRight">
                          <span className="dailyCycleImpurity">{item.impurityMeasured ? `${item.impurity}% imp` : "Tidak diukur"}</span>
                          <span className={`dailyCycleGradeBadge grade-${item.grade.toLowerCase()}`}>
                            MBS {item.grade}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="dailyEmptyNotice">Mulai siklus baru untuk merekam data mutu.</div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ─── Capture Detail Modal ─── */}
      {selectedCapture && (() => {
        const capGrade = normalizeGrade(selectedCapture.grade);
        const curConfig = TRANGKIL_GRADES.find(g => g.code === capGrade) || TRANGKIL_GRADES[1];
        const confPercent = Math.round((selectedCapture.confidence ?? 0) * 100);

        const captureDate = new Date(selectedCapture.timestamp);
        const dateStr = captureDate.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        const timeStr = captureDate.toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

        return (
          <div
            className="modal-backdrop"
            onClick={() => setSelectedCapture(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="capture-detail-modal capture-frame-popup" data-panel={captureDetailPanel} onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="capture-detail-modal__header">
                <div className="modal-title-with-badge">
                  <div className="modal-title-row">
                    <span className="modal-badge-icon">
                      <Camera size={15} />
                    </span>
                    <h2 id="modal-title">Detail Analisis Frame Capture</h2>
                    <span className="modal-batch-pill">Frame {frameNumber(selectedCapture.id)}</span>
                  </div>
                  <p>Hasil pemindaian AI mutu tebu meja inspeksi • Standar Operasional PT Pabrik Gula Trangkil</p>
                </div>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setSelectedCapture(null)}
                  aria-label="Tutup detail capture"
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
                          alt={`Snapshot Frame ${frameNumber(selectedCapture.id)}`}
                          className="snapshot-preview-img"
                        />
                        <div className="snapshot-overlay-top">
                          <span className="snapshot-cam-tag">
                            <span className="snapshot-live-dot" />
                            MBS {activeLine} • Meja {activeLine}
                          </span>
                          <span className="snapshot-conf-tag">AI Conf: {confPercent}%</span>
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
                      <strong className="meta-val">Kamera {selectedCapture.cameraId || activeLine}</strong>
                    </div>
                    <div className="meta-strip-item">
                      <span className="meta-label">JALUR MEJA</span>
                      <strong className="meta-val">MBS {activeLine}</strong>
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
                        <span>Toleransi:</span>
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
                          <Activity size={10} />
                          <span>PREDICTED GRADE (AI)</span>
                        </span>
                        <strong className="hero-grade-title">{curConfig.label} ({curConfig.name})</strong>
                        <span className="hero-grade-sub">{curConfig.kriteria}</span>
                      </div>
                    </div>
                  </div>

                  {/* 7-Grade Compact Distribution Section (NO SCROLL, perfectly fits in 1 screen) */}
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
                        const prob = isMatch ? confPercent : Math.max(1, Math.round((100 - confPercent) / 6));
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
                <button
                  type="button"
                  className="modal-footer-btn danger"
                  onClick={async () => {
                    if (pendingInferenceIds.has(selectedCapture.id)) {
                      alert("Permohonan penghapusan frame ini sedang menunggu persetujuan Direksi.");
                      return;
                    }
                    if (isOperator) {
                      const impPercent = ((selectedCapture.classes?.daun ?? 0) + (selectedCapture.classes?.pucuk ?? 0) + (selectedCapture.classes?.sampah ?? 0));
                      setRequestDeletionTarget({
                        id: selectedCapture.id,
                        title: `Frame #${selectedCapture.id} (${selectedCapture.impurityMeasured ? `${impPercent.toFixed(1)}% Kotoran` : "Kotoran tidak diukur"} • Grade ${selectedCapture.grade})`,
                        subtitle: `Waktu Rekam: ${selectedCapture.timestamp || "Baru saja"}`,
                        snapshotPath: selectedCapture.snapshot ? (selectedCapture.snapshot.startsWith("http") ? selectedCapture.snapshot : `${backendUrl}${selectedCapture.snapshot}`) : undefined
                      });
                    } else {
                      if (confirm(`Hapus frame capture Frame ${frameNumber(selectedCapture.id)} secara langsung sebagai Direksi?`)) {
                        await deleteInference(selectedCapture.id);
                        setSelectedCapture(null);
                      }
                    }
                  }}
                  title={pendingInferenceIds.has(selectedCapture.id) ? "Menunggu persetujuan Direksi" : isOperator ? "Ajukan permohonan hapus frame ke Direksi" : "Hapus rekaman capture ini"}
                  style={pendingInferenceIds.has(selectedCapture.id) ? { opacity: 0.5, cursor: "not-allowed" } : {}}
                >
                  <Trash2 size={13} />
                  <span>{pendingInferenceIds.has(selectedCapture.id) ? "Menunggu Persetujuan Direksi" : isOperator ? "Ajukan Hapus ke Direksi" : "Hapus Frame"}</span>
                </button>

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

      {/* ─── Retroactive Tapping Auto-Sync Modal ─── */}
      {isSyncModalOpen && (
        <TappingSyncModal
          isOpen={isSyncModalOpen}
          onClose={() => setIsSyncModalOpen(false)}
        />
      )}

      {/* ─── Modal Pengajuan Penghapusan oleh Operator (Maker) ─── */}
      {requestDeletionTarget && (
        <RequestDeletionModal
          isOpen={Boolean(requestDeletionTarget)}
          onClose={() => setRequestDeletionTarget(null)}
          targetType="inference"
          targetId={requestDeletionTarget.id}
          targetTitle={requestDeletionTarget.title}
          targetSubtitle={requestDeletionTarget.subtitle}
          snapshotPath={requestDeletionTarget.snapshotPath}
          onSubmitted={() => {
            if (selectedCapture?.id === requestDeletionTarget.id) {
              setSelectedCapture(null);
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

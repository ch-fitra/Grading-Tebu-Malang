import { create } from "zustand";
import type { AiModel, CameraRow, DeletionRequest, InferenceResult, SystemStatus, TruckInspectionSession } from "./types";
import { api } from "./utils/api";

type Session = { token: string; user: { id: number; username: string; role: string; permissions: string[] } };
export type AppState = {
  session: Session | null;
  latest: InferenceResult | null;
  history: InferenceResult[];
  cameras: CameraRow[];
  models: AiModel[];
  status: SystemStatus | null;
  truckSessions: TruckInspectionSession[];
  activeTruckSession: TruckInspectionSession | null;
  deletionRequests: DeletionRequest[];
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  validateSession: () => Promise<void>;
  refresh: () => Promise<void>;
  createCamera: (camera: Omit<CameraRow, "id" | "status">) => Promise<void>;
  updateCamera: (id: number, patch: Partial<Omit<CameraRow, "id">>) => Promise<void>;
  deleteCamera: (id: number) => Promise<void>;
  activateModel: (id: number) => Promise<void>;
  startTruckInspection: (data: Omit<TruckInspectionSession, "id" | "status" | "startedAt" | "captureIds" | "finalDecision" | "averageImpurity" | "averageConfidence" | "totalCaptures">) => Promise<void>;
  completeTruckInspection: (id: string, notes?: string) => Promise<void>;
  deleteTruckInspection: (id: string, adminAuth?: string) => Promise<void>;
  deleteInference: (id: number, adminAuth?: string) => Promise<void>;
  clearAllInferences: (adminAuth?: string) => Promise<void>;
  submitDeletionRequest: (data: {
    targetType: "inference" | "truck_inspection" | "all_inferences";
    targetId: number | string;
    targetTitle: string;
    targetSubtitle?: string;
    snapshotPath?: string;
    reason: string;
    notes?: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  reviewDeletionRequest: (
    id: string,
    decision: "approved" | "rejected",
    reviewNotes?: string
  ) => Promise<{ ok: boolean; message?: string }>;
  verifyAdmin2FA: (password: string) => Promise<{ ok: boolean; admin: { id: number; username: string; role: string }; message: string }>;
  syncTappingData: (matches: Array<{ id: string; truckCode?: string; plateNumber?: string; driverName?: string; supplier?: string; notes?: string }>) => Promise<number>;
};

function readSession(): Session | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("tebu-session") ?? "null");
    if (!value || typeof value !== "object") return null;
    const session = value as Session;
    return typeof session.token === "string" && Array.isArray(session.user?.permissions) ? session : null;
  } catch { return null; }
}

// Old browser-only inspections remain visible. New inspections always use PostgreSQL.
function legacySessions(): TruckInspectionSession[] {
  try {
    if (localStorage.getItem("tebu-legacy-cleared-v30sept") !== "true") {
      localStorage.removeItem("tebu-truck-sessions");
      localStorage.setItem("tebu-legacy-cleared-v30sept", "true");
      return [];
    }
    const value: unknown = JSON.parse(localStorage.getItem("tebu-truck-sessions") ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is TruckInspectionSession => typeof item?.id === "string" && item.id.startsWith("session_")) : [];
  } catch { return []; }
}
function saveLegacy(sessions: TruckInspectionSession[]) { localStorage.setItem("tebu-truck-sessions", JSON.stringify(sessions)); }

export const useAppStore = create<AppState>((set, get) => ({
  session: readSession(), latest: null, history: [], cameras: [], models: [], status: null, truckSessions: [], activeTruckSession: null, deletionRequests: [],
  login: async (username, password) => {
    const session = await api<Session>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    localStorage.setItem("tebu-session", JSON.stringify(session));
    set({ session });
    await get().refresh();
  },
  logout: () => {
    localStorage.removeItem("tebu-session");
    set({ session: null, latest: null, history: [], cameras: [], models: [], status: null, truckSessions: [], activeTruckSession: null, deletionRequests: [] });
  },
  validateSession: async () => {
    const current = get().session;
    if (!current) return;
    try {
      const user = await api<Session["user"]>("/api/auth/me");
      const session = { ...current, user };
      localStorage.setItem("tebu-session", JSON.stringify(session));
      set({ session });
    } catch { get().logout(); }
  },
  refresh: async () => {
    const permissions = get().session?.user.permissions ?? [];
    const can = (permission: string) => permissions.includes(permission);
    const [latest, history, cameras, models, status, backendTrucks, deletionRequests] = await Promise.all([
      can("dashboard.read") ? api<InferenceResult | null>("/api/inference/latest").catch(() => null) : Promise.resolve(null),
      can("history.read") ? api<InferenceResult[]>("/api/inference/history").catch(() => []) : Promise.resolve([]),
      can("camera.read") ? api<CameraRow[]>("/api/cameras").catch(() => []) : Promise.resolve([]),
      can("model.read") ? api<AiModel[]>("/api/models").catch(() => []) : Promise.resolve([]),
      can("dashboard.read") ? api<SystemStatus>("/api/system/status").catch(() => null) : Promise.resolve(null),
      can("history.read") ? api<TruckInspectionSession[]>("/api/truck-inspections").catch(() => []) : Promise.resolve([]),
      can("dashboard.read") ? api<DeletionRequest[]>("/api/deletion-requests").catch(() => []) : Promise.resolve([])
    ]);
    const trucks = [...(backendTrucks ?? []), ...legacySessions()];
    set({
      latest,
      history: history ?? [],
      cameras: cameras ?? [],
      models: models ?? [],
      status,
      truckSessions: trucks,
      activeTruckSession: trucks.find(item => item.status === "active") ?? null,
      deletionRequests: deletionRequests ?? []
    });
  },
  createCamera: async camera => { await api<CameraRow>("/api/cameras", { method: "POST", body: JSON.stringify(camera) }); await get().refresh(); },
  updateCamera: async (id, patch) => { await api<CameraRow>(`/api/cameras/${id}`, { method: "PUT", body: JSON.stringify(patch) }); await get().refresh(); },
  deleteCamera: async id => { await api<{ ok: boolean }>(`/api/cameras/${id}`, { method: "DELETE" }); await get().refresh(); },
  activateModel: async id => { await api<AiModel>("/api/models/activate", { method: "POST", body: JSON.stringify({ id }) }); await get().refresh(); },
  startTruckInspection: async data => { await api<TruckInspectionSession>("/api/truck-inspections", { method: "POST", body: JSON.stringify(data) }); await get().refresh(); },
  completeTruckInspection: async (id, notes) => {
    const active = get().truckSessions.find(item => item.id === id && item.status === "active");
    if (!active) return;
    if (active.id.startsWith("session_")) {
      saveLegacy(legacySessions().map(item => item.id === active.id ? { ...item, status: "completed", completedAt: new Date().toISOString(), notes: notes ?? item.notes } : item));
    } else {
      await api<TruckInspectionSession>(`/api/truck-inspections/${active.id}/complete`, { method: "PATCH", body: JSON.stringify({ notes }) });
    }
    await get().refresh();
  },
  deleteTruckInspection: async (id, adminAuth) => {
    const headers: Record<string, string> = {};
    if (adminAuth) headers["x-admin-approval"] = adminAuth;
    if (id.startsWith("session_")) saveLegacy(legacySessions().filter(item => item.id !== id));
    else await api<{ ok: boolean }>(`/api/truck-inspections/${id}`, { method: "DELETE", headers });
    await get().refresh();
  },
  deleteInference: async (id, adminAuth) => {
    const headers: Record<string, string> = {};
    if (adminAuth) headers["x-admin-approval"] = adminAuth;
    await api<{ ok: boolean }>(`/api/inference/${id}`, { method: "DELETE", headers });
    await get().refresh();
  },
  clearAllInferences: async (adminAuth) => {
    const headers: Record<string, string> = {};
    if (adminAuth) headers["x-admin-approval"] = adminAuth;
    await api<{ ok: boolean }>("/api/inference", { method: "DELETE", headers });
    await get().refresh();
  },
  submitDeletionRequest: async (data) => {
    await api<DeletionRequest>("/api/deletion-requests", {
      method: "POST",
      body: JSON.stringify(data)
    });
    await get().refresh();
    return { ok: true, message: "Pengajuan penghapusan berhasil dikirim ke Direksi/Admin" };
  },
  reviewDeletionRequest: async (id, decision, reviewNotes) => {
    await api<{ ok: boolean }>(`/api/deletion-requests/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, reviewNotes })
    });
    await get().refresh();
    return {
      ok: true,
      message: decision === "approved" ? "Pengajuan disetujui dan data telah dihapus" : "Pengajuan telah ditolak"
    };
  },
  verifyAdmin2FA: async (password: string) => {
    return await api<{ ok: boolean; admin: { id: number; username: string; role: string }; message: string }>(
      "/api/auth/verify-admin",
      { method: "POST", body: JSON.stringify({ password }) }
    );
  },
  syncTappingData: async (matches) => {
    const backendMatches = matches.filter(m => !m.id.startsWith("session_"));
    const legacyMatches = matches.filter(m => m.id.startsWith("session_"));

    if (legacyMatches.length > 0) {
      const updated = legacySessions().map(s => {
        const match = legacyMatches.find(m => m.id === s.id);
        if (!match) return s;
        return {
          ...s,
          truckCode: match.truckCode ?? s.truckCode,
          plateNumber: match.plateNumber ?? s.plateNumber,
          driverName: match.driverName ?? s.driverName,
          supplier: match.supplier ?? s.supplier,
          notes: match.notes ?? s.notes,
        };
      });
      saveLegacy(updated);
    }

    let count = legacyMatches.length;
    if (backendMatches.length > 0) {
      const res = await api<{ count: number }>("/api/truck-inspections/sync-tapping", {
        method: "POST",
        body: JSON.stringify({ matches: backendMatches })
      });
      count += res.count;
    }
    await get().refresh();
    return count;
  }
}));

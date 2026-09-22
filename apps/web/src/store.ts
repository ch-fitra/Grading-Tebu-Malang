import { create } from "zustand";
import type { AiModel, CameraRow, InferenceResult, SystemStatus, TruckInspectionSession } from "./types";
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
  deleteTruckInspection: (id: string) => Promise<void>;
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
    const value: unknown = JSON.parse(localStorage.getItem("tebu-truck-sessions") ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is TruckInspectionSession => typeof item?.id === "string" && item.id.startsWith("session_")) : [];
  } catch { return []; }
}
function saveLegacy(sessions: TruckInspectionSession[]) { localStorage.setItem("tebu-truck-sessions", JSON.stringify(sessions)); }

export const useAppStore = create<AppState>((set, get) => ({
  session: readSession(), latest: null, history: [], cameras: [], models: [], status: null, truckSessions: [], activeTruckSession: null,
  login: async (username, password) => {
    const session = await api<Session>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    localStorage.setItem("tebu-session", JSON.stringify(session));
    set({ session });
    await get().refresh();
  },
  logout: () => {
    localStorage.removeItem("tebu-session");
    set({ session: null, latest: null, history: [], cameras: [], models: [], status: null, truckSessions: [], activeTruckSession: null });
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
    const [latest, history, cameras, models, status, backendTrucks] = await Promise.all([
      can("dashboard.read") ? api<InferenceResult | null>("/api/inference/latest") : Promise.resolve(null),
      can("history.read") ? api<InferenceResult[]>("/api/inference/history") : Promise.resolve([]),
      can("camera.read") ? api<CameraRow[]>("/api/cameras") : Promise.resolve([]),
      can("model.read") ? api<AiModel[]>("/api/models") : Promise.resolve([]),
      can("dashboard.read") ? api<SystemStatus>("/api/system/status") : Promise.resolve(null),
      can("history.read") ? api<TruckInspectionSession[]>("/api/truck-inspections") : Promise.resolve([])
    ]);
    const trucks = [...backendTrucks, ...legacySessions()];
    set({ latest, history, cameras, models, status, truckSessions: trucks, activeTruckSession: trucks.find(item => item.status === "active") ?? null });
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
  deleteTruckInspection: async id => {
    if (id.startsWith("session_")) saveLegacy(legacySessions().filter(item => item.id !== id));
    else await api<{ ok: boolean }>(`/api/truck-inspections/${id}`, { method: "DELETE" });
    await get().refresh();
  }
}));

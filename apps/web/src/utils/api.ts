const configuredBackend = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_BACKEND_URL;
const useDevProxy = import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname);
export const backendUrl = window.sugarcaneDesktop?.apiBaseUrl ?? (useDevProxy || configuredBackend === "same-origin" ? "" : configuredBackend ?? "http://127.0.0.1:4110");
export const aiServiceUrl = window.sugarcaneDesktop?.aiServiceUrl ?? import.meta.env.VITE_AI_SERVICE_URL ?? "http://127.0.0.1:8010";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

// Automatic cycles live in the AI service so they continue without an open dashboard.
export const aiApi = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  let token = "";
  try { token = JSON.parse(localStorage.getItem("tebu-session") ?? "null")?.token ?? ""; } catch { /* invalid cached session */ }
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${aiServiceUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(typeof payload?.detail === "string" ? payload.detail : `AI service gagal (${response.status})`, response.status);
  }
  return response.json();
};

export function getCameraStreamUrl(cameraId: number, overlay: boolean = true, quality: number = 80, key?: number | string): string {
  return `${backendUrl}/api/cameras/${cameraId}/stream?overlay=${overlay ? "true" : "false"}&quality=${quality}${key ? `&t=${key}` : ""}`;
}

export const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  let token = "";
  try { token = JSON.parse(window.localStorage.getItem("tebu-session") ?? "null")?.token ?? ""; } catch { /* invalid cached session */ }
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${backendUrl}${path}`, {
    credentials: "include",
    ...init,
    headers
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = raw;
    try { message = JSON.parse(raw).message ?? raw; } catch { /* plain text response */ }
    throw new ApiError(message || `Permintaan gagal (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
};

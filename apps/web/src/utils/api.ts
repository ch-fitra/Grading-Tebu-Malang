const configuredBackend = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_BACKEND_URL;
const useDevProxy = import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname);
export const backendUrl = window.sugarcaneDesktop?.apiBaseUrl ?? (useDevProxy || configuredBackend === "same-origin" ? "" : configuredBackend ?? "http://127.0.0.1:4110");

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

// Keep AI requests on the authenticated backend origin, including public HTTPS
// and installed desktop clients. The Python service remains internal.
export const aiApi = <T,>(path: string, init?: RequestInit): Promise<T> => api<T>(`/api/ai${path}`, init);

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
    headers,
    signal: init?.signal ?? AbortSignal.timeout(init?.method && init.method !== "GET" ? 65000 : 15000)
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = raw;
    try {
      const payload = JSON.parse(raw);
      message = payload.message ?? (typeof payload.detail === "string" ? payload.detail : undefined) ??
        (Object.values(payload.fieldErrors ?? {}).flat().join("; ") || raw);
    } catch { /* plain text response */ }
    throw new ApiError(message || `Permintaan gagal (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
};

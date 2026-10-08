export const backendUrl = window.sugarcaneDesktop?.apiBaseUrl ?? import.meta.env.VITE_API_URL ?? import.meta.env.VITE_BACKEND_URL ?? "http://127.0.0.1:4110";
export const aiServiceUrl = window.sugarcaneDesktop?.aiServiceUrl ?? import.meta.env.VITE_AI_SERVICE_URL ?? "http://127.0.0.1:8010";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function getCameraStreamUrl(cameraId: number, overlay: boolean = true, quality: number = 80, key?: number | string): string {
  return `${aiServiceUrl}/stream/${cameraId}?overlay=${overlay ? "true" : "false"}&quality=${quality}${key ? `&t=${key}` : ""}`;
}

export const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  let token = "";
  try { token = JSON.parse(window.localStorage.getItem("tebu-session") ?? "null")?.token ?? ""; } catch { /* invalid cached session */ }
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${backendUrl}${path}`, {
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

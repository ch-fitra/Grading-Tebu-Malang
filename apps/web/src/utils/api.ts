const backendUrl = window.sugarcaneDesktop?.apiBaseUrl ?? import.meta.env.VITE_API_URL ?? import.meta.env.VITE_BACKEND_URL ?? "http://127.0.0.1:4110";

export const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  let token = "";
  try { token = JSON.parse(window.localStorage.getItem("tebu-session") ?? "null")?.token ?? ""; } catch { /* invalid cached session */ }
  const headers = { ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers };
  const response = await fetch(`${backendUrl}${path}`, {
    headers,
    ...init
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

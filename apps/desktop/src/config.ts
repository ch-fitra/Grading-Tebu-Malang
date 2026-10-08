export function desktopClientConfig() {
  const configuredUrl = process.env.SUGARCANE_API_URL ?? process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:4110";
  const apiUrl = new URL(configuredUrl);
  if (apiUrl.protocol !== "http:" && apiUrl.protocol !== "https:") {
    throw new Error("SUGARCANE_API_URL harus menggunakan http:// atau https://");
  }
  if (apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
    throw new Error("SUGARCANE_API_URL harus berupa alamat dasar API tanpa kredensial, query, atau fragment");
  }

  const apiBaseUrl = apiUrl.href.replace(/\/+$/, "");
  const websocketUrl = new URL(`${apiBaseUrl}/ws`);
  websocketUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
  const aiServiceUrl = process.env.SUGARCANE_AI_SERVICE_URL ?? "http://127.0.0.1:8010";
  return Object.freeze({ apiBaseUrl, websocketUrl: websocketUrl.href, aiServiceUrl });
}

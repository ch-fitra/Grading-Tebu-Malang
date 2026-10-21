import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../../web/", import.meta.url));

async function isSharedWebServer(url) {
  try {
    const response = await fetch(`${url}/__sugarcane_dev`, {
      signal: AbortSignal.timeout(750),
      redirect: "error"
    });
    if (!response.ok) return false;
    const identity = await response.json();
    return identity.app === "@sugarcane/web" &&
      typeof identity.root === "string" && path.resolve(identity.root) === path.resolve(webRoot);
  } catch {
    return false;
  }
}

export async function ensureSharedWebServer({ port = 5175, reuseOnly = false } = {}) {
  const url = `http://127.0.0.1:${port}`;
  const reused = { url, owned: false, close: async () => {} };
  if (await isSharedWebServer(url)) return reused;

  if (reuseOnly) {
    for (let attempt = 0; attempt < 80; attempt++) {
      await delay(250);
      if (await isSharedWebServer(url)) return reused;
    }
    throw new Error(`UI bersama belum siap di ${url}. Periksa proses web.`);
  }

  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    clearScreen: false,
    server: { host: "127.0.0.1", port, strictPort: true }
  });
  try {
    await server.listen();
    return {
      url,
      owned: true,
      close: async () => {
        // Let in-flight import transforms settle before closing the optimizer.
        await server.waitForRequestsIdle();
        await server.close();
      }
    };
  } catch (error) {
    await server.close();
    // dev:all can start Vite at the same time as this launcher. Wait for its
    // identity endpoint before deciding that the port belongs to another app.
    if (!/already in use|EADDRINUSE/.test(String(error))) throw error;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await isSharedWebServer(url)) return reused;
      await delay(250);
    }
    throw new Error(`Port ${port} dipakai layanan lain. Hentikan layanan tersebut lalu jalankan ulang desktop.`, { cause: error });
  }
}

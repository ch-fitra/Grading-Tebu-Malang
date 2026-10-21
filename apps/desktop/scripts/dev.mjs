import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ensureSharedWebServer } from "./dev-server.mjs";

const require = createRequire(import.meta.url);
let web;
let electron;
let stopping;

function stop(code) {
  // Only close a Vite server started by this process. An existing dev:web
  // session belongs to its own terminal and must keep running.
  return stopping ??= (async () => {
    if (electron && electron.exitCode === null && electron.signalCode === null) electron.kill();
    await web?.close();
    process.exitCode = code;
  })();
}

process.once("SIGINT", () => { void stop(130); });
process.once("SIGTERM", () => { void stop(143); });

try {
  web = await ensureSharedWebServer({ reuseOnly: process.argv.includes("--reuse-web") });
  if (stopping) {
    await web.close();
  } else {
    console.log(`[desktop] ${web.owned ? "Menjalankan" : "Memakai"} UI bersama di ${web.url}. Perubahan React/CSS diperbarui otomatis.`);
    const env = { ...process.env, SUGARCANE_WEB_DEV_URL: web.url };
    delete env.ELECTRON_RUN_AS_NODE;
    electron = spawn(require("electron"), ["dist/main.js"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env,
      stdio: "inherit",
      // Electron is the interactive application, not a background helper.
      // SW_HIDE on Windows can keep its first BrowserWindow hidden even
      // after ready-to-show calls window.show().
      windowsHide: false
    });
    electron.once("error", error => {
      console.error("[desktop] Gagal menjalankan Electron:", error.message);
      void stop(1);
    });
    electron.once("exit", (code, signal) => { void stop(code ?? (signal ? 1 : 0)); });
  }
} catch (error) {
  console.error("[desktop]", error instanceof Error ? error.message : error);
  await stop(1);
}

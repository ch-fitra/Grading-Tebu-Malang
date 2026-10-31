import { app, BrowserWindow, dialog, Menu } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { desktopClientConfig } from "./config";
import { startRendererServer } from "./renderer-server";

let rendererServer: Awaited<ReturnType<typeof startRendererServer>> | undefined;
let mainWindow: BrowserWindow | null = null;

function rendererPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "renderer", "index.html")
    : path.resolve(__dirname, "../../web/dist/index.html");
}

async function createWindow() {
  // Development uses the same live React app as the browser. Packaged apps
  // always use the bundled web build, independently of development variables.
  const devUrl = app.isPackaged ? undefined : process.env.SUGARCANE_WEB_DEV_URL;
  if (devUrl && devUrl !== "http://127.0.0.1:5176") {
    throw new Error("Alamat UI pengembangan desktop harus http://127.0.0.1:5176");
  }
  const indexPath = rendererPath();
  const clientConfig = desktopClientConfig();
  if (!devUrl && !existsSync(indexPath)) {
    throw new Error(`UI desktop tidak ditemukan: ${indexPath}. Jalankan build web terlebih dahulu.`);
  }

  if (!devUrl && !rendererServer) rendererServer = await startRendererServer(path.dirname(indexPath), clientConfig.apiBaseUrl);
  const rendererUrl = devUrl ?? rendererServer!.url;
  const apiBaseUrl = devUrl ? clientConfig.apiBaseUrl : rendererUrl;
  const websocketUrl = devUrl ? clientConfig.websocketUrl : `${rendererUrl.replace(/^http/, "ws")}/ws`;

  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    title: "Tebu AI - PG Kebon Agung",
    backgroundColor: "#f5f8f5",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      additionalArguments: [
        `--sugarcane-api-url=${apiBaseUrl}`,
        `--sugarcane-websocket-url=${websocketUrl}`,
        `--sugarcane-ai-service-url=${clientConfig.aiServiceUrl}`
      ]
    }
  });
  mainWindow = window;
  window.once("closed", () => { if (mainWindow === window) mainWindow = null; });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  await window.loadURL(rendererUrl);
}

app.setName("TebuAI Malang");
app.setPath("userData", path.join(app.getPath("appData"), "TebuAI-Malang"));

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await createWindow();
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox("Tebu AI gagal dibuka", message);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error: unknown) => {
      dialog.showErrorBox("Tebu AI gagal dibuka", error instanceof Error ? error.message : String(error));
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => { void rendererServer?.close(); });

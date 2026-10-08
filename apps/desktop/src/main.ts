import { app, BrowserWindow, dialog, Menu } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { desktopClientConfig } from "./config";

function rendererPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "renderer", "index.html")
    : path.resolve(__dirname, "../../web/dist/index.html");
}

async function createWindow() {
  const indexPath = rendererPath();
  const clientConfig = desktopClientConfig();
  if (!existsSync(indexPath)) {
    throw new Error(`UI desktop tidak ditemukan: ${indexPath}. Jalankan build web terlebih dahulu.`);
  }

  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    title: "Tebu AI",
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
        `--sugarcane-api-url=${clientConfig.apiBaseUrl}`,
        `--sugarcane-websocket-url=${clientConfig.websocketUrl}`,
        `--sugarcane-ai-service-url=${clientConfig.aiServiceUrl}`
      ]
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  await window.loadFile(indexPath);
}

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

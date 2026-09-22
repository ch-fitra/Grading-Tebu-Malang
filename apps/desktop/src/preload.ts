import { contextBridge } from "electron";

function argumentValue(prefix: string) {
  const argument = process.argv.find(value => value.startsWith(prefix));
  if (!argument) throw new Error(`Konfigurasi desktop tidak lengkap: ${prefix}`);
  return argument.slice(prefix.length);
}

contextBridge.exposeInMainWorld("sugarcaneDesktop", Object.freeze({
  apiBaseUrl: argumentValue("--sugarcane-api-url="),
  websocketUrl: argumentValue("--sugarcane-websocket-url=")
}));

import { contextBridge } from "electron";

function argumentValue(prefix: string) {
  const argument = process.argv.find(value => value.startsWith(prefix));
  if (!argument) return undefined;
  return argument.slice(prefix.length);
}

contextBridge.exposeInMainWorld("sugarcaneDesktop", Object.freeze({
  apiBaseUrl: argumentValue("--sugarcane-api-url=") ?? "http://127.0.0.1:4111",
  websocketUrl: argumentValue("--sugarcane-websocket-url=") ?? "ws://127.0.0.1:4111/ws",
  aiServiceUrl: argumentValue("--sugarcane-ai-service-url=") ?? "http://127.0.0.1:8011"
}));

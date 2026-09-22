/// <reference types="vite/client" />

interface Window {
  sugarcaneDesktop?: Readonly<{ apiBaseUrl: string; websocketUrl: string }>;
}

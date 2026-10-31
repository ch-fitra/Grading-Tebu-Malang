import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "sugarcane-shared-ui",
      apply: "serve",
      configureServer(server) {
        // The desktop launcher must only reuse this project's Vite server.
        server.middlewares.use("/__sugarcane_dev", (_request, response) => {
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify({ app: "@sugarcane/web", root: server.config.root }));
        });
      }
    }
  ],
  server: {
    host: "127.0.0.1",
    port: 5176,
    strictPort: true,
    proxy: {
      "/api": process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:4111",
      "/health": process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:4111",
      "/storage": process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:4111",
      "/ws": { target: process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:4111", ws: true }
    }
  }
});

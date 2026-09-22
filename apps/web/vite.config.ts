import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "/api": process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:4110",
      "/health": process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:4110"
    }
  }
});

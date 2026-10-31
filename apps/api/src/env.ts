import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), override: false });
for (const [key, expected] of [["DATABASE_URL", "sugarcane_malang"], ["AI_DATABASE_URL", "sugarcane_ai_malang"]]) {
  const value = process.env[key];
  if (!value || new URL(value).pathname !== `/${expected}`) {
    throw new Error(`${key} harus memakai database khusus Malang: ${expected}`);
  }
}
if (process.env.INSTALLATION_ID !== "malang") throw new Error("INSTALLATION_ID harus malang");

const apiPort = Number(process.env.API_PORT ?? 4111);
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) throw new Error("API_PORT tidak valid");
const aiUrl = new URL(process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8011");
if (!["http:", "https:"].includes(aiUrl.protocol)) throw new Error("AI_SERVICE_URL harus HTTP/HTTPS");

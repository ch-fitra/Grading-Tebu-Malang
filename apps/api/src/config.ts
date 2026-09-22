export const config = {
  host: process.env.API_HOST ?? process.env.BACKEND_HOST ?? "127.0.0.1",
  port: Number(process.env.API_PORT ?? process.env.BACKEND_PORT ?? 4110),
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8010",
  inferenceIntervalMs: Number(process.env.INFERENCE_INTERVAL_MS ?? 2000)
};

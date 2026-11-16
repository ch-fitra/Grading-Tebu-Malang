import { readFileSync } from "node:fs";
import type { Grade } from "./rule-engine.js";

export const UNKNOWN_GRADE: Grade = "Belum Dikenali";
export function activeGradingClasses(): string[] {
  const config = JSON.parse(readFileSync(new URL("../../ai-service/models/active/config.json", import.meta.url), "utf8"));
  if (!Array.isArray(config.classes) || !config.classes.length || config.classes.some((name: unknown) => typeof name !== "string" || !name.trim()) || new Set(config.classes).size !== config.classes.length) {
    throw new Error("Daftar kelas grading tidak valid");
  }
  return config.classes;
}
export function gradingThreshold(): number {
  const config = JSON.parse(readFileSync(new URL("../../ai-service/models/active/config.json", import.meta.url), "utf8"));
  if (typeof config.threshold !== "number" || !Number.isFinite(config.threshold) || config.threshold < 0 || config.threshold > 1) {
    throw new Error("Threshold grading tidak valid");
  }
  return config.threshold;
}
export function acceptedGrade(grade: Grade, confidence: number, threshold = gradingThreshold()): Grade {
  return Number.isFinite(confidence) && confidence >= threshold ? grade : UNKNOWN_GRADE;
}

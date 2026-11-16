import type { Grade, InferenceResult, TruckInspectionSession } from "../types";
import { normalizeGrade } from "./grade-guide";

// The main result belongs to one image, never to a frequency or cycle average.
export function newestFrame<T extends Pick<InferenceResult, "timestamp" | "id">>(frames: T[]): T | null {
  return frames.reduce<T | null>((latest, frame) => !latest ||
    Date.parse(frame.timestamp) > Date.parse(latest.timestamp) ||
    (Date.parse(frame.timestamp) === Date.parse(latest.timestamp) && frame.id > latest.id)
    ? frame : latest, null);
}

// Count selected labels, independently of the model's probability vector.
export function frameGradeDistribution(frames: Pick<InferenceResult, "grade">[], grades: Grade[]) {
  const counts = new Map<Grade, number>();
  for (const frame of frames) {
    const grade = normalizeGrade(frame.grade);
    counts.set(grade, (counts.get(grade) ?? 0) + 1);
  }
  return grades.map(code => {
    const count = counts.get(code) ?? 0;
    return { code, count, percent: frames.length ? count / frames.length * 100 : 0 };
  });
}

// Missing historical scores are unknown; never invent probabilities for other classes.
export function storedClassProbability(frame: Pick<InferenceResult, "classScores">, grade: Grade): number | undefined {
  const value = frame.classScores?.[grade];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value : undefined;
}
export function dominantGrade(frames: Pick<InferenceResult, "grade">[]): Grade | undefined {
  const counts = new Map<Grade, number>();
  for (const frame of frames) counts.set(frame.grade, (counts.get(frame.grade) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

// Confidence belongs to the selected outcome, not to other frames' winning classes.
export function outcomeConfidence(frames: Pick<InferenceResult, "grade" | "confidence">[], grade: Grade | undefined): number {
  const matching = frames.filter(frame => frame.grade === grade);
  return matching.length ? matching.reduce((sum, frame) => sum + frame.confidence, 0) / matching.length : 0;
}
export function meanClassScores(frames: Pick<InferenceResult, "classScores">[]): Partial<Record<Grade, number>> | undefined {
  const scored = frames.filter(frame => frame.classScores);
  if (!scored.length) return undefined;
  const result: Partial<Record<Grade, number>> = {};
  for (const frame of scored) for (const [code, score] of Object.entries(frame.classScores!)) {
    result[code as Grade] = (result[code as Grade] ?? 0) + (score ?? 0) / scored.length;
  }
  return result;
}

export function frameNumbers(history: InferenceResult[], cycles: TruckInspectionSession[]): Map<number, number> {
  const numbers = new Map<number, number>();
  for (const cycle of cycles) {
    const frames = history.filter(frame => cycle.captureIds.includes(frame.id) ||
      (!cycle.captureIds.length && frame.cameraId === cycle.line &&
       new Date(frame.timestamp).getTime() >= new Date(cycle.startedAt).getTime() &&
       (!cycle.completedAt || new Date(frame.timestamp).getTime() <= new Date(cycle.completedAt).getTime())));
    frames.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id - b.id);
    frames.forEach((frame, index) => numbers.set(frame.id, index + 1));
  }
  return numbers;
}

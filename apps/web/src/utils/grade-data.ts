import type { Grade, InferenceResult, TruckInspectionSession } from "../types";
export function dominantGrade(frames: Pick<InferenceResult, "grade">[]): Grade | undefined {
  const counts = new Map<Grade, number>();
  for (const frame of frames) counts.set(frame.grade, (counts.get(frame.grade) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
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

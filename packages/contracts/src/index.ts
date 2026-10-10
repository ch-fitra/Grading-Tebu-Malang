export type Grade = "S" | "M" | "A" | "D" | "B" | "T" | "G" | "X";
export type CameraStatus = "online" | "offline";
export type TruckDecision = "MBS" | "NON_MBS" | "DITOLAK_DO" | "PENDING";

export interface Camera {
  id: number;
  name: string;
  rtspUrl: string;
  location: string;
  status: CameraStatus;
}

export interface AiModel {
  id: number;
  name: string;
  version: string;
  path: string;
  active: boolean;
}

export interface InferenceResult {
  id: number;
  timestamp: string;
  cameraId: number;
  classes: { daun: number; pucuk: number; sampah: number };
  classScores?: Partial<Record<Grade, number>>;
  grade: Grade;
  confidence: number;
  snapshot: string | null;
}


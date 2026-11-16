// Class names follow the active Malang model configuration.
export type Grade = string;

export type InferenceResult = {
  impurityMeasured?: boolean;
  conveyorEmpty?: boolean;
  id: number;
  timestamp: string;
  cameraId: number;
  classes: { daun: number; pucuk: number; sampah: number };
  classScores?: Partial<Record<Grade, number>>;
  candidateGrade?: Grade;
  predictionAccepted?: boolean;
  confidenceThreshold?: number;
  grade: Grade;
  confidence: number;
  snapshot: string | null;
};

export type CameraRow = {
  id: number;
  name: string;
  rtspUrl: string;
  station: number;
  enabled: boolean;
  location: string;
  status: "online" | "offline";
};

export type AiModel = {
  id: number;
  name: string;
  version: string;
  path: string;
  active: boolean;
};

export type SystemStatus = {
  backend: { status: string };
  ai: { status: string; model?: { name: string; version: string; available: boolean; confidence_threshold?: number }; cameras?: Record<string, { live: boolean; fps: number }>; capabilities?: { conveyor_empty?: boolean } };
  database: { status: string };
  websocket: { clients: number };
};

export type TruckDecision = "MBS" | "NON_MBS" | "DITOLAK_DO" | "PENDING";

export type TruckInspectionSession = {
  impurityMeasured?: boolean;
  id: string;
  truckCode: string;
  plateNumber?: string;
  driverName?: string;
  supplier?: string;
  line: number;
  status: "active" | "completed";
  startedAt: string;
  completedAt?: string;
  captureIds: number[];
  finalDecision: TruckDecision;
  detectedGrade?: Grade | null;
  averageImpurity: number;
  averageConfidence: number;
  totalCaptures: number;
  notes?: string;
};

export type DeletionRequest = {
  id: string;
  targetType: "inference" | "truck_inspection" | "all_inferences";
  targetId: number | string;
  targetTitle: string;
  targetSubtitle?: string;
  snapshotPath?: string;
  factory: "kebonagung";
  requestedBy: string;
  requestedAt: string;
  reason: string;
  notes?: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
};

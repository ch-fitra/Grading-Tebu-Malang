export type Grade = "S" | "M" | "A" | "D" | "B" | "G" | "X";

export type InferenceResult = {
  conveyorEmpty?: boolean;
  id: number;
  timestamp: string;
  cameraId: number;
  classes: { daun: number; pucuk: number; sampah: number };
  grade: Grade;
  confidence: number;
  snapshot: string | null;
};

export type CameraRow = {
  id: number;
  name: string;
  rtspUrl: string;
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
  ai: { status: string; model?: { name: string; version: string; available: boolean }; camera_1_live?: boolean; camera_2_live?: boolean; capabilities?: { conveyor_empty?: boolean } };
  database: { status: string };
  websocket: { clients: number };
};

export type TruckDecision = "MBS" | "NON_MBS" | "DITOLAK_DO" | "PENDING";

export type TruckInspectionSession = {
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
  factory: "trangkil" | "kebonagung" | "all";
  requestedBy: string;
  requestedAt: string;
  reason: string;
  notes?: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
};

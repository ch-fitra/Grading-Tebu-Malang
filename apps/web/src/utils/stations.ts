import type { CameraRow } from "../types";

export interface MbsStationInfo {
  mbsNum: number;
  label: string;
  subLabel: string;
  isPrimaryLive: boolean;
  cameraId?: number;
}

export function findFactoryCamera(
  cameras: CameraRow[],
  factory: "trangkil" | "kebonagung",
  station: number,
): CameraRow | undefined {
  const matches = cameras.filter(camera => {
    const text = `${camera.name} ${camera.location}`.toLowerCase();
    const trangkil = text.includes("trangkil");
    const kebonagung = text.includes("kebon agung") || text.includes("malang");
    if (factory === "trangkil" ? !trangkil || kebonagung : !kebonagung || trangkil) return false;
    const namedStation = camera.name.match(/\bMBS\s*(\d+)\b/i)
      ?? camera.name.match(/\bmeja(?:\s+tebu)?\s*(\d+)\b/i);
    const cameraStation = namedStation ? Number(namedStation[1]) : factory === "trangkil" ? 5 : 1;
    return cameraStation === station;
  });
  // An absent or ambiguous station must not select an unrelated camera ID.
  return matches.length === 1 ? matches[0] : undefined;
}

export function resolveMbsStation(idOrLine?: number, cameras?: CameraRow[]): MbsStationInfo {
  if (!idOrLine) {
    return { mbsNum: 5, label: "MBS 5", subLabel: "Wisenet (Utama)", isPrimaryLive: true, cameraId: 2 };
  }
  const cam = cameras?.find(c => c.id === idOrLine);
  if (cam) {
    const name = cam.name.toLowerCase();
    if (name.includes("mbs 5") || name.includes("wisenet")) {
      return { mbsNum: 5, label: "MBS 5", subLabel: "Wisenet (Utama)", isPrimaryLive: true, cameraId: cam.id };
    }
    if (name.includes("mbs 1") || name.includes("kebon agung")) {
      return { mbsNum: 1, label: "MBS 1", subLabel: "PG Kebon Agung", isPrimaryLive: false, cameraId: cam.id };
    }
    const match = cam.name.match(/MBS\s*(\d+)/i);
    if (match) {
      const num = Number(match[1]);
      return { mbsNum: num, label: `MBS ${num}`, subLabel: cam.location || `Meja ${num}`, isPrimaryLive: num === 5, cameraId: cam.id };
    }
  }

  // Fallback direct mapping for PT Trangkil & PG Kebon Agung
  if (idOrLine === 2 || idOrLine === 5) {
    return { mbsNum: 5, label: "MBS 5", subLabel: "Wisenet (Utama)", isPrimaryLive: true, cameraId: 2 };
  }
  if (idOrLine === 1) {
    return { mbsNum: 1, label: "MBS 1", subLabel: "PG Kebon Agung", isPrimaryLive: false, cameraId: 1 };
  }
  return { mbsNum: idOrLine, label: `MBS ${idOrLine}`, subLabel: `Meja ${idOrLine}`, isPrimaryLive: false };
}


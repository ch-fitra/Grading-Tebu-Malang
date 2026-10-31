import type { CameraRow } from "../types";

export interface MbsStationInfo {
  mbsNum: number;
  label: string;
  subLabel: string;
  isPrimaryLive: boolean;
  cameraId?: number;
}

export function findStationCamera(cameras: CameraRow[], station: number): CameraRow | undefined {
  return cameras.find(camera => camera.station === station);
}

export function resolveMbsStation(cameraId?: number, cameras: CameraRow[] = []): MbsStationInfo {
  const camera = cameras.find(item => item.id === cameraId);
  const station = camera?.station;
  return {
    mbsNum: station ?? 0,
    label: station ? `MBS ${station}` : "Kamera tidak terdaftar",
    subLabel: camera?.location || camera?.name || "Konfigurasi kamera belum tersedia",
    isPrimaryLive: camera?.enabled === true && station === 2,
    cameraId: camera?.id,
  };
}

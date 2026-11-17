"""Camera-owned capture and cycles. One primary DB transaction per snapshot."""
from __future__ import annotations

import logging
import math
import os
import threading
import time
from contextlib import closing
from pathlib import Path
from uuid import uuid4

import cv2
from psycopg2.extras import RealDictCursor, Json

from db.connection import get_auth_db_connection
from inference import grade, grading_model, frame_model, frame_trigger
from streamer import stream_manager
from streamer import ROIModel

logger = logging.getLogger("grading_runtime")


class CameraGrading:
    def __init__(self, camera_id, snapshots, clock=time.monotonic):
        self.camera_id, self.snapshots, self.clock = camera_id, Path(snapshots), clock
        self.lock = threading.RLock()
        self.enabled = False
        self.phase, self.error = "off", None
        self.cycle_code = self.deadline = None
        self.next_capture = 0
        self.since = self.last_sample = self.last_frame_id = None
        self.waiting_clear = False
        self.probability = None
        self.duration = 30.0
        self.confirm_seconds, self.clear_seconds = 1.0, 2.0
        self.stop_event = threading.Event()
        self.thread = None

    def status(self):
        with self.lock:
            validated = os.getenv("AI_AUTO_VALIDATED", "false").lower() == "true"
            available = frame_model.model is not None and grading_model.model is not None
            return {"camera_id": self.camera_id, "enabled": self.enabled, "model_available": available,
                    "frame_model_loaded": frame_model.model is not None, "validation_complete": validated,
                    "detection_region": "full_frame", "phase": self.phase, "cycle_code": self.cycle_code,
                    "confirmed_seconds": max(0, self.clock() - self.since) if self.since is not None and not self.waiting_clear else 0,
                    "confirmation_seconds": self.confirm_seconds, "grading_seconds": self.duration,
                    "remaining_seconds": max(0, math.ceil(self.deadline - self.clock())) if self.deadline else 0,
                    "full_frame_confidence": self.probability,
                    "error": self.error or (None if available else "Model grading atau model frame belum tersedia")}

    def _worker(self):
        if self.thread is None or not self.thread.is_alive():
            self.stop_event.clear()
            self.thread = threading.Thread(target=self._run, daemon=True, name=f"grading-{self.camera_id}")
            self.thread.start()

    def capture(self, cycle_code=None):
        with self.lock:
            if grading_model.model is None:
                raise RuntimeError(grading_model.error)
            stream = stream_manager.get_stream(self.camera_id)
            if stream is None:
                raise RuntimeError("Kamera belum terdaftar")
            frame = stream.get_raw_frame()
            if frame is None:
                raise RuntimeError("Frame kamera tidak tersedia")
            # Read the current authoritative ROI; never import the supplied ZIP ROI.
            with closing(get_auth_db_connection()) as conn, conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT enabled FROM cameras WHERE id=%s", (self.camera_id,))
                    camera = cursor.fetchone()
                    if not camera or not camera[0]:
                        raise RuntimeError("Kamera tidak aktif")
            # DB errors propagate as technical errors, rather than silently using a full frame.
            from db.connection import get_ai_db_connection
            with closing(get_ai_db_connection()) as conn, conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT roi_config FROM ai_cameras WHERE id=%s", (self.camera_id,))
                    row = cursor.fetchone()
                    roi = ROIModel(**{**row[0], "camera_id": self.camera_id}) if row and row[0] else None
            crop = frame
            if roi and roi.enabled:
                h, w = frame.shape[:2]
                crop = frame[int(roi.y*h):int((roi.y+roi.height)*h), int(roi.x*w):int((roi.x+roi.width)*w)]
            result = grade(crop)
            result["model_output"]["roi"] = roi.model_dump() if roi else None
            ok, jpeg = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 95])
            if not ok:
                raise RuntimeError("Encoding snapshot gagal")
            filename = f"{uuid4()}.jpg"
            path = self.snapshots / filename
            self.snapshots.mkdir(parents=True, exist_ok=True)
            path.write_bytes(jpeg.tobytes())
            try:
                with closing(get_auth_db_connection()) as conn, conn:
                    with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                        cursor.execute("SELECT id FROM truck_inspections WHERE line=%s AND status='active' FOR UPDATE", (self.camera_id,))
                        active = cursor.fetchone()
                        if (cycle_code is None and active) or (cycle_code is not None and (not active or str(active['id']) != cycle_code)):
                            raise RuntimeError("Status siklus berubah; capture dibatalkan")
                        cursor.execute("""INSERT INTO inference_results
                            (camera_id,grade,confidence,snapshot_path,impurity_measured,model_output)
                            VALUES(%s,%s,%s,%s,false,%s) RETURNING id,created_at""",
                            (self.camera_id, result['grade'], result['confidence'], f"/storage/snapshots/{filename}", Json(result['model_output'])))
                        saved = cursor.fetchone()
                        if cycle_code:
                            cursor.execute("INSERT INTO truck_inspection_captures(inspection_id,inference_id) VALUES(%s,%s)", (cycle_code, saved['id']))
                return {"id": saved['id'], "timestamp": saved['created_at'].isoformat(), "cameraId": self.camera_id,
                        "grade": result['grade'], "confidence": result['confidence'], "modelOutput": result['model_output'],
                        "classes": {"daun": 0, "pucuk": 0, "sampah": 0}, "impurityMeasured": False,
                        "snapshot": f"/storage/snapshots/{filename}"}
            except Exception:
                path.unlink(missing_ok=True)
                raise

    def start(self, title="Siklus Tebu", notes="", automatic=False):
        with self.lock:
            if self.cycle_code or (self.enabled and not automatic):
                raise RuntimeError("Kamera sedang digunakan oleh siklus")
            if grading_model.model is None:
                raise RuntimeError(grading_model.error)
            stream = stream_manager.get_stream(self.camera_id)
            if stream is None or stream.get_raw_frame() is None:
                raise RuntimeError("Frame kamera tidak tersedia")
            code = str(uuid4())
            with closing(get_auth_db_connection()) as conn, conn:
                with conn.cursor() as cursor:
                    cursor.execute("INSERT INTO truck_inspections(id,truck_code,line,status,notes) VALUES(%s,%s,%s,'active',%s)",
                                   (code, title, self.camera_id, notes))
            self.cycle_code, self.deadline = code, self.clock() + self.duration
            self.next_capture = self.clock()
            self.phase, self.error = "grading", None
            self._worker()
            return code

    def finish(self, code):
        with self.lock:
            with closing(get_auth_db_connection()) as conn, conn:
                with conn.cursor() as cursor:
                    cursor.execute("UPDATE truck_inspections SET status='completed',completed_at=NOW() WHERE id=%s AND line=%s AND status='active' RETURNING id", (code, self.camera_id))
                    if not cursor.fetchone():
                        raise RuntimeError("Siklus aktif tidak ditemukan")
            if self.cycle_code == code:
                self.cycle_code = self.deadline = None
            self.since = None
            self.phase = "waiting_clear" if self.enabled else "off"
            self.error = None

    def set_enabled(self, enabled):
        with self.lock:
            if enabled == self.enabled:
                return self.status()
            if enabled and not self.status()['model_available']:
                raise RuntimeError("Model grading atau model frame belum tersedia; Auto tidak dapat diaktifkan")
            if enabled and self.cycle_code:
                raise RuntimeError("Selesaikan siklus manual sebelum mengaktifkan Auto")
            if not enabled and self.enabled and self.cycle_code:
                self.finish(self.cycle_code)
            self.enabled = enabled
            self.since = self.last_sample = self.last_frame_id = None
            self.phase = ("waiting_clear" if self.waiting_clear else "waiting_full") if enabled else "off"
            if enabled:
                self._worker()
            return self.status()

    def tick(self):
        with self.lock:
            now = self.clock()
            if self.cycle_code:
                if now >= self.deadline:
                    self.finish(self.cycle_code)
                elif now >= self.next_capture:
                    self.capture(self.cycle_code)
                    self.next_capture = self.clock() + 1.0
                    self.error = None
                return
            if not self.enabled:
                return
            stream = stream_manager.get_stream(self.camera_id)
            if stream is None:
                raise RuntimeError("Kamera tidak tersedia")
            # Frame and sequence are taken under the same camera lock.
            with stream.raw_cond:
                fid = stream.raw_frame_id
                frame = stream.latest_raw_frame.copy() if stream.latest_raw_frame is not None and time.time() - stream.last_frame_time < 4 else None
            if frame is None or fid == self.last_frame_id:
                if self.last_sample is None or now-self.last_sample > 1.5:
                    self.since = None
                    self.phase, self.probability = "camera_unavailable", None
                return
            full, self.probability = frame_trigger(frame)
            if self.last_sample is not None and now-self.last_sample > 1.5:
                self.since = None
            self.last_sample, self.last_frame_id = now, fid
            self.error = None
            # Clear must also be positively identified, not a low-confidence full prediction.
            clear = self.probability <= 0.30
            matches = clear if self.waiting_clear else full
            if not matches:
                self.since = None
            elif self.since is None:
                self.since = now
            self.phase = "waiting_clear" if self.waiting_clear else ("confirming" if matches else "waiting_full")
            if self.since is not None and now-self.since >= (self.clear_seconds if self.waiting_clear else self.confirm_seconds):
                if self.waiting_clear:
                    self.waiting_clear, self.since = False, None
                    self.phase = "waiting_full"
                else:
                    self.start("Siklus Auto", "Pemicu model frame resmi; ringkasan snapshot terbaru", automatic=True)
                    self.waiting_clear, self.since = True, None

    def _run(self):
        while not self.stop_event.wait(0.25):
            try:
                self.tick()
            except Exception as exc:
                logger.exception("Kesalahan teknis grading kamera %s", self.camera_id)
                with self.lock:
                    self.error, self.phase, self.since = str(exc), "error", None
                    self.next_capture = self.clock() + 1
                self.stop_event.wait(1)

    def shutdown(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=35)
        with self.lock:
            if self.cycle_code:
                self.finish(self.cycle_code)
            self.enabled = False

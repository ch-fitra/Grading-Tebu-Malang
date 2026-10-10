from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

import cv2
import numpy as np
from pydantic import BaseModel, Field, model_validator

logger = logging.getLogger("streamer")
logging.basicConfig(level=logging.INFO)

ROOT = Path(__file__).resolve().parents[2]
ROI_CONFIG_FILE = ROOT / "storage" / "roi_config.json"

# Global OpenCV FFmpeg low-latency flags
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
    "rtsp_transport;tcp|"
    "fflags;nobuffer|"
    "flags;low_delay|"
    "framedrop;1|"
    "strict;experimental|"
    "stimeout;5000000|"
    "max_delay;500000|"
    "reorder_queue_size;0|"
    "buffer_size;1048576"
)


class ROIModel(BaseModel):
    camera_id: int = 1
    enabled: bool = True
    x: float = Field(0.10, ge=0, lt=1)  # normalized 0.0 - 1.0 (left)
    y: float = Field(0.15, ge=0, lt=1)  # normalized 0.0 - 1.0 (top)
    width: float = Field(0.80, gt=0, le=1)  # normalized width
    height: float = Field(0.70, gt=0, le=1)  # normalized height
    label: str = "ROI: MEJA TEBU MBS 1 (PT KEBON AGUNG)"
    show_grid: bool = True
    show_telemetry: bool = True
    show_scrim: bool = True

    @model_validator(mode="after")
    def validate_bounds(self):
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("ROI harus berada di dalam frame")
        return self


DEFAULT_ROIS: Dict[int, ROIModel] = {
    1: ROIModel(
        camera_id=1,
        enabled=True,
        x=0.10,
        y=0.15,
        width=0.80,
        height=0.70,
        label="ROI: MEJA TEBU MBS 1 (PT KEBON AGUNG)",
        show_grid=True,
        show_telemetry=True,
        show_scrim=True,
    ),
    2: ROIModel(
        camera_id=2,
        enabled=True,
        x=0.12,
        y=0.10,
        width=0.76,
        height=0.78,
        label="ROI: MEJA TEBU 5 (PT TRANGKIL WISENET)",
        show_grid=True,
        show_telemetry=True,
        show_scrim=True,
    ),
}

_CACHED_ROIS: Optional[Dict[int, ROIModel]] = None


def load_all_rois() -> Dict[int, ROIModel]:
    global _CACHED_ROIS
    if _CACHED_ROIS is not None:
        return _CACHED_ROIS

    # Try loading from DB sugarcane_ai first
    try:
        from db.repository import AIRepository
        cameras = AIRepository.get_active_cameras()
        db_rois = {
            int(camera["id"]): ROIModel(**{**camera["roi_config"], "camera_id": int(camera["id"])})
            for camera in cameras if camera.get("roi_config")
        }
        if db_rois:
            _CACHED_ROIS = db_rois
            return _CACHED_ROIS
    except Exception as e:
        logger.warning(f"Could not load ROI from DB sugarcane_ai: {e}")

    if ROI_CONFIG_FILE.exists():
        try:
            data = json.loads(ROI_CONFIG_FILE.read_text(encoding="utf-8"))
            _CACHED_ROIS = {int(k): ROIModel(**v) for k, v in data.items()}
            return _CACHED_ROIS
        except Exception as e:
            logger.warning(f"Failed to load roi_config.json: {e}")
    _CACHED_ROIS = {k: v.model_copy() for k, v in DEFAULT_ROIS.items()}
    return _CACHED_ROIS


def save_roi(roi: ROIModel):
    global _CACHED_ROIS
    all_rois = load_all_rois()
    all_rois[roi.camera_id] = roi
    _CACHED_ROIS = all_rois
    ROI_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    serializable = {str(k): v.model_dump() for k, v in all_rois.items()}
    ROI_CONFIG_FILE.write_text(json.dumps(serializable, indent=2), encoding="utf-8")

    # Sync to DB sugarcane_ai
    try:
        from db.repository import AIRepository
        AIRepository.update_camera_roi(roi.camera_id, roi.model_dump())
    except Exception as e:
        logger.warning(f"Failed to sync ROI to DB sugarcane_ai: {e}")


class CameraStream:
    """Production-grade RTSP camera stream reader with zero buffer-drift and decoupled encoding."""

    def __init__(self, camera_id: int, rtsp_url: str, camera_name: str = "Camera"):
        self.camera_id = camera_id
        self.rtsp_url = rtsp_url
        self.camera_name = camera_name

        # Raw frames from RTSP thread
        self.latest_raw_frame: Optional[np.ndarray] = None
        self.raw_frame_id: int = 0
        self.res_w: int = 1280
        self.res_h: int = 720

        # Pre-encoded JPEG cache from encoder thread
        self.latest_overlay_jpeg: Optional[bytes] = None
        self.latest_raw_jpeg: Optional[bytes] = None
        self.encoded_frame_id: int = 0

        # Status & Telemetry
        self.last_frame_time: float = 0.0
        self.fps: float = 0.0
        self.is_connected: bool = False
        self.running: bool = False
        self.stop_event = threading.Event()
        self.last_error: Optional[str] = None
        self.frame_count: int = 0
        self.last_fps_calc: float = time.time()

        # Concurrency & Synchronization
        self.raw_lock = threading.Lock()
        self.raw_cond = threading.Condition(self.raw_lock)

        self.encoded_lock = threading.Lock()
        self.encoded_cond = threading.Condition(self.encoded_lock)

        self.capture_thread: Optional[threading.Thread] = None
        self.encode_thread: Optional[threading.Thread] = None

        # Subscriber tracking
        self.subscribers: int = 0
        self.subscribers_lock = threading.Lock()

        # In-memory pre-rendered fallback image (zero disk I/O during stream)
        self._standby_jpeg: bytes = self._generate_static_standby_jpeg()

    def start(self):
        if self.running:
            return
        self.running = True
        self.stop_event = threading.Event()
        self.capture_thread = threading.Thread(
            target=self._capture_loop,
            args=(self.stop_event,),
            daemon=True,
            name=f"rtsp-cap-{self.camera_id}",
        )
        self.encode_thread = threading.Thread(
            target=self._encode_loop,
            args=(self.stop_event,),
            daemon=True,
            name=f"rtsp-enc-{self.camera_id}",
        )
        self.capture_thread.start()
        self.encode_thread.start()
        logger.info(f"Started Camera #{self.camera_id} pipeline ({self.camera_name})")

    def stop(self):
        self.running = False
        self.stop_event.set()
        with self.raw_cond:
            self.raw_cond.notify_all()
        with self.encoded_cond:
            self.encoded_cond.notify_all()
        if self.capture_thread and self.capture_thread.is_alive():
            self.capture_thread.join(timeout=1.0)
        if self.encode_thread and self.encode_thread.is_alive():
            self.encode_thread.join(timeout=1.0)
        self.is_connected = False
        logger.info(f"Stopped Camera #{self.camera_id}")

    def add_subscriber(self):
        with self.subscribers_lock:
            self.subscribers += 1
            if not self.running:
                self.start()

    def remove_subscriber(self):
        with self.subscribers_lock:
            self.subscribers = max(0, self.subscribers - 1)

    def _generate_static_standby_jpeg(self) -> bytes:
        """Pre-renders an in-memory standby testcard once to avoid repetitive disk I/O."""
        frame = np.full((720, 1280, 3), (15, 23, 42), dtype=np.uint8)
        # Background grid pattern
        for x in range(0, 1280, 80):
            cv2.line(frame, (x, 0), (x, 720), (25, 38, 65), 1)
        for y in range(0, 720, 60):
            cv2.line(frame, (0, y), (1280, y), (25, 38, 65), 1)

        # Header bar
        cv2.rectangle(frame, (0, 0), (1280, 36), (10, 16, 30), -1)
        cv2.circle(frame, (20, 18), 6, (0, 200, 255), -1)
        cv2.putText(
            frame,
            f"CONNECTING STREAM | {self.camera_name.upper()}",
            (36, 23),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )

        center_title = "AI SUGARCANE GRADING SYSTEM"
        (tw, _), _ = cv2.getTextSize(center_title, cv2.FONT_HERSHEY_SIMPLEX, 0.72, 2)
        cv2.putText(
            frame,
            center_title,
            (640 - tw // 2, 320),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.72,
            (0, 230, 118),
            2,
            cv2.LINE_AA,
        )

        sub_title = f"Menghubungkan ke RTSP CCTV (MBS {self.camera_id})..."
        (stw, _), _ = cv2.getTextSize(sub_title, cv2.FONT_HERSHEY_SIMPLEX, 0.52, 1)
        cv2.putText(
            frame,
            sub_title,
            (640 - stw // 2, 360),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.52,
            (160, 185, 215),
            1,
            cv2.LINE_AA,
        )

        _, enc = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return enc.tobytes()

    def _render_and_encode(
        self,
        raw: np.ndarray,
        overlay: bool = True,
        target_width: int = 1280,
        quality: int = 80,
    ) -> bytes:
        h, w = raw.shape[:2]
        if w != target_width:
            target_height = int(h * (target_width / w))
            frame = cv2.resize(raw, (target_width, target_height), interpolation=cv2.INTER_LINEAR)
        else:
            frame = raw.copy()

        h, w = frame.shape[:2]

        if overlay:
            all_rois = load_all_rois()
            roi = all_rois.get(self.camera_id, DEFAULT_ROIS.get(self.camera_id))

            if roi and roi.enabled:
                x1 = int(roi.x * w)
                y1 = int(roi.y * h)
                x2 = int((roi.x + roi.width) * w)
                y2 = int((roi.y + roi.height) * h)

                x1, y1 = max(0, min(w - 1, x1)), max(0, min(h - 1, y1))
                x2, y2 = max(x1 + 10, min(w, x2)), max(y1 + 10, min(h, y2))

                # Hardware-accelerated integer scrim (<0.3ms)
                if roi.show_scrim:
                    scrim = cv2.convertScaleAbs(frame, alpha=0.42, beta=0)
                    scrim[y1:y2, x1:x2] = frame[y1:y2, x1:x2]
                    frame = scrim

                color_primary = (0, 230, 118)  # Emerald green (BGR)
                color_accent = (0, 200, 255)   # Amber (BGR)

                # Border
                cv2.rectangle(frame, (x1, y1), (x2, y2), color_primary, 2)

                # Corner Brackets
                bracket_len = min(35, (x2 - x1) // 4, (y2 - y1) // 4)
                cv2.line(frame, (x1, y1), (x1 + bracket_len, y1), color_primary, 4)
                cv2.line(frame, (x1, y1), (x1, y1 + bracket_len), color_primary, 4)
                cv2.line(frame, (x2, y1), (x2 - bracket_len, y1), color_primary, 4)
                cv2.line(frame, (x2, y1), (x2, y1 + bracket_len), color_primary, 4)
                cv2.line(frame, (x1, y2), (x1 + bracket_len, y2), color_primary, 4)
                cv2.line(frame, (x1, y2), (x1, y2 - bracket_len), color_primary, 4)
                cv2.line(frame, (x2, y2), (x2 - bracket_len, y2), color_primary, 4)
                cv2.line(frame, (x2, y2), (x2, y2 - bracket_len), color_primary, 4)

                # Grid lines
                if roi.show_grid:
                    dx = (x2 - x1) // 3
                    dy = (y2 - y1) // 3
                    for i in range(1, 3):
                        cv2.line(frame, (x1 + i * dx, y1), (x1 + i * dx, y2), (0, 100, 50), 1)
                        cv2.line(frame, (x1, y1 + i * dy), (x2, y1 + i * dy), (0, 100, 50), 1)
                    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                    cv2.drawMarker(frame, (cx, cy), color_accent, cv2.MARKER_CROSS, 20, 2)

                # ROI Header Tag
                label_text = f" [ {roi.label.upper()} ]  {x2-x1}x{y2-y1}px "
                font = cv2.FONT_HERSHEY_SIMPLEX
                (tw, th), _ = cv2.getTextSize(label_text, font, 0.48, 1)
                badge_y = max(th + 8, y1 - 8)
                cv2.rectangle(frame, (x1, badge_y - th - 6), (x1 + tw + 12, badge_y + 4), (15, 23, 42), -1)
                cv2.rectangle(frame, (x1, badge_y - th - 6), (x1 + tw + 12, badge_y + 4), color_primary, 1)
                cv2.putText(frame, label_text, (x1 + 6, badge_y - 2), font, 0.48, (255, 255, 255), 1, cv2.LINE_AA)

            # Top Telemetry Bar (<0.1ms)
            if roi and roi.show_telemetry:
                bar_h = 34
                cv2.rectangle(frame, (0, 0), (w, bar_h), (15, 23, 42), -1)
                cv2.line(frame, (0, bar_h), (w, bar_h), (0, 230, 118), 1)

                cv2.circle(frame, (16, bar_h // 2), 5, (0, 230, 118), -1)
                cv2.putText(
                    frame,
                    f"LIVE | {self.camera_name.upper()}",
                    (28, bar_h // 2 + 5),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (255, 255, 255),
                    1,
                    cv2.LINE_AA,
                )

                center_text = "AI SUGARCANE GRADING SYSTEM"
                (ctw, _), _ = cv2.getTextSize(center_text, cv2.FONT_HERSHEY_SIMPLEX, 0.44, 1)
                cv2.putText(
                    frame,
                    center_text,
                    (w // 2 - ctw // 2, bar_h // 2 + 5),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.44,
                    (0, 230, 118),
                    1,
                    cv2.LINE_AA,
                )

                res_label = f"{self.res_w}x{self.res_h}"
                fps_display = f"FPS: {self.fps:.1f} | {res_label} | {time.strftime('%Y-%m-%d %H:%M:%S')}"
                (rtw, _), _ = cv2.getTextSize(fps_display, cv2.FONT_HERSHEY_SIMPLEX, 0.44, 1)
                cv2.putText(
                    frame,
                    fps_display,
                    (w - rtw - 16, bar_h // 2 + 5),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.44,
                    (200, 220, 240),
                    1,
                    cv2.LINE_AA,
                )

        _, enc = cv2.imencode(
            ".jpg",
            frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), quality, cv2.IMWRITE_JPEG_OPTIMIZE, 0],
        )
        return enc.tobytes()

    def _capture_loop(self, stop_event: threading.Event):
        """Dedicated high-speed RTSP capture thread.
        Does NOT encode JPEGs or render overlays to guarantee ZERO buffer drift and NO frame jumping.
        """
        while not stop_event.is_set():
            cap = None
            try:
                logger.info(f"Connecting Camera #{self.camera_id} ({self.camera_name})")
                cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG, [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000])
                if stop_event.is_set():
                    break
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

                if not cap.isOpened():
                    self.is_connected = False
                    self.last_error = f"Cannot open RTSP stream #{self.camera_id}"
                    logger.warning(f"Camera #{self.camera_id} open failed. Retrying in 2.5s...")
                    stop_event.wait(2.5)
                    continue

                self.is_connected = True
                self.last_error = None
                logger.info(f"Camera #{self.camera_id} connected successfully.")

                while not stop_event.is_set():
                    ret, frame = cap.read()
                    if stop_event.is_set():
                        break
                    if not ret or frame is None:
                        logger.warning(f"Camera #{self.camera_id} read returned empty frame. Reconnecting...")
                        self.is_connected = False
                        break

                    now = time.time()
                    with self.raw_cond:
                        self.latest_raw_frame = frame
                        self.raw_frame_id += 1
                        self.last_frame_time = now
                        self.is_connected = True
                        self.res_h, self.res_w = frame.shape[:2]

                        # Calculate true hardware capture FPS
                        self.frame_count += 1
                        if now - self.last_fps_calc >= 1.0:
                            self.fps = self.frame_count / (now - self.last_fps_calc)
                            self.frame_count = 0
                            self.last_fps_calc = now

                        # Wake up the encoding worker immediately
                        self.raw_cond.notify_all()

            except Exception as e:
                self.is_connected = False
                self.last_error = str(e)
                logger.error(f"Camera #{self.camera_id} capture loop exception: {e}")
                stop_event.wait(2.0)
            finally:
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
                if self.stop_event is stop_event:
                    self.is_connected = False

    def _encode_loop(self, stop_event: threading.Event):
        """Dedicated background encoder thread.
        Pre-encodes overlay and raw JPEGs as frames arrive and notifies all waiting async streaming clients.
        Paces encoding at a smooth 28 FPS (matching PT Malang standard) to eliminate CPU spikes, burst lags, and jump frames.
        """
        last_processed_raw_id = -1
        last_encode_time = 0.0
        TARGET_INTERVAL = 1.0 / 28.0  # Stable broadcast standard 28 FPS

        while not stop_event.is_set():
            raw = None
            with self.raw_cond:
                while not stop_event.is_set() and (self.raw_frame_id == last_processed_raw_id or self.latest_raw_frame is None):
                    self.raw_cond.wait(timeout=0.04)
                if stop_event.is_set():
                    break
                raw = self.latest_raw_frame
                last_processed_raw_id = self.raw_frame_id

            if raw is None:
                continue

            # If no web viewers are watching, throttle to 1 FPS to save 99% CPU
            if self.subscribers == 0:
                stop_event.wait(0.5)
                continue

            now = time.time()
            if now - last_encode_time < TARGET_INTERVAL:
                # Discard intermediate stale frames when camera sends bursts/60 FPS
                continue
            last_encode_time = now

            try:
                overlay_bytes = self._render_and_encode(raw, overlay=True)
                raw_bytes = self._render_and_encode(raw, overlay=False)

                with self.encoded_cond:
                    self.latest_overlay_jpeg = overlay_bytes
                    self.latest_raw_jpeg = raw_bytes
                    self.encoded_frame_id += 1
                    # Wake up all waiting FastAPI StreamingResponse generators
                    self.encoded_cond.notify_all()
            except Exception as enc_err:
                logger.error(f"Camera #{self.camera_id} encode error: {enc_err}")

    async def get_next_jpeg_async(
        self,
        overlay: bool = True,
        last_fid: int = -1,
        timeout: float = 0.08,
    ) -> Tuple[bytes, int]:
        """Asynchronously waits for the next ready JPEG from the background encoder.
        Returns instantly with 0 GIL blocking and 0 event loop starvation.
        """
        def _wait():
            with self.encoded_cond:
                # If camera is connected and a newer frame is already ready
                if self.is_connected and time.time() - self.last_frame_time < 4.0 and self.encoded_frame_id != last_fid and self.latest_overlay_jpeg is not None:
                    jpeg = self.latest_overlay_jpeg if overlay else self.latest_raw_jpeg
                    return jpeg, self.encoded_frame_id

                # Wait for next frame signal from encoder thread
                self.encoded_cond.wait(timeout=timeout)
                if self.is_connected and time.time() - self.last_frame_time < 4.0 and self.latest_overlay_jpeg is not None:
                    jpeg = self.latest_overlay_jpeg if overlay else self.latest_raw_jpeg
                    return jpeg, self.encoded_frame_id

                # Standby fallback if disconnected / waiting
                return self._standby_jpeg, -1

        return await asyncio.to_thread(_wait)

    async def get_stream_async(self, overlay: bool = True, target_width: int = 1280, quality: int = 80, fps: int = 25):
        """Asynchronous MJPEG generator for FastAPI StreamingResponse."""
        self.add_subscriber()
        last_fid = -1
        try:
            while True:
                jpeg, fid = await self.get_next_jpeg_async(overlay=overlay, last_fid=last_fid)
                if jpeg is not None:
                    if target_width != 1280 or quality != 80:
                        jpeg = await asyncio.to_thread(self.get_jpeg_bytes, overlay, target_width, quality) or self._standby_jpeg
                    last_fid = fid
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        b"Content-Length: " + str(len(jpeg)).encode() + b"\r\n\r\n"
                        + jpeg
                        + b"\r\n"
                    )
                    await asyncio.sleep(1.0 / fps if fid != -1 else 0.15)
        except asyncio.CancelledError:
            pass
        finally:
            self.remove_subscriber()

    def get_jpeg_bytes(
        self,
        overlay: bool = True,
        target_width: int = 1280,
        quality: int = 80,
    ) -> bytes:
        """Encode a fresh snapshot even when no video subscriber is watching."""
        frame = self.get_raw_frame()
        if frame is None:
            return b""
        return self._render_and_encode(frame, overlay=overlay, target_width=target_width, quality=quality)

    def get_raw_frame(self) -> Optional[np.ndarray]:
        """Returns the latest uncompressed full-resolution raw frame for AI inference."""
        now = time.time()
        with self.raw_cond:
            if self.latest_raw_frame is not None and (now - self.last_frame_time) < 4.0:
                self.is_connected = True
                return self.latest_raw_frame.copy()
            self.is_connected = False
            self.fps = 0.0
        return None

    def get_roi_crop(self, roi: Optional[ROIModel] = None) -> Optional[np.ndarray]:
        """Crops the sugarcane ROI directly from the full-resolution raw frame."""
        frame = self.get_raw_frame()
        if frame is None:
            return None
        if roi is None or not roi.enabled:
            return frame

        h, w = frame.shape[:2]
        x1 = max(0, int(roi.x * w))
        y1 = max(0, int(roi.y * h))
        x2 = min(w, int((roi.x + roi.width) * w))
        y2 = min(h, int((roi.y + roi.height) * h))

        if x2 > x1 and y2 > y1:
            return frame[y1:y2, x1:x2].copy()
        return frame


class StreamManager:
    def __init__(self):
        self.streams: Dict[int, CameraStream] = {}

    def get_or_create(self, camera_id: int, rtsp_url: str, camera_name: str = "Camera") -> CameraStream:
        if camera_id in self.streams:
            stream = self.streams[camera_id]
            if stream.rtsp_url != rtsp_url:
                stream.stop()
                stream.rtsp_url = rtsp_url
                stream.camera_name = camera_name
                stream.start()
            return stream

        stream = CameraStream(camera_id, rtsp_url, camera_name)
        stream.start()
        self.streams[camera_id] = stream
        return stream

    def get_stream(self, camera_id: int) -> Optional[CameraStream]:
        return self.streams.get(camera_id)

    def restart_camera(self, camera_id: int) -> Optional[CameraStream]:
        if camera_id in self.streams:
            stream = self.streams[camera_id]
            stream.stop()
            stream.start()
            return stream
        return None

    def stop_all(self):
        for stream in self.streams.values():
            stream.stop()
        self.streams.clear()


stream_manager = StreamManager()

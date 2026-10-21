from __future__ import annotations

import os
import hmac
import hashlib
import logging
import threading
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from contextlib import asynccontextmanager
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from typing import Dict, List, Optional, Tuple, Literal

os.environ.setdefault("KERAS_BACKEND", "torch")
os.environ.setdefault("TORCH_COMPILE_DISABLE", "1")
try:
    import torch
    torch._dynamo.config.suppress_errors = True
    torch.set_num_threads(2)
except Exception:
    pass

logger = logging.getLogger("ai_service")

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Query, Response, Header, Request as FastAPIRequest
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from streamer import (
    DEFAULT_ROIS,
    ROIModel,
    load_all_rois,
    save_roi,
    stream_manager,
)

from db.migrations import run_ai_migrations
from db.repository import AIRepository
from auto_cycle import AutoCycleController

try:
    import onnxruntime as ort
except Exception:  # pragma: no cover
    ort = None

AI_SERVICE_DIR = Path(__file__).resolve().parent
ROOT = AI_SERVICE_DIR.parents[1]

MODEL_DIR = AI_SERVICE_DIR / "models" / "active"
CONFIG_PATH = MODEL_DIR / "config.json"
if not CONFIG_PATH.exists():
    CONFIG_PATH = ROOT / "models" / "active" / "config.json"

SNAPSHOTS_DIR = Path(os.getenv("AI_SNAPSHOTS_DIR", str(AI_SERVICE_DIR / "storage" / "snapshots"))).resolve()
SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)

from fastapi.staticfiles import StaticFiles

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run Native DB Migrations for sugarcane_ai
    run_ai_migrations()

    # Load active cameras 100% from database sugarcane_ai
    cameras = AIRepository.get_active_cameras()
    if cameras:
        for cam in cameras:
            if cam.get("rtsp_url"):
                stream_manager.get_or_create(cam["id"], cam["rtsp_url"], cam["name"])
    else:
        logger.warning("Tidak ada kamera aktif; periksa koneksi database dan konfigurasi kamera")

    try:
        # A service restart never leaves an automatic dashboard cycle marked active.
        try:
            for code in AIRepository.unfinished_auto_inspections():
                summary = AIRepository.stop_cycle(code)
                if summary:
                    AIRepository.complete_auto_inspection(code, summary)
        except Exception:
            logger.exception("Could not recover interrupted automatic cycles; Auto will require database availability")
        yield
    finally:
        for controller in list(_auto_controllers.values()):
            try:
                controller.shutdown()
            except Exception:
                logger.exception("Could not finalize automatic cycle during shutdown")
        for event, thread in list(_active_cycle_workers.values()):
            event.set()
            thread.join(timeout=30)
        stream_manager.stop_all()

app = FastAPI(title="Tebu AI Service", version="0.2.0", lifespan=lifespan)

@app.middleware("http")
async def internal_service_access(request: FastAPIRequest, call_next):
    if request.url.path not in ("/health", "/docs", "/openapi.json", "/redoc", "/docs/oauth2-redirect"):
        expected = os.getenv("AI_SERVICE_TOKEN") or hmac.new(
            os.getenv("JWT_SECRET", "local-development-secret-change-me").encode(),
            b"sugarcane-ai-service", hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(request.headers.get("x-sugarcane-service-token", ""), expected):
            return JSONResponse(status_code=401, content={"detail": "Akses layanan AI harus melalui backend"})
    return await call_next(request)

# Static Files Mount for serving snapshot images directly to frontend
app.mount("/snapshots", StaticFiles(directory=str(SNAPSHOTS_DIR)), name="snapshots")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class InferRequest(BaseModel):
    image_path: Optional[str] = None
    camera_id: Optional[int] = None
    crop_roi: bool = True
    cycle_id: Optional[int] = None
    cycle_code: Optional[str] = None


class StartCycleRequest(BaseModel):
    camera_id: int = 1
    cycle_code: Optional[str] = None


class StopCycleRequest(BaseModel):
    cycle_code: str


class ModelConfig(BaseModel):
    name: str
    version: str
    type: str
    input_size: int = Field(gt=0, le=4096)
    classes: List[str] = Field(min_length=1)
    threshold: float = Field(0.5, ge=0, le=1)
    output_activation: Literal["probabilities", "sigmoid", "softmax"] = "probabilities"
    input_color: Literal["rgb", "bgr"] = "rgb"
    model_path: str = "models/active/model.onnx"


class CameraRegisterPayload(BaseModel):
    camera_id: int
    rtsp_url: str
    camera_name: str = "Camera"


def load_config() -> ModelConfig:
    path = AI_SERVICE_DIR / "models" / "active" / "config.json"
    if not path.exists():
        path = ROOT / "models" / "active" / "config.json"
    if not path.exists():
        raise HTTPException(status_code=500, detail="models/active/config.json not found")
    return ModelConfig.model_validate_json(path.read_text(encoding="utf-8"))


# Auto-register Default Cameras on startup
DEFAULT_KEBONAGUNG_RTSP = os.getenv("CCTV_KEBONAGUNG_RTSP_URL", "")

_session_lock = threading.Lock()
_session_key = None
_session = None
_sessions = {}
_inference_lock = threading.RLock()


def configured_model_path(config: ModelConfig) -> Path:
    value = config.model_path.replace("\\", "/")
    base = ROOT if value.startswith(("apps/ai-service/", "models/archive/")) else AI_SERVICE_DIR
    path = (base / value).resolve()
    roots = [(AI_SERVICE_DIR / "models").resolve(), (ROOT / "models" / "archive").resolve()]
    if not any(path.is_relative_to(root) for root in roots) or path.suffix.lower() not in [".onnx", ".keras", ".h5"]:
        raise HTTPException(status_code=400, detail="Lokasi model tidak valid. Hanya mendukung .onnx, .keras, atau .h5")
    return path


def model_session(config: ModelConfig):
    global _session, _session_key
    path = configured_model_path(config)
    if not path.is_file():
        raise HTTPException(status_code=503, detail="File model belum tersedia")
    key = (str(path), path.stat().st_mtime_ns)
    with _session_lock:
        if key not in _sessions:
            if path.suffix.lower() in [".keras", ".h5"]:
                import keras
                candidate = keras.models.load_model(str(path), compile=False)
            else:
                if ort is None:
                    raise HTTPException(status_code=503, detail="onnxruntime belum terpasang")
                candidate = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
            # Keep frame and grading models resident independently.
            for old_key in list(_sessions):
                if old_key[0] == str(path):
                    del _sessions[old_key]
            _sessions[key] = candidate
        _session = _sessions[key]
        _session_key = key
        return _session


class ActivateModelPayload(BaseModel):
    name: str
    version: str
    model_path: str


@app.post("/models/activate")
def activate_model(payload: ActivateModelPayload):
    config = load_config().model_copy(update=payload.model_dump())
    model_session(config)  # Validate the file before changing active configuration.
    temporary = CONFIG_PATH.with_name(f"config.{uuid4().hex}.tmp")
    try:
        temporary.write_text(config.model_dump_json(indent=2), encoding="utf-8")
        os.replace(temporary, CONFIG_PATH)
    finally:
        temporary.unlink(missing_ok=True)
    return {"status": "ok", "model": config.name, "version": config.version}


def classification_measurement(output: np.ndarray, config: ModelConfig) -> Tuple[Dict[str, float], float]:
    arr = np.asarray(output, dtype=np.float32)
    if arr.ndim == 2 and arr.shape[0] == 1:
        arr = arr[0]
    if arr.ndim != 1 or arr.shape[0] != len(config.classes):
        # Fallback to segmentation if output shape matches segmentation
        if arr.ndim == 3 or (np.asarray(output).ndim == 4 and np.asarray(output).shape[0] == 1):
            return segmentation_measurement(output, config)
        raise HTTPException(status_code=422, detail=f"Output model klasifikasi harus 1D tensor berukuran [{len(config.classes)}]")
    
    if not np.isfinite(arr).all():
        raise HTTPException(status_code=422, detail="Output model mengandung nilai tidak valid")
    if config.output_activation == "softmax":
        exp_arr = np.exp(arr - np.max(arr))
        arr = exp_arr / exp_arr.sum()
    elif config.output_activation == "sigmoid":
        arr = 1.0 / (1.0 + np.exp(-np.clip(arr, -80, 80)))
    elif arr.min() < 0 or arr.max() > 1:
        raise HTTPException(status_code=422, detail="Output bukan probabilitas. Sesuaikan output_activation pada konfigurasi model")
    
    # Scale to percentage (0.0 - 100.0%)
    classes = {name: round(float(prob) * 100, 2) for name, prob in zip(config.classes, arr)}
    max_confidence = round(float(np.max(arr)), 4)
    return classes, max_confidence


def segmentation_measurement(output: np.ndarray, config: ModelConfig) -> Tuple[Dict[str, float], float]:
    masks = np.asarray(output, dtype=np.float32)
    if masks.ndim == 4 and masks.shape[0] == 1:
        masks = masks[0]
    if masks.ndim == 1:
        return classification_measurement(output, config)
    if config.type != "segmentation" or masks.ndim != 3 or masks.shape[0] != len(config.classes) or masks.size == 0 or not np.isfinite(masks).all():
        raise HTTPException(status_code=422, detail="Output model harus berupa peta segmentasi [1, kelas, tinggi, lebar] sesuai konfigurasi")
    if config.output_activation == "sigmoid":
        masks = 1.0 / (1.0 + np.exp(-np.clip(masks, -80, 80)))
    elif config.output_activation == "softmax":
        shifted = masks - masks.max(axis=0, keepdims=True)
        masks = np.exp(shifted)
        masks /= masks.sum(axis=0, keepdims=True)
    elif masks.min() < 0 or masks.max() > 1:
        raise HTTPException(status_code=422, detail="Output bukan probabilitas. Sesuaikan output_activation pada konfigurasi model")
    scores = masks.max(axis=0)
    winners = masks.argmax(axis=0)
    confident = scores > config.threshold
    classes = {name: round(float(np.mean((winners == index) & confident)) * 100, 2) for index, name in enumerate(config.classes)}
    return classes, round(float(scores.mean()), 4)


def measurement_result(classes: Dict[str, float], config: ModelConfig) -> Tuple[Dict[str, float], Optional[float], str, bool]:
    """Keep grade probabilities distinct from measured segmentation area."""
    if config.type == "classification":
        scores = {grade: round(float(value), 2) for grade, value in classes.items()
                  if grade in ("S", "M", "A", "D", "B", "T", "G", "X")}
        if not scores:
            raise HTTPException(status_code=422, detail="Model grading tidak menghasilkan kelas mutu yang dikenali")
        return scores, None, max(scores, key=scores.get), False
    if not all(name in classes for name in ("daun", "pucuk", "sampah")):
        raise HTTPException(status_code=422, detail="Model segmentasi harus memiliki kelas daun, pucuk, dan sampah")
    scores = {name: round(float(classes[name]), 2) for name in ("daun", "pucuk", "sampah")}
    total = round(sum(scores.values()), 2)
    grade = ("X" if scores["sampah"] > 15 or total > 35 else "G" if total > 20
             else "B" if total > 15 else "D" if total > 10 else "A" if total > 5
             else "M" if total > 2 else "S")
    return scores, total, grade, True


def run_onnx_inference(image: cv2.typing.MatLike, config: ModelConfig) -> Tuple[Dict[str, float], float]:
    with _inference_lock:
        return _run_model_inference(image, config)


def _run_model_inference(image: cv2.typing.MatLike, config: ModelConfig) -> Tuple[Dict[str, float], float]:
    path = configured_model_path(config)
    
    # If model is .keras / .h5, handle via Keras runner
    if path.suffix.lower() in [".keras", ".h5"]:
        try:
            keras_model = model_session(config)
            resized = cv2.resize(image, (config.input_size, config.input_size))
            if config.input_color == "rgb":
                resized = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            tensor = np.expand_dims(resized.astype("float32"), axis=0)
            with torch.no_grad():
                preds = keras_model(tensor, training=False)
                if hasattr(preds, "detach"):
                    preds = preds.detach().cpu().numpy()
            if config.type == "classification":
                return classification_measurement(preds, config)
            return segmentation_measurement(preds, config)
        except Exception as e:
            logger.error(f"Keras execution error: {e}")
            raise HTTPException(status_code=500, detail=f"Gagal menjalankan model Keras: {e}")

    session = model_session(config)
    resized = cv2.resize(image, (config.input_size, config.input_size))
    if config.input_color == "rgb":
        resized = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    tensor = resized.astype("float32") / 255.0
    tensor = tensor.transpose(2, 0, 1)[None, ...]

    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: tensor})

    if config.type == "classification":
        return classification_measurement(outputs[0], config)
    return segmentation_measurement(outputs[0], config)


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    config = load_config()
    s1 = stream_manager.get_stream(1)
    s2 = stream_manager.get_stream(2)
    s3 = stream_manager.get_stream(3)
    s4 = stream_manager.get_stream(4)
    return {
        "status": "ok",
        "service": "ai-service",
        "capabilities": {"conveyor_empty": False, "auto_cycle": FRAME_CONFIG_PATH.is_file()},
        "model": {
            "name": config.name,
            "version": config.version,
            "available": configured_model_path(config).is_file() and (configured_model_path(config).suffix.lower() in (".keras", ".h5") or ort is not None),
        },
        "camera_1_live": s1.is_connected if s1 else False,
        "camera_1_fps": round(s1.fps, 1) if s1 else 0.0,
        "camera_2_live": s2.is_connected if s2 else False,
        "camera_2_fps": round(s2.fps, 1) if s2 else 0.0,
        "camera_2_error": s2.last_error if s2 else None,
        "camera_3_live": s3.is_connected if s3 else False,
        "camera_3_fps": round(s3.fps, 1) if s3 else 0.0,
        "camera_4_live": s4.is_connected if s4 else False,
        "camera_4_fps": round(s4.fps, 1) if s4 else 0.0,
    }


@app.post("/stream/{camera_id}/reconnect")
def reconnect_camera(camera_id: int):
    stream = stream_manager.restart_camera(camera_id)
    return {
        "status": "ok",
        "camera_id": camera_id,
        "reconnected": stream is not None,
    }


@app.get("/stream/{camera_id}")
async def video_stream(
    camera_id: int,
    overlay: bool = Query(True, description="Render ROI and HUD overlays on frame"),
    target_width: int = Query(1280, ge=1, le=4096, description="Target frame width"),
    fps: int = Query(25, ge=1, le=60, description="Target frame rate"),
    quality: int = Query(80, ge=1, le=100, description="JPEG quality 1-100"),
):
    stream = stream_manager.get_stream(camera_id)
    if not stream:
        raise HTTPException(status_code=404, detail=f"Camera stream #{camera_id} not initialized")

    if not stream.running:
        stream.start()

    return StreamingResponse(
        stream.get_stream_async(overlay=overlay, target_width=target_width, quality=quality, fps=fps),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.get("/snapshot/{camera_id}")
def snapshot(
    camera_id: int,
    overlay: bool = Query(True, description="Render ROI HUD"),
    crop_roi: bool = Query(False, description="Crop frame to ROI"),
    target_width: int = Query(1280, ge=1, le=4096, description="Target width"),
    quality: int = Query(85, ge=1, le=100, description="JPEG quality"),
):
    stream = stream_manager.get_stream(camera_id)
    if not stream:
        raise HTTPException(status_code=404, detail=f"Camera stream #{camera_id} not found")

    if crop_roi:
        all_rois = load_all_rois()
        roi = all_rois.get(camera_id)
        frame = stream.get_roi_crop(roi)
        if frame is None:
            raise HTTPException(status_code=503, detail="Camera frame not available")
        _, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        return Response(content=encoded.tobytes(), media_type="image/jpeg")

    jpeg = stream.get_jpeg_bytes(overlay=overlay, target_width=target_width, quality=quality)
    if not jpeg:
        raise HTTPException(status_code=503, detail="Camera frame not available")
    return Response(content=jpeg, media_type="image/jpeg")


@app.get("/roi/{camera_id}", response_model=ROIModel)
def get_roi(camera_id: int):
    all_rois = load_all_rois()
    roi = all_rois.get(camera_id)
    if not roi:
        roi = DEFAULT_ROIS.get(camera_id, ROIModel(camera_id=camera_id))
    return roi


@app.post("/roi/{camera_id}")
def update_roi(camera_id: int, payload: ROIModel):
    payload.camera_id = camera_id
    save_roi(payload)
    return {"status": "ok", "roi": payload}


@app.post("/cameras/register")
def register_camera(payload: CameraRegisterPayload):
    AIRepository.register_camera(payload.camera_id, payload.rtsp_url, payload.camera_name)
    stream = stream_manager.get_or_create(payload.camera_id, payload.rtsp_url, payload.camera_name)
    return {
        "status": "ok",
        "camera_id": payload.camera_id,
        "connected": stream.is_connected,
    }


@app.delete("/cameras/{camera_id}")
def deactivate_camera(camera_id: int):
    controller = _auto_controller(camera_id)
    with controller.lock:
        controller.set_enabled(False)
        AIRepository.deactivate_camera(camera_id)
        stream = stream_manager.streams.pop(camera_id, None)
        if stream:
            stream.stop()
    return {"status": "ok"}


_active_cycle_workers: Dict[str, Tuple[threading.Event, threading.Thread]] = {}
_workers_lock = threading.Lock()
_lifecycle_lock = threading.RLock()
_auto_controllers: Dict[int, AutoCycleController] = {}
_controllers_lock = threading.Lock()
_automatic_cycle_codes = set()
FRAME_CONFIG_PATH = MODEL_DIR / "frame_config.json"


class AutoModeRequest(BaseModel):
    enabled: bool


def load_frame_config() -> ModelConfig:
    return ModelConfig.model_validate_json(FRAME_CONFIG_PATH.read_text(encoding="utf-8"))


def _authorized_cameras(authorization: Optional[str], permission: Optional[str] = None, operator_only: bool = False):
    """Reuse the API's session and factory access checks; never trust UI permissions."""
    base = os.getenv("AUTO_CYCLE_API_URL", f"http://127.0.0.1:{os.getenv('API_PORT', os.getenv('BACKEND_PORT', '4110'))}").rstrip("/")
    try:
        def read(path):
            request = Request(base + path, headers={"Authorization": authorization or ""})
            with urlopen(request, timeout=5) as response:
                return json.load(response)
        user = read("/api/auth/me")
        # /auth/me returns the public user directly.
        if (permission and permission not in user.get("permissions", [])) or (operator_only and user.get("role") == "admin"):
            raise HTTPException(status_code=403, detail="Akses ditolak")
        return read("/api/cameras")
    except HTTPError as exc:
        raise HTTPException(status_code=exc.code, detail="Sesi atau akses kamera tidak valid") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=503, detail="API autentikasi tidak tersedia") from exc


def _authorize_auto(camera_id: int, authorization: Optional[str], write: bool = False):
    cameras = _authorized_cameras(authorization, "inspection.write" if write else None, operator_only=write)
    if not any(camera["id"] == camera_id for camera in cameras):
        raise HTTPException(status_code=403, detail="Kamera berada di luar akses pabrik")


@app.get("/inference/history-summary")
def history_summary(
    authorization: Optional[str] = Header(None),
    camera_ids: Optional[List[int]] = Query(None),
    start_at: Optional[datetime] = Query(None),
    end_at: Optional[datetime] = Query(None),
    search: str = Query("", max_length=500),
):
    permitted = {camera["id"] for camera in _authorized_cameras(authorization, "history.read")}
    requested = set(camera_ids) if camera_ids is not None else permitted
    if not requested.issubset(permitted):
        raise HTTPException(status_code=403, detail="Kamera berada di luar akses pabrik")
    if start_at is not None and end_at is not None and start_at >= end_at:
        raise HTTPException(status_code=422, detail="Rentang waktu tidak valid")
    return AIRepository.history_summary(sorted(requested), start_at, end_at, search.strip())


@app.get("/inference/history-page")
def history_page(
    camera_id: int = Query(..., gt=0),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    cycle_code: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    cameras = _authorized_cameras(authorization, "dashboard.read")
    if camera_id not in {camera["id"] for camera in cameras}:
        raise HTTPException(status_code=403, detail="Kamera berada di luar akses pabrik")
    if cycle_code:
        from uuid import UUID
        try:
            cycle_code = str(UUID(cycle_code))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="ID siklus tidak valid") from exc
    return AIRepository.history_page(camera_id, page, page_size, cycle_code)


def _sample_full_frame(camera_id, previous_id):
    stream = stream_manager.get_stream(camera_id)
    if not stream or not stream.is_connected:
        return None, None, None
    # Copy the original camera image and identity under the same lock, WITHOUT ROI/HUD.
    with stream.raw_lock:
        frame_id = (id(stream), stream.raw_frame_id)
        if frame_id == previous_id or stream.latest_raw_frame is None or time.time() - stream.last_frame_time > 1.5:
            return frame_id, None, None
        image = stream.latest_raw_frame.copy()
    config = load_frame_config()
    classes, confidence = run_onnx_inference(image, config)
    if not np.isfinite(list(classes.values())).all():
        raise RuntimeError("Output model full frame tidak valid")
    if confidence < config.threshold:
        return frame_id, None, confidence
    return frame_id, classes["full_frame_sugarcane"] > classes["not_full_frame"], confidence


def _start_automatic_cycle(camera_id):
    with _lifecycle_lock:
        if AIRepository.has_running_cycle(camera_id) or AIRepository.has_active_inspection(camera_id):
            raise RuntimeError("Tunggu siklus aktif selesai sebelum memulai siklus otomatis")
        code = str(uuid4())
        AIRepository.create_auto_inspection(camera_id, code)
        try:
            result, deadline = _begin_cycle(StartCycleRequest(camera_id=camera_id, cycle_code=code), duration=30.0, warm=False)
        except Exception:
            AIRepository.discard_auto_inspection(code)
            raise
        _automatic_cycle_codes.add(code)
        return result["cycle_code"], deadline


def _finish_automatic_cycle(code):
    summary = _stop_cycle(code)
    AIRepository.complete_auto_inspection(code, summary)
    _automatic_cycle_codes.discard(code)


def _auto_controller(camera_id):
    with _controllers_lock:
        if camera_id not in _auto_controllers:
            _auto_controllers[camera_id] = AutoCycleController(
                camera_id, lambda previous: _sample_full_frame(camera_id, previous),
                lambda: _start_automatic_cycle(camera_id), _finish_automatic_cycle)
        return _auto_controllers[camera_id]


@app.get("/cycle/auto/{camera_id}")
def get_auto_mode(camera_id: int, authorization: Optional[str] = Header(None)):
    _authorize_auto(camera_id, authorization)
    return {**_auto_controller(camera_id).status(), "model_available": configured_model_path(load_frame_config()).is_file()}


@app.put("/cycle/auto/{camera_id}")
def set_auto_mode(camera_id: int, payload: AutoModeRequest, authorization: Optional[str] = Header(None)):
    _authorize_auto(camera_id, authorization, write=True)
    controller = _auto_controller(camera_id)
    with controller.lock, _lifecycle_lock:
        if payload.enabled and not controller.enabled:
            if AIRepository.has_running_cycle(camera_id) or AIRepository.has_active_inspection(camera_id):
                raise HTTPException(status_code=409, detail="Selesaikan siklus manual sebelum mengaktifkan Auto")
            stream = stream_manager.get_stream(camera_id)
            image = stream.get_raw_frame() if stream and stream.is_connected else None
            if image is None:
                raise HTTPException(status_code=503, detail="Kamera belum terhubung")
            # Warm both models before the confirmation/capture clocks start.
            run_onnx_inference(image, load_frame_config())
            run_onnx_inference(image, load_config())
        return {**controller.set_enabled(payload.enabled), "model_available": True}


def _cycle_scan_worker(cycle_code: str, camera_id: int, cycle_id: Optional[int], stop_event: threading.Event, deadline: Optional[float] = None):
    logger.info(f"Started autonomous background cycle scan worker for {cycle_code} (camera #{camera_id})")
    frame_idx = 0
    next_capture = time.monotonic()
    while not stop_event.is_set():
        if stop_event.wait(max(0.0, next_capture - time.monotonic())):
            break
        if deadline is not None and time.monotonic() >= deadline:
            break
        next_capture += 1.0
        try:
            config = load_config()
            stream = stream_manager.get_stream(camera_id)
            if not stream:
                camera = next((item for item in AIRepository.get_active_cameras() if item["id"] == camera_id), None)
                if camera and camera.get("rtsp_url"):
                    stream = stream_manager.get_or_create(camera_id, camera["rtsp_url"], camera["name"])

            all_rois = load_all_rois()
            roi = all_rois.get(camera_id)
            image = stream.get_roi_crop(roi) if (roi and roi.enabled and stream and stream.is_connected) else (stream.get_raw_frame() if stream else None)

            if image is None:
                raise RuntimeError("CCTV frame unavailable; no detection was saved")

            captured_at = datetime.now(timezone.utc).isoformat()
            frame_idx += 1
            snapshot_filename = f"frame_{frame_idx:04d}_{uuid4().hex[:6]}.jpg"
            cycle_folder = SNAPSHOTS_DIR / cycle_code
            cycle_folder.mkdir(parents=True, exist_ok=True)
            snapshot_path = cycle_folder / snapshot_filename
            rel_snapshot_path = f"storage/snapshots/{cycle_code}/{snapshot_filename}"

            # A frame queued behind another inference must not run after the deadline.
            with _inference_lock:
                if stop_event.is_set() or (deadline is not None and time.monotonic() >= deadline):
                    break
                classes, confidence = run_onnx_inference(image, config)
            if not cv2.imwrite(str(snapshot_path), image):
                raise RuntimeError("Failed to persist cycle snapshot")

            mapped_scores, total_impurity, detected_class, _ = measurement_result(classes, config)

            _, encoded_jpg = cv2.imencode(".jpg", image)
            image_bytes = encoded_jpg.tobytes() if encoded_jpg is not None else None

            result_id = AIRepository.save_inference_result(
                camera_id=camera_id,
                model_version=config.version,
                snapshot_path=rel_snapshot_path,
                classes_score=mapped_scores,
                total_impurity=total_impurity,
                detected_class=detected_class,
                confidence=confidence,
                image_blob=image_bytes,
                cycle_id=cycle_id,
                cycle_code=cycle_code,
                captured_at=captured_at
            )
            if result_id is None:
                snapshot_path.unlink(missing_ok=True)
                raise RuntimeError("Failed to persist cycle detection in database")
        except Exception as e:
            logger.error(f"Error in background cycle scan frame processing for {cycle_code}: {e}")

        # Skip missed slots rather than emitting a burst of duplicate captures.
        if next_capture < time.monotonic():
            next_capture += int(time.monotonic() - next_capture) + 1

    logger.info(f"Stopped background cycle scan worker for {cycle_code}")


@app.post("/cycle/start")
def start_cycle(payload: StartCycleRequest):
    controller = _auto_controller(payload.camera_id)
    with controller.lock, _lifecycle_lock:
        if controller.enabled:
            raise HTTPException(status_code=409, detail="Mode Auto aktif; kontrol manual dikunci")
        result, _ = _begin_cycle(payload)
        return {"status": "ok", "cycle": result}


def _begin_cycle(payload: StartCycleRequest, duration: Optional[float] = None, warm: bool = True):
    if AIRepository.has_running_cycle(payload.camera_id):
        raise HTTPException(status_code=409, detail="Masih ada siklus aktif pada kamera ini")
    config = load_config()
    # Load/warm the model before starting the one-second acquisition clock.
    stream = stream_manager.get_stream(payload.camera_id)
    image = stream.get_raw_frame() if stream else None
    if image is None:
        raise HTTPException(status_code=503, detail="CCTV is not connected")
    if warm:
        run_onnx_inference(image, config)
    result = AIRepository.start_cycle(
        camera_id=payload.camera_id,
        model_version=config.version,
        cycle_code=payload.cycle_code
    )
    cycle_code = result["cycle_code"]
    cycle_id = result.get("id")
    deadline = time.monotonic() + duration if duration is not None else None

    # Ensure cycle snapshot subfolder exists
    cycle_dir = SNAPSHOTS_DIR / cycle_code
    cycle_dir.mkdir(parents=True, exist_ok=True)

    # Start autonomous background scanner worker for this cycle
    with _workers_lock:
        if cycle_code in _active_cycle_workers:
            _active_cycle_workers[cycle_code][0].set()
        stop_event = threading.Event()
        thread = threading.Thread(
            target=_cycle_scan_worker,
            args=(cycle_code, payload.camera_id, cycle_id, stop_event, deadline),
            daemon=True,
            name=f"cycle-scan-{cycle_code}"
        )
        _active_cycle_workers[cycle_code] = (stop_event, thread)
        thread.start()

    return result, deadline


@app.post("/cycle/stop")
def stop_cycle(payload: StopCycleRequest):
    if payload.cycle_code in _automatic_cycle_codes:
        raise HTTPException(status_code=409, detail="Siklus Auto dikendalikan oleh timer; matikan Auto untuk mengakhiri lebih awal")
    return {"status": "ok", "cycle_result": _stop_cycle(payload.cycle_code)}


def _stop_cycle(cycle_code: str):
    with _workers_lock:
        if cycle_code in _active_cycle_workers:
            stop_event, thread = _active_cycle_workers[cycle_code]
            stop_event.set()
            thread.join(timeout=30.0)
            if thread.is_alive():
                raise HTTPException(status_code=503, detail="Capture is still finishing; retry stop")
            del _active_cycle_workers[cycle_code]

    result = AIRepository.stop_cycle(cycle_code)
    if not result:
        raise HTTPException(status_code=503, detail=f"Cycle {cycle_code} could not be finalized; retry stop")
    return result


@app.post("/infer")
def infer(payload: InferRequest):
    config = load_config()
    image = None
    captured_at = datetime.now(timezone.utc).isoformat()
    snapshot_filename = f"capture_{uuid4().hex}.jpg"
    
    # Store snapshot in cycle folder if cycle_code is provided
    if payload.cycle_code:
        cycle_folder = SNAPSHOTS_DIR / payload.cycle_code
        cycle_folder.mkdir(parents=True, exist_ok=True)
        snapshot_path = cycle_folder / snapshot_filename
        rel_snapshot_path = f"storage/snapshots/{payload.cycle_code}/{snapshot_filename}"
    else:
        snapshot_path = SNAPSHOTS_DIR / snapshot_filename
        rel_snapshot_path = f"storage/snapshots/{snapshot_filename}"

    if payload.camera_id:
        stream = stream_manager.get_stream(payload.camera_id)
        if stream:
            all_rois = load_all_rois()
            roi = all_rois.get(payload.camera_id)
            if payload.crop_roi and roi and roi.enabled:
                image = stream.get_roi_crop(roi)
            else:
                image = stream.get_raw_frame()

    if image is None and payload.image_path:
        img_p = Path(payload.image_path)
        if not img_p.is_absolute():
            img_p = ROOT / img_p
        image = cv2.imread(str(img_p))

    if image is None:
        raise HTTPException(status_code=400, detail="No valid camera stream or image provided for inference")

    classes, confidence = run_onnx_inference(image, config)
    if not cv2.imwrite(str(snapshot_path), image):
        raise HTTPException(status_code=500, detail="Gagal menyimpan snapshot")

    mapped_scores, total_impurity, detected_class, impurity_measured = measurement_result(classes, config)
    grade = detected_class

    # Encode image bytes for optional DB BLOB storage
    _, encoded_jpg = cv2.imencode(".jpg", image)
    image_bytes = encoded_jpg.tobytes() if encoded_jpg is not None else None

    # Save to sugarcane_ai database
    result_id = AIRepository.save_inference_result(
        camera_id=payload.camera_id or 1,
        model_version=config.version,
        snapshot_path=rel_snapshot_path,
        classes_score=mapped_scores,
        total_impurity=total_impurity,
        detected_class=detected_class,
        confidence=confidence,
        image_blob=image_bytes,
        cycle_id=payload.cycle_id,
        cycle_code=payload.cycle_code,
        captured_at=captured_at
    )

    if result_id is None:
        snapshot_path.unlink(missing_ok=True)
        raise HTTPException(status_code=503, detail="Failed to persist detection in database")

    return {
        "id": result_id,
        "timestamp": captured_at,
        "camera_id": payload.camera_id,
        "cycle_id": payload.cycle_id,
        "cycle_code": payload.cycle_code,
        "classes": mapped_scores,
        "detected_class": detected_class,
        "grade": grade,
        "total_impurity": total_impurity,
        "impurity_measured": impurity_measured,
        "confidence": confidence,
        "snapshot_path": rel_snapshot_path,
    }

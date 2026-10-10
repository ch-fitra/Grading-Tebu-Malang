from __future__ import annotations

import asyncio
import os
import logging
import threading
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
except Exception:
    pass

logger = logging.getLogger("ai_service")

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Query, Response
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

SNAPSHOTS_DIR = AI_SERVICE_DIR / "storage" / "snapshots"
SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)

from fastapi.staticfiles import StaticFiles

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run Native DB Migrations for sugarcane_ai
    try:
        run_ai_migrations()
    except Exception as e:
        print(f"Warning on AI DB Migration startup: {e}")

    # Load active cameras 100% from database sugarcane_ai
    cameras = AIRepository.get_active_cameras()
    if cameras:
        for cam in cameras:
            stream_manager.get_or_create(cam["id"], cam["rtsp_url"], cam["name"])
    else:
        # Fallback to PT Trangkil camera if empty
        stream_manager.get_or_create(1, DEFAULT_TRANGKIL_WISENET_RTSP, "MBS 5 - PT Trangkil (Wisenet Meja 5)")

    try:
        yield
    finally:
        stream_manager.stop_all()

app = FastAPI(title="Tebu AI Service", version="0.2.0", lifespan=lifespan)

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
DEFAULT_KEBONAGUNG_RTSP = "rtsp://admin:qc_12345@123.255.202.132:10554/Streaming/Channels/101"
DEFAULT_TRANGKIL_WISENET_RTSP = "rtsp://admin:XNOAdmin123@192.168.33.86:554/profile2/media.smp"

_session_lock = threading.Lock()
_session_key = None
_session = None


def configured_model_path(config: ModelConfig) -> Path:
    path = (AI_SERVICE_DIR / config.model_path.replace("apps/ai-service/", "")).resolve()
    if not path.is_relative_to((AI_SERVICE_DIR / "models").resolve()) or path.suffix.lower() not in [".onnx", ".keras", ".h5"]:
        raise HTTPException(status_code=400, detail="Lokasi model tidak valid. Hanya mendukung .onnx, .keras, atau .h5")
    return path


def model_session(config: ModelConfig):
    global _session, _session_key
    path = configured_model_path(config)
    if ort is None or not path.is_file():
        raise HTTPException(status_code=503, detail="Model ONNX belum tersedia atau onnxruntime belum terpasang")
    key = (str(path), path.stat().st_mtime_ns)
    with _session_lock:
        if _session_key != key:
            candidate = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
            _session = candidate
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
    
    if config.output_activation == "softmax" or arr.min() < 0 or arr.max() > 1.0:
        exp_arr = np.exp(arr - np.max(arr))
        arr = exp_arr / exp_arr.sum()
    elif config.output_activation == "sigmoid":
        arr = 1.0 / (1.0 + np.exp(-np.clip(arr, -80, 80)))
    
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


def run_onnx_inference(image: cv2.typing.MatLike, config: ModelConfig) -> Tuple[Dict[str, float], float]:
    path = configured_model_path(config)
    
    # If model is .keras / .h5, handle via Keras runner
    if path.suffix.lower() in [".keras", ".h5"]:
        try:
            import keras
            keras_model = keras.models.load_model(str(path))
            resized = cv2.resize(image, (config.input_size, config.input_size))
            if config.input_color == "rgb":
                resized = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            tensor = np.expand_dims(resized.astype("float32"), axis=0)
            preds = keras_model.predict(tensor, verbose=0)
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
        "capabilities": {"conveyor_empty": False},
        "model": {
            "name": config.name,
            "version": config.version,
            "available": configured_model_path(config).is_file() and ort is not None,
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
    stream = stream_manager.get_or_create(payload.camera_id, payload.rtsp_url, payload.camera_name)
    return {
        "status": "ok",
        "camera_id": payload.camera_id,
        "connected": stream.is_connected,
        "rtsp_url": payload.rtsp_url,
    }


_active_cycle_workers: Dict[str, Tuple[threading.Event, threading.Thread]] = {}
_workers_lock = threading.Lock()


def _generate_synthetic_sugarcane_frame() -> np.ndarray:
    """Generates a realistic 1280x720 sugarcane conveyor frame for offline simulation."""
    frame = np.full((720, 1280, 3), (30, 40, 35), dtype=np.uint8)
    cv2.rectangle(frame, (180, 100), (1100, 620), (50, 60, 55), -1)
    for y in range(120, 600, 40):
        cv2.line(frame, (180, y), (1100, y), (20, 30, 25), 3)
    t_seed = int(time.time() * 10) % 10000
    rng = np.random.RandomState(t_seed)
    for _ in range(25):
        x1 = rng.randint(220, 1000)
        y1 = rng.randint(140, 560)
        x2 = x1 + rng.randint(60, 180)
        y2 = y1 + rng.randint(-20, 20)
        color = (int(rng.randint(40, 80)), int(rng.randint(120, 180)), int(rng.randint(100, 160)))
        cv2.line(frame, (x1, y1), (x2, y2), color, int(rng.randint(8, 16)))
    return frame


def _cycle_scan_worker(cycle_code: str, camera_id: int, cycle_id: Optional[int], stop_event: threading.Event):
    logger.info(f"Started autonomous background cycle scan worker for {cycle_code} (camera #{camera_id})")
    frame_idx = 0
    while not stop_event.is_set():
        try:
            config = load_config()
            stream = stream_manager.get_stream(camera_id)
            if not stream:
                stream = stream_manager.get_or_create(camera_id, DEFAULT_TRANGKIL_WISENET_RTSP, "MBS 5 - PT Trangkil (Wisenet Meja 5)")

            all_rois = load_all_rois()
            roi = all_rois.get(camera_id)
            image = stream.get_roi_crop(roi) if (roi and roi.enabled and stream and stream.is_connected) else (stream.get_raw_frame() if stream else None)

            if image is None:
                # Fallback to synthetic conveyor frame when offline / connecting
                full_synthetic = _generate_synthetic_sugarcane_frame()
                if roi and roi.enabled:
                    h, w = full_synthetic.shape[:2]
                    x1, y1 = max(0, int(roi.x * w)), max(0, int(roi.y * h))
                    x2, y2 = min(w, int((roi.x + roi.width) * w)), min(h, int((roi.y + roi.height) * h))
                    image = full_synthetic[y1:y2, x1:x2].copy()
                else:
                    image = full_synthetic

            frame_idx += 1
            snapshot_filename = f"frame_{frame_idx:04d}_{uuid4().hex[:6]}.jpg"
            cycle_folder = SNAPSHOTS_DIR / cycle_code
            cycle_folder.mkdir(parents=True, exist_ok=True)
            snapshot_path = cycle_folder / snapshot_filename
            rel_snapshot_path = f"storage/snapshots/{cycle_code}/{snapshot_filename}"

            classes, confidence = run_onnx_inference(image, config)
            cv2.imwrite(str(snapshot_path), image)

            mapped_scores = {
                "S": round(float(classes.get("S", 0.0)), 2),
                "A": round(float(classes.get("A", classes.get("daun", 0.0))), 2),
                "B": round(float(classes.get("B", classes.get("pucuk", 0.0))), 2),
                "D": round(float(classes.get("D", 0.0)), 2),
                "G": round(float(classes.get("G", 0.0)), 2),
                "M": round(float(classes.get("M", 0.0)), 2),
                "T": round(float(classes.get("T", classes.get("sampah", 0.0))), 2),
            }

            daun_score = mapped_scores["A"]
            pucuk_score = mapped_scores["B"]
            sampah_score = mapped_scores["T"]
            total_impurity = round(daun_score + pucuk_score + sampah_score, 2)
            detected_class = max(mapped_scores, key=mapped_scores.get)

            _, encoded_jpg = cv2.imencode(".jpg", image)
            image_bytes = encoded_jpg.tobytes() if encoded_jpg is not None else None

            AIRepository.save_inference_result(
                camera_id=camera_id,
                model_version=config.version,
                snapshot_path=rel_snapshot_path,
                classes_score=mapped_scores,
                total_impurity=total_impurity,
                detected_class=detected_class,
                confidence=confidence,
                image_blob=image_bytes,
                cycle_id=cycle_id,
                cycle_code=cycle_code
            )
        except Exception as e:
            logger.error(f"Error in background cycle scan frame processing for {cycle_code}: {e}")

        stop_event.wait(1.0)

    logger.info(f"Stopped background cycle scan worker for {cycle_code}")


@app.post("/cycle/start")
def start_cycle(payload: StartCycleRequest):
    config = load_config()
    result = AIRepository.start_cycle(
        camera_id=payload.camera_id,
        model_version=config.version,
        cycle_code=payload.cycle_code
    )
    cycle_code = result["cycle_code"]
    cycle_id = result.get("id")

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
            args=(cycle_code, payload.camera_id, cycle_id, stop_event),
            daemon=True,
            name=f"cycle-scan-{cycle_code}"
        )
        _active_cycle_workers[cycle_code] = (stop_event, thread)
        thread.start()

    return {"status": "ok", "cycle": result}


@app.post("/cycle/stop")
def stop_cycle(payload: StopCycleRequest):
    with _workers_lock:
        if payload.cycle_code in _active_cycle_workers:
            stop_event, thread = _active_cycle_workers.pop(payload.cycle_code)
            stop_event.set()
            thread.join(timeout=2.0)

    result = AIRepository.stop_cycle(payload.cycle_code)
    if not result:
        raise HTTPException(status_code=404, detail=f"Cycle {payload.cycle_code} not found")
    return {"status": "ok", "cycle_result": result}


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

    # Map scores including Class S (Super Clean) and Indexes 0=A, 1=B, 2=D, 3=G, 4=M, 5=T
    mapped_scores = {
        "S": round(float(classes.get("S", 0.0)), 2),
        "A": round(float(classes.get("A", classes.get("daun", 0.0))), 2),
        "B": round(float(classes.get("B", classes.get("pucuk", 0.0))), 2),
        "D": round(float(classes.get("D", 0.0)), 2),
        "G": round(float(classes.get("G", 0.0)), 2),
        "M": round(float(classes.get("M", 0.0)), 2),
        "T": round(float(classes.get("T", classes.get("sampah", 0.0))), 2),
    }

    daun_score = mapped_scores["A"]
    pucuk_score = mapped_scores["B"]
    sampah_score = mapped_scores["T"]
    total_impurity = round(daun_score + pucuk_score + sampah_score, 2)

    # Determine dominant detected class
    detected_class = max(mapped_scores, key=mapped_scores.get)

    if mapped_scores["T"] > 15.0 or total_impurity > 35.0:
        grade = "X"
    elif total_impurity > 20.0:
        grade = "G"
    elif total_impurity > 15.0:
        grade = "B"
    elif total_impurity > 10.0:
        grade = "D"
    elif total_impurity > 5.0:
        grade = "A"
    elif total_impurity > 2.0:
        grade = "M"
    else:
        grade = "S"

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
        cycle_code=payload.cycle_code
    )

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
        "confidence": confidence,
        "snapshot_path": rel_snapshot_path,
    }

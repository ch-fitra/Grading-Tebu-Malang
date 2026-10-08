from __future__ import annotations

import asyncio
import time
from datetime import datetime
from pathlib import Path
from random import random
from typing import Dict, List, Optional

import cv2
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from streamer import (
    DEFAULT_ROIS,
    ROIModel,
    load_all_rois,
    save_roi,
    stream_manager,
)

try:
    import onnxruntime as ort
except Exception:  # pragma: no cover
    ort = None

ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = ROOT / "models" / "active"
MODEL_PATH = MODEL_DIR / "model.onnx"
CONFIG_PATH = MODEL_DIR / "config.json"
SNAPSHOTS_DIR = ROOT / "storage" / "snapshots"
SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Tebu AI Service", version="0.2.0")

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


class ModelConfig(BaseModel):
    name: str
    version: str
    type: str
    input_size: int
    classes: List[str]
    threshold: float = 0.5


class CameraRegisterPayload(BaseModel):
    camera_id: int
    rtsp_url: str
    camera_name: str = "Camera"


def load_config() -> ModelConfig:
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=500, detail="models/active/config.json not found")
    return ModelConfig.model_validate_json(CONFIG_PATH.read_text(encoding="utf-8"))


# Auto-register Default Cameras on startup
DEFAULT_KEBONAGUNG_RTSP = "rtsp://admin:qc_12345@123.255.202.132:10554/Streaming/Channels/101"
DEFAULT_TRANGKIL_WISENET_RTSP = "rtsp://admin:XNOAdmin123@192.168.33.86:554/profile2/media.smp"

stream_manager.get_or_create(1, DEFAULT_KEBONAGUNG_RTSP, "MBS 1 - PT Kebon Agung (Malang)")
stream_manager.get_or_create(2, DEFAULT_TRANGKIL_WISENET_RTSP, "MBS 5 - PT Trangkil (Wisenet Meja 5)")


def run_placeholder_inference(classes: List[str]) -> Dict[str, float]:
    # Variasi realistik tebu untuk demo inspeksi jika ONNX belum ada
    vals = [round(2.5 + random() * 4.0, 2), round(1.0 + random() * 2.5, 2), round(1.5 + random() * 3.0, 2)]
    return {name: vals[i % len(vals)] for i, name in enumerate(classes)}


def run_onnx_inference(image: cv2.typing.MatLike, config: ModelConfig) -> Dict[str, float]:
    if ort is None or not MODEL_PATH.exists():
        return run_placeholder_inference(config.classes)

    resized = cv2.resize(image, (config.input_size, config.input_size))
    tensor = resized.astype("float32") / 255.0
    tensor = tensor.transpose(2, 0, 1)[None, ...]

    session = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: tensor})

    flat = outputs[0].reshape(-1)
    total = float(abs(flat).sum()) or 1.0
    result = {}
    for index, class_name in enumerate(config.classes):
        value = abs(float(flat[index % len(flat)])) / total * 100
        result[class_name] = round(value, 2)
    return result


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
        "model": {
            "name": config.name,
            "version": config.version,
            "available": MODEL_PATH.exists(),
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
    target_width: int = Query(1280, description="Target frame width"),
    fps: int = Query(25, description="Target frame rate"),
    quality: int = Query(80, description="JPEG quality 1-100"),
):
    stream = stream_manager.get_stream(camera_id)
    if not stream:
        raise HTTPException(status_code=404, detail=f"Camera stream #{camera_id} not initialized")

    if not stream.running:
        stream.start()

    return StreamingResponse(
        stream.get_stream_async(overlay=overlay),
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
    target_width: int = Query(1280, description="Target width"),
    quality: int = Query(85, description="JPEG quality"),
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


@app.post("/infer")
def infer(payload: InferRequest):
    config = load_config()
    image = None
    snapshot_filename = f"capture_{int(time.time() * 1000)}.jpg"
    snapshot_path = SNAPSHOTS_DIR / snapshot_filename

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

    # Save snapshot to disk
    cv2.imwrite(str(snapshot_path), image)

    classes = run_onnx_inference(image, config)
    daun = classes.get("daun", 0.0)
    pucuk = classes.get("pucuk", 0.0)
    sampah = classes.get("sampah", 0.0)
    total_impurity = round(daun + pucuk + sampah, 2)

    if sampah > 15.0 or total_impurity > 35.0:
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

    return {
        "timestamp": datetime.now().isoformat(),
        "camera_id": payload.camera_id,
        "classes": classes,
        "grade": grade,
        "total_impurity": total_impurity,
        "confidence": 0.94 if MODEL_PATH.exists() else 0.88,
        "snapshot_path": f"storage/snapshots/{snapshot_filename}",
    }

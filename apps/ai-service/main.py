from __future__ import annotations

import os
import hmac
import hashlib
import logging
import json
import time
import threading
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Literal
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

import cv2
from fastapi import FastAPI, HTTPException, Query, Response, Header, Request as FastAPIRequest
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from streamer import DEFAULT_ROIS, ROIModel, load_all_rois, invalidate_rois, save_roi, stream_manager
from db.repository import AIRepository
from inference import grading_model, frame_model
from grading_runtime import CameraGrading

logger = logging.getLogger("camera_service")
AI_SERVICE_DIR = Path(__file__).resolve().parent
ROOT = AI_SERVICE_DIR.parents[1]
SNAPSHOTS_DIR = Path(os.getenv("AI_SNAPSHOTS_DIR", str(AI_SERVICE_DIR / "storage" / "snapshots")))
if not SNAPSHOTS_DIR.is_absolute():
    SNAPSHOTS_DIR = ROOT / SNAPSHOTS_DIR
SNAPSHOTS_DIR = SNAPSHOTS_DIR.resolve()
SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
controllers = {}

def controller(camera_id):
    # Registry creation is protected across concurrent FastAPI worker threads.
    with controller_lock:
        if camera_id not in controllers:
            controllers[camera_id] = CameraGrading(camera_id, SNAPSHOTS_DIR)
        return controllers[camera_id]

controller_lock = threading.RLock()
AI_MESSAGE = "Model grading resmi Malang"

@asynccontextmanager
async def lifespan(app: FastAPI):
    for model in (grading_model, frame_model):
        try:
            model.load()
        except Exception:
            logger.exception("Model resmi gagal dimuat: %s", model.path.name)
    try:
        AIRepository.sync_application_cameras()
        for camera in AIRepository.get_active_cameras():
            if camera.get("rtsp_url"):
                stream_manager.get_or_create(camera["id"], camera["rtsp_url"], camera["name"])
    except Exception:
        logger.exception("Konfigurasi kamera belum tersedia")
    try:
        yield
    finally:
        for runtime in list(controllers.values()):
            try:
                runtime.shutdown()
            except Exception:
                logger.exception("Gagal menyelesaikan siklus saat shutdown")
        stream_manager.stop_all()

app = FastAPI(title="Tebu Camera Service", version="1.0.0", lifespan=lifespan)

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


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {
        "status": "ok", "service": "ai-service", "installation": "malang",
        "ai_status": "ready" if grading_model.model is not None else "error", "message": grading_model.error or AI_MESSAGE,
        "capabilities": {"conveyor_empty": False, "auto_cycle": grading_model.model is not None and frame_model.model is not None, "independent_visual_similarity": False},
        "model": grading_model.status(), "frame_model": frame_model.status(),
        "cameras": {str(camera_id): {"live": stream.is_connected and time.time() - stream.last_frame_time < 4.0,
                                   "fps": round(stream.fps, 1) if stream.is_connected and time.time() - stream.last_frame_time < 4.0 else 0.0}
                    for camera_id, stream in list(stream_manager.streams.items())},
    }


class CameraRegisterPayload(BaseModel):
    camera_id: int
    rtsp_url: str
    camera_name: str = "Camera"


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
    roi_target: Literal["grading", "incoming"] = Query("grading", description="Area ROI untuk snapshot crop"),
    target_width: int = Query(1280, ge=1, le=4096, description="Target width"),
    quality: int = Query(85, ge=1, le=100, description="JPEG quality"),
):
    stream = stream_manager.get_stream(camera_id)
    if not stream:
        raise HTTPException(status_code=404, detail=f"Camera stream #{camera_id} not found")

    if crop_roi or roi_target == "incoming":
        all_rois = load_all_rois()
        roi = all_rois.get(camera_id)
        try:
            frame = stream.get_roi_crop(roi, target=roi_target)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
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
    # Older clients only know the grading rectangle. Keep the incoming region
    # unless the caller explicitly provides it (null removes it).
    existing = load_all_rois().get(camera_id)
    if "incoming" not in payload.model_fields_set and existing:
        payload.incoming = existing.incoming
    save_roi(payload)
    return {"status": "ok", "roi": payload}


@app.post("/cameras/register")
def register_camera(payload: CameraRegisterPayload):
    AIRepository.register_camera(payload.camera_id, payload.rtsp_url, payload.camera_name)
    invalidate_rois()
    stream = stream_manager.get_or_create(payload.camera_id, payload.rtsp_url, payload.camera_name)
    return {
        "status": "ok",
        "camera_id": payload.camera_id,
        "connected": stream.is_connected,
    }


def _authorized_cameras(authorization: Optional[str], permission: Optional[str] = None, operator_only: bool = False):
    """Reuse the API's session and factory access checks; never trust UI permissions."""
    base = os.getenv("SUGARCANE_API_URL", f"http://127.0.0.1:{os.getenv('API_PORT', os.getenv('BACKEND_PORT', '4111'))}").rstrip("/")
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


@app.delete("/cameras/{camera_id}")
def deactivate_camera(camera_id: int):
    AIRepository.deactivate_camera(camera_id)
    invalidate_rois()
    stream = stream_manager.streams.pop(camera_id, None)
    if stream:
        stream.stop()
    return {"status": "ok"}


class AutoPayload(BaseModel):
    enabled: bool


@app.get("/cycle/auto/{camera_id}")
def get_auto_mode(camera_id: int, authorization: Optional[str] = Header(None)):
    _authorize_auto(camera_id, authorization)
    return controller(camera_id).status()


@app.put("/cycle/auto/{camera_id}")
def set_auto_mode(camera_id: int, payload: AutoPayload, authorization: Optional[str] = Header(None)):
    _authorize_auto(camera_id, authorization, write=True)
    try:
        return controller(camera_id).set_enabled(payload.enabled)
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc


class CapturePayload(BaseModel):
    camera_id: int


class StartPayload(CapturePayload):
    truck_code: str = "Siklus Tebu"
    notes: str = ""


class StopPayload(CapturePayload):
    cycle_code: str


@app.post("/infer")
def infer(payload: CapturePayload, authorization: Optional[str] = Header(None)):
    _authorize_auto(payload.camera_id, authorization, write=True)
    runtime = controller(payload.camera_id)
    try:
        with runtime.lock:
            if runtime.enabled or runtime.cycle_code:
                raise HTTPException(409, "Kamera sedang digunakan oleh siklus")
            return runtime.capture()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Capture gagal")
        raise HTTPException(503, f"Kesalahan teknis capture: {exc}") from exc


@app.post("/cycle/start")
def start_cycle(payload: StartPayload, authorization: Optional[str] = Header(None)):
    _authorize_auto(payload.camera_id, authorization, write=True)
    try:
        code = controller(payload.camera_id).start(payload.truck_code, payload.notes)
        return {"cycle_code": code}
    except Exception as exc:
        raise HTTPException(503, f"Kesalahan teknis siklus: {exc}") from exc


@app.post("/cycle/stop")
def stop_cycle(payload: StopPayload, authorization: Optional[str] = Header(None)):
    _authorize_auto(payload.camera_id, authorization, write=True)
    try:
        controller(payload.camera_id).finish(payload.cycle_code)
        return {"cycle_code": payload.cycle_code}
    except Exception as exc:
        raise HTTPException(503, f"Kesalahan teknis siklus: {exc}") from exc

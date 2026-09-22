from datetime import datetime
from pathlib import Path
from random import random
from typing import Dict, List

import cv2
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

try:
    import onnxruntime as ort
except Exception:  # pragma: no cover - optional during early setup
    ort = None


ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = ROOT / "models" / "active"
MODEL_PATH = MODEL_DIR / "model.onnx"
CONFIG_PATH = MODEL_DIR / "config.json"

app = FastAPI(title="Tebu AI Service", version="0.1.0")


class InferRequest(BaseModel):
    image_path: str
    camera_id: int | None = None


class ModelConfig(BaseModel):
    name: str
    version: str
    type: str
    input_size: int
    classes: List[str]
    threshold: float = 0.5


def load_config() -> ModelConfig:
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=500, detail="models/active/config.json not found")
    return ModelConfig.model_validate_json(CONFIG_PATH.read_text(encoding="utf-8"))


def run_placeholder_inference(classes: List[str]) -> Dict[str, float]:
    return {name: round(random() * 10, 2) for name in classes}


def run_onnx_inference(image_path: Path, config: ModelConfig) -> Dict[str, float]:
    if ort is None or not MODEL_PATH.exists():
        return run_placeholder_inference(config.classes)

    image = cv2.imread(str(image_path))
    if image is None:
        raise HTTPException(status_code=400, detail=f"Image not readable: {image_path}")

    resized = cv2.resize(image, (config.input_size, config.input_size))
    tensor = resized.astype("float32") / 255.0
    tensor = tensor.transpose(2, 0, 1)[None, ...]

    session = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: tensor})

    # Adapter awal: model segmentation final bisa mengganti mapping ini sesuai kontrak output.
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
    return {
        "status": "ok",
        "service": "ai-service",
        "model": {
            "name": config.name,
            "version": config.version,
            "available": MODEL_PATH.exists(),
        },
    }


@app.post("/infer")
def infer(payload: InferRequest):
    config = load_config()
    image_path = Path(payload.image_path)
    if not image_path.is_absolute():
        image_path = ROOT / image_path

    classes = run_onnx_inference(image_path, config)
    return {
        "timestamp": datetime.now().isoformat(),
        "camera_id": payload.camera_id,
        "classes": classes,
        "confidence": 0.91 if MODEL_PATH.exists() else 0.65,
    }

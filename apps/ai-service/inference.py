"""Pinned official checkpoints. Grading decisions are exclusively logit argmax."""
from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path

import cv2
import numpy as np

ACTIVE = Path(__file__).resolve().parent / "models" / "active"
CLASSES = ["ATPSD", "Akar Tanah", "Daduk", "Kocok Air", "MBS", "MBS Bintang",
           "MBS Plus", "Non MBS", "Sogolan Pucuk", "Tebu Muda", "Terbakar"]
FRAME_CLASSES = ["full_frame_sugarcane", "not_full_frame"]
GRADING_HASH = "062a0ff2ab4413052b746d3764d24140476f0f475c54921c864d92590dac07d1"
FRAME_HASH = "d3647a56066754b6900960e16193b16c45a12c0aa92522f50aaf8279a39ec7b6"


def softmax(logits):
    values = np.asarray(logits, dtype=np.float64)
    values = np.exp(values - np.max(values))
    return values / values.sum()


def input_batch(bgr):
    if bgr is None or bgr.ndim != 3 or bgr.shape[2] != 3 or not bgr.size:
        raise ValueError("Frame RGB/BGR tidak tersedia atau tidak valid")
    rgb = cv2.cvtColor(cv2.resize(bgr, (224, 224)), cv2.COLOR_BGR2RGB)
    return rgb.astype(np.float32)[None, ...]  # 0..255; rescaling belongs to checkpoint


class OfficialModel:
    def __init__(self, filename, digest, classes, config_name, cropped=False):
        self.path = ACTIVE / filename
        self.digest = digest
        self.classes = classes
        self.config_name = config_name
        self.cropped = cropped
        self.model = None
        self.error = "Model belum dimuat"
        self.lock = threading.RLock()

    def load(self):
        with self.lock:
            self.model = None
            try:
                with self.path.open("rb") as handle:
                    actual = hashlib.file_digest(handle, "sha256").hexdigest()
                if actual != self.digest:
                    raise ValueError(f"SHA-256 tidak cocok: {self.path.name}: {actual}")
                config = json.loads((ACTIVE / self.config_name).read_text(encoding="utf-8"))
                if config["classes"] != self.classes or config["input_size"] != 224 or config["input_color"] != "rgb":
                    raise ValueError("Kontrak konfigurasi model tidak sesuai")
                if config.get("output_activation") != "linear":
                    raise ValueError("Checkpoint harus dideklarasikan sebagai logits linear")
                if self.cropped and config.get("threshold") != 0.70:
                    raise ValueError("Threshold frame harus 0.70")
                if not self.cropped and "threshold" in config:
                    raise ValueError("Threshold penolakan grading dilarang")
                import keras
                model = keras.models.load_model(self.path, compile=False, safe_mode=True)
                if tuple(model.input_shape) != (None, 224, 224, 3) or tuple(model.output_shape) != (None, len(self.classes)):
                    raise ValueError("Bentuk input/output checkpoint tidak sesuai")
                scales = [layer for layer in model.layers if isinstance(layer, keras.layers.Rescaling)]
                if len(scales) != 1 or not np.isclose(scales[0].scale, 1 / 255) or scales[0].offset != 0:
                    raise ValueError("Rescaling internal tidak sesuai")
                if self.cropped and len([l for l in model.layers if isinstance(l, keras.layers.Cropping2D)]) != 1:
                    raise ValueError("Cropping internal model frame tidak sesuai")
                if model.layers[-1].get_config().get("activation") != "linear":
                    raise ValueError("Output checkpoint bukan logits")
                self.model = model
                self.error = None
                self.logits(np.zeros((224, 224, 3), dtype=np.uint8))
            except Exception as exc:
                self.model = None
                self.error = str(exc)
                raise

    def logits(self, bgr):
        with self.lock:
            if self.model is None:
                raise RuntimeError(self.error)
            result = np.asarray(self.model(input_batch(bgr), training=False), dtype=np.float32)
            if result.shape != (1, len(self.classes)) or not np.isfinite(result).all():
                raise RuntimeError("Output model tidak valid")
            return result[0]

    def status(self):
        return {"available": self.model is not None, "sha256": self.digest if self.model is not None else None,
                "error": self.error, "classes": self.classes, "name": self.path.name, "version": "malang-official-1"}


grading_model = OfficialModel("model_sugarcane_malang.keras", GRADING_HASH, CLASSES, "config.json")
frame_model = OfficialModel("model_frame_sugarcane.keras", FRAME_HASH, FRAME_CLASSES, "frame_config.json", cropped=True)


def grade(bgr):
    logits = grading_model.logits(bgr)
    index = int(np.argmax(logits))
    # The legacy NOT NULL confidence column stores actual softmax probability,
    # never similarity, a calibrated score, a filter, or a different decision.
    return {"grade": CLASSES[index], "confidence": float(softmax(logits)[index]),
            "model_output": {"sha256": GRADING_HASH, "logits": logits.tolist(), "class_index": index,
                             "confidence_kind": "softmax_probability", "classes": CLASSES}}


def frame_trigger(full_bgr):
    logits = frame_model.logits(full_bgr)  # full camera frame; no external crop
    probabilities = softmax(logits)
    return bool(np.argmax(logits) == 0 and probabilities[0] >= 0.70), float(probabilities[0])

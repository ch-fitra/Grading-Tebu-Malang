"""Acceptance is separate from the model's candidate scores."""
import json
import math
from pathlib import Path

UNKNOWN_GRADE = "Belum Dikenali"


def grading_threshold():
    config = Path(__file__).resolve().parent / "models/active/config.json"
    value = float(json.loads(config.read_text(encoding="utf-8"))["threshold"])
    if not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError("Threshold grading tidak valid")
    return value


def accepted_grade(candidate, confidence, threshold):
    return candidate if candidate and math.isfinite(confidence) and confidence >= threshold else UNKNOWN_GRADE


def apply_history_policy(item, threshold):
    """Interpret a saved candidate without modifying the historical database row."""
    candidate = item.get("candidateGrade") or item["grade"]
    scores = item.get("classScores") or {}
    if candidate == UNKNOWN_GRADE and scores:
        candidate = max(scores, key=scores.get)
    item["candidateGrade"] = candidate
    item["confidenceThreshold"] = threshold
    item["grade"] = accepted_grade(item["grade"], item["confidence"], threshold)
    item["predictionAccepted"] = item["grade"] != UNKNOWN_GRADE
    return item

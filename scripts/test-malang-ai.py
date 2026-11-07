"""Local DB/model checks. Never opens a camera or starts a grading cycle."""
import os
import sys
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "ai-service"))
os.environ["KERAS_BACKEND"] = "torch"
from db.connection import get_ai_db_connection, get_auth_db_connection
from db.migrations import run_ai_migrations
from db.repository import AIRepository
import numpy as np

run_ai_migrations()
AIRepository.sync_application_cameras()
with get_auth_db_connection() as connection:
    with connection.cursor() as cursor:
        cursor.execute("SELECT id,rtsp_url,name FROM cameras WHERE station=2")
        camera_id, camera_rtsp, camera_name = cursor.fetchone()
with get_ai_db_connection() as connection:
    with connection.cursor() as cursor:
        cursor.execute("SELECT roi_config FROM ai_cameras WHERE id=%s", (camera_id,))
        roi = cursor.fetchone()[0]
assert roi["camera_id"] == camera_id
assert (roi["x"], roi["y"], roi["width"], roi["height"]) == (0.49, 0.14, 0.32, 0.72)
print("PASS: station 2 ROI mapped to actual camera ID", camera_id)

# Check sync never overwrites an operator calibration.
custom = {**roi, "x": 0.57}
try:
    assert AIRepository.update_camera_roi(camera_id, custom)
    AIRepository.sync_application_cameras()
    assert AIRepository.get_camera_roi(camera_id)["x"] == 0.57
    AIRepository.register_camera(camera_id, camera_rtsp, camera_name)
    assert AIRepository.get_camera_roi(camera_id)["x"] == 0.57
    # Upgrade a legacy calibrated rectangle without resetting its coordinates.
    legacy = {key: value for key, value in custom.items() if key != "incoming"}
    assert AIRepository.update_camera_roi(camera_id, legacy)
    AIRepository.sync_application_cameras()
    upgraded = AIRepository.get_camera_roi(camera_id)
    assert upgraded["x"] == 0.57
    assert upgraded["incoming"]["points"][0] == {"x": 0.106, "y": 0.052}
    # Explicitly removing the incoming region must survive synchronization.
    assert AIRepository.update_camera_roi(camera_id, {**custom, "incoming": None})
    AIRepository.sync_application_cameras()
    assert AIRepository.get_camera_roi(camera_id)["incoming"] is None
finally:
    AIRepository.update_camera_roi(camera_id, roi)
print("PASS: calibrated ROI survives camera synchronization")
from streamer import load_all_rois, invalidate_rois
assert load_all_rois()[camera_id].x == roi["x"]
AIRepository.deactivate_camera(camera_id)
invalidate_rois()
assert camera_id not in load_all_rois()
AIRepository.sync_application_cameras()
invalidate_rois()
assert load_all_rois()[camera_id].x == roi["x"]
print("PASS: ROI reloads after disabling and enabling the camera")

result = subprocess.run([sys.executable, "-c", "import sys; sys.path.insert(0, 'apps/ai-service'); import db.connection"],
                        cwd=ROOT, env={**os.environ, "DATABASE_URL": os.environ["DATABASE_URL"].replace("/sugarcane_malang", "/sugarcane_trangkil")},
                        capture_output=True)
assert result.returncode != 0
assert b"database khusus Malang" in result.stderr
print("PASS: Python rejects Trangkil database")

import main
expected_classes = ["ATPSD", "Akar Tanah", "Daduk", "Kocok Air", "MBS", "MBS Bintang", "MBS Plus", "Non MBS", "Sogolan Pucuk", "Tebu Muda", "Terbakar"]
config = main.load_config()
assert config.classes == expected_classes
for index, label in enumerate(expected_classes):
    logits = np.full((1, 11), -20.0)
    logits[0, index] = 20.0
    scores, confidence = main.classification_measurement(logits, config)
    mapped, total, detected, measured = main.measurement_result(scores, config)
    assert list(mapped) == expected_classes
    assert detected == label and config.classes.index(detected) == index
    assert confidence > 0.99 and total is None and measured is False
print("PASS: every official class index 0-10 maps correctly without legacy conversion")
with get_ai_db_connection() as connection:
    try:
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO ai_inference_results(detected_class,classes_score) VALUES(%s,%s)", ("Sogolan Pucuk", json.dumps({"Sogolan Pucuk": 100})))
            cursor.execute("INSERT INTO ai_results(cycle_code,majority_class) VALUES(%s,%s)", ("test-malang-label-width", "Sogolan Pucuk"))
    finally:
        connection.rollback()
print("PASS: longest class label persists in frame and cycle tables (rolled back)")
for config, expected in [(main.load_config(), set(main.load_config().classes)),
                         (main.load_frame_config(), {"full_frame_sugarcane", "not_full_frame"})]:
    scores, confidence = main.run_onnx_inference(np.zeros((360, 640, 3), dtype=np.uint8), config)
    assert set(scores) == expected
    assert all(np.isfinite(value) for value in scores.values())
    assert np.isfinite(confidence)
    print("PASS: model loads and returns expected classes:", config.name)
print("These checks verify execution, not accuracy on Malang field images.")

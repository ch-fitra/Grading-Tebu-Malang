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
assert (roi["x"], roi["y"], roi["width"], roi["height"]) == (0.58, 0.08, 0.39, 0.62)
print("PASS: station 2 ROI mapped to actual camera ID", camera_id)

# Check sync never overwrites an operator calibration.
custom = {**roi, "x": 0.57}
try:
    assert AIRepository.update_camera_roi(camera_id, custom)
    AIRepository.sync_application_cameras()
    assert AIRepository.get_camera_roi(camera_id)["x"] == 0.57
    AIRepository.register_camera(camera_id, camera_rtsp, camera_name)
    assert AIRepository.get_camera_roi(camera_id)["x"] == 0.57
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
for config, expected in [(main.load_config(), {"A", "B", "D", "G", "M", "T"}),
                         (main.load_frame_config(), {"full_frame_sugarcane", "not_full_frame"})]:
    scores, confidence = main.run_onnx_inference(np.zeros((360, 640, 3), dtype=np.uint8), config)
    assert set(scores) == expected
    assert all(np.isfinite(value) for value in scores.values())
    assert np.isfinite(confidence)
    print("PASS: model loads and returns expected classes:", config.name)
print("These checks verify execution, not accuracy on Malang field images.")

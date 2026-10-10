import asyncio
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from fastapi import HTTPException
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "ai-service"))
import main
from streamer import CameraStream, ROIModel


class AIRegressionTests(unittest.TestCase):
    def test_import_does_not_start_camera_workers(self):
        self.assertEqual(main.stream_manager.streams, {})

    def test_missing_model_cannot_generate_random_grades(self):
        config = main.load_config().model_copy(update={"model_path": "models/active/missing-regression.onnx"})
        with self.assertRaises(HTTPException) as error:
            main.run_onnx_inference(np.zeros((20, 20, 3), dtype=np.uint8), config)
        self.assertEqual(error.exception.status_code, 503)

    def test_roi_bounds_are_validated(self):
        for values in ({"x": -0.1}, {"width": 0}, {"x": 0.9, "width": 0.8}, {"height": float("nan")}):
            with self.assertRaises(ValidationError):
                ROIModel(**values)

    def test_snapshot_works_without_a_video_subscriber(self):
        stream = CameraStream(9, "rtsp://unused", "regression")
        stream.latest_raw_frame = np.full((100, 200, 3), 150, dtype=np.uint8)
        stream.last_frame_time = time.time()
        self.assertEqual(stream.subscribers, 0)
        jpeg = stream.get_jpeg_bytes(overlay=False, target_width=80, quality=60)
        image = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(image.shape[:2], (40, 80))

    def test_offline_snapshot_returns_no_image(self):
        stream = CameraStream(9, "rtsp://unused")
        self.assertEqual(stream.get_jpeg_bytes(), b"")

    def test_stale_encoded_frames_are_not_reported_as_live(self):
        stream = CameraStream(9, "rtsp://unused")
        stream.is_connected = True
        stream.last_frame_time = time.time() - 10
        stream.latest_overlay_jpeg = b"stale"
        jpeg, frame_id = asyncio.run(stream.get_next_jpeg_async(timeout=0))
        self.assertNotEqual(jpeg, b"stale")
        self.assertEqual(frame_id, -1)

    def test_model_path_cannot_escape_model_directory(self):
        config = main.load_config().model_copy(update={"model_path": "../outside.onnx"})
        with self.assertRaises(HTTPException):
            main.configured_model_path(config)

    def test_failed_activation_preserves_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "config.json"
            original = main.load_config().model_dump_json()
            path.write_text(original)
            with patch.object(main, "CONFIG_PATH", path):
                with self.assertRaises(HTTPException):
                    main.activate_model(main.ActivateModelPayload(name="missing", version="2", model_path="models/active/missing-regression.onnx"))
            self.assertEqual(path.read_text(), original)

    def test_snapshot_filenames_are_unique_and_timestamp_has_timezone(self):
        class FakeStream:
            def get_raw_frame(self):
                return np.zeros((20, 20, 3), dtype=np.uint8)

        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(main, "SNAPSHOTS_DIR", Path(temporary)), patch.object(main.stream_manager, "get_stream", return_value=FakeStream()), patch.object(main, "run_onnx_inference", return_value=({"daun": 1.0, "pucuk": 0.0, "sampah": 0.0}, 0.9)):
                payload = main.InferRequest(camera_id=9, crop_roi=False)
                a, b = main.infer(payload), main.infer(payload)
                self.assertNotEqual(a["snapshot_path"], b["snapshot_path"])
                self.assertTrue(a["timestamp"].endswith("+00:00"))
                self.assertEqual(len(list(Path(temporary).glob("*.jpg"))), 2)

    def test_segmentation_counts_every_pixel_and_derives_confidence(self):
        masks = np.array([[[[0.8, 0.1], [0.1, 0.1]], [[0.1, 0.9], [0.1, 0.2]], [[0.1, 0.1], [0.7, 0.1]]]])
        config = main.ModelConfig(name="test", version="1.0", type="segmentation", input_size=224, classes=["daun", "pucuk", "sampah"])
        classes, confidence = main.segmentation_measurement(masks, config)
        self.assertEqual(classes, {"daun": 25.0, "pucuk": 25.0, "sampah": 25.0})
        self.assertAlmostEqual(confidence, 0.65)

    def test_segmentation_rejects_unknown_shapes_and_invalid_probabilities(self):
        config = main.ModelConfig(name="test", version="1.0", type="segmentation", input_size=224, classes=["daun", "pucuk", "sampah"])
        for output in (np.ones((1, 3)), np.ones((1, 4, 2, 2)), np.full((1, 3, 2, 2), np.nan), np.full((1, 3, 2, 2), 5)):
            with self.assertRaises(HTTPException):
                main.segmentation_measurement(output, config)


if __name__ == "__main__":
    unittest.main()

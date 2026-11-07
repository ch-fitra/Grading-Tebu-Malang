"""Offline geometry, rendering and API checks; never opens a CCTV or starts cycles."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "ai-service"))

import cv2
import numpy as np
from pydantic import ValidationError
from streamer import CameraStream, IncomingROI, ROIModel, crop_incoming_roi


class IncomingROITest(unittest.TestCase):
    def setUp(self):
        self.roi = ROIModel(camera_id=8, **json.loads(
            (ROOT / "apps/ai-service/models/malang_roi.json").read_text(encoding="utf-8")))

    def test_polygon_matches_reference_at_multiple_resolutions(self):
        for width, height in [(1920, 1080), (1280, 720), (640, 360)]:
            frame = np.full((height, width, 3), 180, np.uint8)
            crop = crop_incoming_roi(frame, self.roi.incoming)
            self.assertGreater(crop.shape[0], height * .35)
            self.assertGreater(crop.shape[1], width * .24)
            self.assertTrue(np.all(crop[crop.shape[0] // 2, crop.shape[1] // 2] == 180))
            # The bottom left corner is outside the tapered polygon.
            self.assertTrue(np.all(crop[-1, 0] == 0))
            self.assertTrue(np.all(frame == 180))

    def test_reject_invalid_polygons(self):
        for points in [[(0, 0), (1, 1), (1, 0), (0, 1)],
                       [(0, 0), (.1, .1), (.2, .2), (.3, .3)],
                       [(-.1, 0), (1, 0), (1, 1), (0, 1)]]:
            with self.assertRaises(ValidationError):
                IncomingROI(points=[{"x": x, "y": y} for x, y in points])

    def test_legacy_config_is_accepted(self):
        self.assertIsNone(ROIModel(camera_id=1).incoming)

    def test_overlay_preserves_both_regions(self):
        stream = CameraStream(8, "unused", "MBS 2")
        frame = np.full((720, 1280, 3), 180, np.uint8)
        with patch("streamer.load_all_rois", return_value={8: self.roi}):
            jpeg = stream._render_and_encode(frame, overlay=True, target_width=1280, quality=95)
        rendered = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        self.assertGreater(rendered[150, 280].mean(), 170)  # Incoming interior
        self.assertGreater(rendered[170, 700].mean(), 170)  # Grading interior
        self.assertLess(rendered[400, 1150].mean(), 90)  # Scrim outside both
        self.assertTrue(np.all(frame == 180))
        with patch.object(stream, "get_raw_frame", return_value=frame):
            np.testing.assert_array_equal(stream.get_roi_crop(self.roi), frame[100:619, 627:1036])
            self.assertLess(stream.get_roi_crop(self.roi, target="incoming").shape[1], 320)
            with self.assertRaises(ValueError):
                stream.get_roi_crop(ROIModel(camera_id=8), target="incoming")

    def test_api_selection_and_legacy_save(self):
        import main
        from fastapi import HTTPException
        stream = CameraStream(8, "unused")
        frame = np.full((720, 1280, 3), 180, np.uint8)
        with patch.object(main.stream_manager, "get_stream", return_value=stream), \
             patch.object(stream, "get_raw_frame", return_value=frame), \
             patch.object(main, "load_all_rois", return_value={8: self.roi}), \
             patch.object(main, "save_roi") as save:
            response = main.snapshot(8, roi_target="incoming", crop_roi=False, quality=95)
            self.assertEqual(response.status_code, 200)
            crop = cv2.imdecode(np.frombuffer(response.body, np.uint8), cv2.IMREAD_COLOR)
            self.assertLess(crop.shape[1], 320)
            self.assertEqual(main.update_roi(8, ROIModel(camera_id=8, x=.2))["status"], "ok")
            self.assertEqual(save.call_args.args[0].incoming, self.roi.incoming)
            self.assertEqual(main.update_roi(8, ROIModel(camera_id=8, incoming=None))["status"], "ok")
            self.assertIsNone(save.call_args.args[0].incoming)
        with patch.object(main.stream_manager, "get_stream", return_value=stream), \
             patch.object(stream, "get_raw_frame", return_value=frame), \
             patch.object(main, "load_all_rois", return_value={}):
            with self.assertRaises(HTTPException) as error:
                main.snapshot(8, roi_target="incoming", crop_roi=False, quality=95)
            self.assertEqual(error.exception.status_code, 422)

    def test_auto_uses_incoming_crop_and_keeps_cycle_gate(self):
        import main
        from auto_cycle import AutoCycleController
        import time
        stream = CameraStream(8, "unused")
        stream.is_connected = True
        stream.latest_raw_frame = np.full((720, 1280, 3), 180, np.uint8)
        stream.raw_frame_id = 0
        expected = crop_incoming_roi(stream.latest_raw_frame, self.roi.incoming)
        now = [0.0]
        occupied = [True]
        def predict(image, config):
            np.testing.assert_array_equal(image, expected)
            return {"full_frame_sugarcane": 99 if occupied[0] else 1,
                    "not_full_frame": 1 if occupied[0] else 99}, .99
        start = Mock(side_effect=lambda: ("test-cycle", now[0] + 30))
        finish = Mock()
        controller = AutoCycleController(8, lambda previous: main._sample_full_frame(8, previous),
                                         start, finish, clock=lambda: now[0])
        controller.enabled = True  # Tick manually; no worker thread.
        with patch.object(main.stream_manager, "get_stream", return_value=stream), \
             patch.object(main, "load_all_rois", return_value={8: self.roi}), \
             patch.object(main, "load_frame_config", return_value=main.load_frame_config().model_copy(update={"frame_input": "incoming_roi"})), \
             patch.object(main, "run_onnx_inference", side_effect=predict):
            for second in range(4):
                now[0] = float(second)
                stream.raw_frame_id += 1
                stream.last_frame_time = time.time()
                controller.tick()
            self.assertEqual(start.call_count, 1)
            self.assertEqual(controller.phase, "grading")
            now[0] = 33.0
            controller.tick()
            finish.assert_called_once_with("test-cycle")
            for second in range(34, 38):
                now[0] = float(second)
                stream.raw_frame_id += 1
                stream.last_frame_time = time.time()
                controller.tick()
            self.assertEqual(start.call_count, 1)  # Same load cannot retrigger.
            occupied[0] = False
            for second in range(38, 42):
                now[0] = float(second)
                stream.raw_frame_id += 1
                stream.last_frame_time = time.time()
                controller.tick()
            occupied[0] = True
            for second in range(42, 46):
                now[0] = float(second)
                stream.raw_frame_id += 1
                stream.last_frame_time = time.time()
                controller.tick()
            self.assertEqual(start.call_count, 2)
            previous = (id(stream), stream.raw_frame_id)
            with patch.object(main, "run_onnx_inference") as inference:
                self.assertEqual(main._sample_full_frame(8, previous), (previous, None, None))
                stream.last_frame_time = time.time() - 3
                self.assertEqual(main._sample_full_frame(8, None), (previous, None, None))
                inference.assert_not_called()
        with patch.object(main, "load_all_rois", return_value={}):
            self.assertIs(main._frame_detection_image(1, stream.latest_raw_frame), stream.latest_raw_frame)

    def test_embedded_roi_receives_full_frame(self):
        import main
        image = np.full((1080, 1920, 3), 180, np.uint8)
        config = main.load_frame_config().model_copy(update={"frame_input": "embedded_roi"})
        with patch.object(main, "load_all_rois", return_value={8: self.roi}), \
             patch.object(main, "load_frame_config", return_value=config):
            self.assertIs(main._frame_detection_image(8, image), image)
            self.assertEqual(main._detection_region(8), "incoming")


if __name__ == "__main__":
    unittest.main()

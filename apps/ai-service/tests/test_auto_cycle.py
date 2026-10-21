import sys
import threading
import time
import types
import io
import json
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from auto_cycle import AutoCycleController, FrameGate
import main


class FrameGateTests(unittest.TestCase):
    def test_three_seconds_of_continuous_full_frame(self):
        gate = FrameGate()
        for now in (0, 0.5, 1, 2, 2.99):
            self.assertFalse(gate.observe(True, now))
        self.assertTrue(gate.observe(True, 3))

    def test_partial_uncertain_and_disconnected_frames_reset_confirmation(self):
        for interrupted in (False, None):
            gate = FrameGate()
            for now in (0, 1, 2):
                gate.observe(True, now)
            gate.observe(interrupted, 2.5)
            for now in (3, 4, 5):
                self.assertFalse(gate.observe(True, now))
            self.assertTrue(gate.observe(True, 6))

    def test_long_sample_gap_never_counts_as_continuous_coverage(self):
        gate = FrameGate()
        gate.observe(True, 0)
        self.assertFalse(gate.observe(True, 4))
        self.assertEqual(gate.since, 4)

    def test_clear_gate_requires_stable_not_full_before_next_load(self):
        gate = FrameGate(waiting_clear=True)
        for now in range(6):
            self.assertFalse(gate.observe(True, now))
        for now in range(6, 10):
            self.assertFalse(gate.observe(False, now))
        self.assertFalse(gate.waiting_clear)
        for now in range(10, 13):
            self.assertFalse(gate.observe(True, now))
        self.assertTrue(gate.observe(True, 13))


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        self.frame_id = 0
        self.full = True
        self.starts = []
        self.finish = Mock()
        def sample(previous):
            self.frame_id += 1
            return self.frame_id, self.full, 0.99
        def start():
            code = f"cycle-{len(self.starts) + 1}"
            self.starts.append(code)
            return code, self.now + 30
        self.controller = AutoCycleController(1, sample, start, self.finish, clock=lambda: self.now)
        self.controller.enabled = True

    def tick(self, now, full=True):
        self.now, self.full = now, full
        self.controller.tick()

    def start_first(self):
        for now in range(4):
            self.tick(now)
        self.assertEqual(self.starts, ["cycle-1"])

    def test_auto_starts_at_three_and_finishes_after_thirty_seconds(self):
        self.start_first()
        self.tick(32.99)
        self.finish.assert_not_called()
        self.assertEqual(self.controller.status()["remaining_seconds"], 1)
        self.tick(33)
        self.finish.assert_called_once_with("cycle-1")
        self.assertEqual(self.controller.phase, "waiting_clear")

    def test_same_load_does_not_repeat_and_next_load_can_start(self):
        self.start_first()
        self.tick(33)
        for now in range(34, 41):
            self.tick(now)
        self.assertEqual(len(self.starts), 1)
        for now in range(41, 45):
            self.tick(now, full=False)
        for now in range(45, 49):
            self.tick(now)
        self.assertEqual(self.starts, ["cycle-1", "cycle-2"])

    def test_disable_saves_cycle_then_releases_manual_control(self):
        self.start_first()
        status = self.controller.set_enabled(False)
        self.finish.assert_called_once_with("cycle-1")
        self.assertFalse(status["enabled"])
        self.assertIsNone(status["cycle_code"])
        self.assertTrue(self.controller.gate.waiting_clear)

    def test_completion_failure_retries_same_cycle_without_new_start(self):
        self.start_first()
        self.finish.side_effect = [RuntimeError("database offline"), None]
        with self.assertRaises(RuntimeError):
            self.tick(33)
        self.assertEqual(self.controller.cycle_code, "cycle-1")
        self.tick(34)
        self.assertEqual(self.finish.call_count, 2)
        self.assertEqual(len(self.starts), 1)

    def test_failed_disable_keeps_manual_locked(self):
        self.start_first()
        self.finish.side_effect = RuntimeError("database offline")
        with self.assertRaises(RuntimeError):
            self.controller.set_enabled(False)
        self.assertTrue(self.controller.enabled)
        self.assertEqual(self.controller.cycle_code, "cycle-1")

    def test_duplicate_frame_cannot_confirm(self):
        self.controller.sample = lambda previous: (1, True, 0.99)
        for now in range(10):
            self.tick(now)
        self.assertEqual(self.starts, [])

    def test_uncertainty_cannot_confirm(self):
        self.controller.sample = lambda previous: (self.now, None, 0.6)
        for now in range(10):
            self.tick(now)
        self.assertEqual(self.starts, [])
        self.assertEqual(self.controller.phase, "uncertain")


class ServiceIntegrationTests(unittest.TestCase):
    def test_history_page_uses_database_total_and_checks_access(self):
        result = {"items": [], "total": 11749, "page": 101, "page_size": 10, "pages": 1175}
        with patch.object(main, "_authorized_cameras", return_value=[{"id": 1}]) as authorize, \
             patch.object(main.AIRepository, "history_page", return_value=result) as read:
            self.assertEqual(main.history_page(1, 101, 10, None, "Bearer test"), result)
            authorize.assert_called_once_with("Bearer test", "dashboard.read")
            read.assert_called_once_with(1, 101, 10, None)
            with self.assertRaises(main.HTTPException) as exc:
                main.history_page(2, 1, 10, None, "Bearer test")
            self.assertEqual(exc.exception.status_code, 403)
            with self.assertRaises(main.HTTPException) as exc:
                main.history_page(1, 1, 10, "invalid-cycle", "Bearer test")
            self.assertEqual(exc.exception.status_code, 422)
            self.assertEqual(read.call_count, 1)

    def test_history_summary_returns_full_count_and_enforces_camera_scope(self):
        with patch.object(main, "_authorized_cameras", return_value=[{"id": 1}]) as authorize, \
             patch.object(main.AIRepository, "history_summary", return_value={"total_captures": 11719}) as summary:
            result = main.history_summary("Bearer test", [1], None, None, "")
            self.assertEqual(result["total_captures"], 11719)
            authorize.assert_called_once_with("Bearer test", "history.read")
            summary.assert_called_once_with([1], None, None, "")
            with self.assertRaises(main.HTTPException) as exc:
                main.history_summary("Bearer test", [2], None, None, "")
            self.assertEqual(exc.exception.status_code, 403)
            self.assertEqual(summary.call_count, 1)

    def test_empty_camera_scope_cannot_count_other_factories(self):
        with patch.object(main, "_authorized_cameras", return_value=[]):
            result = main.history_summary("Bearer test", None, None, None, "")
            self.assertEqual(result["total_captures"], 0)

    def test_auto_controls_validate_session_factory_and_operator_permission(self):
        def response(value):
            return io.BytesIO(json.dumps(value).encode())
        with patch.object(main, "urlopen", side_effect=[response({"role": "operator", "permissions": ["inspection.write"]}), response([{"id": 1}])]):
            main._authorize_auto(1, "Bearer test-session", write=True)
        with patch.object(main, "urlopen", return_value=response({"role": "admin", "permissions": ["inspection.write"]})):
            with self.assertRaises(main.HTTPException) as exc:
                main._authorize_auto(1, "Bearer test-session", write=True)
            self.assertEqual(exc.exception.status_code, 403)
        with patch.object(main, "urlopen", side_effect=[response({"role": "operator", "permissions": ["inspection.write"]}), response([{"id": 2}])]):
            with self.assertRaises(main.HTTPException) as exc:
                main._authorize_auto(1, "Bearer test-session", write=True)
            self.assertEqual(exc.exception.status_code, 403)
        from urllib.error import HTTPError
        with patch.object(main, "urlopen", side_effect=HTTPError("http://local", 401, "Unauthorized", {}, None)):
            with self.assertRaises(main.HTTPException) as exc:
                main._authorize_auto(1, None, write=True)
            self.assertEqual(exc.exception.status_code, 401)

    def test_auto_cannot_be_enabled_during_manual_cycle(self):
        controller = AutoCycleController(1, Mock(), Mock(), Mock())
        with patch.object(main, "_authorize_auto"), \
             patch.object(main, "_auto_controller", return_value=controller), \
             patch.object(main.AIRepository, "has_running_cycle", return_value=True):
            with self.assertRaises(main.HTTPException) as exc:
                main.set_auto_mode(1, main.AutoModeRequest(enabled=True), "Bearer test-session")
            self.assertEqual(exc.exception.status_code, 409)
            self.assertFalse(controller.enabled)

    def test_frame_detector_uses_whole_raw_image_without_roi(self):
        image = np.zeros((300, 600, 3), dtype=np.uint8)
        stream = types.SimpleNamespace(is_connected=True, raw_lock=threading.Lock(), raw_frame_id=1,
                                       latest_raw_frame=image, last_frame_time=time.time())
        with patch.object(main.stream_manager, "get_stream", return_value=stream), \
             patch.object(main, "run_onnx_inference", return_value=({"full_frame_sugarcane": 95, "not_full_frame": 5}, .95)) as predict:
            frame_id, full, confidence = main._sample_full_frame(1, None)
            self.assertTrue(full)
            self.assertEqual(predict.call_args.args[0].shape, image.shape)
            self.assertEqual(main._sample_full_frame(1, frame_id), (frame_id, None, None))
            self.assertEqual(predict.call_count, 1)
            stream.last_frame_time = time.time() - 5
            self.assertIsNone(main._sample_full_frame(1, None)[1])

    def test_frame_model_class_zero_is_full_and_logits_are_softmaxed(self):
        config = main.load_frame_config()
        classes, confidence = main.classification_measurement(np.array([[8, -8]]), config)
        self.assertEqual(config.classes, ["full_frame_sugarcane", "not_full_frame"])
        self.assertGreater(classes["full_frame_sugarcane"], 99)
        self.assertGreater(confidence, .99)

    def test_manual_start_and_stop_are_rejected_during_auto(self):
        controller = types.SimpleNamespace(lock=threading.RLock(), enabled=True)
        with patch.object(main, "_auto_controller", return_value=controller):
            with self.assertRaises(main.HTTPException) as exc:
                main.start_cycle(main.StartCycleRequest(camera_id=1))
            self.assertEqual(exc.exception.status_code, 409)
        with patch.object(main, "_automatic_cycle_codes", {"auto"}):
            with self.assertRaises(main.HTTPException) as exc:
                main.stop_cycle(main.StopCycleRequest(cycle_code="auto"))
            self.assertEqual(exc.exception.status_code, 409)

    def test_grading_acquires_only_thirty_slots_and_never_runs_after_deadline(self):
        clock = types.SimpleNamespace(now=0.0)
        class Stop:
            def is_set(self): return False
            def wait(self, seconds):
                clock.now += seconds
                return False
        captures = []
        image = np.zeros((10, 20, 3), dtype=np.uint8)
        def predict(*args):
            self.assertLess(clock.now, 30)
            captures.append(clock.now)
            clock.now += .12
            return {"A": 100}, 1.0
        stream = types.SimpleNamespace(is_connected=True, get_raw_frame=lambda: image)
        with patch.object(main.time, "monotonic", side_effect=lambda: clock.now), \
             patch.object(main, "load_config", return_value=types.SimpleNamespace(version="test")), \
             patch.object(main.stream_manager, "get_stream", return_value=stream), \
             patch.object(main, "load_all_rois", return_value={}), \
             patch.object(main, "run_onnx_inference", side_effect=predict), \
             patch.object(main.cv2, "imwrite", return_value=True), \
             patch.object(main.Path, "mkdir"), \
             patch.object(main.AIRepository, "save_inference_result", return_value=1):
            main._cycle_scan_worker("deadline-test", 1, 1, Stop(), deadline=30)
        self.assertEqual(captures, list(range(30)))
        self.assertEqual(clock.now, 30)

    def test_models_are_cached_separately(self):
        candidates = [object(), object()]
        loader = Mock(side_effect=candidates)
        keras = types.SimpleNamespace(models=types.SimpleNamespace(load_model=loader))
        with patch.dict(sys.modules, {"keras": keras}), patch.object(main, "_sessions", {}):
            grade = main.model_session(main.load_config())
            frame = main.model_session(main.load_frame_config())
            self.assertIs(main.model_session(main.load_config()), grade)
            self.assertIs(main.model_session(main.load_frame_config()), frame)
            self.assertEqual(loader.call_count, 2)

    def test_auto_start_failure_rolls_back_dashboard_inspection(self):
        with patch.object(main.AIRepository, "has_running_cycle", return_value=False), \
             patch.object(main.AIRepository, "has_active_inspection", return_value=False), \
             patch.object(main.AIRepository, "create_auto_inspection"), \
             patch.object(main.AIRepository, "discard_auto_inspection") as discard, \
             patch.object(main, "_begin_cycle", side_effect=RuntimeError("camera offline")):
            with self.assertRaises(RuntimeError):
                main._start_automatic_cycle(1)
            discard.assert_called_once()

    def test_dashboard_completion_failure_does_not_release_cycle_ownership(self):
        with patch.object(main, "_automatic_cycle_codes", {"auto"}), \
             patch.object(main, "_stop_cycle", return_value={}), \
             patch.object(main.AIRepository, "complete_auto_inspection", side_effect=RuntimeError("database offline")):
            with self.assertRaises(RuntimeError):
                main._finish_automatic_cycle("auto")
            self.assertIn("auto", main._automatic_cycle_codes)


if __name__ == "__main__":
    unittest.main()

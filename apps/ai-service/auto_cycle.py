"""Server-owned automatic cycles, using observations from the configured detection area."""
from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass


@dataclass
class FrameGate:
    confirm_seconds: float = 3.0
    clear_seconds: float = 3.0
    max_gap: float = 1.5
    waiting_clear: bool = False
    since: float | None = None
    last_sample: float | None = None

    def reset(self):
        self.since = self.last_sample = None

    def observe(self, full: bool | None, now: float) -> bool:
        if full is None:
            self.reset()
            return False
        if self.last_sample is not None and now - self.last_sample > self.max_gap:
            self.since = None
        self.last_sample = now
        matches = not full if self.waiting_clear else full
        if not matches:
            self.since = None
            return False
        if self.since is None:
            self.since = now
        duration = self.clear_seconds if self.waiting_clear else self.confirm_seconds
        if now - self.since < duration:
            return False
        self.reset()
        if self.waiting_clear:
            self.waiting_clear = False
            return False
        return True


class AutoCycleController:
    def __init__(self, camera_id, sample, start, finish, duration=50.0, clock=time.monotonic):
        self.camera_id = camera_id
        self.sample = sample
        self.start_cycle = start
        self.finish_cycle = finish
        self.duration = duration
        self.clock = clock
        self.lock = threading.RLock()
        self.gate = FrameGate()
        self.enabled = False
        self.phase = "off"
        self.error = None
        self.confidence = None
        self.cycle_code = None
        self.deadline = None
        self.last_frame_id = None
        self.stop_event = threading.Event()
        self.thread = None

    def status(self):
        with self.lock:
            now = self.clock()
            return {
                "camera_id": self.camera_id, "enabled": self.enabled,
                "phase": self.phase, "error": self.error,
                "full_frame_confidence": self.confidence,
                "confirmation_seconds": self.gate.confirm_seconds,
                "confirmed_seconds": min(self.gate.confirm_seconds, max(0.0, now - self.gate.since))
                    if self.gate.since is not None and not self.gate.waiting_clear else 0.0,
                "grading_seconds": self.duration,
                "remaining_seconds": max(0, math.ceil(self.deadline - now)) if self.deadline else 0,
                "cycle_code": self.cycle_code,
            }

    def set_enabled(self, enabled):
        with self.lock:
            if enabled == self.enabled:
                return self.status()
            # Disabling also saves the current automatic cycle before manual control returns.
            if not enabled and self.cycle_code:
                self.finish_cycle(self.cycle_code)
                self.cycle_code = self.deadline = None
            self.enabled = enabled
            self.gate.reset()
            self.error = None
            self.phase = "waiting_clear" if enabled and self.gate.waiting_clear else ("waiting_full" if enabled else "off")
            if enabled and (self.thread is None or not self.thread.is_alive()):
                self.stop_event.clear()
                self.thread = threading.Thread(target=self._run, daemon=True, name=f"auto-frame-{self.camera_id}")
                self.thread.start()
            return self.status()

    def tick(self):
        with self.lock:
            if not self.enabled:
                return
            if self.cycle_code:
                if self.clock() >= self.deadline:
                    self.phase = "finishing"
                    self.finish_cycle(self.cycle_code)
                    self.cycle_code = self.deadline = None
                    self.gate.reset()
                    self.phase = "waiting_clear"
                return
            frame_id, full, confidence = self.sample(self.last_frame_id)
            if frame_id is not None and frame_id == self.last_frame_id:
                # A slower camera may repeat a frame between samples. Only a NEW
                # frame may confirm coverage, and a frozen feed resets after max_gap.
                if self.gate.last_sample is None or self.clock() - self.gate.last_sample > self.gate.max_gap:
                    self.gate.observe(None, self.clock())
                    self.phase = "camera_unavailable"
                    self.confidence = None
                return
            if full is None:
                self.gate.observe(None, self.clock())
                self.phase = "uncertain" if confidence is not None else "camera_unavailable"
                self.confidence = confidence
                if frame_id is not None:
                    self.last_frame_id = frame_id
                return
            self.last_frame_id = frame_id
            self.confidence = confidence
            ready = self.gate.observe(full, self.clock())
            self.error = None
            self.phase = "waiting_clear" if self.gate.waiting_clear else ("confirming" if self.gate.since is not None else "waiting_full")
            if ready:
                self.phase = "starting"
                code, deadline = self.start_cycle()
                self.cycle_code, self.deadline = code, deadline
                self.gate.waiting_clear = True
                self.phase = "grading"

    def _run(self):
        while not self.stop_event.wait(0.25):
            try:
                self.tick()
            except Exception as exc:
                with self.lock:
                    self.error = str(exc)
                    self.phase = "error"
                    self.gate.reset()
                # Retry completion without ever opening another cycle on a database failure.
                self.stop_event.wait(1.0)

    def shutdown(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=35)
        with self.lock:
            if self.cycle_code:
                self.finish_cycle(self.cycle_code)
                self.cycle_code = self.deadline = None
            self.enabled = False

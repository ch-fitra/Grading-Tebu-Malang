"""Create a verified recovery bundle WITHOUT changing the active model/config.

The staged rollback config points to a separate immutable archive weight, so
future candidate activation need not overwrite the previous checkpoint.
This command deliberately has no activation/restore option.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
os.environ["AI_DEVICE"] = "cpu"
os.environ["KERAS_BACKEND"] = "torch"
sys.path.insert(0, str(ROOT / "apps/ai-service"))
import main as service


def prepare():
    config = service.load_config()
    original_config = service.CONFIG_PATH.read_bytes()
    source = service.configured_model_path(config)
    original_hash = service.model_fingerprint(config)
    folder = ROOT / "models/archive" / ("recovery-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8])
    folder.mkdir(parents=True, exist_ok=False)
    weight = folder / source.name
    shutil.copy2(source, weight)
    if hashlib.sha256(weight.read_bytes()).hexdigest() != original_hash:
        raise ValueError("Recovery weight hash differs")
    (folder / "original-config.json").write_bytes(original_config)
    rollback = config.model_copy(update={"model_path": weight.relative_to(ROOT).as_posix()})
    (folder / "rollback-config.json").write_text(rollback.model_dump_json(indent=2), encoding="utf-8")
    import numpy as np
    scores, _ = service.run_onnx_inference(np.zeros((config.input_size, config.input_size, 3), dtype=np.uint8), rollback)
    if set(scores) != set(config.classes):
        raise ValueError("Recovery model output contract differs")
    if service.CONFIG_PATH.read_bytes() != original_config or service.model_fingerprint(config) != original_hash:
        raise ValueError("Active artifact changed during recovery preparation")
    report = {"created_at": datetime.now(timezone.utc).isoformat(), "recovery_folder": str(folder),
              "original_model_sha256": original_hash, "archived_model_sha256": hashlib.sha256(weight.read_bytes()).hexdigest(),
              "original_config_sha256": hashlib.sha256(original_config).hexdigest(),
              "rollback_config_sha256": hashlib.sha256((folder / "rollback-config.json").read_bytes()).hexdigest(),
              "offline_load_and_output_smoke_test": "passed", "active_model_or_config_changed": False,
              "full_service_rollback_rehearsal": "not_performed",
              "recovery_steps": ["Pause captures and retain candidate evidence",
                                 "Verify archive weight and rollback-config hashes against this manifest",
                                 "Stage rollback-config.json beside the active config; replace config atomically",
                                 "Reconcile API active-model registry, restart affected service if necessary, verify health hash and image replay",
                                 "Resume captures only after checks; retain all historical scores and candidate files"],
              "limitations": ["AI config and API model registry are separate stores; coordinated maintenance is required",
                              "Offline recovery smoke test does not validate recognition quality or cross-service transaction recovery"]}
    (folder / "recovery-manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(prepare(), ensure_ascii=False))

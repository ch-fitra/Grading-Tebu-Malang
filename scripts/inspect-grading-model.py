"""Read-only replay of a model artifact. No database, service, camera, or weight updates."""
import argparse
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--config", type=Path, default=ROOT / "apps/ai-service/models/active/config.json")
parser.add_argument("--image", type=Path, action="append", default=[])
parser.add_argument("--snapshots", type=Path, help="Optional saved snapshot folder; sampled, never modified")
parser.add_argument("--samples", type=int, default=10)
args = parser.parse_args()
if not 1 <= args.samples <= 100:
    parser.error("--samples must be between 1 and 100")
os.environ["KERAS_BACKEND"] = "torch"
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"  # Offline CPU diagnostic, independent of the live AI process.
import cv2
import keras
import numpy as np
import torch

torch.set_num_threads(2)
config = json.loads(args.config.read_text(encoding="utf-8"))
value = config["model_path"].replace("\\", "/")
model_path = (ROOT if value.startswith(("apps/ai-service/", "models/archive/")) else ROOT / "apps/ai-service") / value
if model_path.suffix.lower() not in (".keras", ".h5"):
    raise SystemExit("This inspector currently supports Keras artifacts only")
model = keras.models.load_model(model_path, compile=False)
model.to("cpu")
print(json.dumps({"artifact": model_path.name, "sha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
    "parameters": model.count_params(), "input_shape": model.input_shape, "output_shape": model.output_shape,
    "configured_classes": config["classes"], "class_order_verified_against_training": False,
    "configured_color": config.get("input_color", "rgb"), "configured_activation": config.get("output_activation", "probabilities"),
    "layers": [{"name": layer.name, "type": type(layer).__name__, "activation": getattr(getattr(layer, "activation", None), "__name__", None),
                "scale": float(layer.scale) if hasattr(layer, "scale") else None} for layer in model.layers]}))
size = config["input_size"]
samples = [("synthetic_black", np.zeros((size,size,3),dtype=np.uint8)),
           ("synthetic_white", np.full((size,size,3),255,dtype=np.uint8)),
           ("synthetic_gray", np.full((size,size,3),127,dtype=np.uint8)),
           ("synthetic_noise_seed19", np.random.default_rng(19).integers(0,256,(size,size,3),dtype=np.uint8))]
files = args.image[:]
if args.snapshots:
    available = sorted(args.snapshots.rglob("*.jpg"))
    indexes = np.linspace(0,len(available)-1,min(args.samples,len(available)),dtype=int) if available else []
    files.extend(available[index] for index in indexes)
for file in files:
    image = cv2.imread(str(file))
    if image is None:
        raise SystemExit(f"Image unreadable: {file.name}")
    samples.append((file.name,image))
for name,image in samples:
    pixels = cv2.resize(image,(size,size))
    if config.get("input_color", "rgb") == "rgb":
        pixels = cv2.cvtColor(pixels,cv2.COLOR_BGR2RGB)
    tensor = torch.as_tensor(pixels.astype("float32")[None])
    with torch.no_grad():
        raw = model(tensor,training=False).detach().cpu().numpy()[0]
    if raw.shape != (len(config["classes"]),) or not np.isfinite(raw).all():
        raise SystemExit("Model output does not match configured classes")
    mode = config.get("output_activation", "probabilities")
    probabilities = raw.copy()
    if mode == "softmax":
        probabilities = np.exp(raw-raw.max()); probabilities /= probabilities.sum()
    elif mode == "sigmoid":
        probabilities = 1/(1+np.exp(-np.clip(raw,-80,80)))
    elif probabilities.min() < 0 or probabilities.max() > 1:
        raise SystemExit("Configured probabilities contain values outside [0,1]")
    order = np.argsort(-probabilities,kind="stable")
    print(json.dumps({"sample":name,"raw_output":raw.tolist(),"probabilities":probabilities.tolist(),
        "winner_index":int(order[0]),"configured_label":config["classes"][int(order[0])],
        "confidence":float(probabilities[order[0]]),"below_configured_threshold":bool(probabilities[order[0]] < config["threshold"]),
        "top_two_margin":float(probabilities[order[0]]-probabilities[order[1]]) if len(order)>1 else None,
        "note":"Candidate from this artifact/configuration; not a verified QC label or accuracy measurement."}))

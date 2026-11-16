"""Offline-only data contract and evaluation. Never imported by the live service.

No report generated here authorizes production. Human review of extractor quality,
training provenance, calibration, rejection/OOD evaluation and approval is required.
"""
import hashlib
import json
from pathlib import Path

import numpy as np

from visual_matching import ReferenceBankMatcher, unit_rows
from match_calibration import PairCalibrator, pair_targets, reliability_report

CLASSES = ["ATPSD", "Akar Tanah", "Daduk", "Kocok Air", "MBS", "MBS Bintang",
           "MBS Plus", "Non MBS", "Sogolan Pucuk", "Tebu Muda", "Terbakar"]
PREPROCESSING = {"decoder": "opencv_imread_color_bgr_uint8", "resize": [224, 224],
                 "interpolation": "opencv_INTER_LINEAR", "color": "rgb",
                 "tensor": "float32_NHWC_0_255", "rescaling": "inside_model_1_255",
                 "feature": "final_dense_input", "dimension": 16}
SPLITS = ("reference", "calibration", "validation")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def checked_file(base, entry):
    """Evidence and samples are explicit local files, pinned by content hash."""
    if not isinstance(entry, dict) or not entry.get("path") or not entry.get("sha256"):
        raise ValueError("Path dan SHA-256 wajib diisi")
    path = (base / entry["path"]).resolve()
    if not path.is_file() or sha256(path) != entry["sha256"]:
        raise ValueError(f"File hilang atau hash berbeda: {path}")
    return path


def load_manifest(path, model_sha256, configured_classes, decode):
    """Reject incomplete banks and split leakage before inference.

    capture_group identifies the original truck/load/capture session, including
    related crops and augmentations. Exact decoded duplicates are also checked;
    semantic/near-duplicate leakage still requires review by the data owner.
    """
    path = Path(path).resolve()
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") != 1 or not data.get("reference_version"):
        raise ValueError("Schema atau versi referensi tidak valid")
    if data.get("classes") != CLASSES or list(configured_classes) != CLASSES:
        raise ValueError("Urutan kelas manifest/config tidak sesuai kontrak 11 kelas")
    if data.get("model_sha256") != model_sha256 or data.get("preprocessing") != PREPROCESSING:
        raise ValueError("Checkpoint atau preprocessing berbeda dari runtime yang diuji")
    for key in ("training_class_order_evidence", "training_preprocessing_evidence"):
        evidence_path = checked_file(path.parent, data.get(key))
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        field, expected = (("classes", CLASSES) if key == "training_class_order_evidence"
                           else ("preprocessing", PREPROCESSING))
        if evidence.get("checkpoint_sha256") != model_sha256 or evidence.get(field) != expected:
            raise ValueError(f"Bukti training tidak sesuai checkpoint/kontrak: {key}")
    if type(data.get("neighbors")) is not int or data["neighbors"] < 1:
        raise ValueError("neighbors harus integer positif")
    samples = data.get("samples", [])
    if not isinstance(samples, list) or not samples:
        raise ValueError("Referensi berlabel belum tersedia")
    seen_ids, groups, pixels, records = set(), {}, {}, []
    for sample in samples:
        if not isinstance(sample, dict):
            raise ValueError("Record sampel tidak valid")
        identity, label, split = sample.get("id"), sample.get("label"), sample.get("split")
        group = sample.get("capture_group")
        if (not isinstance(identity, str) or not identity.strip() or identity in seen_ids
                or label not in CLASSES or split not in SPLITS
                or not isinstance(group, str) or not group.strip()
                or not isinstance(sample.get("verified_by"), str) or not sample["verified_by"].strip()
                or not isinstance(sample.get("label_source"), str) or not sample["label_source"].strip()):
            raise ValueError("ID, label QC, split, capture_group, atau provenance tidak valid")
        image_path = checked_file(path.parent, sample)
        image = decode(str(image_path))
        if image is None or image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3:
            raise ValueError(f"Gambar tidak dapat dibaca: {identity}")
        digest = hashlib.sha256(str(image.shape).encode() + image.tobytes()).hexdigest()
        if digest in pixels:
            raise ValueError(f"Duplikat piksel: {identity}; {pixels[digest]}")
        if group in groups and groups[group] != split:
            raise ValueError(f"Kebocoran capture_group lintas split: {group}")
        seen_ids.add(identity)
        pixels[digest], groups[group] = identity, split
        records.append({**sample, "resolved_path": str(image_path), "pixel_sha256": digest})
    for split in SPLITS:
        present = {r["label"] for r in records if r["split"] == split}
        if present != set(CLASSES):
            raise ValueError(f"Split {split} belum lengkap: {sorted(set(CLASSES) - present)}")
    return data, records


def feature_report(embeddings):
    vectors = np.asarray(embeddings, dtype=float)
    unit = unit_rows(vectors)
    pairwise = np.clip(unit @ unit.T, -1, 1)
    pairs = pairwise[np.triu_indices(len(unit), 1)]
    return {"sample_count": len(unit), "dimension": vectors.shape[1],
            "std_per_dimension": vectors.std(axis=0).tolist(),
            "pairwise_cosine_min": float(pairs.min()) if pairs.size else None,
            "pairwise_cosine_median": float(np.median(pairs)) if pairs.size else None,
            "pairwise_cosine_max": float(pairs.max()) if pairs.size else None,
            "unit_embedding_max_distance": float(np.sqrt(max(0., 2-2*pairs.min()))) if pairs.size else None,
            "class_discrimination_proven": False,
            "note": "Directional concentration is diagnostic; no arbitrary cosine cutoff establishes fitness."}


def evaluate_labeled(data, records, embeddings):
    vectors = np.asarray(embeddings, dtype=float)
    if vectors.shape != (len(records), 16):
        raise ValueError("Embedding harus 16 dimensi untuk setiap record")
    indexes = {s: [i for i, r in enumerate(records) if r["split"] == s] for s in SPLITS}
    labels = {s: [records[i]["label"] for i in indexes[s]] for s in SPLITS}
    matcher = ReferenceBankMatcher.fit(CLASSES, vectors[indexes["reference"]],
                                       labels["reference"], data["neighbors"])
    cal_scores = matcher.compare(vectors[indexes["calibration"]])
    validation_scores = matcher.compare(vectors[indexes["validation"]])
    calibration_targets = pair_targets(labels["calibration"], CLASSES)
    validation_targets = pair_targets(labels["validation"], CLASSES)
    calibrator = PairCalibrator.fit(cal_scores, calibration_targets)
    predicted_pairs = calibrator.predict(validation_scores)
    confusion = np.zeros((len(CLASSES), len(CLASSES)), dtype=int)
    diagnostics = matcher.diagnose(vectors[indexes["validation"]], data["reference_version"])
    for i, record in enumerate(diagnostics):
        actual = labels["validation"][i]
        confusion[CLASSES.index(actual), CLASSES.index(record["candidate_class"])] += 1
        record.update({"sample_id": records[indexes["validation"][i]]["id"], "verified_label": actual})
    return {"method": "mean_top_k_cosine_within_each_class", "neighbors": matcher.neighbors,
            "reference_counts": matcher.counts, "classes": CLASSES,
            "top1_candidate_accuracy": float(np.trace(confusion) / confusion.sum()),
            "confusion_matrix_actual_rows_predicted_columns": confusion.tolist(),
            "per_class": {name: {"support": int(confusion[i].sum()),
                                 "recall": float(confusion[i, i] / confusion[i].sum()),
                                 "genuine_cosine_mean": float(validation_scores[validation_targets[:, i] == 1, i].mean()),
                                 "impostor_cosine_mean": float(validation_scores[validation_targets[:, i] == 0, i].mean()),
                                 "calibration_diagnostics": reliability_report(predicted_pairs[:, i], validation_targets[:, i])}
                          for i, name in enumerate(CLASSES)},
            "experimental_calibrator": calibrator.contract(),
            "held_out_calibration_diagnostics": reliability_report(predicted_pairs, validation_targets),
            "validation_results": diagnostics,
            "rejection_policy_validated": False, "production_enabled": False,
            "note": "Candidate accuracy only. No calibrated percentage exposed; no OOD/rejection acceptance claim."}


def require_production_readiness():
    """No config/manifest boolean can bypass absent production validation."""
    raise RuntimeError("Similarity hanya offline: kualitas fitur, kalibrasi, penolakan dan persetujuan belum disahkan")

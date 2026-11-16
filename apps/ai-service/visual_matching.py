"""Offline reference matching primitives. Raw cosine is NOT a validated percentage.

No active config, weights, database, or camera is modified by this module.
"""
from dataclasses import dataclass
import numpy as np


def unit_rows(values):
    values = np.asarray(values, dtype=np.float64)
    if values.ndim != 2 or not values.size or not np.isfinite(values).all():
        raise ValueError("Embedding harus matriks finite yang tidak kosong")
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    if np.any(norms <= 1e-12):
        raise ValueError("Embedding nol tidak memiliki cosine yang terdefinisi")
    return values / norms


@dataclass
class ReferenceMatcher:
    classes: list
    prototypes: np.ndarray
    counts: dict

    @classmethod
    def fit(cls, classes, embeddings, labels):
        if len(classes) < 2 or len(set(classes)) != len(classes):
            raise ValueError("Diperlukan setidaknya dua kelas unik")
        vectors = unit_rows(embeddings)
        if len(labels) != len(vectors) or set(labels) != set(classes):
            raise ValueError("Referensi wajib mencakup persis seluruh kelas model aktif")
        labels = np.asarray(labels)
        prototypes = unit_rows(np.stack([vectors[labels == name].mean(axis=0) for name in classes]))
        return cls(list(classes), prototypes, {name: int(np.sum(labels == name)) for name in classes})

    def compare(self, embeddings):
        vectors = unit_rows(embeddings)
        if vectors.shape[1] != self.prototypes.shape[1]:
            raise ValueError("Dimensi embedding tidak sama dengan referensi")
        # Every image x every class; no softmax and no normalization across classes.
        return np.clip(vectors @ self.prototypes.T, -1.0, 1.0)

    def select(self, scores, minimum_cosine, minimum_margin):
        """Experimental decision only; callers must validate thresholds on held-out data."""
        if not np.isfinite(minimum_cosine) or not -1 <= minimum_cosine <= 1:
            raise ValueError("Ambang cosine harus finite dalam [-1,1]")
        if not np.isfinite(minimum_margin) or not 0 <= minimum_margin <= 2:
            raise ValueError("Ambang margin harus finite dalam [0,2]")
        scores = np.asarray(scores, dtype=float)
        if (scores.shape != (len(self.classes),) or not np.isfinite(scores).all()
                or np.any((scores < -1) | (scores > 1))):
            raise ValueError("Skor harus mencakup seluruh kelas")
        order = np.argsort(-scores, kind="stable")
        best, second = order[:2]
        margin = float(scores[best] - scores[second])
        status = ("Belum Dikenali" if scores[best] < minimum_cosine else
                  "Perlu Pemeriksaan" if margin <= minimum_margin else "recognized")
        return {"candidate": self.classes[best], "grade": self.classes[best] if status == "recognized" else status,
                "status": status, "raw_cosine": float(scores[best]), "raw_margin": margin,
                "similarity_percent": None, "compared_class_count": len(self.classes)}

    def diagnose(self, embeddings, reference_version):
        """One record per image. No acceptance policy or percentage is invented.

        Cosine measures direction agreement in feature space, in [-1, 1].
        It is neither probability of correct grade nor physical visual overlap.
        Stable ties follow the declared class order and remain unaccepted.
        """
        if not isinstance(reference_version, str) or not reference_version.strip():
            raise ValueError("Versi referensi wajib diisi")
        results = []
        for scores in self.compare(embeddings):
            order = np.argsort(-scores, kind="stable")
            best, second = order[:2]
            results.append({
                "candidate_class": self.classes[best], "score_kind": "raw_cosine_similarity",
                "raw_similarity": float(scores[best]), "similarity_percent": None,
                "accepted_class": "Belum Dikenali", "prediction_accepted": False,
                "rejection_reason": "acceptance_policy_not_validated",
                "raw_margin": float(scores[best] - scores[second]),
                "class_scores": dict(zip(self.classes, map(float, scores))),
                "reference_version": reference_version, "calibration_version": None,
            })
        return results


@dataclass
class ReferenceBankMatcher(ReferenceMatcher):
    references: np.ndarray
    labels: np.ndarray
    neighbors: int

    @classmethod
    def fit(cls, classes, embeddings, labels, neighbors=3):
        if type(neighbors) is not int or neighbors < 1:
            raise ValueError("Jumlah tetangga harus bilangan bulat positif")
        vectors = unit_rows(embeddings)
        if len(classes) < 2 or len(set(classes)) != len(classes) or len(labels) != len(vectors) or set(labels) != set(classes):
            raise ValueError("Bank referensi wajib mencakup seluruh kelas unik")
        labels = np.asarray(labels)
        # Bank scoring does not need a mean prototype (opposite modes may cancel).
        placeholders = np.stack([vectors[labels == name][0] for name in classes])
        counts = {name: int(np.sum(labels == name)) for name in classes}
        return cls(list(classes), placeholders, counts, vectors, labels, neighbors)

    def compare(self, embeddings):
        vectors = unit_rows(embeddings)
        if vectors.shape[1] != self.references.shape[1]:
            raise ValueError("Dimensi embedding tidak sesuai referensi")
        pairwise = vectors @ self.references.T
        result = []
        for name in self.classes:
            scores = pairwise[:, self.labels == name]
            k = min(self.neighbors, scores.shape[1])
            result.append(np.sort(scores, axis=1)[:, -k:].mean(axis=1))
        return np.clip(np.column_stack(result), -1, 1)


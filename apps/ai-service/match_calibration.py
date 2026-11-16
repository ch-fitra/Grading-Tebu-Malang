"""Independent binary pair-match calibration, never a class softmax.

Meaning: P(genuine image/class pair | cosine) in a declared balanced pair
population (50% genuine, 50% impostor). Not physical visual overlap, not
deployment posterior without matching priors, and not model accuracy.
"""
from dataclasses import dataclass, asdict
import numpy as np


def sigmoid(values):
    z = np.asarray(values, dtype=float)
    # Stable without clipping the actual scores.
    return np.exp(-np.logaddexp(0, -z))


@dataclass
class PairCalibrator:
    center: float
    scale: float
    intercept: float
    slope: float
    regularization: float
    genuine_count: int
    impostor_count: int

    @classmethod
    def fit(cls, cosine, genuine, regularization=.001):
        raw, y = np.asarray(cosine, dtype=float).ravel(), np.asarray(genuine, dtype=float).ravel()
        if (raw.shape != y.shape or len(raw) < 4 or not np.isfinite(raw).all()
                or np.any((raw < -1) | (raw > 1)) or not np.isin(y, [0, 1]).all()):
            raise ValueError("Pasangan cosine/label tidak valid")
        positive, negative = int(y.sum()), int((1-y).sum())
        if min(positive, negative) < 2 or not np.isfinite(regularization) or regularization <= 0:
            raise ValueError("Kalibrasi memerlukan genuine dan impostor serta regularisasi positif")
        center, scale = float(raw.mean()), float(raw.std())
        if scale < 1e-12:
            raise ValueError("Cosine konstan tidak dapat dikalibrasi menjadi pengukur diskriminatif")
        x = (raw - center) / scale
        design = np.column_stack([np.ones(len(raw)), x])
        # Equal total positive/negative weight declares a 50:50 pair prior.
        weights = np.where(y == 1, .5 / positive, .5 / negative)
        beta = np.zeros(2)

        def loss(value):
            z = design @ value
            return float(np.sum(weights * (np.logaddexp(0, z) - y*z)) + regularization * value[1]**2 / 2)

        for _ in range(100):
            p = sigmoid(design @ beta)
            gradient = design.T @ (weights * (p-y)) + [0, regularization*beta[1]]
            hessian = design.T @ ((weights*p*(1-p))[:, None] * design) + np.diag([1e-10, regularization])
            step = np.linalg.solve(hessian, gradient)
            previous, rate = loss(beta), 1.0
            for _ in range(40):
                candidate = beta - rate * step
                candidate[1] = max(0.0, candidate[1])  # Higher cosine cannot lower match score.
                if loss(candidate) <= previous:
                    break
                rate /= 2
            if np.linalg.norm(candidate-beta) < 1e-9:
                beta = candidate
                break
            beta = candidate
        return cls(center, scale, float(beta[0]), float(beta[1]), regularization, positive, negative)

    def predict(self, cosine):
        raw = np.asarray(cosine, dtype=float)
        if (not np.isfinite(raw).all() or np.any((raw < -1) | (raw > 1))
                or not np.isfinite([self.center, self.scale, self.intercept, self.slope]).all()
                or self.scale <= 0 or self.slope < 0):
            raise ValueError("Cosine atau parameter kalibrasi tidak valid")
        return sigmoid(self.intercept + self.slope * (raw-self.center)/self.scale)

    def contract(self):
        return {**asdict(self), "method": "monotone_regularized_binary_sigmoid",
                "pair_prior": {"genuine": .5, "impostor": .5},
                "semantics": "Estimated genuine-pair probability under balanced pair sampling; not softmax, accuracy, or physical overlap",
                "validated_for_production": False}


def pair_targets(labels, classes):
    if (len(classes) == 0 or len(set(classes)) != len(classes) or len(labels) == 0
            or not set(labels).issubset(classes)):
        raise ValueError("Label pasangan harus berasal dari kelas yang dideklarasikan")
    return np.asarray([[int(label == name) for name in classes] for label in labels])


def reliability_report(probabilities, genuine, bins=10):
    if type(bins) is not int or bins < 1:
        raise ValueError("Jumlah bin harus bilangan bulat positif")
    p, y = np.asarray(probabilities, dtype=float).ravel(), np.asarray(genuine, dtype=float).ravel()
    if p.shape != y.shape or not np.isfinite(p).all() or np.any((p<0)|(p>1)) or not np.isin(y,[0,1]).all():
        raise ValueError("Data reliabilitas tidak valid")
    positive, negative = int(y.sum()), int((1-y).sum())
    if min(positive, negative) == 0:
        raise ValueError("Reliabilitas membutuhkan genuine dan impostor")
    weights = np.where(y == 1, .5/positive, .5/negative)
    reliability, ece = [], 0.0
    for i in range(bins):
        subset = (p >= i/bins) & ((p < (i+1)/bins) if i < bins-1 else (p <= 1))
        if not subset.any():
            continue
        mass = float(weights[subset].sum())
        predicted = float(np.average(p[subset], weights=weights[subset]))
        observed = float(np.average(y[subset], weights=weights[subset]))
        ece += mass*abs(predicted-observed)
        reliability.append({"lower": i/bins, "upper": (i+1)/bins, "pairs": int(subset.sum()),
                            "balanced_weight": mass, "mean_score": predicted, "observed_genuine_fraction": observed})
    return {"balanced_pair_brier_score": float(np.sum(weights*(p-y)**2)),
            "balanced_pair_ece": ece, "bin_count": bins, "reliability_bins": reliability,
            "pair_prior": "balanced_50_50", "pairs_are_correlated_within_image": True,
            "note": "Brier and ECE are empirical diagnostics, not a guarantee; evaluate per class and independent capture groups"}

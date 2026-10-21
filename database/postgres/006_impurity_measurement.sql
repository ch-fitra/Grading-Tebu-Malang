-- Class probabilities are not physical impurity measurements. NULL preserves
-- the unknown provenance of historical records without rewriting their values.
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS impurity_measured BOOLEAN;

-- Preserve all historical rows; new captures retain their exact logit provenance.
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS model_output JSONB;

-- Keep historical model registry entries without an active grading engine.
UPDATE ai_models SET active = FALSE WHERE active = TRUE;

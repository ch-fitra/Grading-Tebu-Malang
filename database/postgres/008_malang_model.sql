-- Replace the inherited grading model in the Malang installation.
UPDATE ai_models SET active = FALSE
WHERE path = 'apps/ai-service/models/active/v0.0.1.sugarcane.keras';
INSERT INTO ai_models(name, version, path, active)
VALUES ('Sugarcane Malang 11 Classes', 'malang-1',
        'apps/ai-service/models/active/model_sugarcane_malang.keras', TRUE)
ON CONFLICT (name, version) DO NOTHING;

BEGIN;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS station INTEGER;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE cameras SET station = COALESCE(
  (regexp_match(name, '(?i)MBS\s*(\d+)'))[1]::integer,
  (regexp_match(name, '(?i)meja(?:\s+tebu)?\s*(\d+)'))[1]::integer,
  id::integer
) WHERE station IS NULL;
ALTER TABLE cameras ALTER COLUMN station SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cameras_station_unique ON cameras(station);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cameras_station_positive' AND conrelid='cameras'::regclass) THEN
    ALTER TABLE cameras ADD CONSTRAINT cameras_station_positive CHECK (station BETWEEN 1 AND 99);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS installation_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
COMMIT;

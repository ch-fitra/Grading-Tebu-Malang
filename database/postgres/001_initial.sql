CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'operator',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cameras (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  rtsp_url TEXT NOT NULL,
  location VARCHAR(100) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_models (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  version VARCHAR(50) NOT NULL,
  path TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS inference_results (
  id BIGSERIAL PRIMARY KEY,
  camera_id BIGINT REFERENCES cameras(id) ON DELETE SET NULL,
  grade VARCHAR(20) NOT NULL,
  daun_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  pucuk_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  sampah_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  snapshot_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS truck_inspections (
  id UUID PRIMARY KEY,
  truck_code VARCHAR(100) NOT NULL,
  plate_number VARCHAR(30),
  driver_name VARCHAR(100),
  supplier VARCHAR(150),
  line INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'completed')),
  final_decision VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  average_impurity DOUBLE PRECISION NOT NULL DEFAULT 0,
  average_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS truck_inspection_captures (
  inspection_id UUID NOT NULL REFERENCES truck_inspections(id) ON DELETE CASCADE,
  inference_id BIGINT NOT NULL REFERENCES inference_results(id) ON DELETE CASCADE,
  PRIMARY KEY (inspection_id, inference_id)
);

CREATE INDEX IF NOT EXISTS idx_inference_created_at ON inference_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inference_camera ON inference_results(camera_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_started_at ON truck_inspections(started_at DESC);

CREATE TABLE IF NOT EXISTS deletion_requests (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_created_at ON deletion_requests(created_at DESC);

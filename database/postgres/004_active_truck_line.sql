-- One unfinished inspection per camera/line; different lines may run concurrently.
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_truck_line
  ON truck_inspections(line) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS roles (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT[] NOT NULL DEFAULT '{}',
  system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS role_id BIGINT REFERENCES roles(id);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

INSERT INTO roles(code,name,description,permissions,system) VALUES
('developer','Developer','Mengelola seluruh role, pengguna, dan konfigurasi sistem',ARRAY['dashboard.read','history.read','inspection.write','camera.read','camera.write','model.read','model.write','settings.read','user.read','user.write','role.read','role.write'],TRUE),
('admin','Admin','Mengelola pengguna operasional dan konfigurasi',ARRAY['dashboard.read','history.read','inspection.write','camera.read','camera.write','model.read','model.write','settings.read','user.read','user.write','role.read'],TRUE),
('operator','Operator','Menjalankan inspeksi dan melihat data operasional',ARRAY['dashboard.read','history.read','inspection.write','camera.read','model.read'],TRUE),
('viewer','Viewer','Monitoring tanpa mengubah data',ARRAY['dashboard.read','history.read','camera.read','model.read'],TRUE)
ON CONFLICT(code) DO NOTHING;

UPDATE app_users SET role_id=(SELECT id FROM roles WHERE code=app_users.role) WHERE role_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_users_role_id ON app_users(role_id);


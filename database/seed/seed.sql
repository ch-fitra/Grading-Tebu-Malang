IF NOT EXISTS (SELECT 1 FROM dbo.app_users WHERE username = 'admin')
BEGIN
    INSERT INTO dbo.app_users (username, password, role, active)
    VALUES ('admin', 'admin', 'admin', 1);
END;

INSERT INTO cameras (name, rtsp_url, location, status)
SELECT 'Line 1 Camera', 'rtsp://example.local/stream1', 'Loading Bay 1', 'offline'
WHERE NOT EXISTS (SELECT 1 FROM cameras WHERE name = 'Line 1 Camera');

INSERT INTO models (name, version, path, active)
SELECT 'Tebu Segmentation V1', '1.0.0', 'models/active/model.onnx', 1
WHERE NOT EXISTS (SELECT 1 FROM models WHERE name = 'Tebu Segmentation V1' AND version = '1.0.0');

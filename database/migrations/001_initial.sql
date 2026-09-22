IF OBJECT_ID('dbo.app_users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_users (
        id INT PRIMARY KEY IDENTITY,
        username NVARCHAR(100) NOT NULL UNIQUE,
        password NVARCHAR(255) NOT NULL,
        role NVARCHAR(50) NOT NULL DEFAULT 'operator',
        active BIT NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT GETDATE()
    );
END;

IF NOT EXISTS (SELECT 1 FROM dbo.app_users WHERE username = 'admin')
BEGIN
    INSERT INTO dbo.app_users (username, password, role, active)
    VALUES ('admin', 'admin', 'admin', 1);
END;

IF OBJECT_ID('dbo.cameras', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.cameras (
        id INT PRIMARY KEY IDENTITY,
        name NVARCHAR(100) NOT NULL,
        rtsp_url NVARCHAR(MAX) NOT NULL,
        location NVARCHAR(100),
        status NVARCHAR(20) DEFAULT 'offline',
        created_at DATETIME DEFAULT GETDATE()
    );
END;

IF OBJECT_ID('dbo.models', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.models (
        id INT PRIMARY KEY IDENTITY,
        name NVARCHAR(100) NOT NULL,
        version NVARCHAR(50) NOT NULL,
        path NVARCHAR(MAX) NOT NULL,
        active BIT DEFAULT 0,
        created_at DATETIME DEFAULT GETDATE()
    );
END;

IF OBJECT_ID('dbo.inference_results', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.inference_results (
        id BIGINT PRIMARY KEY IDENTITY,
        camera_id INT,
        grade NVARCHAR(20) NOT NULL,
        daun_percent FLOAT DEFAULT 0,
        pucuk_percent FLOAT DEFAULT 0,
        sampah_percent FLOAT DEFAULT 0,
        confidence FLOAT DEFAULT 0,
        snapshot_path NVARCHAR(MAX),
        created_at DATETIME DEFAULT GETDATE(),
        CONSTRAINT fk_inference_camera FOREIGN KEY (camera_id) REFERENCES dbo.cameras(id)
    );
END;

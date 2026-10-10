from __future__ import annotations

import logging
import psycopg2
from db.connection import AI_DB_URL, get_ai_db_connection

logger = logging.getLogger("ai_migrations")


def ensure_ai_database_exists():
    """Ensure database sugarcane_ai exists in PostgreSQL."""
    try:
        # Connect to default postgres DB to create sugarcane_ai if it does not exist
        default_url = AI_DB_URL.rsplit('/', 1)[0] + '/postgres'
        conn = psycopg2.connect(default_url)
        conn.autocommit = True
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_database WHERE datname = 'sugarcane_ai';")
            exists = cursor.fetchone()
            if not exists:
                cursor.execute("CREATE DATABASE sugarcane_ai;")
                logger.info("Database 'sugarcane_ai' berhasil dibuat.")
        conn.close()
    except Exception as e:
        logger.warning(f"Note pada pemastian DB sugarcane_ai: {e}")


def run_ai_migrations():
    """Run native Python DDL migrations for sugarcane_ai database."""
    ensure_ai_database_exists()
    conn = get_ai_db_connection()
    try:
        with conn.cursor() as cursor:
            # 1. Table: ai_cameras
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ai_cameras (
                    id SERIAL PRIMARY KEY,
                    camera_code VARCHAR(50) UNIQUE NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    rtsp_url TEXT NOT NULL,
                    location VARCHAR(100),
                    is_active BOOLEAN DEFAULT true,
                    roi_config JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # 2. Table: ai_models
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ai_models (
                    id SERIAL PRIMARY KEY,
                    model_code VARCHAR(50) UNIQUE NOT NULL,
                    model_name VARCHAR(100) NOT NULL,
                    version VARCHAR(20) NOT NULL,
                    model_path TEXT NOT NULL,
                    config_json JSONB,
                    is_active BOOLEAN DEFAULT false,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # 3. Table: ai_results (Per-Cycle Aggregated Summary Table)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ai_results (
                    id BIGSERIAL PRIMARY KEY,
                    cycle_code VARCHAR(50) UNIQUE NOT NULL,
                    camera_id INT REFERENCES ai_cameras(id),
                    model_version VARCHAR(20),
                    status VARCHAR(20) DEFAULT 'running',
                    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    end_time TIMESTAMP,
                    total_frames_scanned INT DEFAULT 0,
                    majority_class VARCHAR(10),
                    avg_total_impurity NUMERIC(10,2),
                    class_distribution JSONB,
                    confidence_avg NUMERIC(10,4),
                    best_snapshot_path TEXT,
                    snapshot_paths JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            cursor.execute("""
                ALTER TABLE ai_results
                ADD COLUMN IF NOT EXISTS snapshot_paths JSONB,
                ALTER COLUMN avg_total_impurity TYPE NUMERIC(10,2),
                ALTER COLUMN confidence_avg TYPE NUMERIC(10,4);
            """)

            # 4. Table: ai_inference_results (Raw Frames tied to Cycle)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ai_inference_results (
                    id BIGSERIAL PRIMARY KEY,
                    cycle_id BIGINT REFERENCES ai_results(id),
                    cycle_code VARCHAR(50),
                    camera_id INT REFERENCES ai_cameras(id),
                    model_version VARCHAR(20),
                    snapshot_path TEXT,
                    image_blob BYTEA,
                    classes_score JSONB,
                    total_impurity NUMERIC(10,2),
                    detected_class VARCHAR(10),
                    confidence NUMERIC(10,4),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            cursor.execute("""
                ALTER TABLE ai_inference_results
                ALTER COLUMN total_impurity TYPE NUMERIC(10,2),
                ALTER COLUMN confidence TYPE NUMERIC(10,4);
            """)

            # Add cycle_id & cycle_code to ai_inference_results if table already existed
            cursor.execute("""
                ALTER TABLE ai_inference_results 
                ADD COLUMN IF NOT EXISTS cycle_id BIGINT REFERENCES ai_results(id),
                ADD COLUMN IF NOT EXISTS cycle_code VARCHAR(50);
            """)

            # Seed Default Cameras if empty (Only PT Trangkil camera with ID 1)
            cursor.execute("""
                INSERT INTO ai_cameras (id, camera_code, name, rtsp_url, location, roi_config)
                VALUES 
                (1, 'CAM_TRANGKIL_5', 'MBS 5 - PT Trangkil (Wisenet Meja 5)', 'rtsp://admin:XNOAdmin123@192.168.33.86:554/profile2/media.smp', 'Meja Tebu 5', '{"camera_id": 1, "enabled": true, "x": 0.14, "y": 0.14, "width": 0.74, "height": 0.66, "label": "ROI: MEJA TEBU 5 (PT TRANGKIL WISENET)", "show_grid": true, "show_telemetry": true, "show_scrim": true}'::jsonb)
                ON CONFLICT (id) DO UPDATE SET roi_config = EXCLUDED.roi_config;
            """)

            # Seed Default AI Model if empty (Keras model uploaded by user)
            cursor.execute("""
                INSERT INTO ai_models (model_code, model_name, version, model_path, is_active, config_json)
                VALUES 
                ('MDL_SUGARCANE_KERAS_V001', 'Sugarcane Quality Keras Model', '0.0.1', 'apps/ai-service/models/active/v0.0.1.sugarcane.keras', true, '{"classes": ["A", "B", "D", "G", "M", "T"], "threshold": 0.5}')
                ON CONFLICT (model_code) DO NOTHING;
            """)

        conn.commit()
        logger.info("Migrasi skema database 'sugarcane_ai' berhasil dijalankan.")
    except Exception as e:
        conn.rollback()
        logger.error(f"Gagal menjalankan migrasi DB sugarcane_ai: {e}")
        raise
    finally:
        conn.close()

from __future__ import annotations

import json
from pathlib import Path
import logging
import os
import psycopg2
from psycopg2 import sql
from psycopg2.extensions import parse_dsn
from db.connection import AI_DB_URL, get_ai_db_connection

logger = logging.getLogger("ai_migrations")


def ensure_ai_database_exists():
    """Ensure database sugarcane_ai exists in PostgreSQL."""
    try:
        connection = parse_dsn(AI_DB_URL)
        database = connection.get("dbname")
        if not database:
            raise ValueError("AI_DATABASE_URL harus menyertakan nama database")
        connection["dbname"] = "postgres"
        conn = psycopg2.connect(**connection)
        conn.autocommit = True
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (database,))
            exists = cursor.fetchone()
            if not exists:
                cursor.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
                logger.info("Database AI berhasil dibuat.")
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

            cursor.execute("ALTER TABLE ai_results ALTER COLUMN majority_class TYPE VARCHAR(50)")
            cursor.execute("ALTER TABLE ai_inference_results ALTER COLUMN detected_class TYPE VARCHAR(50)")
            config = json.loads((Path(__file__).resolve().parents[1] / "models/active/config.json").read_text())
            cursor.execute("UPDATE ai_models SET is_active=false WHERE is_active=true AND model_code <> 'MDL_MALANG_11'")
            cursor.execute("""INSERT INTO ai_models(model_code,model_name,version,model_path,is_active,config_json)
                VALUES('MDL_MALANG_11',%s,%s,%s,true,%s)
                ON CONFLICT(model_code) DO UPDATE SET model_name=EXCLUDED.model_name,
                version=EXCLUDED.version,model_path=EXCLUDED.model_path,is_active=true,config_json=EXCLUDED.config_json""",
                (config['name'],config['version'],config['model_path'],json.dumps(config)))

        conn.commit()
        logger.info("Migrasi skema database 'sugarcane_ai' berhasil dijalankan.")
    except Exception as e:
        conn.rollback()
        logger.error(f"Gagal menjalankan migrasi DB sugarcane_ai: {e}")
        raise
    finally:
        conn.close()

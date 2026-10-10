from __future__ import annotations

import os
import logging
from pathlib import Path
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger("ai_db")

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env", override=False)

# Database Connection URLs
PRIMARY_DB_URL = os.getenv("DATABASE_URL", "postgres://postgres:admin123@127.0.0.1:5432/sugarcane")
AI_DB_URL = os.getenv("AI_DATABASE_URL", "postgres://postgres:admin123@127.0.0.1:5432/sugarcane_ai")


def get_ai_db_connection():
    """Returns a connection to the dedicated sugarcane_ai database."""
    try:
        conn = psycopg2.connect(AI_DB_URL)
        return conn
    except Exception as e:
        logger.error(f"Gagal terhubung ke database sugarcane_ai: {e}")
        raise


def get_auth_db_connection():
    """Returns a connection to the primary sugarcane database (for Auth/Users lookup)."""
    try:
        conn = psycopg2.connect(PRIMARY_DB_URL)
        return conn
    except Exception as e:
        logger.error(f"Gagal terhubung ke database auth sugarcane: {e}")
        raise

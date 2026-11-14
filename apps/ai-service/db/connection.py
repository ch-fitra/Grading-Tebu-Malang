from __future__ import annotations

import os
import logging
from pathlib import Path
from dotenv import load_dotenv
import psycopg2

logger = logging.getLogger("ai_db")

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env", override=False)

# Database Connection URLs
if os.getenv("AUTO_CYCLE_API_URL") != "http://127.0.0.1:4111":
    raise RuntimeError("AUTO_CYCLE_API_URL Malang harus http://127.0.0.1:4111")
PRIMARY_DB_URL = os.environ["DATABASE_URL"]
AI_DB_URL = os.environ["AI_DATABASE_URL"]
from urllib.parse import urlparse
if os.getenv("INSTALLATION_ID") != "malang":
    raise RuntimeError("INSTALLATION_ID harus malang")
for key, value, expected in [("DATABASE_URL", PRIMARY_DB_URL, "sugarcane_malang"), ("AI_DATABASE_URL", AI_DB_URL, "sugarcane_ai_malang")]:
    if urlparse(value).path != "/" + expected:
        raise RuntimeError(f"{key} harus memakai database khusus Malang: {expected}")


def get_ai_db_connection():
    """Returns a connection to the dedicated sugarcane_ai database."""
    try:
        conn = psycopg2.connect(AI_DB_URL, connect_timeout=5)
        return conn
    except Exception as e:
        logger.error(f"Gagal terhubung ke database sugarcane_ai: {e}")
        raise


def get_auth_db_connection():
    """Returns a connection to the primary sugarcane database (for Auth/Users lookup)."""
    try:
        conn = psycopg2.connect(PRIMARY_DB_URL, connect_timeout=5)
        return conn
    except Exception as e:
        logger.error(f"Gagal terhubung ke database auth sugarcane: {e}")
        raise

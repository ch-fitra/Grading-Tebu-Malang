from __future__ import annotations

import json
import logging
from typing import Dict, Any, Optional, List
from db.connection import get_ai_db_connection, get_auth_db_connection
from psycopg2.extras import RealDictCursor

logger = logging.getLogger("ai_repository")


class AIRepository:
    """Data Access Layer for AI Service operating on sugarcane_ai DB and reading sugarcane Auth DB."""

    # --- Auth & User Validation (from DB: sugarcane) ---
    @staticmethod
    def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
        try:
            with get_auth_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute("SELECT u.id, u.username, u.password_hash, r.code as role FROM app_users u JOIN roles r ON r.id = u.role_id WHERE u.username = %s AND u.active = true", (username,))
                    res = cursor.fetchone()
                    return dict(res) if res else None
        except Exception as e:
            logger.error(f"Error fetching user from auth db: {e}")
            return None

    # --- Camera Management (from DB: sugarcane_ai) ---
    @staticmethod
    def get_active_cameras() -> List[Dict[str, Any]]:
        try:
            with get_ai_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute("SELECT * FROM ai_cameras WHERE is_active = true ORDER BY id ASC")
                    return [dict(r) for r in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error fetching active cameras: {e}")
            return []

    @staticmethod
    def get_camera_roi(camera_id: int) -> Optional[Dict[str, Any]]:
        try:
            with get_ai_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute("SELECT roi_config FROM ai_cameras WHERE id = %s", (camera_id,))
                    res = cursor.fetchone()
                    return res["roi_config"] if res and res.get("roi_config") else None
        except Exception as e:
            logger.error(f"Error fetching camera ROI from DB sugarcane_ai: {e}")
            return None

    @staticmethod
    def update_camera_roi(camera_id: int, roi_config: Dict[str, Any]) -> bool:
        try:
            with get_ai_db_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        "UPDATE ai_cameras SET roi_config = %s, updated_at = NOW() WHERE id = %s",
                        (json.dumps(roi_config), camera_id)
                    )
                    conn.commit()
                    return True
        except Exception as e:
            logger.error(f"Error updating camera ROI in DB sugarcane_ai: {e}")
            return False

    # --- Cycle Scanning Management (to DB: sugarcane_ai) ---
    @staticmethod
    def start_cycle(camera_id: int, model_version: str, cycle_code: Optional[str] = None) -> Dict[str, Any]:
        from datetime import datetime, timezone
        from uuid import uuid4
        if not cycle_code:
            cycle_code = f"CYC-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:6]}"
        try:
            with get_ai_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    # Ensure camera_id exists
                    cursor.execute("""
                        INSERT INTO ai_cameras (id, camera_code, name, rtsp_url, location)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING;
                    """, (camera_id, f"CAM_{camera_id}", f"Camera #{camera_id}", "http://127.0.0.1", "Meja Tebu"))

                    cursor.execute("""
                        INSERT INTO ai_results (cycle_code, camera_id, model_version, status, start_time)
                        VALUES (%s, %s, %s, 'running', NOW())
                        RETURNING *;
                    """, (cycle_code, camera_id, model_version))
                    res = dict(cursor.fetchone())
                    conn.commit()
                    return res
        except Exception as e:
            logger.error(f"Error starting cycle in sugarcane_ai: {e}")
            raise

    @staticmethod
    def stop_cycle(cycle_code: str) -> Optional[Dict[str, Any]]:
        try:
            with get_ai_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    # Resolve active running cycle if cycle_code matches exact code or camera_id string or latest running cycle
                    cursor.execute("""
                        SELECT cycle_code FROM ai_results 
                        WHERE cycle_code = %s OR (status = 'running' AND camera_id::text = %s)
                        ORDER BY id DESC LIMIT 1;
                    """, (cycle_code, cycle_code))
                    found = cursor.fetchone()
                    if found:
                        cycle_code = found["cycle_code"]

                    # Calculate aggregated metrics from raw inference results
                    cursor.execute("""
                        SELECT 
                            COUNT(*) as total_frames,
                            AVG(total_impurity) as avg_impurity,
                            AVG(confidence) as avg_confidence,
                            MODE() WITHIN GROUP (ORDER BY detected_class) as majority_class,
                            (SELECT snapshot_path FROM ai_inference_results WHERE cycle_code = %s ORDER BY confidence DESC LIMIT 1) as best_snapshot,
                            (SELECT json_agg(snapshot_path) FROM ai_inference_results WHERE cycle_code = %s AND snapshot_path IS NOT NULL) as all_snapshots
                        FROM ai_inference_results
                        WHERE cycle_code = %s;
                    """, (cycle_code, cycle_code, cycle_code))
                    agg = cursor.fetchone()

                    if not agg or agg["total_frames"] == 0:
                        cursor.execute("""
                            UPDATE ai_results
                            SET status = 'completed', end_time = NOW()
                            WHERE cycle_code = %s
                            RETURNING *;
                        """, (cycle_code,))
                    else:
                        cursor.execute("""
                            UPDATE ai_results
                            SET status = 'completed',
                                end_time = NOW(),
                                total_frames_scanned = %s,
                                avg_total_impurity = ROUND(%s::numeric, 2),
                                confidence_avg = ROUND(%s::numeric, 4),
                                majority_class = %s,
                                best_snapshot_path = %s,
                                snapshot_paths = %s
                            WHERE cycle_code = %s
                            RETURNING *;
                        """, (
                            agg["total_frames"], agg["avg_impurity"],
                            agg["avg_confidence"], agg["majority_class"],
                            agg["best_snapshot"], json.dumps(agg["all_snapshots"] or []), cycle_code
                        ))

                    res = dict(cursor.fetchone()) if cursor.rowcount else None
                    conn.commit()
                    return res
        except Exception as e:
            logger.error(f"Error stopping cycle in sugarcane_ai: {e}")
            return None

    @staticmethod
    def save_inference_result(
        camera_id: int,
        model_version: str,
        snapshot_path: str,
        classes_score: Dict[str, float],
        total_impurity: float,
        detected_class: str,
        confidence: float,
        image_blob: Optional[bytes] = None,
        cycle_id: Optional[int] = None,
        cycle_code: Optional[str] = None
    ) -> Optional[int]:
        try:
            with get_ai_db_connection() as conn:
                with conn.cursor() as cursor:
                    # Auto-link to active running cycle if cycle_code was not explicitly supplied
                    if not cycle_code:
                        cursor.execute("""
                            SELECT id, cycle_code FROM ai_results 
                            WHERE camera_id = %s AND status = 'running' 
                            ORDER BY id DESC LIMIT 1;
                        """, (camera_id,))
                        active_cycle = cursor.fetchone()
                        if active_cycle:
                            cycle_id = active_cycle[0]
                            cycle_code = active_cycle[1]

                    cursor.execute("""
                        INSERT INTO ai_cameras (id, camera_code, name, rtsp_url, location)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING;
                    """, (camera_id, f"CAM_{camera_id}", f"Camera #{camera_id}", "http://127.0.0.1", "Meja Tebu"))

                    cursor.execute("""
                        INSERT INTO ai_inference_results (
                            cycle_id, cycle_code, camera_id, model_version, snapshot_path, image_blob,
                            classes_score, total_impurity, detected_class,
                            confidence
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING id;
                    """, (
                        cycle_id, cycle_code, camera_id, model_version, snapshot_path,
                        image_blob, json.dumps(classes_score),
                        total_impurity, detected_class,
                        confidence
                    ))
                    result = cursor.fetchone()
                    conn.commit()
                    return result[0] if result else None
        except Exception as e:
            logger.error(f"Error saving inference result to sugarcane_ai: {e}")
            return None

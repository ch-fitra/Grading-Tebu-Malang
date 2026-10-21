from __future__ import annotations

import json
import logging
from contextlib import closing
from typing import Dict, Any, Optional, List
from db.connection import get_ai_db_connection, get_auth_db_connection
from psycopg2.extras import RealDictCursor

logger = logging.getLogger("ai_repository")


class AIRepository:
    """Data Access Layer for AI Service operating on sugarcane_ai DB and reading sugarcane Auth DB."""

    @staticmethod
    def history_summary(camera_ids: List[int], start_at=None, end_at=None, search: str = "") -> Dict[str, Any]:
        """Aggregate ALL saved history, independently of the API's 1,000-row preview."""
        if not camera_ids:
            return {"total_captures": 0, "average_confidence": None, "average_impurity": None}
        conditions = ["i.camera_id = ANY(%s)"]
        params = [camera_ids]
        if start_at is not None:
            conditions.append("i.created_at >= %s")
            params.append(start_at)
        if end_at is not None:
            conditions.append("i.created_at < %s")
            params.append(end_at)
        if search:
            pattern = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            conditions.append("""(
                concat_ws(' ', i.id, i.grade, i.created_at, c.name) ILIKE %s
                OR EXISTS (
                    SELECT 1 FROM truck_inspection_captures tc
                    JOIN truck_inspections t ON t.id = tc.inspection_id
                    WHERE tc.inference_id = i.id
                      AND concat_ws(' ', t.truck_code, t.plate_number, t.driver_name) ILIKE %s
                )
            )""")
            params.extend([pattern, pattern])
        with closing(get_auth_db_connection()) as conn, conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute("""
                    SELECT COUNT(*) AS total_captures,
                           AVG(i.confidence) AS average_confidence,
                           AVG(i.daun_percent + i.pucuk_percent + i.sampah_percent) AS average_impurity
                    FROM inference_results i
                    LEFT JOIN cameras c ON c.id = i.camera_id
                    WHERE """ + " AND ".join(conditions), params)
                row = cursor.fetchone()
                return {"total_captures": int(row["total_captures"]),
                        "average_confidence": float(row["average_confidence"]) if row["average_confidence"] is not None else None,
                        "average_impurity": float(row["average_impurity"]) if row["average_impurity"] is not None else None}

    # --- Auth & User Validation (from DB: sugarcane) ---
    @staticmethod
    def history_page(camera_id: int, page: int = 1, page_size: int = 10, cycle_code: Optional[str] = None) -> Dict[str, Any]:
        """Read one page from the full history; totals never use a preview array."""
        conditions = ["i.camera_id = %s"]
        params = [camera_id]
        if cycle_code:
            conditions.append("""EXISTS (
                SELECT 1 FROM truck_inspections t WHERE t.id = %s AND t.line = i.camera_id
                AND (EXISTS (SELECT 1 FROM truck_inspection_captures tc WHERE tc.inspection_id = t.id AND tc.inference_id = i.id)
                     OR (i.created_at >= t.started_at AND i.created_at <= COALESCE(t.completed_at, NOW())))
            )""")
            params.append(cycle_code)
        where = " AND ".join(conditions)
        with closing(get_auth_db_connection()) as conn, conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute("SELECT COUNT(*) AS total FROM inference_results i WHERE " + where, params)
                total = int(cursor.fetchone()["total"])
                pages = max(1, (total + page_size - 1) // page_size)
                page = min(max(1, page), pages)
                cursor.execute("""
                    SELECT i.*, CASE WHEN links.cycle IS NULL THEN 1 ELSE
                        ROW_NUMBER() OVER (PARTITION BY links.cycle ORDER BY i.created_at, i.id) END AS frame_number
                    FROM inference_results i
                    LEFT JOIN (SELECT inference_id, MIN(inspection_id::text) AS cycle
                               FROM truck_inspection_captures GROUP BY inference_id) links ON links.inference_id = i.id
                    WHERE """ + where + " ORDER BY i.created_at DESC, i.id DESC LIMIT %s OFFSET %s",
                    [*params, page_size, (page - 1) * page_size])
                items = [{
                    "id": int(row["id"]), "cameraId": int(row["camera_id"]),
                    "timestamp": row["created_at"].isoformat(), "grade": row["grade"],
                    "classes": {"daun": float(row["daun_percent"]), "pucuk": float(row["pucuk_percent"]), "sampah": float(row["sampah_percent"])},
                    "confidence": float(row["confidence"]), "snapshot": row["snapshot_path"],
                    "frameNumber": int(row["frame_number"]),
                } for row in cursor.fetchall()]
        # Preserve the actual model class/scores for older captures, just as the existing API does.
        paths = [item["snapshot"].lstrip("/") for item in items if item["snapshot"]]
        if paths:
            with closing(get_ai_db_connection()) as conn, conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute("""SELECT DISTINCT ON (snapshot_path) snapshot_path,detected_class,classes_score
                        FROM ai_inference_results WHERE snapshot_path = ANY(%s) ORDER BY snapshot_path,id DESC""", (paths,))
                    detections = {row["snapshot_path"]: row for row in cursor.fetchall()}
            for item in items:
                detection = detections.get((item["snapshot"] or "").lstrip("/"))
                if detection and detection["detected_class"] in ("S", "M", "A", "D", "B", "T", "G", "X"):
                    item["grade"] = detection["detected_class"]
                    item["classScores"] = detection["classes_score"]
        return {"items": items, "total": total, "page": page, "page_size": page_size, "pages": pages}

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
    def create_auto_inspection(camera_id: int, cycle_code: str):
        """Use the existing dashboard inspection schema without changing the API service."""
        with closing(get_auth_db_connection()) as conn, conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT id FROM truck_inspections WHERE line = %s AND status = 'active'", (camera_id,))
                if cursor.fetchone():
                    raise RuntimeError("Masih ada siklus aktif pada kamera ini")
                cursor.execute("""
                    INSERT INTO truck_inspections (id, truck_code, line, status, notes)
                    VALUES (%s, %s, %s, 'active', %s)
                """, (cycle_code, "Siklus Auto " + cycle_code[:8], camera_id,
                      "[AUTO_FRAME] Full frame 3 detik; grading maksimum 30 detik"))

    @staticmethod
    def has_running_cycle(camera_id: int) -> bool:
        with closing(get_ai_db_connection()) as conn, conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1 FROM ai_results WHERE camera_id = %s AND status = 'running' LIMIT 1", (camera_id,))
                return cursor.fetchone() is not None

    @staticmethod
    def has_active_inspection(camera_id: int) -> bool:
        with closing(get_auth_db_connection()) as conn, conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1 FROM truck_inspections WHERE line = %s AND status = 'active' LIMIT 1", (camera_id,))
                return cursor.fetchone() is not None

    @staticmethod
    def discard_auto_inspection(cycle_code: str):
        with closing(get_auth_db_connection()) as conn, conn:
            with conn.cursor() as cursor:
                cursor.execute("DELETE FROM truck_inspections WHERE id = %s AND notes LIKE '[AUTO_FRAME]%%'", (cycle_code,))

    @staticmethod
    def complete_auto_inspection(cycle_code: str, summary: Dict[str, Any]):
        grade = summary.get("majority_class")
        decision = ("MBS" if grade in ("S", "M", "A") else "NON_MBS" if grade in ("D", "B")
                    else "DITOLAK_DO" if grade in ("G", "X") else "PENDING")
        with closing(get_auth_db_connection()) as conn, conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE truck_inspections SET status = 'completed', completed_at = COALESCE(completed_at, NOW()),
                        final_decision = %s, average_impurity = %s, average_confidence = %s
                    WHERE id = %s AND notes LIKE '[AUTO_FRAME]%%'
                """, (decision, summary.get("avg_total_impurity") or 0,
                      summary.get("confidence_avg") or 0, cycle_code))

    @staticmethod
    def unfinished_auto_inspections() -> List[str]:
        with closing(get_auth_db_connection()) as conn, conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT id FROM truck_inspections WHERE status = 'active' AND notes LIKE '[AUTO_FRAME]%%'")
                return [str(row[0]) for row in cursor.fetchall()]

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
                            SET status = 'completed', end_time = COALESCE(end_time, NOW())
                            WHERE cycle_code = %s
                            RETURNING *;
                        """, (cycle_code,))
                    else:
                        cursor.execute("""
                            UPDATE ai_results
                            SET status = 'completed',
                                end_time = COALESCE(end_time, NOW()),
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
        cycle_code: Optional[str] = None,
        captured_at: Optional[str] = None
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
                            confidence, created_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s::timestamptz, NOW()))
                        RETURNING id;
                    """, (
                        cycle_id, cycle_code, camera_id, model_version, snapshot_path,
                        image_blob, json.dumps(classes_score),
                        total_impurity, detected_class,
                        confidence, captured_at
                    ))
                    result = cursor.fetchone()
                    conn.commit()
                    return result[0] if result else None
        except Exception as e:
            logger.error(f"Error saving inference result to sugarcane_ai: {e}")
            return None

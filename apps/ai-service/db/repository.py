from __future__ import annotations

import json
import logging
from pathlib import Path
from contextlib import closing
from typing import Dict, Any, Optional, List
from db.connection import get_ai_db_connection, get_auth_db_connection
from psycopg2.extras import RealDictCursor

logger = logging.getLogger("ai_repository")


def malang_roi(camera_id: int, station: int):
    if station != 2:
        return None
    template = json.loads((Path(__file__).resolve().parents[1] / "models" / "malang_roi.json").read_text(encoding="utf-8"))
    return {**template, "camera_id": camera_id}


class AIRepository:
    """Data Access Layer for AI Service operating on sugarcane_ai DB and reading sugarcane Auth DB."""

    @staticmethod
    def sync_application_cameras():
        """The application database owns camera configuration, including disabled cameras."""
        with closing(get_auth_db_connection()) as conn, conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute("SELECT id,name,rtsp_url,location,enabled,station FROM cameras")
                cameras = cursor.fetchall()
        with closing(get_ai_db_connection()) as conn, conn:
            with conn.cursor() as cursor:
                cursor.execute("UPDATE ai_cameras SET is_active=false WHERE NOT (id = ANY(%s::int[]))", ([camera["id"] for camera in cameras],))
                for camera in cameras:
                    cursor.execute("""INSERT INTO ai_cameras(id,camera_code,name,rtsp_url,location,is_active)
                        VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET
                        name=EXCLUDED.name,rtsp_url=EXCLUDED.rtsp_url,location=EXCLUDED.location,
                        is_active=EXCLUDED.is_active,updated_at=NOW()""",
                        (camera["id"], f"CAM_API_{camera['id']}", camera["name"], camera["rtsp_url"],
                         camera["location"], bool(camera["enabled"] and camera["rtsp_url"])))

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
                           AVG(i.daun_percent + i.pucuk_percent + i.sampah_percent) FILTER (WHERE i.impurity_measured IS TRUE) AS average_impurity
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
                    "modelOutput": row.get("model_output"),
                    "confidence": float(row["confidence"]), "snapshot": row["snapshot_path"],
                    "frameNumber": int(row["frame_number"]),
                    "impurityMeasured": row["impurity_measured"] is True,
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
                if detection and isinstance(detection["detected_class"], str) and detection["detected_class"].strip():
                    item["grade"] = detection["detected_class"]
                    if not any(key in (detection["classes_score"] or {}) for key in ("daun", "pucuk", "sampah")):
                        item["classScores"] = detection["classes_score"]
        return {"items": items, "total": total, "page": page, "page_size": page_size, "pages": pages}

    @staticmethod
    def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
        try:
            with closing(get_auth_db_connection()) as conn, conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute("SELECT u.id, u.username, u.password_hash, r.code as role FROM app_users u JOIN roles r ON r.id = u.role_id WHERE u.username = %s AND u.active = true", (username,))
                    res = cursor.fetchone()
                    return dict(res) if res else None
        except Exception as e:
            logger.error(f"Error fetching user from auth db: {e}")
            return None

    # --- Camera Management (from DB: sugarcane_ai) ---
    @staticmethod
    def register_camera(camera_id: int, rtsp_url: str, name: str):
        with closing(get_auth_db_connection()) as conn, conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT station FROM cameras WHERE id=%s", (camera_id,))
                camera = cursor.fetchone()
        template = malang_roi(camera_id, camera[0]) if camera else None
        with closing(get_ai_db_connection()) as conn, conn:
            with conn.cursor() as cursor:
                cursor.execute("""INSERT INTO ai_cameras(id,camera_code,name,rtsp_url,is_active,roi_config)
                    VALUES(%s,%s,%s,%s,true,%s) ON CONFLICT(id) DO UPDATE
                    SET name=EXCLUDED.name,rtsp_url=EXCLUDED.rtsp_url,is_active=true,
                    roi_config=COALESCE(ai_cameras.roi_config,EXCLUDED.roi_config),updated_at=NOW()""",
                    (camera_id, f"CAM_API_{camera_id}", name, rtsp_url, json.dumps(template) if template else None))

    @staticmethod
    def deactivate_camera(camera_id: int):
        with closing(get_ai_db_connection()) as conn, conn:
            with conn.cursor() as cursor:
                cursor.execute("UPDATE ai_cameras SET is_active=false,updated_at=NOW() WHERE id=%s", (camera_id,))

    @staticmethod
    def get_active_cameras() -> List[Dict[str, Any]]:
        try:
            with closing(get_ai_db_connection()) as conn, conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute("SELECT * FROM ai_cameras WHERE is_active = true ORDER BY id ASC")
                    return [dict(r) for r in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error fetching active cameras: {e}")
            return []

    @staticmethod
    def get_camera_roi(camera_id: int) -> Optional[Dict[str, Any]]:
        try:
            with closing(get_ai_db_connection()) as conn, conn:
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
            with closing(get_ai_db_connection()) as conn, conn:
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

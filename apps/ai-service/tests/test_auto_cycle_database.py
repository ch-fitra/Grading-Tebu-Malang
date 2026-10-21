"""Opt-in PostgreSQL integration; all inserts are rolled back in both databases."""
import os
import sys
import unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch
from datetime import datetime, timezone, timedelta

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db.repository as repository
from db.connection import get_ai_db_connection, get_auth_db_connection
from db.repository import AIRepository


class RollbackOnly:
    def __init__(self, conn): self.conn = conn
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def cursor(self, *args, **kwargs): return self.conn.cursor(*args, **kwargs)
    def commit(self): pass
    def close(self): pass


@unittest.skipUnless(os.getenv("AI_TEST_DATABASE") == "1", "Set AI_TEST_DATABASE=1 for rollback-only PostgreSQL integration")
class DatabaseIntegrationTests(unittest.TestCase):
    def test_history_summary_counts_beyond_preview_limit_with_filters(self):
        conn = get_auth_db_connection()
        camera_ids = [1900000001, 1900000002]
        now = datetime.now(timezone.utc)
        try:
            with conn.cursor() as cursor:
                cursor.execute("""INSERT INTO cameras(id,name,rtsp_url) VALUES
                    (%s,'Summary_Test%%_','rtsp://rollback-only'),
                    (%s,'Other factory','rtsp://rollback-only')""", camera_ids)
                cursor.execute("""INSERT INTO inference_results(camera_id,grade,daun_percent,pucuk_percent,sampah_percent,confidence,created_at)
                    SELECT %s, CASE WHEN n=1005 THEN 'T' ELSE 'A' END, 1,2,3,0.9,
                        %s::timestamptz - CASE WHEN n<=1000 THEN interval '0 days' ELSE interval '10 days' END
                    FROM generate_series(1,1005) n""", (camera_ids[0], now))
                cursor.execute("""INSERT INTO inference_results(camera_id,grade,confidence)
                    SELECT %s,'B',0.5 FROM generate_series(1,3)""", (camera_ids[1],))
            with patch.object(repository, "get_auth_db_connection", return_value=RollbackOnly(conn)):
                total = AIRepository.history_summary([camera_ids[0]])
                self.assertEqual(total["total_captures"], 1005)
                self.assertAlmostEqual(total["average_confidence"], .9)
                self.assertAlmostEqual(total["average_impurity"], 6)
                self.assertEqual(AIRepository.history_summary(camera_ids)["total_captures"], 1008)
                self.assertEqual(AIRepository.history_summary([camera_ids[1]])["total_captures"], 3)
                self.assertEqual(AIRepository.history_summary([camera_ids[0]], now-timedelta(days=1), now+timedelta(days=1))["total_captures"], 1000)
                self.assertEqual(AIRepository.history_summary([camera_ids[0]], search="T")["total_captures"], 1005)  # camera name also matches
                self.assertEqual(AIRepository.history_summary(camera_ids, search="%_")["total_captures"], 1005)  # literal wildcard characters
                self.assertEqual(AIRepository.history_summary(camera_ids, search="missing-unique-query")["total_captures"], 0)
                self.assertEqual(AIRepository.history_summary([])["total_captures"], 0)
                code = str(uuid4())
                AIRepository.create_auto_inspection(camera_ids[0], code)
                with conn.cursor() as cursor:
                    cursor.execute("UPDATE truck_inspections SET plate_number='TEST-HISTORY-COUNT' WHERE id=%s", (code,))
                    cursor.execute("""INSERT INTO truck_inspection_captures(inspection_id,inference_id)
                        SELECT %s,id FROM inference_results WHERE camera_id=%s ORDER BY id LIMIT 1""", (code,camera_ids[0]))
                self.assertEqual(AIRepository.history_summary(camera_ids, search="TEST-HISTORY-COUNT")["total_captures"], 1)
                with conn.cursor() as cursor:
                    cursor.execute("""INSERT INTO truck_inspection_captures(inspection_id,inference_id)
                        SELECT %s,id FROM inference_results WHERE camera_id=%s ON CONFLICT DO NOTHING""", (code,camera_ids[0]))
                first = AIRepository.history_page(camera_ids[0], 1, 10)
                self.assertEqual((first["total"], first["pages"], len(first["items"])), (1005, 101, 10))
                self.assertEqual([item["frameNumber"] for item in first["items"]], list(range(1005,995,-1)))
                last = AIRepository.history_page(camera_ids[0], 101, 10)
                self.assertEqual(len(last["items"]), 5)
                self.assertTrue({item["id"] for item in first["items"]}.isdisjoint(item["id"] for item in last["items"]))
                self.assertEqual(AIRepository.history_page(camera_ids[0], 999999, 10)["page"], 101)
                self.assertEqual(AIRepository.history_page(camera_ids[1], 1, 10)["total"], 3)
                self.assertEqual(AIRepository.history_page(camera_ids[0], 1, 10, code)["total"], 1005)
        finally:
            conn.rollback()
            conn.close()

    def test_auto_inspection_and_grade_summary_share_cycle_code(self):
        primary = get_auth_db_connection()
        ai = get_ai_db_connection()
        code = str(uuid4())
        camera_id = 1900000000
        try:
            with patch.object(repository, "get_auth_db_connection", return_value=RollbackOnly(primary)), \
                 patch.object(repository, "get_ai_db_connection", return_value=RollbackOnly(ai)):
                self.assertFalse(AIRepository.has_active_inspection(camera_id))
                AIRepository.create_auto_inspection(camera_id, code)
                self.assertTrue(AIRepository.has_active_inspection(camera_id))
                cycle = AIRepository.start_cycle(camera_id, "auto-integration", code)
                self.assertTrue(AIRepository.has_running_cycle(camera_id))
                for confidence in (.91, .95):
                    result = AIRepository.save_inference_result(
                        camera_id, "auto-integration", "storage/snapshots/rollback-only.jpg",
                        {"A": 90, "B": 5, "T": 5}, 100, "A", confidence,
                        cycle_id=cycle["id"], cycle_code=code)
                    self.assertIsNotNone(result)
                summary = AIRepository.stop_cycle(code)
                self.assertEqual(summary["total_frames_scanned"], 2)
                self.assertEqual(summary["majority_class"], "A")
                self.assertFalse(AIRepository.has_running_cycle(camera_id))
                AIRepository.complete_auto_inspection(code, summary)
                self.assertFalse(AIRepository.has_active_inspection(camera_id))
                with primary.cursor() as cursor:
                    cursor.execute("SELECT status, final_decision, average_confidence FROM truck_inspections WHERE id=%s", (code,))
                    status, decision, confidence = cursor.fetchone()
                    self.assertEqual((status, decision), ("completed", "MBS"))
                    self.assertAlmostEqual(confidence, .93)
                # Completion retries retain the original stop time.
                self.assertEqual(AIRepository.stop_cycle(code)["end_time"], summary["end_time"])
        finally:
            primary.rollback()
            ai.rollback()
            primary.close()
            ai.close()


if __name__ == "__main__":
    unittest.main()

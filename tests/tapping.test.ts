import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { parseExcelOrCsv, parseTrangkilDate, getAiGrade, matchTappingRecords, reassignTapping, swapTapping, type TappingRecord } from "../apps/web/src/utils/tapping.ts";
import type { TruckInspectionSession } from "../apps/web/src/types.ts";

const cycle = (id: string, line = 5, startedAt = "2026-09-30T12:30:00+07:00"): TruckInspectionSession => ({
  id, line, startedAt, status: "completed", truckCode: id, captureIds: [], finalDecision: "PENDING", averageImpurity: 0, averageConfidence: 0, totalCaptures: 0
});
const tap = (id: string, noMeja = 5, time: string | null = "2026-09-30T12:20:00+07:00"): TappingRecord => ({
  id, noMeja, queueNumber: id, tappingTime: time ? new Date(time) : null, tappingTimeStr: "", plateNumber: id, driverName: "", supplier: "", spatNumber: ""
});
function file(rows: unknown[][], date1904 = false, type: "xlsx" | "xls" = "xlsx") {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "DATA");
  book.Workbook = { WBProps: { date1904 } };
  const data = XLSX.write(book, { type: "array", bookType: type });
  return { name: `test.${type}`, arrayBuffer: async () => data };
}

test("Excel numeric date retains the local wall-clock timestamp", () => {
  const serial = 46295 + (12 * 3600 + 20 * 60 + 32) / 86400;
  for (const raw of [serial, String(serial)]) {
    const date = parseTrangkilDate(raw)!;
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 8);
    assert.equal(date.getDate(), 30);
    assert.equal(date.getHours(), 12);
    assert.equal(date.getMinutes(), 20);
    assert.equal(date.getSeconds(), 32);
  }
});
test("dates reject invalid calendar values and time-only cells without a date", () => {
  for (const raw of ["2026-02-30 10:00:00", "2026-09-30 25:00:00", "25:30", "12:20", "garbage", new Date(NaN)]) assert.equal(parseTrangkilDate(raw), null);
  assert.equal(parseTrangkilDate("12:20:32", new Date(2026, 8, 30))!.getHours(), 12);
});
test("XLSX and XLS import real date cells and distinct queue/plate columns", async () => {
  for (const type of ["xlsx", "xls"] as const) {
    const { records } = await parseExcelOrCsv(file([
      ["kd_antrian", "no_meja", "mbs", "kode", "tgl_nilai", "tgl_daftar", "nopol"],
      ["26K001", 5, 3, "a", 46295.5, 46295.4, "K 1234 AB"]
    ], false, type));
    assert.equal(records[0].queueNumber, "26K001");
    assert.equal(records[0].plateNumber, "K 1234 AB");
    assert.equal(records[0].factoryGrade, "A");
    assert.equal(records[0].tappingTime!.getHours(), 12);
  }
});
test("1904 workbooks use their own date epoch", async () => {
  const { records } = await parseExcelOrCsv(file([["kd_antrian", "no_meja", "tgl_nilai"], ["26K002", 5, 44833.5]], true));
  assert.equal(records[0].tappingTime!.getFullYear(), 2026);
  assert.equal(records[0].tappingTime!.getDate(), 30);
});
test("numeric Excel time-only cells use the registration date", async () => {
  const { records } = await parseExcelOrCsv(file([["kd_antrian", "no_meja", "tgl_nilai", "tgl_daftar"], ["26K002", 5, 0.5, 46295.4]]));
  assert.equal(records[0].tappingTime!.getFullYear(), 2026);
  assert.equal(records[0].tappingTime!.getHours(), 12);
});
test("CSV preserves leading zeros and rejects unrelated spreadsheets", async () => {
  const csv = "kd_antrian,no_meja,kode,tgl_nilai\n00123,5,A,2026-09-30 12:20:00";
  const { records } = await parseExcelOrCsv({ name: "test.csv", arrayBuffer: async () => new TextEncoder().encode(csv).buffer });
  assert.equal(records[0].queueNumber, "00123");
  await assert.rejects(parseExcelOrCsv(file([["customer", "value"], ["Joe", 23]])), /kd_antrian/);
});
test("headerless imports retain the first row and invalid meja values stay unassigned", async () => {
  const { records, stats } = await parseExcelOrCsv(file([["26K003", "1.5", 3, "A", "2026-09-30 12:20:00", "2026-09-30 12:00:00"]]));
  assert.equal(records.length, 1);
  assert.equal(records[0].noMeja, undefined);
  assert.equal(stats.unassignedMeja, 1);
});
test("matching never assigns records from another table, another day, or without a timestamp", () => {
  const result = matchTappingRecords([cycle("a"), cycle("b", 1)], [tap("wrong-table", 2), tap("old", 5, "2026-09-29T12:20:00+07:00"), tap("missing", 5, null)], c => c.line);
  assert.ok(result.every(row => row.assignedTappingId === null));
});
test("manual assignments and skipped rows survive polling; records cannot be assigned twice", () => {
  const cycles = [cycle("a"), cycle("b")];
  const records = [tap("one"), tap("two")];
  const initial = matchTappingRecords(cycles, records, c => c.line);
  const edited = reassignTapping(initial, "b", "one");
  assert.equal(edited[0].assignedTappingId, null);
  const refreshed = matchTappingRecords(cycles.map(c => ({ ...c })), records, c => c.line, edited);
  assert.equal(refreshed[0].assignedTappingId, null);
  assert.equal(refreshed[1].assignedTappingId, "one");
});
test("swapping uses cycle IDs even when visible rows are filtered", () => {
  const rows = ["a", "b", "c"].map(id => ({ cycle: cycle(id), assignedTappingId: id, isManualOverride: false }));
  const result = swapTapping(rows, "a", "c");
  assert.deepEqual(result.map(row => row.assignedTappingId), ["c", "b", "a"]);
});
test("grade boundaries include the X rejection grade", () => {
  assert.deepEqual([0, 2, 5, 10, 15, 20, 35, 36].map(getAiGrade), ["S", "S", "M", "A", "D", "B", "G", "X"]);
});

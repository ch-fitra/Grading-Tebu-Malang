export type HistoryDateFilter = "all" | "today" | "7d" | "30d" | "date" | "range";
export type HistoryDateRange = { start?: string; end?: string; error?: string; label: string };

export function jakartaDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function midnight(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}T00:00:00+07:00`);
  return Number.isFinite(time) && jakartaDate(new Date(time)) === value ? time : NaN;
}
export function historyDateRange(mode: HistoryDateFilter, from: string, to: string, now = new Date()): HistoryDateRange {
  if (mode === "all") return { label: "Semua Waktu" };
  let start: number, end: number;
  if (mode === "date" || mode === "range") {
    if (!from || (mode === "range" && !to)) return { label: "Pilih tanggal", error: "Lengkapi tanggal untuk menampilkan riwayat." };
    start = midnight(from);
    end = midnight(mode === "date" ? from : to);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { label: "Tanggal tidak valid", error: "Tanggal tidak valid." };
    if (end < start) return { label: "Rentang tidak valid", error: "Tanggal akhir harus sama dengan atau setelah tanggal awal." };
    end += 86400000;
  } else {
    end = midnight(jakartaDate(now)) + 86400000;
    start = end - (mode === "7d" ? 7 : mode === "30d" ? 30 : 1) * 86400000;
  }
  const display = (time: number) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" }).format(new Date(time));
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), label: `${display(start)}${end - start > 86400000 ? ` sampai ${display(end - 1)}` : ""} (WIB)` };
}
export function withinHistoryRange(timestamp: string, range: HistoryDateRange): boolean {
  if (range.error) return false;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && (!range.start || time >= Date.parse(range.start)) && (!range.end || time < Date.parse(range.end));
}

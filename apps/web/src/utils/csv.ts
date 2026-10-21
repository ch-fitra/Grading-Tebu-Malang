export function serializeCsv(rows: Array<Array<string | number>>) {
  return "\uFEFF" + rows.map(row => row.map(cell => {
    const value = String(cell);
    const safe = typeof cell === "string" && /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = serializeCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

import type { Workbook } from "./import-validation";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "result" in value) return cell(value.result);
  return String(value);
}

export async function readWorkbook(file: File): Promise<Workbook> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("请选择 .xlsx 格式文件。");
  if (file.size > 10 * 1024 * 1024) throw new Error("Excel 文件不能超过 10 MB。");
  const { readSheet } = await import("read-excel-file/browser");
  const data = await readSheet(file, 1);
  if (!data || data.length < 2) throw new Error("文件没有可读取的数据。");
  const width = data.reduce((max, row) => Math.max(max, row.length), 0);
  if (width > 500) throw new Error("Excel 列数过多，请拆分文件。");
  const headers = Array.from({ length: width }, (_, i) => cell(data[0]?.[i]).trim());
  const rows = data.slice(1).map(row => Array.from({ length: width }, (_, i) => cell(row[i])))
    .filter(row => row.some(value => value.trim()));
  return { headers, rows };
}

export function downloadCsv(filename: string, rows: string[][]) {
  // Neutralize spreadsheet-formula injection in user-controlled names.
  const escape = (value: string) => {
    const safe = /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const csv = "\uFEFF" + rows.map(row => row.map(escape).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import { unzipSync, type UnzipFileInfo } from "fflate";
import { googlePackageName } from "../billing/google/contracts";
import { assertDistinctHeaders, findHeaderIndex } from "./reportFiles";
import { decodePlayReportFile, routePlayObject, type PlayMappedRow, type PlayObjectRoute } from "./playReports";

const maximumArchiveBytes = 64 * 1024 * 1024;
const maximumCsvEntries = 20;
const financialHeaders = [
  "Order Number", "Order Charged Date", "Order Charged Timestamp", "Financial Status",
  "Package ID", "Product Type", "SKU ID", "Currency of Sale", "Item Price",
  "Taxes Collected", "Charged Amount", "Base Plan or Purchase Option ID", "Offer ID", "Sales Channel",
] as const;

export function decodeGoogleSalesArchive(
  bytes: Buffer, objectName: string,
): Readonly<{ route: PlayObjectRoute; header: ReadonlyArray<string>; rows: ReadonlyArray<PlayMappedRow> }> {
  const month = /^sales\/salesreport_(\d{4})(0[1-9]|1[0-2])\.zip$/.exec(objectName);
  if (month === null) throw new Error("Google sales archive must be sales/salesreport_YYYYMM.zip.");
  const entries: Array<UnzipFileInfo> = [];
  unzipSync(bytes, { filter: (entry) => { entries.push(entry); return false; } });
  const csvEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith(".csv"));
  if (csvEntries.length === 0 || csvEntries.length > maximumCsvEntries
    || csvEntries.reduce((total, entry) => total + entry.originalSize, 0) > maximumArchiveBytes) {
    throw new Error("Google sales archive must contain 1–20 CSV entries totaling at most 64 MiB.");
  }
  const names = new Set(csvEntries.map((entry) => entry.name));
  if (names.size !== csvEntries.length) throw new Error("Google sales archive contains duplicate CSV names.");
  const extracted = unzipSync(bytes, { filter: (entry) => names.has(entry.name) });
  const rows: Array<PlayMappedRow> = [];
  for (const entry of csvEntries) {
    const label = "Google sales CSV";
    const file = decodePlayReportFile(Buffer.from(extracted[entry.name]), label);
    assertDistinctHeaders(file.header, label);
    const indexes = new Map(financialHeaders.map((header) => [header, findHeaderIndex(file.header, header)]));
    for (const required of ["Order Number", "Order Charged Date", "Order Charged Timestamp", "Package ID"]) {
      if (findHeaderIndex(file.header, required) === null) throw new Error(`Google sales CSV is missing ${required}.`);
    }
    for (const row of file.rows) {
      const columns: Record<string, string> = {};
      for (const [header, index] of indexes) {
        if (index !== null) columns[header] = row[index].trim();
      }
      if (columns["Package ID"] !== googlePackageName) continue;
      const orderId = columns["Order Number"];
      const chargedAt = Number(columns["Order Charged Timestamp"]);
      const reportDate = columns["Order Charged Date"];
      if (!/^GPA\.\d{4}-\d{4}-\d{4}-\d{5}(?:\.\.\d+)?$/.test(orderId)
        || !/^\d+$/.test(columns["Order Charged Timestamp"]) || !Number.isSafeInteger(chargedAt)
        || chargedAt <= 0 || chargedAt > 8_640_000_000_000
        || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)
        || new Date(chargedAt * 1000).toISOString().slice(0, 10) !== reportDate) {
        throw new Error("Google sales CSV contains an invalid order identifier or charge date/timestamp.");
      }
      rows.push({ reportDate, packageName: googlePackageName, breakdownValue: null,
        typedValues: {}, jsonColumns: columns });
    }
  }
  return { route: { ...routePlayObject(objectName), reportName: "sales", fileMonth: `${month[1]}-${month[2]}-01`,
    packageNameFromObjectName: googlePackageName }, header: financialHeaders, rows };
}

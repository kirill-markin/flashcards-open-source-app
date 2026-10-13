import { parse } from "papaparse";

export type ReportColumnType = "text" | "numeric" | "date";

export type ReportFile = Readonly<{
  header: ReadonlyArray<string>;
  rows: ReadonlyArray<ReadonlyArray<string>>;
}>;

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const numericPattern = /^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

/** Headers are matched by name, ignoring case and spacing, never by position. */
function normalizeHeader(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function findHeaderIndex(header: ReadonlyArray<string>, name: string): number | null {
  const wanted = normalizeHeader(name);
  const index = header.findIndex((candidate) => normalizeHeader(candidate) === wanted);
  return index === -1 ? null : index;
}

export function assertDistinctHeaders(header: ReadonlyArray<string>, label: string): void {
  const seenHeaders = new Set<string>();
  for (const name of header) {
    const normalized = normalizeHeader(name);
    if (seenHeaders.has(normalized)) {
      throw new Error(`${label}: header ${name} appears more than once`);
    }
    seenHeaders.add(normalized);
  }
}

export function readTypedValue(value: string, type: ReportColumnType, context: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  if (type === "date" && !isoDatePattern.test(trimmed)) {
    throw new Error(`${context}: expected a YYYY-MM-DD date, got ${JSON.stringify(value)}`);
  }
  if (type === "numeric" && !numericPattern.test(trimmed)) {
    throw new Error(`${context}: expected a number, got ${JSON.stringify(value)}`);
  }
  return trimmed;
}

/** The first row is the header; every other row must have as many fields. */
export function parseDelimitedReport(content: string, delimiter: string, label: string): ReportFile {
  const result = parse<Array<string>>(content, { delimiter, header: false, skipEmptyLines: true });
  if (result.errors.length > 0) {
    const details = result.errors
      .slice(0, 5)
      .map((error) => `row ${error.row ?? "?"}: ${error.code}: ${error.message}`)
      .join("; ");
    throw new Error(`${label}: parse failed: ${details}`);
  }

  const [header, ...rows] = result.data;
  if (header === undefined) {
    return { header: [], rows: [] };
  }
  const trimmedHeader = header.map((name) => name.trim());
  rows.forEach((row, index) => {
    if (row.length !== trimmedHeader.length) {
      throw new Error(
        `${label}: row ${index + 2} has ${row.length} fields but the header has ${trimmedHeader.length}`,
      );
    }
  });
  return { header: trimmedHeader, rows };
}

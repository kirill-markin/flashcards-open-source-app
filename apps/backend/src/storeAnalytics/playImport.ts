import type { DatabaseExecutor } from "../database";
import { unsafeQuery, unsafeTransaction } from "../database/unsafe";
import {
  addBackendBreadcrumb,
  captureBackendException,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { GoogleStorageClient, type GoogleStorageObject } from "./googleStorageClient";
import {
  decodePlayReportFile,
  mapPlayReportRows,
  playReportTables,
  routePlayObject,
  type PlayMappedRow,
  type PlayObjectRoute,
  type PlayReportTable,
} from "./playReports";

const playReportsBucket = "pubsite_prod_6698442103294061634";
// stats/ covers installs, ratings, crashes, store_performance and every other statistics family.
// reviews/, sales/ and earnings/ are not imported.
const importedPrefixes: ReadonlyArray<string> = ["stats/", "financial-stats/subscriptions/"];
const insertBatchRows = 1_000;

export type PlayImportSummary = Readonly<{
  /** True when the budget was already spent or the lock lost at the start, so the bucket was never listed. */
  listingSkippedForDeadline: boolean;
  objectsListed: number;
  objectsNotCsv: number;
  filesAlreadyImported: number;
  filesImported: number;
  filesReplacingEarlierGeneration: number;
  filesFailed: number;
  filesRemaining: number;
  rowsInserted: Readonly<Record<string, number>>;
}>;

type DownloadedFile = Readonly<{
  object: GoogleStorageObject;
  sourceRef: string;
  route: PlayObjectRoute;
  header: ReadonlyArray<string>;
  rows: ReadonlyArray<PlayMappedRow>;
}>;

type ImportFileIdRow = Readonly<{ id: string }>;
type SourceRefRow = Readonly<{ source_ref: string }>;

function toSourceRef(object: GoogleStorageObject): string {
  return `${object.name}#${object.generation}`;
}

async function loadImportedSourceRefs(sourceRefs: ReadonlyArray<string>): Promise<ReadonlySet<string>> {
  const result = await unsafeQuery<SourceRefRow>(
    `SELECT files.source_ref
     FROM store_analytics.import_files AS files
     WHERE files.store = 'google_play'
       AND files.source_ref = ANY($1::text[])`,
    [sourceRefs],
  );
  return new Set(result.rows.map((row) => row.source_ref));
}

function quoteIdentifier(name: string): string {
  return `"${name}"`;
}

function jsonColumnName(table: PlayReportTable): string {
  return table.kind === "named" ? "extra_columns" : "columns";
}

/** Every inserted column with its SQL type, in the order of the record built by `toRecord`. */
function recordColumns(table: PlayReportTable): ReadonlyArray<Readonly<{ column: string; type: string }>> {
  const typedColumns = [...new Map(table.columns.map((typedColumn) => [typedColumn.column, typedColumn.type])).entries()]
    .map(([column, type]) => ({ column, type }));
  return [
    { column: "import_file_id", type: "bigint" },
    ...(table.kind === "other" ? [{ column: "report_name", type: "text" }] : []),
    { column: "report_date", type: "date" },
    { column: "package_name", type: "text" },
    ...(table.hasBreakdown ? [{ column: "breakdown", type: "text" }, { column: "breakdown_value", type: "text" }] : []),
    ...typedColumns,
    { column: jsonColumnName(table), type: "jsonb" },
  ];
}

function buildInsertRowsSql(table: PlayReportTable): string {
  const columns = recordColumns(table);
  const names = columns.map((entry) => quoteIdentifier(entry.column));
  const definitions = columns.map((entry) => `${quoteIdentifier(entry.column)} ${entry.type}`);
  return `INSERT INTO store_analytics.${quoteIdentifier(table.tableName)} (${names.join(", ")})
    SELECT ${names.map((name) => `incoming.${name}`).join(", ")}
    FROM jsonb_to_recordset($1::jsonb) AS incoming(${definitions.join(", ")})`;
}

function toRecord(file: DownloadedFile, importFileId: string, row: PlayMappedRow): Readonly<Record<string, unknown>> {
  return {
    ...row.typedValues,
    import_file_id: importFileId,
    report_name: file.route.reportName,
    report_date: row.reportDate,
    package_name: row.packageName,
    breakdown: file.route.breakdown,
    breakdown_value: row.breakdownValue,
    [jsonColumnName(file.route.table)]: row.jsonColumns,
  };
}

function reportDateRange(rows: ReadonlyArray<PlayMappedRow>): Readonly<{ from: string | null; to: string | null }> {
  const dates = rows.map((row) => row.reportDate).sort();
  return { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null };
}

async function insertImportFile(executor: DatabaseExecutor, file: DownloadedFile): Promise<string> {
  const range = reportDateRange(file.rows);
  const result = await executor.query<ImportFileIdRow>(
    `INSERT INTO store_analytics.import_files (
       store, report_name, source_ref, file_month, checksum, header, row_count, report_date_from, report_date_to
     )
     VALUES ('google_play', $1, $2, $3::date, $4, $5::text[], $6, $7::date, $8::date)
     RETURNING id::text AS id`,
    [
      file.route.reportName,
      file.sourceRef,
      file.route.fileMonth,
      file.object.md5Hash,
      file.header,
      file.rows.length,
      range.from,
      range.to,
    ],
  );
  return result.rows[0].id;
}

/**
 * Google rewrites a month's file in place as a new generation, so the new generation replaces every
 * earlier one of the same object in one transaction. Deleting an import_files row cascades to the
 * rows imported from it. starts_with, not LIKE: object names contain "_", a LIKE wildcard.
 */
async function writeFile(file: DownloadedFile): Promise<Readonly<{ replacedEarlierGeneration: boolean }>> {
  return unsafeTransaction(async (executor) => {
    const replaced = await executor.query<ImportFileIdRow>(
      `DELETE FROM store_analytics.import_files AS files
       WHERE files.store = 'google_play'
         AND starts_with(files.source_ref, $1::text || '#')
       RETURNING files.id::text AS id`,
      [file.object.name],
    );
    const importFileId = await insertImportFile(executor, file);
    const sql = buildInsertRowsSql(file.route.table);
    const records = file.rows.map((row) => toRecord(file, importFileId, row));
    for (let start = 0; start < records.length; start += insertBatchRows) {
      await executor.query(sql, [JSON.stringify(records.slice(start, start + insertBatchRows))]);
    }
    return { replacedEarlierGeneration: replaced.rows.length > 0 };
  });
}

async function downloadFile(client: GoogleStorageClient, object: GoogleStorageObject): Promise<DownloadedFile> {
  // "#" separates the object name and generation inside import_files.source_ref.
  if (object.name.includes("#")) {
    throw new Error(`Play report object ${object.name} contains "#", which source_ref uses as its separator`);
  }
  const sourceRef = toSourceRef(object);
  const label = `gs://${playReportsBucket}/${sourceRef}`;
  const route = routePlayObject(object.name);
  const file = decodePlayReportFile(await client.downloadObject(playReportsBucket, object), label);
  return { object, sourceRef, route, header: file.header, rows: mapPlayReportRows(route, file, label) };
}

/**
 * Imports every Google Play statistics CSV generation not yet in store_analytics, for every package
 * in the bucket. No new file is started after `deadlineAtMs` or once `signal` aborts (the run lost
 * its lock), and the bucket is not even listed when that is already true at the start; the next run
 * continues with what remains. A failed file is reported and skipped, and the run throws once every
 * other file was attempted.
 */
export async function importPlayReports(
  scope: BackendObservationScope,
  deadlineAtMs: number,
  signal: AbortSignal,
): Promise<PlayImportSummary> {
  const rowsInserted: Record<string, number> = Object.fromEntries(
    playReportTables.map((table) => [table.tableName, 0]),
  );
  if (Date.now() >= deadlineAtMs || signal.aborted) {
    const skippedSummary: PlayImportSummary = {
      listingSkippedForDeadline: true,
      objectsListed: 0,
      objectsNotCsv: 0,
      filesAlreadyImported: 0,
      filesImported: 0,
      filesReplacingEarlierGeneration: 0,
      filesFailed: 0,
      filesRemaining: 0,
      rowsInserted,
    };
    addBackendBreadcrumb({ action: "store_analytics_play_import_completed", scope, details: skippedSummary });
    return skippedSummary;
  }

  const client = new GoogleStorageClient((retry) => {
    addBackendBreadcrumb({ action: "store_analytics_play_retry", scope, details: retry });
  });

  const listed: Array<GoogleStorageObject> = [];
  for (const prefix of importedPrefixes) {
    listed.push(...await client.listObjects(playReportsBucket, prefix));
  }
  const csvObjects = listed.filter((object) => object.name.endsWith(".csv"));
  const importedSourceRefs = await loadImportedSourceRefs(csvObjects.map(toSourceRef));
  const pendingObjects = csvObjects
    .filter((object) => !importedSourceRefs.has(toSourceRef(object)))
    .sort((left, right) => left.name.localeCompare(right.name));

  let filesAttempted = 0;
  let filesImported = 0;
  let filesReplacingEarlierGeneration = 0;
  let filesFailed = 0;

  for (const object of pendingObjects) {
    if (Date.now() >= deadlineAtMs || signal.aborted) {
      break;
    }
    filesAttempted += 1;
    try {
      const file = await downloadFile(client, object);
      const result = await writeFile(file);
      filesImported += 1;
      if (result.replacedEarlierGeneration) {
        filesReplacingEarlierGeneration += 1;
      }
      rowsInserted[file.route.table.tableName] += file.rows.length;
    } catch (error) {
      filesFailed += 1;
      const normalizedError = normalizeCaughtError(error);
      captureBackendException({
        action: "store_analytics_play_file_failed",
        scope,
        error: normalizedError,
        details: {
          objectName: object.name,
          generation: object.generation,
          message: normalizedError.message,
        },
      });
    }
  }

  const summary: PlayImportSummary = {
    listingSkippedForDeadline: false,
    objectsListed: listed.length,
    objectsNotCsv: listed.length - csvObjects.length,
    filesAlreadyImported: csvObjects.length - pendingObjects.length,
    filesImported,
    filesReplacingEarlierGeneration,
    filesFailed,
    filesRemaining: pendingObjects.length - filesAttempted,
    rowsInserted,
  };
  addBackendBreadcrumb({ action: "store_analytics_play_import_completed", scope, details: summary });

  if (filesFailed > 0) {
    throw new Error(`${filesFailed} Google Play report files failed to import; see store_analytics_play_file_failed.`);
  }
  return summary;
}

import type { DatabaseExecutor } from "../database";
import { unsafeQuery, unsafeTransaction } from "../database/unsafe";
import {
  addBackendBreadcrumb,
  captureBackendException,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import {
  AppStoreConnectClient,
  loadAppStoreConnectCredentials,
  type AnalyticsReport,
  type AnalyticsReportInstance,
  type AnalyticsReportRequest,
} from "./appStoreConnectClient";
import {
  appleReportTables,
  mapAppleReportRows,
  parseAppleReportFile,
  resolveAppleReportVariant,
  type AppleMappedRow,
  type AppleReportTable,
  type AppleReportVariant,
} from "./appleReports";

const reportsSecretIdEnvName = "APP_STORE_CONNECT_REPORTS_SECRET_ID";
const insertBatchRows = 1_000;

export type AppleImportSummary = Readonly<{
  reportRequests: number;
  reports: number;
  instancesListed: number;
  instancesAlreadyImported: number;
  instancesWithoutSegments: number;
  instancesImported: number;
  instancesFailed: number;
  instancesRemaining: number;
  segmentsImported: number;
  rowsInserted: Readonly<Record<string, number>>;
  rowsSkippedAsSuperseded: number;
}>;

type PendingInstance = Readonly<{
  report: AnalyticsReport;
  variant: AppleReportVariant;
  instance: AnalyticsReportInstance;
}>;

type DownloadedSegment = Readonly<{
  sourceRef: string;
  checksum: string | null;
  header: ReadonlyArray<string>;
  rows: ReadonlyArray<AppleMappedRow>;
}>;

type InstanceImportResult = Readonly<{
  segments: number;
  rowsInserted: number;
  rowsSkippedAsSuperseded: number;
}>;

type ReportDateRow = Readonly<{ report_date: string }>;
type ImportFileIdRow = Readonly<{ id: string }>;
type InstanceIdRow = Readonly<{ instance_id: string }>;

function readReportsSecretId(): string {
  const secretId = process.env[reportsSecretIdEnvName];
  if (secretId === undefined || secretId === "") {
    throw new Error(`${reportsSecretIdEnvName} is required to read the App Store Connect reports key`);
  }
  return secretId;
}

/** `/` separates the instance and segment ids inside `import_files.source_ref`. */
function assertSourceRefId(id: string, kind: string): void {
  if (id.includes("/")) {
    throw new Error(`App Store Connect ${kind} id ${id} contains "/", which source_ref uses as its separator`);
  }
}

/**
 * Every segment of an instance is committed in one transaction, so one `import_files` row proves
 * the whole instance was imported, and an imported instance needs no segment listing.
 */
async function loadImportedInstanceIds(instanceIds: ReadonlyArray<string>): Promise<ReadonlySet<string>> {
  const result = await unsafeQuery<InstanceIdRow>(
    `SELECT DISTINCT split_part(files.source_ref, '/', 1) AS instance_id
     FROM store_analytics.import_files AS files
     WHERE files.store = 'app_store'
       AND split_part(files.source_ref, '/', 1) = ANY($1::text[])`,
    [instanceIds],
  );
  return new Set(result.rows.map((row) => row.instance_id));
}

function quoteIdentifier(name: string): string {
  return `"${name}"`;
}

function columnSqlType(table: AppleReportTable, column: string): string {
  const typedColumn = table.columns.find((candidate) => candidate.column === column);
  if (typedColumn === undefined) {
    throw new Error(`${table.tableName} has no typed column ${column}`);
  }
  return typedColumn.type;
}

function distinctColumns(table: AppleReportTable): ReadonlyArray<string> {
  return [...new Set(table.columns.map((typedColumn) => typedColumn.column))];
}

function jsonColumnName(table: AppleReportTable): string {
  return table.kind === "named" ? "extra_columns" : "columns";
}

function buildInsertRowsSql(table: AppleReportTable): string {
  const columns = distinctColumns(table);
  const typedColumns = columns.map(quoteIdentifier);
  const jsonColumn = quoteIdentifier(jsonColumnName(table));
  const recordDefinition = [
    "import_file_id bigint",
    "report_date date",
    "app_apple_identifier text",
    ...columns.map((column) => `${quoteIdentifier(column)} ${columnSqlType(table, column)}`),
    `${jsonColumn} jsonb`,
  ];
  const reportNameColumn = table.kind === "other" ? "report_name, " : "";
  const reportNameValue = table.kind === "other" ? "$5::text, " : "";
  return `INSERT INTO store_analytics.${quoteIdentifier(table.tableName)} (
      import_file_id, ${reportNameColumn}report_date, granularity, detail_level, processing_date,
      app_apple_identifier, ${typedColumns.join(", ")}, ${jsonColumn}
    )
    SELECT
      incoming.import_file_id, ${reportNameValue}incoming.report_date, $2::text, $3::text, $4::date,
      incoming.app_apple_identifier, ${typedColumns.map((column) => `incoming.${column}`).join(", ")},
      incoming.${jsonColumn}
    FROM jsonb_to_recordset($1::jsonb) AS incoming(${recordDefinition.join(", ")})`;
}

/**
 * The replacement key is the report, granularity, detail level and report date. The report is
 * matched through `import_files.report_name`, which keeps each report's rows apart even where two
 * report names share a table.
 */
async function loadSupersededReportDates(
  executor: DatabaseExecutor,
  pending: PendingInstance,
  reportDates: ReadonlyArray<string>,
): Promise<ReadonlySet<string>> {
  const table = pending.variant.table;
  const result = await executor.query<ReportDateRow>(
    `SELECT DISTINCT to_char(stored.report_date, 'YYYY-MM-DD') AS report_date
     FROM store_analytics.${quoteIdentifier(table.tableName)} AS stored
     JOIN store_analytics.import_files AS files ON files.id = stored.import_file_id
     WHERE files.report_name = $1
       AND stored.granularity = $2
       AND stored.detail_level = $3
       AND stored.report_date = ANY($4::date[])
       AND stored.processing_date > $5::date`,
    [
      pending.report.name,
      pending.instance.granularity,
      pending.variant.detailLevel,
      reportDates,
      pending.instance.processingDate,
    ],
  );
  return new Set(result.rows.map((row) => row.report_date));
}

/**
 * Deletes the equal processing date too: the ONGOING and ONE_TIME_SNAPSHOT requests can deliver
 * the same report date with the same processing date, and keeping both copies would double sums.
 */
async function deleteReplacedRows(
  executor: DatabaseExecutor,
  pending: PendingInstance,
  reportDates: ReadonlyArray<string>,
): Promise<void> {
  const table = pending.variant.table;
  await executor.query(
    `DELETE FROM store_analytics.${quoteIdentifier(table.tableName)} AS stored
     USING store_analytics.import_files AS files
     WHERE files.id = stored.import_file_id
       AND files.report_name = $1
       AND stored.granularity = $2
       AND stored.detail_level = $3
       AND stored.report_date = ANY($4::date[])
       AND stored.processing_date <= $5::date`,
    [
      pending.report.name,
      pending.instance.granularity,
      pending.variant.detailLevel,
      reportDates,
      pending.instance.processingDate,
    ],
  );
}

function reportDateRange(rows: ReadonlyArray<AppleMappedRow>): Readonly<{ from: string | null; to: string | null }> {
  const dates = rows.map((row) => row.reportDate).sort();
  return { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null };
}

async function insertImportFile(
  executor: DatabaseExecutor,
  pending: PendingInstance,
  segment: DownloadedSegment,
): Promise<string> {
  const range = reportDateRange(segment.rows);
  const result = await executor.query<ImportFileIdRow>(
    `INSERT INTO store_analytics.import_files (
       store, report_name, detail_level, granularity, source_ref, processing_date, checksum, header,
       row_count, report_date_from, report_date_to
     )
     VALUES ('app_store', $1, $2, $3, $4, $5::date, $6, $7::text[], $8, $9::date, $10::date)
     RETURNING id::text AS id`,
    [
      pending.report.name,
      pending.variant.detailLevel,
      pending.instance.granularity,
      segment.sourceRef,
      pending.instance.processingDate,
      segment.checksum,
      segment.header,
      segment.rows.length,
      range.from,
      range.to,
    ],
  );
  return result.rows[0].id;
}

function toRecord(table: AppleReportTable, importFileId: string, row: AppleMappedRow): Readonly<Record<string, unknown>> {
  return {
    ...row.typedValues,
    import_file_id: importFileId,
    report_date: row.reportDate,
    app_apple_identifier: row.appAppleIdentifier,
    [jsonColumnName(table)]: row.jsonColumns,
  };
}

async function insertRows(
  executor: DatabaseExecutor,
  pending: PendingInstance,
  records: ReadonlyArray<Readonly<Record<string, unknown>>>,
): Promise<void> {
  const table = pending.variant.table;
  const sql = buildInsertRowsSql(table);
  for (let start = 0; start < records.length; start += insertBatchRows) {
    const batch = records.slice(start, start + insertBatchRows);
    const params = [
      JSON.stringify(batch),
      pending.instance.granularity,
      pending.variant.detailLevel,
      pending.instance.processingDate,
      ...(table.kind === "other" ? [pending.report.name] : []),
    ];
    await executor.query(sql, params);
  }
}

async function downloadSegments(
  client: AppStoreConnectClient,
  pending: PendingInstance,
  fallbackAppId: string,
): Promise<ReadonlyArray<DownloadedSegment>> {
  const segments = await client.listSegments(pending.instance.id);
  const downloaded: Array<DownloadedSegment> = [];
  for (const segment of segments) {
    assertSourceRefId(segment.id, "segment");
    const sourceRef = `${pending.instance.id}/${segment.id}`;
    const label = `${pending.report.name} ${pending.instance.granularity} ${pending.instance.processingDate} segment ${sourceRef}`;
    const file = parseAppleReportFile(await client.downloadSegment(segment.url, label), label);
    downloaded.push({
      sourceRef,
      checksum: segment.checksum,
      header: file.header,
      rows: mapAppleReportRows(pending.variant.table, file, fallbackAppId, label),
    });
  }
  return downloaded;
}

/**
 * All segments of the instance are written after its one delete, in one transaction, so a later
 * segment of the same instance never deletes an earlier one's rows. A report date for which a
 * strictly newer processing date is already stored is skipped.
 */
async function writeInstance(
  pending: PendingInstance,
  segments: ReadonlyArray<DownloadedSegment>,
): Promise<InstanceImportResult> {
  const reportDates = [...new Set(segments.flatMap((segment) => segment.rows.map((row) => row.reportDate)))];
  return unsafeTransaction(async (executor) => {
    const supersededDates = await loadSupersededReportDates(executor, pending, reportDates);
    const replacedDates = reportDates.filter((reportDate) => !supersededDates.has(reportDate));
    if (replacedDates.length > 0) {
      await deleteReplacedRows(executor, pending, replacedDates);
    }

    const records: Array<Readonly<Record<string, unknown>>> = [];
    let rowsSkippedAsSuperseded = 0;
    for (const segment of segments) {
      const importFileId = await insertImportFile(executor, pending, segment);
      for (const row of segment.rows) {
        if (supersededDates.has(row.reportDate)) {
          rowsSkippedAsSuperseded += 1;
          continue;
        }
        records.push(toRecord(pending.variant.table, importFileId, row));
      }
    }
    await insertRows(executor, pending, records);

    return { segments: segments.length, rowsInserted: records.length, rowsSkippedAsSuperseded };
  });
}

async function listPendingInstances(
  client: AppStoreConnectClient,
  requests: ReadonlyArray<AnalyticsReportRequest>,
): Promise<Readonly<{ reports: number; listed: ReadonlyArray<PendingInstance> }>> {
  const listed: Array<PendingInstance> = [];
  let reports = 0;
  for (const request of requests) {
    for (const report of await client.listReports(request.id)) {
      reports += 1;
      const variant = resolveAppleReportVariant(report.name);
      for (const instance of await client.listInstances(report.id)) {
        assertSourceRefId(instance.id, "report instance");
        listed.push({ report, variant, instance });
      }
    }
  }
  return { reports, listed };
}

function compareInstances(left: PendingInstance, right: PendingInstance): number {
  return left.instance.processingDate.localeCompare(right.instance.processingDate)
    || left.report.name.localeCompare(right.report.name)
    || left.instance.granularity.localeCompare(right.instance.granularity)
    || left.instance.id.localeCompare(right.instance.id);
}

/** Reports the request problems an App Store Connect Admin must fix; the job only reads requests. */
function describeOngoingRequestProblem(appId: string, requests: ReadonlyArray<AnalyticsReportRequest>): string | null {
  const ongoing = requests.filter((request) => request.accessType === "ONGOING");
  if (ongoing.length === 0) {
    return `App ${appId} has no ONGOING analytics report request, so Apple generates no new reports. `
      + "An App Store Connect Admin must create one (docs/app-store-analytics.md).";
  }
  if (ongoing.every((request) => request.stoppedDueToInactivity)) {
    return `The ONGOING analytics report request ${ongoing.map((request) => request.id).join(", ")} for app ${appId} `
      + "is stoppedDueToInactivity, so Apple generates no new reports. "
      + "An App Store Connect Admin must create a new ONGOING request (docs/app-store-analytics.md).";
  }
  return null;
}

/**
 * Imports every App Store Connect Analytics report instance not yet in store_analytics. No new
 * instance is started after `deadlineAtMs` or once `signal` aborts (the run lost its lock); the
 * next run continues with what remains. A failed instance is reported and skipped, and the run
 * throws once every other instance was attempted.
 */
export async function importAppleReports(
  scope: BackendObservationScope,
  deadlineAtMs: number,
  signal: AbortSignal,
): Promise<AppleImportSummary> {
  const credentials = await loadAppStoreConnectCredentials(readReportsSecretId());
  const client = new AppStoreConnectClient(credentials, (retry) => {
    addBackendBreadcrumb({ action: "store_analytics_apple_retry", scope, details: retry });
  });

  const requests = await client.listReportRequests(credentials.appId);
  const { reports, listed } = await listPendingInstances(client, requests);
  const importedInstanceIds = await loadImportedInstanceIds(listed.map((pending) => pending.instance.id));
  const pendingInstances = listed
    .filter((pending) => !importedInstanceIds.has(pending.instance.id))
    .sort(compareInstances);

  const rowsInserted: Record<string, number> = Object.fromEntries(
    appleReportTables.map((table) => [table.tableName, 0]),
  );
  let instancesAttempted = 0;
  let instancesImported = 0;
  let instancesWithoutSegments = 0;
  let instancesFailed = 0;
  let segmentsImported = 0;
  let rowsSkippedAsSuperseded = 0;

  for (const pending of pendingInstances) {
    if (Date.now() >= deadlineAtMs || signal.aborted) {
      break;
    }
    instancesAttempted += 1;
    try {
      const segments = await downloadSegments(client, pending, credentials.appId);
      if (segments.length === 0) {
        instancesWithoutSegments += 1;
        continue;
      }
      const result = await writeInstance(pending, segments);
      instancesImported += 1;
      segmentsImported += result.segments;
      rowsInserted[pending.variant.table.tableName] += result.rowsInserted;
      rowsSkippedAsSuperseded += result.rowsSkippedAsSuperseded;
    } catch (error) {
      instancesFailed += 1;
      const normalizedError = normalizeCaughtError(error);
      captureBackendException({
        action: "store_analytics_apple_instance_failed",
        scope,
        error: normalizedError,
        details: {
          reportName: pending.report.name,
          instanceId: pending.instance.id,
          granularity: pending.instance.granularity,
          processingDate: pending.instance.processingDate,
          message: normalizedError.message,
        },
      });
    }
  }

  const summary: AppleImportSummary = {
    reportRequests: requests.length,
    reports,
    instancesListed: listed.length,
    instancesAlreadyImported: listed.length - pendingInstances.length,
    instancesWithoutSegments,
    instancesImported,
    instancesFailed,
    instancesRemaining: pendingInstances.length - instancesAttempted,
    segmentsImported,
    rowsInserted,
    rowsSkippedAsSuperseded,
  };
  addBackendBreadcrumb({ action: "store_analytics_apple_import_completed", scope, details: summary });

  const problems: Array<string> = [];
  if (instancesFailed > 0) {
    problems.push(`${instancesFailed} App Store Connect report instances failed to import; see store_analytics_apple_instance_failed.`);
  }
  const ongoingRequestProblem = describeOngoingRequestProblem(credentials.appId, requests);
  if (ongoingRequestProblem !== null) {
    problems.push(ongoingRequestProblem);
  }
  if (problems.length > 0) {
    throw new Error(problems.join(" "));
  }
  return summary;
}

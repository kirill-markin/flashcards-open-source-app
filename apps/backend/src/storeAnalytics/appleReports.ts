import { gunzipSync } from "node:zlib";
import {
  assertDistinctHeaders,
  findHeaderIndex,
  parseDelimitedReport,
  readTypedValue,
  type ReportColumnType,
  type ReportFile,
} from "./reportFiles";

export type AppleDetailLevel = "standard" | "detailed" | "single";

type AppleTypedColumn = Readonly<{
  column: string;
  header: string;
  type: ReportColumnType;
}>;

/**
 * A named table holds one report family and keeps unmapped headers in `extra_columns`; the other
 * table holds every remaining report, keyed by `report_name`, and keeps every header in `columns`.
 */
export type AppleReportTable = Readonly<{
  kind: "named" | "other";
  tableName: string;
  /** The first of these headers present in a file is its report date. */
  reportDateHeaders: ReadonlyArray<string>;
  columns: ReadonlyArray<AppleTypedColumn>;
}>;

export type AppleReportVariant = Readonly<{
  table: AppleReportTable;
  detailLevel: AppleDetailLevel;
}>;

export type AppleMappedRow = Readonly<{
  reportDate: string;
  appAppleIdentifier: string;
  typedValues: Readonly<Record<string, string | null>>;
  /** `extra_columns` for a named table, `columns` for the other table. */
  jsonColumns: Readonly<Record<string, string>>;
}>;

const appAppleIdentifierHeader = "App Apple Identifier";
// Every row repeats the app's display name; the identifier beside it is what is kept.
const appNameHeader = "App Name";

function text(header: string, column: string): AppleTypedColumn {
  return { header, column, type: "text" };
}

function numeric(header: string, column: string): AppleTypedColumn {
  return { header, column, type: "numeric" };
}

function date(header: string, column: string): AppleTypedColumn {
  return { header, column, type: "date" };
}

const sourceColumns: ReadonlyArray<AppleTypedColumn> = [
  text("Source Type", "source_type"),
  text("Source Info", "source_info"),
  text("Campaign", "campaign"),
  text("Page Type", "page_type"),
  text("Page Title", "page_title"),
];

const subscriptionColumns: ReadonlyArray<AppleTypedColumn> = [
  text("Subscription Name", "subscription_name"),
  text("Subscription Identifier", "subscription_identifier"),
  text("Subscription Duration", "subscription_duration"),
  text("Billing Frequency", "billing_frequency"),
  text("Billing Period", "billing_period"),
  text("Subscription Group", "subscription_group"),
  text("Subscription Group Identifier", "subscription_group_identifier"),
  text("Offer Type", "offer_type"),
  text("Offer Name", "offer_name"),
  text("Offer ID", "offer_id"),
  text("Vanity Code", "vanity_code"),
  text("Offer Pricing", "offer_pricing"),
  text("Offer Duration", "offer_duration"),
];

const subscriptionAttributionColumns: ReadonlyArray<AppleTypedColumn> = [
  text("Family Sharing", "family_sharing"),
  text("Cancellation Reason", "cancellation_reason"),
  text("App Download Source Type", "app_download_source_type"),
  text("App Download Source Info", "app_download_source_info"),
  text("Campaign", "campaign"),
  text("Page Type", "page_type"),
  text("Page Title", "page_title"),
  text("Pre-Order", "pre_order"),
  text("Original Purchase Device", "original_purchase_device"),
  text("Territory", "territory"),
  numeric("Counts", "counts"),
];

/** Field names: https://developer.apple.com/documentation/analytics-reports */
const discoveryEngagementTable: AppleReportTable = {
  kind: "named",
  tableName: "apple_discovery_engagement",
  reportDateHeaders: ["Date"],
  columns: [
    text("Event", "event"),
    text("Page Type", "page_type"),
    text("Page Title", "page_title"),
    text("Source Type", "source_type"),
    text("Source Info", "source_info"),
    text("Campaign", "campaign"),
    text("Engagement Type", "engagement_type"),
    text("Device", "device"),
    text("Platform Version", "platform_version"),
    text("Territory", "territory"),
    numeric("Counts", "counts"),
    numeric("Unique Counts", "unique_counts"),
  ],
};

const webPreviewEngagementTable: AppleReportTable = {
  kind: "named",
  tableName: "apple_web_preview_engagement",
  reportDateHeaders: ["Date"],
  columns: [
    text("Event", "event"),
    text("Page Type", "page_type"),
    text("Page Title", "page_title"),
    text("Source Type", "source_type"),
    text("Source Info", "source_info"),
    text("Engagement Type", "engagement_type"),
    text("Browser", "browser"),
    text("Browser Version", "browser_version"),
    text("Device", "device"),
    text("Platform Version", "platform_version"),
    text("Territory", "territory"),
    numeric("Counts", "counts"),
  ],
};

const downloadsTable: AppleReportTable = {
  kind: "named",
  tableName: "apple_downloads",
  reportDateHeaders: ["Date"],
  columns: [
    text("Download Type", "download_type"),
    text("App Version", "app_version"),
    text("Device", "device"),
    text("Platform Version", "platform_version"),
    ...sourceColumns,
    text("Pre-Order", "pre_order"),
    text("Territory", "territory"),
    numeric("Counts", "counts"),
  ],
};

const installsDeletionsTable: AppleReportTable = {
  kind: "named",
  tableName: "apple_installs_deletions",
  reportDateHeaders: ["Date"],
  columns: [
    text("Event", "event"),
    text("Download Type", "download_type"),
    text("App Version", "app_version"),
    text("Device", "device"),
    text("Platform Version", "platform_version"),
    ...sourceColumns,
    date("App Download Date", "app_download_date"),
    text("Territory", "territory"),
    numeric("Counts", "counts"),
    numeric("Unique Devices", "unique_devices"),
  ],
};

const sessionsTable: AppleReportTable = {
  kind: "named",
  tableName: "apple_sessions",
  reportDateHeaders: ["Date"],
  columns: [
    text("App Version", "app_version"),
    text("Device", "device"),
    text("Platform Version", "platform_version"),
    ...sourceColumns,
    date("App Download Date", "app_download_date"),
    text("Territory", "territory"),
    numeric("Sessions", "sessions"),
    numeric("Total Session Duration", "total_session_duration"),
    numeric("Unique Devices", "unique_devices"),
  ],
};

const purchasesTable: AppleReportTable = {
  kind: "named",
  tableName: "apple_purchases",
  reportDateHeaders: ["Date"],
  columns: [
    text("Purchase Type", "purchase_type"),
    text("Content Name", "content_name"),
    text("Content Apple Identifier", "content_apple_identifier"),
    text("Payment Method", "payment_method"),
    text("Device", "device"),
    text("Platform Version", "platform_version"),
    ...sourceColumns,
    date("App Download Date", "app_download_date"),
    text("Pre-Order", "pre_order"),
    text("Territory", "territory"),
    numeric("Purchases", "purchases"),
    numeric("Proceeds in USD", "proceeds_usd"),
    numeric("Sales in USD", "sales_usd"),
    numeric("Paying Users", "paying_users"),
  ],
};

const subscriptionEventsTable: AppleReportTable = {
  kind: "named",
  tableName: "apple_subscription_events",
  reportDateHeaders: ["Event Date"],
  columns: [
    text("Event Sub Type", "event_sub_type"),
    text("Event Grouping", "event_grouping"),
    ...subscriptionColumns,
    text("Plan Change Type", "plan_change_type"),
    text("Previous Subscription Name", "previous_subscription_name"),
    text("Previous Subscription Identifier", "previous_subscription_identifier"),
    text("Paid Service Days Recovered", "paid_service_days_recovered"),
    ...subscriptionAttributionColumns,
  ],
};

const subscriptionStatesTable: AppleReportTable = {
  kind: "named",
  tableName: "apple_subscription_states",
  reportDateHeaders: ["Date"],
  columns: [
    text("State Metric", "state_metric"),
    text("State Metric Grouping", "state_metric_grouping"),
    ...subscriptionColumns,
    ...subscriptionAttributionColumns,
  ],
};

const crashesTable: AppleReportTable = {
  kind: "named",
  tableName: "apple_crashes",
  reportDateHeaders: ["Date"],
  columns: [
    text("App Version", "app_version"),
    text("Device", "device"),
    text("Platform Version", "platform_version"),
    numeric("Crashes", "crashes"),
    numeric("Unique Devices", "unique_devices"),
  ],
};

const optInTable: AppleReportTable = {
  kind: "named",
  tableName: "apple_opt_in",
  reportDateHeaders: ["Date"],
  columns: [
    numeric("Downloading Users", "downloading_users"),
    numeric("Users Opting-In", "users_opting_in"),
  ],
};

export const appleOtherReportTable: AppleReportTable = {
  kind: "other",
  tableName: "apple_other_report_rows",
  // Platform App Installs dates its rows by Install Day.
  reportDateHeaders: ["Date", "Event Date", "Install Day"],
  columns: [
    text("Territory", "territory"),
    text("Platform", "platform"),
    text("Device", "device"),
    text("Build", "build"),
    text("Release Type", "release_type"),
    text("Platform Version", "platform_version"),
    text("App Version", "app_version"),
    numeric("Count", "count"),
    numeric("Counts", "count"),
    numeric("Unique Devices", "unique_devices"),
  ],
};

export const appleReportTables: ReadonlyArray<AppleReportTable> = [
  discoveryEngagementTable,
  webPreviewEngagementTable,
  downloadsTable,
  installsDeletionsTable,
  sessionsTable,
  purchasesTable,
  subscriptionEventsTable,
  subscriptionStatesTable,
  crashesTable,
  optInTable,
  appleOtherReportTable,
];

/**
 * Report family names, normalized by `normalizeName`, after the Standard/Detailed suffix is removed.
 * The API names are confirmed only once Apple lists them, so a family accepts the API spelling and
 * its documentation title. Replacement is scoped by the exact report name, so two spellings landing
 * in one table can never replace each other's rows; a name matching none lands in the other table.
 */
const namedReportFamilies: ReadonlyArray<Readonly<{ names: ReadonlyArray<string>; table: AppleReportTable }>> = [
  { names: ["app store discovery and engagement"], table: discoveryEngagementTable },
  { names: ["app store web preview engagement", "app store web preview"], table: webPreviewEngagementTable },
  { names: ["app downloads", "app store downloads"], table: downloadsTable },
  {
    names: ["app store installation and deletion", "app store installations and deletions"],
    table: installsDeletionsTable,
  },
  { names: ["app sessions"], table: sessionsTable },
  { names: ["app store purchases"], table: purchasesTable },
  {
    names: ["app store subscription event", "app store subscription event report"],
    table: subscriptionEventsTable,
  },
  {
    names: ["app store subscription state", "app store subscription state report"],
    table: subscriptionStatesTable,
  },
  { names: ["app crashes"], table: crashesTable },
  { names: ["app opt in", "app store opt in"], table: optInTable },
];

function normalizeName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolveAppleReportVariant(reportName: string): AppleReportVariant {
  const normalized = normalizeName(reportName);
  const suffix = /^(.*) (standard|detailed)$/.exec(normalized);
  const baseName = suffix === null ? normalized : suffix[1];
  const detailLevel: AppleDetailLevel = suffix === null ? "single" : suffix[2] === "standard" ? "standard" : "detailed";
  const family = namedReportFamilies.find((candidate) => candidate.names.includes(baseName));
  return { table: family === undefined ? appleOtherReportTable : family.table, detailLevel };
}

/** Apple documents gzip-compressed TSV; the gzip magic bytes decide, so a plain file reads as is. */
export function parseAppleReportFile(bytes: Buffer, label: string): ReportFile {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const content = (isGzip ? gunzipSync(bytes) : bytes).toString("utf8").replace(/^﻿/, "");
  return parseDelimitedReport(content, "\t", label);
}

/**
 * Maps the rows of one report file onto its table. `fallbackAppId` is the app the reports were
 * requested for, used when a report publishes no App Apple Identifier column.
 */
export function mapAppleReportRows(
  table: AppleReportTable,
  file: ReportFile,
  fallbackAppId: string,
  label: string,
): ReadonlyArray<AppleMappedRow> {
  if (file.rows.length === 0) {
    return [];
  }

  assertDistinctHeaders(file.header, label);

  const reportDateIndex = table.reportDateHeaders
    .map((name) => findHeaderIndex(file.header, name))
    .find((index): index is number => index !== null);
  if (reportDateIndex === undefined) {
    throw new Error(
      `${label}: none of the report date headers ${table.reportDateHeaders.join(", ")} is in the header ${file.header.join(", ")}`,
    );
  }
  const appIdentifierIndex = findHeaderIndex(file.header, appAppleIdentifierHeader);
  const appNameIndex = findHeaderIndex(file.header, appNameHeader);

  const typedIndexes = new Map<number, AppleTypedColumn>();
  const mappedColumns = new Map<string, string>();
  for (const typedColumn of table.columns) {
    const index = findHeaderIndex(file.header, typedColumn.header);
    if (index === null) {
      continue;
    }
    const previousHeader = mappedColumns.get(typedColumn.column);
    if (previousHeader !== undefined) {
      throw new Error(
        `${label}: headers ${previousHeader} and ${typedColumn.header} both map to ${table.tableName}.${typedColumn.column}`,
      );
    }
    mappedColumns.set(typedColumn.column, typedColumn.header);
    typedIndexes.set(index, typedColumn);
  }

  const jsonColumnIndexes = file.header
    .map((_name, index) => index)
    .filter((index) => table.kind === "other" || (
      index !== reportDateIndex
      && index !== appIdentifierIndex
      && index !== appNameIndex
      && !typedIndexes.has(index)
    ));

  return file.rows.map((row, rowIndex) => {
    const rowContext = `${label}: row ${rowIndex + 2}`;
    const reportDate = readTypedValue(row[reportDateIndex], "date", `${rowContext} ${file.header[reportDateIndex]}`);
    if (reportDate === null) {
      throw new Error(`${rowContext}: ${file.header[reportDateIndex]} is empty`);
    }

    let appAppleIdentifier = fallbackAppId;
    if (appIdentifierIndex !== null) {
      const value = row[appIdentifierIndex].trim();
      if (value === "") {
        throw new Error(`${rowContext}: ${appAppleIdentifierHeader} is empty`);
      }
      appAppleIdentifier = value;
    }

    const typedValues: Record<string, string | null> = Object.fromEntries(
      table.columns.map((typedColumn) => [typedColumn.column, null]),
    );
    for (const [index, typedColumn] of typedIndexes) {
      typedValues[typedColumn.column] = readTypedValue(
        row[index],
        typedColumn.type,
        `${rowContext} ${file.header[index]}`,
      );
    }

    const jsonColumns: Record<string, string> = Object.fromEntries(
      jsonColumnIndexes.map((index) => [file.header[index], row[index]]),
    );

    return { reportDate, appAppleIdentifier, typedValues, jsonColumns };
  });
}

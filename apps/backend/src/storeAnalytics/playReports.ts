import {
  assertDistinctHeaders,
  findHeaderIndex,
  parseDelimitedReport,
  readTypedValue,
  type ReportColumnType,
  type ReportFile,
} from "./reportFiles";

/** The closed breakdown CHECK of play_installs, play_ratings and play_crashes. */
const playBreakdowns = ["overview", "country", "device", "os_version", "app_version", "carrier", "language"] as const;

export type PlayBreakdown = typeof playBreakdowns[number];

type PlayTypedColumn = Readonly<{
  column: string;
  header: string;
  type: ReportColumnType;
}>;

/**
 * A named table holds one file family and keeps unmapped headers in `extra_columns`; the other
 * table holds every remaining file, keyed by `report_name`, and keeps every header in `columns`.
 */
export type PlayReportTable = Readonly<{
  kind: "named" | "other";
  tableName: string;
  hasBreakdown: boolean;
  columns: ReadonlyArray<PlayTypedColumn>;
}>;

export type PlayObjectRoute = Readonly<{
  /** The object's directory, such as stats/installs. */
  reportName: string;
  table: PlayReportTable;
  breakdown: PlayBreakdown | null;
  /** The first day of the month named in the file name. */
  fileMonth: string | null;
  /** NULL where the file name does not separate the package unambiguously. */
  packageNameFromObjectName: string | null;
}>;

export type PlayMappedRow = Readonly<{
  reportDate: string;
  packageName: string;
  breakdownValue: string | null;
  typedValues: Readonly<Record<string, string | null>>;
  /** `extra_columns` for a named table, `columns` for the other table. */
  jsonColumns: Readonly<Record<string, string>>;
}>;

const reportDateHeader = "Date";
const packageNameHeader = "Package Name";
// Google writes NA for a metric without data on that day, such as a day without ratings.
const notAvailableValue = "NA";
// <family>_<package>[_<productId>]_<yyyyMM>_<breakdown>.csv; package names and product ids may
// contain "_", so the month is the last six-digit segment before the breakdown.
const fileNamePattern = /^(.+)_(\d{4})(\d{2})_([A-Za-z0-9_]+)\.csv$/;

function text(header: string, column: string): PlayTypedColumn {
  return { header, column, type: "text" };
}

function numeric(header: string, column: string): PlayTypedColumn {
  return { header, column, type: "numeric" };
}

const storeListingColumns: ReadonlyArray<PlayTypedColumn> = [
  numeric("Store listing acquisitions", "store_listing_acquisitions"),
  numeric("Store listing visitors", "store_listing_visitors"),
  numeric("Store listing conversion rate", "store_listing_conversion_rate"),
];

const storePerformanceCountryTable: PlayReportTable = {
  kind: "named",
  tableName: "play_store_performance_country",
  hasBreakdown: false,
  columns: [
    text("Country", "country"),
    text("Country/region", "country"),
    text("Country / region", "country"),
    ...storeListingColumns,
  ],
};

const storePerformanceTrafficSourceTable: PlayReportTable = {
  kind: "named",
  tableName: "play_store_performance_traffic_source",
  hasBreakdown: false,
  columns: [
    text("Traffic source", "traffic_source"),
    text("Search term", "search_term"),
    text("UTM source", "utm_source"),
    text("UTM campaign", "utm_campaign"),
    ...storeListingColumns,
  ],
};

const installsTable: PlayReportTable = {
  kind: "named",
  tableName: "play_installs",
  hasBreakdown: true,
  columns: [
    numeric("Current Device Installs", "current_device_installs"),
    numeric("Installs on Active Devices", "installs_on_active_devices"),
    numeric("Active Device Installs", "installs_on_active_devices"),
    numeric("Daily Device Installs", "daily_device_installs"),
    numeric("Daily Device Uninstalls", "daily_device_uninstalls"),
    numeric("Daily Device Upgrades", "daily_device_upgrades"),
    numeric("Current User Installs", "current_user_installs"),
    numeric("Total User Installs", "total_user_installs"),
    numeric("Daily User Installs", "daily_user_installs"),
    numeric("Daily User Uninstalls", "daily_user_uninstalls"),
  ],
};

const ratingsTable: PlayReportTable = {
  kind: "named",
  tableName: "play_ratings",
  hasBreakdown: true,
  columns: [
    numeric("Daily Average Rating", "daily_average_rating"),
    numeric("Total Average Rating", "total_average_rating"),
  ],
};

const crashesTable: PlayReportTable = {
  kind: "named",
  tableName: "play_crashes",
  hasBreakdown: true,
  columns: [
    numeric("Daily Crashes", "daily_crashes"),
    numeric("Daily ANRs", "daily_anrs"),
  ],
};

const subscriptionsTable: PlayReportTable = {
  kind: "named",
  tableName: "play_subscriptions",
  hasBreakdown: false,
  columns: [
    text("Product ID", "product_id"),
    text("Country", "country"),
    text("Base Plan ID", "base_plan_id"),
    text("Offer ID", "offer_id"),
    numeric("New Subscriptions", "new_subscriptions"),
    numeric("Cancelled Subscriptions", "canceled_subscriptions"),
    numeric("Canceled Subscriptions", "canceled_subscriptions"),
    numeric("Active Subscriptions", "active_subscriptions"),
  ],
};

const playOtherReportTable: PlayReportTable = {
  kind: "other",
  tableName: "play_other_report_rows",
  hasBreakdown: false,
  columns: [],
};

export const playReportTables: ReadonlyArray<PlayReportTable> = [
  storePerformanceCountryTable,
  storePerformanceTrafficSourceTable,
  installsTable,
  ratingsTable,
  crashesTable,
  subscriptionsTable,
  playOtherReportTable,
];

const breakdownTables: ReadonlyMap<string, PlayReportTable> = new Map([
  ["stats/installs", installsTable],
  ["stats/ratings", ratingsTable],
  ["stats/crashes", crashesTable],
]);

/** The column holding each breakdown's value; an overview file has none. */
const breakdownValueHeaders: Readonly<Record<Exclude<PlayBreakdown, "overview">, ReadonlyArray<string>>> = {
  country: ["Country", "Country/region", "Country / region"],
  device: ["Device"],
  os_version: ["Android OS Version"],
  app_version: ["App Version Code"],
  carrier: ["Carrier"],
  language: ["Language"],
};

function isPlayBreakdown(value: string): value is PlayBreakdown {
  return (playBreakdowns as ReadonlyArray<string>).includes(value);
}

function resolveTable(
  reportName: string,
  breakdownSuffix: string | null,
): Readonly<{ table: PlayReportTable; breakdown: PlayBreakdown | null }> {
  const breakdownTable = breakdownTables.get(reportName);
  if (breakdownTable !== undefined && breakdownSuffix !== null && isPlayBreakdown(breakdownSuffix)) {
    return { table: breakdownTable, breakdown: breakdownSuffix };
  }
  if (reportName === "stats/store_performance" && breakdownSuffix === "country") {
    return { table: storePerformanceCountryTable, breakdown: null };
  }
  if (reportName === "stats/store_performance" && breakdownSuffix === "traffic_source") {
    return { table: storePerformanceTrafficSourceTable, breakdown: null };
  }
  if (reportName === "financial-stats/subscriptions" && breakdownSuffix === "country") {
    return { table: subscriptionsTable, breakdown: null };
  }
  return { table: playOtherReportTable, breakdown: null };
}

/**
 * Routes a CSV object to its table by directory and file-name breakdown. A file whose name does not
 * follow the documented pattern, or whose breakdown has no table, lands in the other table, so a
 * new Google breakdown never fails the breakdown CHECK.
 */
export function routePlayObject(objectName: string): PlayObjectRoute {
  const separatorIndex = objectName.lastIndexOf("/");
  const reportName = objectName.slice(0, separatorIndex);
  const fileName = objectName.slice(separatorIndex + 1);
  const familyName = reportName.slice(reportName.lastIndexOf("/") + 1);

  const match = fileNamePattern.exec(fileName);
  const month = match === null ? null : Number(match[3]);
  const isNamedFile = match !== null && month !== null && month >= 1 && month <= 12;
  const prefix = isNamedFile ? match[1] : null;
  const breakdownSuffix = isNamedFile ? match[4] : null;

  // A subscriptions file name joins the package and product id with "_", which both may contain.
  const packageNameFromObjectName = prefix !== null
    && reportName !== "financial-stats/subscriptions"
    && prefix.startsWith(`${familyName}_`)
    && prefix.length > familyName.length + 1
    ? prefix.slice(familyName.length + 1)
    : null;

  return {
    reportName,
    ...resolveTable(reportName, breakdownSuffix),
    fileMonth: isNamedFile ? `${match[2]}-${match[3]}-01` : null,
    packageNameFromObjectName,
  };
}

/**
 * Google documents the files as UTF-16 without naming the byte order, so the byte order mark
 * decides; a file without one is read as UTF-8.
 */
export function decodePlayReportFile(bytes: Buffer, label: string): ReportFile {
  let encoding: "utf-8" | "utf-16le" | "utf-16be" = "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
  } else if (!(bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) && bytes.includes(0)) {
    // UTF-16 text without a byte order mark is valid UTF-8 full of NUL characters.
    throw new Error(`${label}: the file has no byte order mark but contains NUL bytes, so its encoding is unknown`);
  }

  let content: string;
  try {
    content = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label}: the file is not valid ${encoding}`, { cause: error });
  }
  return parseDelimitedReport(content, ",", label);
}

function readPlayValue(value: string, type: ReportColumnType, context: string): string | null {
  const trimmed = value.trim();
  if (type === "numeric" && trimmed === notAvailableValue) {
    return null;
  }
  // A percentage keeps its percent units without the sign.
  const number = type === "numeric" && trimmed.endsWith("%") ? trimmed.slice(0, -1) : value;
  return readTypedValue(number, type, context);
}

function findBreakdownValueIndex(
  header: ReadonlyArray<string>,
  breakdown: PlayBreakdown | null,
  label: string,
): number | null {
  if (breakdown === null || breakdown === "overview") {
    return null;
  }
  const names = breakdownValueHeaders[breakdown];
  const index = names
    .map((name) => findHeaderIndex(header, name))
    .find((candidate): candidate is number => candidate !== null);
  if (index === undefined) {
    throw new Error(
      `${label}: none of the ${breakdown} headers ${names.join(", ")} is in the header ${header.join(", ")}`,
    );
  }
  return index;
}

/** Maps the rows of one Play statistics file onto the table its route names. */
export function mapPlayReportRows(
  route: PlayObjectRoute,
  file: ReportFile,
  label: string,
): ReadonlyArray<PlayMappedRow> {
  if (file.rows.length === 0) {
    return [];
  }

  assertDistinctHeaders(file.header, label);
  const table = route.table;

  const reportDateIndex = findHeaderIndex(file.header, reportDateHeader);
  if (reportDateIndex === null) {
    throw new Error(`${label}: the header ${file.header.join(", ")} has no ${reportDateHeader} column`);
  }
  const packageNameIndex = findHeaderIndex(file.header, packageNameHeader);
  if (packageNameIndex === null && route.packageNameFromObjectName === null) {
    throw new Error(`${label}: the header has no ${packageNameHeader} column and the object name does not name the package`);
  }
  const breakdownValueIndex = findBreakdownValueIndex(file.header, route.breakdown, label);

  const typedIndexes = new Map<number, PlayTypedColumn>();
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
      && index !== packageNameIndex
      && index !== breakdownValueIndex
      && !typedIndexes.has(index)
    ));

  return file.rows.map((row, rowIndex) => {
    const rowContext = `${label}: row ${rowIndex + 2}`;
    const reportDate = readTypedValue(row[reportDateIndex], "date", `${rowContext} ${file.header[reportDateIndex]}`);
    if (reportDate === null) {
      throw new Error(`${rowContext}: ${file.header[reportDateIndex]} is empty`);
    }

    let packageName = route.packageNameFromObjectName;
    if (packageNameIndex !== null) {
      packageName = row[packageNameIndex].trim();
    }
    if (packageName === null || packageName === "") {
      throw new Error(`${rowContext}: ${packageNameHeader} is empty`);
    }

    const breakdownValue = breakdownValueIndex === null
      ? null
      : readTypedValue(row[breakdownValueIndex], "text", `${rowContext} ${file.header[breakdownValueIndex]}`);

    const typedValues: Record<string, string | null> = Object.fromEntries(
      table.columns.map((typedColumn) => [typedColumn.column, null]),
    );
    for (const [index, typedColumn] of typedIndexes) {
      typedValues[typedColumn.column] = readPlayValue(
        row[index],
        typedColumn.type,
        `${rowContext} ${file.header[index]}`,
      );
    }

    const jsonColumns: Record<string, string> = Object.fromEntries(
      jsonColumnIndexes.map((index) => [file.header[index], row[index]]),
    );

    return { reportDate, packageName, breakdownValue, typedValues, jsonColumns };
  });
}

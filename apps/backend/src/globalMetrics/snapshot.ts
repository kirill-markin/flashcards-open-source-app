import { z } from "zod";

const millisecondsPerDay = 86_400_000;
const utcDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const legacyGlobalMetricsSnapshotTrailingUtcDayCount = 90;
export const globalMetricsSnapshotSchemaVersion = 1 as const;

export type GlobalMetricsReviewEventsByPlatform = Readonly<{
  web: number;
  android: number;
  ios: number;
}>;

export type GlobalMetricsReviewEvents = Readonly<{
  total: number;
  byPlatform: GlobalMetricsReviewEventsByPlatform;
}>;

export type GlobalMetricsSnapshotDay = Readonly<{
  date: string;
  uniqueReviewingUsers: number;
  reviewEvents: GlobalMetricsReviewEvents;
}>;

export type GlobalMetricsSnapshot = Readonly<{
  schemaVersion: typeof globalMetricsSnapshotSchemaVersion;
  generatedAtUtc: string;
  asOfUtc: string;
  from: string;
  to: string;
  totals: Readonly<{
    uniqueReviewingUsers: number;
    reviewEvents: GlobalMetricsReviewEvents;
  }>;
  days: ReadonlyArray<GlobalMetricsSnapshotDay>;
}>;

export type GlobalMetricsSnapshotWindow = Readonly<{
  generatedAtUtc: string;
  asOfUtc: string;
  from: string;
  to: string;
  rangeStartUtc: string;
  rangeEndUtc: string;
  days: ReadonlyArray<string>;
}>;

export type GlobalMetricsSnapshotTotalsRow = Readonly<{
  unique_reviewing_users: number | string;
  total_review_events: number | string;
  web_review_events: number | string;
  android_review_events: number | string;
  ios_review_events: number | string;
}>;

export type GlobalMetricsSnapshotDayRow = Readonly<{
  review_date: string;
  unique_reviewing_users: number | string;
  total_review_events: number | string;
  web_review_events: number | string;
  android_review_events: number | string;
  ios_review_events: number | string;
}>;

export type GlobalMetricsSnapshotHistoricalStartDate = string | null;

const globalMetricsReviewEventsByPlatformSchema = z.object({
  web: z.number().int().nonnegative(),
  android: z.number().int().nonnegative(),
  ios: z.number().int().nonnegative(),
}).strict();

const globalMetricsReviewEventsSchema = z.object({
  total: z.number().int().nonnegative(),
  byPlatform: globalMetricsReviewEventsByPlatformSchema,
}).strict();

const globalMetricsSnapshotDaySchema = z.object({
  date: z.string().regex(utcDatePattern),
  uniqueReviewingUsers: z.number().int().nonnegative(),
  reviewEvents: globalMetricsReviewEventsSchema,
}).strict();

export const globalMetricsSnapshotSchema = z.object({
  schemaVersion: z.literal(globalMetricsSnapshotSchemaVersion),
  generatedAtUtc: z.string().datetime(),
  asOfUtc: z.string().datetime(),
  from: z.string().regex(utcDatePattern),
  to: z.string().regex(utcDatePattern),
  totals: z.object({
    uniqueReviewingUsers: z.number().int().nonnegative(),
    reviewEvents: globalMetricsReviewEventsSchema,
  }).strict(),
  days: z.array(globalMetricsSnapshotDaySchema),
}).strict();

function parseUtcDatePart(value: string, start: number, end: number): number {
  return Number.parseInt(value.slice(start, end), 10);
}

function parseUtcDate(value: string, fieldName: string): Date {
  if (!utcDatePattern.test(value)) {
    throw new Error(`Global metrics snapshot ${fieldName} must be a YYYY-MM-DD date.`);
  }

  const year = parseUtcDatePart(value, 0, 4);
  const month = parseUtcDatePart(value, 5, 7);
  const day = parseUtcDatePart(value, 8, 10);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`Global metrics snapshot ${fieldName} must be a valid UTC date.`);
  }

  return parsedDate;
}

function parseCanonicalUtcTimestamp(value: string, fieldName: string): Date {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString() !== value) {
    throw new Error(`Global metrics snapshot ${fieldName} must be a canonical UTC timestamp.`);
  }

  return parsedDate;
}

function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftUtcDate(value: Date, offsetDays: number): Date {
  return new Date(value.getTime() + offsetDays * millisecondsPerDay);
}

function createUtcMidnightBoundary(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}

function createInclusiveUtcDateRange(from: string, to: string): ReadonlyArray<string> {
  const dates: Array<string> = [];
  let currentDate = parseUtcDate(from, "from");
  const endDate = parseUtcDate(to, "to");

  while (currentDate.getTime() <= endDate.getTime()) {
    dates.push(formatUtcDate(currentDate));
    currentDate = shiftUtcDate(currentDate, 1);
  }

  return dates;
}

function normalizeNonNegativeInteger(value: number | string, fieldName: string): number {
  const normalizedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(normalizedValue) || normalizedValue < 0) {
    throw new Error(`Global metrics snapshot ${fieldName} must be a non-negative integer.`);
  }

  return normalizedValue;
}

function createReviewEvents(
  total: number,
  web: number,
  android: number,
  ios: number,
): GlobalMetricsReviewEvents {
  const byPlatformTotal = web + android + ios;
  if (total !== byPlatformTotal) {
    throw new Error(
      `Global metrics snapshot reviewEvents total must equal the platform sum: total=${total}, byPlatformTotal=${byPlatformTotal}.`,
    );
  }

  return {
    total,
    byPlatform: {
      web,
      android,
      ios,
    },
  };
}

function createEmptySnapshotDay(date: string): GlobalMetricsSnapshotDay {
  return {
    date,
    uniqueReviewingUsers: 0,
    reviewEvents: createReviewEvents(0, 0, 0, 0),
  };
}

function createSnapshotDayFromRow(row: GlobalMetricsSnapshotDayRow): GlobalMetricsSnapshotDay {
  parseUtcDate(row.review_date, "days.date");

  return {
    date: row.review_date,
    uniqueReviewingUsers: normalizeNonNegativeInteger(
      row.unique_reviewing_users,
      `days.${row.review_date}.unique_reviewing_users`,
    ),
    reviewEvents: createReviewEvents(
      normalizeNonNegativeInteger(
        row.total_review_events,
        `days.${row.review_date}.total_review_events`,
      ),
      normalizeNonNegativeInteger(
        row.web_review_events,
        `days.${row.review_date}.web_review_events`,
      ),
      normalizeNonNegativeInteger(
        row.android_review_events,
        `days.${row.review_date}.android_review_events`,
      ),
      normalizeNonNegativeInteger(
        row.ios_review_events,
        `days.${row.review_date}.ios_review_events`,
      ),
    ),
  };
}

function assertSnapshotDayRange(snapshot: GlobalMetricsSnapshot): void {
  const expectedDates = createInclusiveUtcDateRange(snapshot.from, snapshot.to);
  if (snapshot.days.length !== expectedDates.length) {
    throw new Error(
      `Global metrics snapshot days length must be ${expectedDates.length}, received ${snapshot.days.length}.`,
    );
  }

  for (let index = 0; index < expectedDates.length; index += 1) {
    const expectedDate = expectedDates[index];
    const actualDate = snapshot.days[index]?.date;
    if (actualDate !== expectedDate) {
      throw new Error(
        `Global metrics snapshot day ${index} must be ${expectedDate}, received ${actualDate ?? "missing"}.`,
      );
    }
  }
}

function assertSnapshotTimeWindow(snapshot: GlobalMetricsSnapshot): void {
  const generatedAtDate = parseCanonicalUtcTimestamp(snapshot.generatedAtUtc, "generatedAtUtc");
  const asOfDate = parseCanonicalUtcTimestamp(snapshot.asOfUtc, "asOfUtc");
  if (
    asOfDate.getUTCHours() !== 0
    || asOfDate.getUTCMinutes() !== 0
    || asOfDate.getUTCSeconds() !== 0
    || asOfDate.getUTCMilliseconds() !== 0
  ) {
    throw new Error("Global metrics snapshot asOfUtc must be a UTC midnight boundary.");
  }

  if (generatedAtDate.getTime() < asOfDate.getTime()) {
    throw new Error("Global metrics snapshot generatedAtUtc must be greater than or equal to asOfUtc.");
  }

  const fromDate = parseUtcDate(snapshot.from, "from");
  const toDate = parseUtcDate(snapshot.to, "to");
  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error("Global metrics snapshot from must be less than or equal to to.");
  }

  const expectedTo = formatUtcDate(shiftUtcDate(asOfDate, -1));
  if (snapshot.to !== expectedTo) {
    throw new Error(`Global metrics snapshot to must equal ${expectedTo}.`);
  }
}

function assertReviewEventsByPlatformSum(
  reviewEvents: GlobalMetricsReviewEvents,
  fieldName: string,
): void {
  const byPlatformTotal = reviewEvents.byPlatform.web
    + reviewEvents.byPlatform.android
    + reviewEvents.byPlatform.ios;
  if (reviewEvents.total !== byPlatformTotal) {
    throw new Error(
      `Global metrics snapshot ${fieldName}.total must equal the platform sum: total=${reviewEvents.total}, byPlatformTotal=${byPlatformTotal}.`,
    );
  }
}

function calculateSnapshotReviewEventSums(snapshot: GlobalMetricsSnapshot): GlobalMetricsReviewEvents {
  let daySeriesTotal = 0;
  let daySeriesWebTotal = 0;
  let daySeriesAndroidTotal = 0;
  let daySeriesIosTotal = 0;

  for (const day of snapshot.days) {
    assertReviewEventsByPlatformSum(day.reviewEvents, `days.${day.date}.reviewEvents`);
    daySeriesTotal += day.reviewEvents.total;
    daySeriesWebTotal += day.reviewEvents.byPlatform.web;
    daySeriesAndroidTotal += day.reviewEvents.byPlatform.android;
    daySeriesIosTotal += day.reviewEvents.byPlatform.ios;
  }

  return createReviewEvents(
    daySeriesTotal,
    daySeriesWebTotal,
    daySeriesAndroidTotal,
    daySeriesIosTotal,
  );
}

function assertSnapshotReviewEventShapes(snapshot: GlobalMetricsSnapshot): void {
  assertReviewEventsByPlatformSum(snapshot.totals.reviewEvents, "totals.reviewEvents");
  calculateSnapshotReviewEventSums(snapshot);
}

function assertSnapshotReviewEventSeriesMatchesDays(snapshot: GlobalMetricsSnapshot): void {
  const daySeriesReviewEvents = calculateSnapshotReviewEventSums(snapshot);
  if (
    snapshot.totals.reviewEvents.total !== daySeriesReviewEvents.total
    || snapshot.totals.reviewEvents.byPlatform.web !== daySeriesReviewEvents.byPlatform.web
    || snapshot.totals.reviewEvents.byPlatform.android !== daySeriesReviewEvents.byPlatform.android
    || snapshot.totals.reviewEvents.byPlatform.ios !== daySeriesReviewEvents.byPlatform.ios
  ) {
    throw new Error(
      "Global metrics snapshot totals.reviewEvents must equal the sum of day review events.",
    );
  }
}

function assertGlobalMetricsSnapshotStructuralInvariants(snapshot: GlobalMetricsSnapshot): void {
  assertSnapshotTimeWindow(snapshot);
  assertSnapshotDayRange(snapshot);
  assertSnapshotReviewEventShapes(snapshot);
}

function isLegacyTrailingWindowSnapshot(snapshot: GlobalMetricsSnapshot): boolean {
  // Existing deployments can still hold the old bounded snapshot until the first
  // post-deploy seed rewrites the same S3 key with the all-time payload.
  const asOfDate = parseCanonicalUtcTimestamp(snapshot.asOfUtc, "asOfUtc");
  const expectedLegacyFrom = formatUtcDate(shiftUtcDate(asOfDate, -legacyGlobalMetricsSnapshotTrailingUtcDayCount));
  return snapshot.from === expectedLegacyFrom && snapshot.days.length === legacyGlobalMetricsSnapshotTrailingUtcDayCount;
}

export function createGlobalMetricsSnapshotWindow(params: Readonly<{
  now: Date;
  historicalStartDate: GlobalMetricsSnapshotHistoricalStartDate;
}>): GlobalMetricsSnapshotWindow {
  if (Number.isNaN(params.now.getTime())) {
    throw new Error("Global metrics snapshot window requires a valid generation time.");
  }

  const asOfDate = createUtcMidnightBoundary(params.now);
  const toDate = shiftUtcDate(asOfDate, -1);
  const fromDate = params.historicalStartDate === null
    ? toDate
    : parseUtcDate(params.historicalStartDate, "historicalStartDate");
  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error("Global metrics snapshot historicalStartDate must be less than or equal to to.");
  }
  const from = formatUtcDate(fromDate);
  const to = formatUtcDate(toDate);

  return {
    generatedAtUtc: params.now.toISOString(),
    asOfUtc: asOfDate.toISOString(),
    from,
    to,
    rangeStartUtc: fromDate.toISOString(),
    rangeEndUtc: asOfDate.toISOString(),
    days: createInclusiveUtcDateRange(from, to),
  };
}

export function buildGlobalMetricsSnapshot(params: Readonly<{
  window: GlobalMetricsSnapshotWindow;
  totalsRow: GlobalMetricsSnapshotTotalsRow;
  dayRows: ReadonlyArray<GlobalMetricsSnapshotDayRow>;
}>): GlobalMetricsSnapshot {
  const expectedDateSet = new Set<string>(params.window.days);
  const daysByDate = new Map<string, GlobalMetricsSnapshotDay>();

  for (const row of params.dayRows) {
    const day = createSnapshotDayFromRow(row);
    if (!expectedDateSet.has(day.date)) {
      throw new Error(`Global metrics snapshot row date ${day.date} falls outside the requested UTC window.`);
    }

    if (daysByDate.has(day.date)) {
      throw new Error(`Global metrics snapshot row date ${day.date} is duplicated.`);
    }

    daysByDate.set(day.date, day);
  }

  const snapshot: GlobalMetricsSnapshot = {
    schemaVersion: globalMetricsSnapshotSchemaVersion,
    generatedAtUtc: params.window.generatedAtUtc,
    asOfUtc: params.window.asOfUtc,
    from: params.window.from,
    to: params.window.to,
    totals: {
      uniqueReviewingUsers: normalizeNonNegativeInteger(
        params.totalsRow.unique_reviewing_users,
        "totals.unique_reviewing_users",
      ),
      reviewEvents: createReviewEvents(
        normalizeNonNegativeInteger(
          params.totalsRow.total_review_events,
          "totals.total_review_events",
        ),
        normalizeNonNegativeInteger(
          params.totalsRow.web_review_events,
          "totals.web_review_events",
        ),
        normalizeNonNegativeInteger(
          params.totalsRow.android_review_events,
          "totals.android_review_events",
        ),
        normalizeNonNegativeInteger(
          params.totalsRow.ios_review_events,
          "totals.ios_review_events",
        ),
      ),
    },
    days: params.window.days.map((date) => daysByDate.get(date) ?? createEmptySnapshotDay(date)),
  };

  assertGlobalMetricsSnapshotStructuralInvariants(snapshot);
  assertSnapshotReviewEventSeriesMatchesDays(snapshot);
  return snapshot;
}

export function parseGlobalMetricsSnapshotJson(value: string): GlobalMetricsSnapshot {
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(value) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Global metrics snapshot JSON is invalid: ${message}`);
  }

  const parsedSnapshot = globalMetricsSnapshotSchema.safeParse(parsedValue);
  if (!parsedSnapshot.success) {
    const firstIssue = parsedSnapshot.error.issues[0];
    const issuePath = firstIssue === undefined || firstIssue.path.length === 0
      ? "root"
      : firstIssue.path.join(".");
    const issueMessage = firstIssue?.message ?? "Invalid payload.";
    throw new Error(`Global metrics snapshot JSON is invalid at ${issuePath}: ${issueMessage}`);
  }

  const snapshot: GlobalMetricsSnapshot = parsedSnapshot.data;
  assertGlobalMetricsSnapshotStructuralInvariants(snapshot);

  try {
    assertSnapshotReviewEventSeriesMatchesDays(snapshot);
  } catch (error) {
    if (!isLegacyTrailingWindowSnapshot(snapshot)) {
      throw error;
    }
  }

  return snapshot;
}

import { runAdminQuery } from "../../adminApi";
import type { AdminQueryResultSet, AdminQueryRow } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import {
  assertIsString,
  assertValidDateRange,
  parseActivityCount,
  parseActivityDate,
} from "../reportValues";

export const browserChecksReportLabel = "Browser checks report";

/** `analytics.guest_browser_checks.outcome`, db/migrations/0242_guest_browser_checks.sql. */
export const browserCheckOutcomes = ["required", "passed", "failed", "bypassed", "allowed"] as const;
export type BrowserCheckOutcome = (typeof browserCheckOutcomes)[number];

/** Separates the flags of one check in a flag set; flag names are snake_case. */
export const browserCheckFlagSetSeparator = " + ";

export type BrowserChecksDay = Readonly<{
  date: string;
  checksByOutcome: ReadonlyMap<BrowserCheckOutcome, number>;
  /** Required checks by their sorted flags joined with `browserCheckFlagSetSeparator`. */
  requiredByFlagSet: ReadonlyMap<string, number>;
}>;

/** One flag over the whole range, with every check that carried it counted once per outcome. */
export type BrowserCheckFlagTotal = Readonly<{
  flag: string;
  checksByOutcome: ReadonlyMap<BrowserCheckOutcome, number>;
}>;

export type BrowserChecksReport = Readonly<{
  generatedAtUtc: string;
  from: string;
  to: string;
  /** Only the days that have a row; a missing day had no decision. */
  days: ReadonlyArray<BrowserChecksDay>;
  flagTotals: ReadonlyArray<BrowserCheckFlagTotal>;
}>;

// Rows are request decisions, mostly without a person, so neither the shared actor exclusions nor
// any filter but the date range applies.
function buildRangePredicateSql(dateRange: AnalyticsDateRange): string {
  return [
    `checks.checked_at >= ((${escapeSqlStringLiteral(dateRange.from)}::date)::timestamp AT TIME ZONE 'UTC')`,
    `AND checks.checked_at < ((${escapeSqlStringLiteral(dateRange.to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')`,
  ].join("\n  ");
}

/** Two statements: decisions per UTC day, outcome and flag set; then range totals per single flag and outcome. */
export function buildBrowserChecksSql(dateRange: AnalyticsDateRange): string {
  const range = assertValidDateRange(dateRange, browserChecksReportLabel);
  return [
    [
      "SELECT",
      "  to_char((checks.checked_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS check_date,",
      "  checks.outcome,",
      `  pg_catalog.array_to_string(ARRAY(SELECT flag FROM pg_catalog.unnest(checks.flags) AS flag ORDER BY flag), ${escapeSqlStringLiteral(browserCheckFlagSetSeparator)}) AS flag_set,`,
      "  COUNT(*)::int AS check_count",
      "FROM analytics.guest_browser_checks AS checks",
      `WHERE ${buildRangePredicateSql(range)}`,
      "GROUP BY 1, 2, 3",
      "ORDER BY 1, 2, 3",
    ].join("\n"),
    [
      "SELECT",
      "  flag,",
      "  checks.outcome,",
      "  COUNT(*)::int AS check_count",
      "FROM analytics.guest_browser_checks AS checks",
      "CROSS JOIN LATERAL pg_catalog.unnest(checks.flags) AS flag",
      `WHERE ${buildRangePredicateSql(range)}`,
      "GROUP BY 1, 2",
      "ORDER BY 1, 2",
    ].join("\n"),
  ].join(";\n");
}

function parseOutcome(row: AdminQueryRow): BrowserCheckOutcome {
  const outcome = assertIsString(row.outcome ?? null, browserChecksReportLabel, "outcome");
  if (browserCheckOutcomes.includes(outcome as BrowserCheckOutcome) === false) {
    throw new Error(`${browserChecksReportLabel} field "outcome" must be one of ${browserCheckOutcomes.join(", ")}, got: ${outcome}`);
  }
  return outcome as BrowserCheckOutcome;
}

function parseCheckCount(row: AdminQueryRow): number {
  const count = parseActivityCount(row.check_count ?? null, browserChecksReportLabel, "check_count");
  if (count === null) {
    throw new Error(`${browserChecksReportLabel} field "check_count" must not be NULL.`);
  }
  return count;
}

function addCount<Key>(counts: Map<Key, number>, key: Key, count: number): void {
  counts.set(key, (counts.get(key) ?? 0) + count);
}

function buildBrowserChecksDays(resultSet: AdminQueryResultSet): ReadonlyArray<BrowserChecksDay> {
  const days = new Map<string, { checksByOutcome: Map<BrowserCheckOutcome, number>; requiredByFlagSet: Map<string, number> }>();
  for (const row of resultSet.rows) {
    const date = parseActivityDate(row.check_date ?? null, browserChecksReportLabel, "check_date");
    const outcome = parseOutcome(row);
    const flagSet = assertIsString(row.flag_set ?? null, browserChecksReportLabel, "flag_set");
    const count = parseCheckCount(row);
    const day = days.get(date) ?? { checksByOutcome: new Map(), requiredByFlagSet: new Map() };
    addCount(day.checksByOutcome, outcome, count);
    if (outcome === "required") {
      // The backend asks for the check only when a flag is set (apps/backend/src/guestAuth/browser/challenge.ts).
      if (flagSet === "") {
        throw new Error(`${browserChecksReportLabel} has ${count} required checks without a flag on ${date}.`);
      }
      addCount(day.requiredByFlagSet, flagSet, count);
    }
    days.set(date, day);
  }

  return Array.from(days.entries()).map(([date, day]) => ({ date, ...day }));
}

function buildBrowserCheckFlagTotals(resultSet: AdminQueryResultSet): ReadonlyArray<BrowserCheckFlagTotal> {
  const flags = new Map<string, Map<BrowserCheckOutcome, number>>();
  for (const row of resultSet.rows) {
    const flag = assertIsString(row.flag ?? null, browserChecksReportLabel, "flag");
    const checksByOutcome = flags.get(flag) ?? new Map<BrowserCheckOutcome, number>();
    addCount(checksByOutcome, parseOutcome(row), parseCheckCount(row));
    flags.set(flag, checksByOutcome);
  }

  return Array.from(flags.entries()).map(([flag, checksByOutcome]) => ({ flag, checksByOutcome }));
}

export async function loadBrowserChecksReport(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  signal: AbortSignal,
): Promise<BrowserChecksReport> {
  const response = await runAdminQuery(config, buildBrowserChecksSql(dateRange), signal);
  const [daysResultSet, flagsResultSet] = response.resultSets;
  if (response.resultSets.length !== 2 || daysResultSet === undefined || flagsResultSet === undefined) {
    throw new Error(`${browserChecksReportLabel} must return exactly two result sets. Got ${response.resultSets.length}.`);
  }

  return {
    generatedAtUtc: response.executedAtUtc,
    from: dateRange.from,
    to: dateRange.to,
    days: buildBrowserChecksDays(daysResultSet),
    flagTotals: buildBrowserCheckFlagTotals(flagsResultSet),
  };
}

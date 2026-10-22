import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildExcludedActorSqlLines } from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { buildHashedSiteVisitorRowSqlLines, buildHashedVisitorDayRangeSqlLines } from "../funnels/funnelAudienceSql";

const siteViewEventNames: ReadonlyArray<string> = ["site_page_viewed"];

export function buildSiteEventNamesSql(rowAlias: string, eventNames: ReadonlyArray<string>): string {
  return `${rowAlias}.event_name IN (${eventNames.map(escapeSqlStringLiteral).join(", ")})`;
}

/** A marketing-site fact: only the credential-free collector writes these, under the visitor cookie. */
function buildSiteFactSourceSql(rowAlias: string): string {
  return `${rowAlias}.origin = 'client' AND ${rowAlias}.trust_level = 'anonymous_client'`;
}

/**
 * The `eventNames` site facts of the identified site visitors the `web` series reads, inside the
 * range, as a `WHERE` body. Each is a person under the shared actor exclusion rule.
 */
export function buildIdentifiedSiteFactFilterSql(
  rowAlias: string,
  eventNames: ReadonlyArray<string>,
  range: AnalyticsDateRange,
): string {
  const fromSql = `${escapeSqlStringLiteral(range.from)}::date`;
  const toSql = `${escapeSqlStringLiteral(range.to)}::date`;
  return [
    `${buildSiteEventNamesSql(rowAlias, eventNames)} AND ${buildSiteFactSourceSql(rowAlias)}`,
    `  AND ${rowAlias}.anonymous_id IS NOT NULL`,
    `  AND ${rowAlias}.actor_id IS NOT NULL`,
    // On the raw column, so the (event_name, occurred_at) index stays usable.
    `  AND ${rowAlias}.occurred_at >= (${fromSql})::timestamp AT TIME ZONE 'UTC'`,
    `  AND ${rowAlias}.occurred_at < (${toSql} + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    ...buildExcludedActorSqlLines(`${rowAlias}.actor_id::text`),
  ].join("\n");
}

/** The page views of identified site visitors the `web` series reads. */
export function buildIdentifiedSiteViewFilterSql(rowAlias: string, range: AnalyticsDateRange): string {
  return buildIdentifiedSiteFactFilterSql(rowAlias, siteViewEventNames, range);
}

/**
 * The `eventNames` site facts of the cookieless site visitors the `web` series reads, on hash days
 * inside the range, as a `WHERE` body. Each is a person for one UTC day of `buildHashedVisitorDaySql`.
 */
export function buildHashedSiteFactFilterSql(
  rowAlias: string,
  eventNames: ReadonlyArray<string>,
  range: AnalyticsDateRange,
): string {
  return [
    buildSiteEventNamesSql(rowAlias, eventNames),
    ...buildHashedSiteVisitorRowSqlLines(rowAlias),
    ...buildHashedVisitorDayRangeSqlLines(rowAlias, range.from, range.to),
  ].join("\n  AND ");
}

/** The page views of cookieless site visitors the `web` series reads. */
export function buildHashedSiteViewFilterSql(rowAlias: string, range: AnalyticsDateRange): string {
  return buildHashedSiteFactFilterSql(rowAlias, siteViewEventNames, range);
}

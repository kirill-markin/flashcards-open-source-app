import type { AnalyticsDateRange, SiteVisitorFilterState } from "../../filters/analyticsFilters";
import { buildExcludedActorSqlLines } from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { buildBreakdownValueSql } from "../levelOneMetrics/breakdownQuery";
import {
  buildHashedSiteRowSqlLines,
  buildHashedSiteVisitorRowSqlLines,
  buildHashedVisitorDayRangeSqlLines,
} from "../funnels/funnelAudienceSql";

const siteViewEventNames: ReadonlyArray<string> = ["site_page_viewed"];

export function buildSiteEventNamesSql(rowAlias: string, eventNames: ReadonlyArray<string>): string {
  return `${rowAlias}.event_name IN (${eventNames.map(escapeSqlStringLiteral).join(", ")})`;
}

/** A marketing-site fact: only the credential-free collector writes these, under the visitor cookie. */
function buildSiteFactSourceSql(rowAlias: string): string {
  return `${rowAlias}.origin = 'client' AND ${rowAlias}.trust_level = 'anonymous_client'`;
}

/** The `eventNames` site facts of identified site visitors inside the range, before any cleanup, as a `WHERE` body. */
function buildIdentifiedSiteFactRowsSql(
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
  ].join("\n");
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
  return [
    buildIdentifiedSiteFactRowsSql(rowAlias, eventNames, range),
    ...buildExcludedActorSqlLines(`${rowAlias}.actor_id::text`),
  ].join("\n");
}

/** Every page view of identified site visitors inside the range, the excluded actors' included. */
export function buildIdentifiedSiteViewRowsSql(rowAlias: string, range: AnalyticsDateRange): string {
  return buildIdentifiedSiteFactRowsSql(rowAlias, siteViewEventNames, range);
}

/** The page views of the identified visitors the `web` series keeps, which its breakdowns' first views read. */
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

/** Every page view of cookieless site visitors on hash days inside the range, automated and scraper-fleet rows included. */
export function buildHashedSiteViewRowsSql(rowAlias: string, range: AnalyticsDateRange): string {
  return [
    buildSiteEventNamesSql(rowAlias, siteViewEventNames),
    ...buildHashedSiteRowSqlLines(rowAlias),
    ...buildHashedVisitorDayRangeSqlLines(rowAlias, range.from, range.to),
  ].join("\n  AND ");
}

/** The page views of the cookieless visitors the `web` series keeps, which its breakdowns' first views read. */
export function buildHashedSiteViewFilterSql(rowAlias: string, range: AnalyticsDateRange): string {
  return buildHashedSiteFactFilterSql(rowAlias, siteViewEventNames, range);
}

export function buildSiteCountrySql(rowAlias: string): string {
  return `${rowAlias}.country`;
}

export function buildSitePageKindSql(rowAlias: string): string {
  return `${rowAlias}.event_properties ->> 'page_kind'`;
}

export function buildSiteDeviceCategorySql(rowAlias: string): string {
  return `${rowAlias}.event_properties ->> 'device_category'`;
}

export function buildSiteSourceSql(rowAlias: string): string {
  return `${rowAlias}.event_properties ->> 'source'`;
}

// The language subtag of the browser locale, so `en-US`, `en_GB` and `en` are all `en`.
export function buildSiteBrowserLanguageSql(rowAlias: string): string {
  return `lower(split_part(translate(${rowAlias}.device_locale, '_', '-'), '-', 1))`;
}

// Each site visitor filter field beside the page view value it narrows, the one its breakdown reads.
const siteVisitorFilterValueSqlOf: Readonly<
  Record<keyof SiteVisitorFilterState, (rowAlias: string) => string>
> = {
  siteDeviceCategories: buildSiteDeviceCategorySql,
  siteSources: buildSiteSourceSql,
  siteCountries: buildSiteCountrySql,
  siteBrowserLanguages: buildSiteBrowserLanguageSql,
  sitePageKinds: buildSitePageKindSql,
};

const siteVisitorFilterFields = Object.keys(siteVisitorFilterValueSqlOf) as ReadonlyArray<keyof SiteVisitorFilterState>;

/**
 * The value of `field` on the page view `rowAlias` as its breakdown chart segments it, missing as
 * Unknown, so a filter value, a filter option and a chart segment are one and the same string.
 */
export function buildSiteVisitorFilterValueSql(field: keyof SiteVisitorFilterState, rowAlias: string): string {
  return buildBreakdownValueSql(siteVisitorFilterValueSqlOf[field](rowAlias));
}

export function isSiteVisitorFilterNarrowed(filters: SiteVisitorFilterState): boolean {
  return siteVisitorFilterFields.some((field) => filters[field].length > 0);
}

/**
 * Whether the page view `rowAlias` matches every narrowed site visitor filter, as one SQL boolean; an
 * empty field keeps every value. Every Web engaged query tests it on a visitor's first page view in
 * the unit it counts them once in, never on each view, so a visitor is kept or dropped whole.
 */
export function buildSiteVisitorFilterSql(rowAlias: string, filters: SiteVisitorFilterState): string {
  const conditionSqls = siteVisitorFilterFields.flatMap((field) => {
    const values: ReadonlyArray<string> = filters[field];
    return values.length === 0
      ? []
      : [`${buildSiteVisitorFilterValueSql(field, rowAlias)} IN (${values.map(escapeSqlStringLiteral).join(", ")})`];
  });
  return conditionSqls.length === 0 ? "TRUE" : `(${conditionSqls.join(" AND ")})`;
}

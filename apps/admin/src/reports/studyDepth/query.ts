import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesActorIdsSqlLines,
  buildConnectionCountriesActorIdsSqlLines,
  buildEventPlatformsFilterSql,
  buildExcludedActorSqlLines,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { assertValidDateRange, toInteger } from "../reportValues";
import type { StudyDepthMaturityDays } from "./studyDepthUrl";

const reportLabel = "Study depth";

/** A review day starts at this local hour, so a late-night session counts on the day it began. */
export const studyDepthDayStartHour = 4;

// `serverDerivedProductAnalyticsEventIdSalt` in
// `apps/backend/src/productAnalytics/serverFacts/serverEvents.ts`, which cannot be imported into the
// browser bundle. A `review_answered` event id is derived from it and the review event id, which is
// the only link from the event to the time zone its review was saved with.
const serverDerivedEventIdSalt = "flashcards-open-source-app:product-analytics:server-derived-event-id:v1";

/** How many cohort members ended at exactly this many reviews and review days. */
export type StudyDepthCell = Readonly<{
  reviewCount: number;
  reviewDayCount: number;
  peopleCount: number;
}>;

/** One selected country or language test, as the CTE holding the distinct people it keeps. */
type PersonFilter = Readonly<{
  cteName: string;
  actorIdsSqlLines: ReadonlyArray<string>;
}>;

export type StudyDepthReport = Readonly<{
  generatedAtUtc: string;
  /** The joint counts every chart of the area is derived from, one per pair someone has. */
  cells: ReadonlyArray<StudyDepthCell>;
  cohortPeopleCount: number;
  reviewCount: number;
  /** Reviews dated in UTC because no time zone was stored with them. */
  noTimeZoneReviewCount: number;
}>;

/**
 * One row per `(review_count, review_day_count)` pair with the cohort members who have it.
 *
 * The cohort is the people whose first counted review falls inside the range and at least
 * `maturityDays` before now; their counts span every counted review up to now. The platform filter
 * picks the reviews counted, so it moves a person's first review too; a review carries no country or
 * language, so those two judge the person. A review day is the local date in the time zone stored
 * with the review, starting at `studyDepthDayStartHour`, or the UTC date when none was stored.
 */
export function buildStudyDepthSql(filters: AnalyticsFilterState, maturityDays: StudyDepthMaturityDays): string {
  const { from, to } = assertValidDateRange(filters.dateRange, reportLabel);
  const rangeStart = `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const rangeEnd = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;
  const eventIdPrefix = escapeSqlStringLiteral(`${serverDerivedEventIdSalt}:review_answered:`);
  // Each is deduplicated once and tested once per person after grouping, not per review row: the shared
  // filters probe an undeduplicated array linearly, which over every review ever outlasts the timeout.
  const personFilters: ReadonlyArray<PersonFilter> = [
    ...(filters.connectionCountries.length === 0 ? [] : [{
      cteName: "country_people",
      actorIdsSqlLines: buildConnectionCountriesActorIdsSqlLines(filters.connectionCountries, filters.dateRange),
    }]),
    ...(filters.appUiLanguages.length === 0 ? [] : [{
      cteName: "language_people",
      actorIdsSqlLines: buildAppUiLanguagesActorIdsSqlLines(filters.appUiLanguages, filters.dateRange),
    }]),
  ];
  const personFilterCtesSql = personFilters.map((personFilter) => `${personFilter.cteName} AS MATERIALIZED (
  SELECT DISTINCT selected.actor_id::uuid AS actor_id
  FROM (
${personFilter.actorIdsSqlLines.join("\n")}
  ) AS selected (actor_id)
), `).join("");
  const personWhereSql = personFilters.length === 0 ? "" : `WHERE ${personFilters
    .map((personFilter) => `person.actor_id IN (SELECT ${personFilter.cteName}.actor_id FROM ${personFilter.cteName})`)
    .join("\n  AND ")}
`;

  return `WITH ${personFilterCtesSql}review_time_zones AS (
  SELECT (substr(hashed.digest, 1, 8) || '-' || substr(hashed.digest, 9, 4) || '-' || substr(hashed.digest, 13, 4)
      || '-' || substr(hashed.digest, 17, 4) || '-' || substr(hashed.digest, 21, 12))::uuid AS event_id,
    hashed.reviewed_time_zone
  FROM (
    SELECT encode(sha256(convert_to(${eventIdPrefix} || review_event.review_event_id::text, 'UTF8')), 'hex') AS digest,
      review_event.reviewed_time_zone
    FROM content.review_events AS review_event
    WHERE review_event.reviewed_time_zone IS NOT NULL
  ) AS hashed
), people AS (
  SELECT review.actor_id,
    COUNT(*)::int AS review_count,
    COUNT(DISTINCT ((review.occurred_at AT TIME ZONE COALESCE(time_zone.reviewed_time_zone, 'UTC'))
      - INTERVAL '${studyDepthDayStartHour} hours')::date)::int AS review_day_count,
    (COUNT(*) FILTER (WHERE time_zone.reviewed_time_zone IS NULL))::int AS no_time_zone_review_count
  FROM analytics.product_events_resolved AS review
  LEFT JOIN review_time_zones AS time_zone ON time_zone.event_id = review.event_id
  WHERE review.event_name = 'review_answered'
    AND review.actor_id IS NOT NULL
    AND review.occurred_at <= now()
    AND ${buildEventPlatformsFilterSql("COALESCE(review.platform, 'unattributed')", filters.eventPlatforms)}
    ${buildExcludedActorSqlLines("review.actor_id::text").join("\n")}
  GROUP BY review.actor_id
  HAVING MIN(review.occurred_at) >= ${rangeStart}
    AND MIN(review.occurred_at) < ${rangeEnd}
    AND MIN(review.occurred_at) <= now() - INTERVAL '${maturityDays} days'
)
SELECT person.review_count, person.review_day_count,
  COUNT(*)::int AS people_count,
  SUM(person.no_time_zone_review_count)::int AS no_time_zone_review_count
FROM people AS person
${personWhereSql}GROUP BY person.review_count, person.review_day_count
ORDER BY person.review_count, person.review_day_count`;
}

export async function loadStudyDepthReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  maturityDays: StudyDepthMaturityDays,
  signal: AbortSignal,
): Promise<StudyDepthReport> {
  const response = await runAdminQuery(config, buildStudyDepthSql(filters, maturityDays), signal);
  if (response.resultSets.length !== 1) {
    throw new Error(`${reportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  let cohortPeopleCount = 0;
  let reviewCount = 0;
  let noTimeZoneReviewCount = 0;
  const cells = (response.resultSets[0]?.rows ?? []).map((row): StudyDepthCell => {
    const count = (fieldName: string): number => toInteger(row[fieldName] ?? null, reportLabel, fieldName);
    const cell = {
      reviewCount: count("review_count"),
      reviewDayCount: count("review_day_count"),
      peopleCount: count("people_count"),
    };
    cohortPeopleCount += cell.peopleCount;
    reviewCount += cell.reviewCount * cell.peopleCount;
    noTimeZoneReviewCount += count("no_time_zone_review_count");
    return cell;
  });

  return { generatedAtUtc: response.executedAtUtc, cells, cohortPeopleCount, reviewCount, noTimeZoneReviewCount };
}

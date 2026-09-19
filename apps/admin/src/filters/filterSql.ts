import {
  reviewEventCohorts,
  reviewEventPlatforms,
  type ReviewEventCohort,
  type ReviewEventPlatform,
} from "../adminApi";
import { escapeSqlStringLiteral } from "../sql";
import type { AnalyticsFilterState } from "./analyticsFilters";

// The SQL half of `AnalyticsFilterState`: one predicate builder per filter field, so every report
// applies a selection the same way and the "what does an empty selection mean" decisions live here
// once.
//
// Each builder takes the SQL expression to compare rather than a column name, because every report
// derives its own actor, cohort and platform expressions - a cohort in particular is a comparison
// between a row's date and that actor's first day of the activity the report counts, and no two
// reports count the same activity.

function buildInPredicateSql(sqlExpression: string, values: ReadonlyArray<string>): string {
  if (values.length === 0) {
    return "FALSE";
  }

  return `${sqlExpression} IN (${values.map(escapeSqlStringLiteral).join(", ")})`;
}

/** Picking nobody keeps every user, so an empty selection is the absence of a filter rather than "none". */
export function buildUsersFilterSql(
  actorIdSqlExpression: string,
  users: ReadonlyArray<string>,
): string {
  return users.length === 0 ? "TRUE" : buildInPredicateSql(actorIdSqlExpression, users);
}

/** Both sides are selected by default, so an empty selection is a deliberate "neither" and matches nothing. */
export function buildUserCohortsFilterSql(
  cohortSqlExpression: string,
  userCohorts: ReadonlyArray<ReviewEventCohort>,
): string {
  return buildInPredicateSql(cohortSqlExpression, userCohorts);
}

/** Every platform is selected by default, so an empty selection matches nothing, as on the cohorts. */
export function buildEventPlatformsFilterSql(
  platformSqlExpression: string,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
): string {
  return buildInPredicateSql(platformSqlExpression, eventPlatforms);
}

/**
 * A row whose cohort cannot be decided is kept only while both cohorts are selected, which is the
 * state the filter row treats as "no cohort filter". Catalog installs are the one report with that
 * case: an installer with no `app_opened` day inside the range belongs to neither side.
 */
export function isEveryUserCohortSelected(filters: AnalyticsFilterState): boolean {
  return filters.userCohorts.length === reviewEventCohorts.length;
}

/**
 * True once the cohort or the platform selection stops spanning every value. Community rows carry no
 * cohort and no platform of their own, so this is what makes them fall back to the users that still
 * have review events in range.
 */
export function isCohortOrPlatformNarrowed(filters: AnalyticsFilterState): boolean {
  return isEveryUserCohortSelected(filters) === false
    || filters.eventPlatforms.length !== reviewEventPlatforms.length;
}

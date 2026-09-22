import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildConnectionCountriesFilterSql,
  buildEventPlatformsFilterSql,
  buildTrustedActorRowsFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import {
  buildExcludedActorFilterSqlLines,
  catalogInstallConversionWindowDays,
} from "../catalogInstallFunnel/query";
import { assertIsString, assertValidDateRange, toInteger } from "../reportValues";

/** The marketing-site `page_kind` values a funnel on this page can start from. */
export type SiteEntryPageKind = "home" | "blog_article";

/** Where "studied it properly" is drawn, the same line the other funnels draw. */
export const siteEntryEngagedReviewThreshold = 20;

/** People per step, each step a subset of the one before it. */
export type SiteEntryFunnelReport = Readonly<{
  generatedAtUtc: string;
  entryViewCount: number;
  appEntryClickCount: number;
  signedInCount: number;
  oneReviewCount: number;
  engagedCount: number;
  engagedReturningCount: number;
  /** Entries whose seven-day window had not closed when the query ran. */
  maturingCount: number;
  /**
   * The first UTC day entries count from: the later of the selected start and the first day the site
   * reported a page view carrying a visitor id. `null` when it had reported none by the end of the range.
   */
  effectiveFromDate: string | null;
}>;

/** A marketing-site fact: only the credential-free collector writes these, under the visitor cookie. */
function buildSiteFactSql(rowAlias: string, eventName: string): string {
  return [
    `${rowAlias}.event_name = ${escapeSqlStringLiteral(eventName)}`,
    `${rowAlias}.origin = 'client'`,
    `${rowAlias}.trust_level = 'anonymous_client'`,
  ].join(" AND ");
}

/**
 * One row per person whose first identified marketing-site page view is a `pageKind` page on a
 * selected UTC day, reduced in SQL to one row of step counts.
 *
 * The person is the visitor cookie the site reports under, `analytics_visitor`, which the web app on
 * the same domain reports under too. The web app's first authenticated analytics batch after sign-in
 * carries that cookie and writes the `authenticated_client` link that resolves every site row to the
 * account (`createIngestIdentityLink` in `apps/backend/src/routes/productAnalytics.ts`), so the site
 * steps and the in-app steps meet on one `actor_id`. The web app mints no guests
 * (`apps/web/src/appData/session/guest/webGuestSession.ts`), so a session here is always a sign-in.
 *
 * The shape is the mobile funnel's (`../mobileFirstLaunchFunnel/query.ts`), for the same reason: no
 * step joins a cohort to `analytics.product_events_resolved` by membership.
 *
 * - `actor_first_events` is one pass grouped by actor over trusted history and the site's page views
 *   up to the range end. Per actor it keeps the first page view, the first one of `pageKind` on a
 *   selected platform, and the first trusted event. `entries` keeps the people whose first page view
 *   is that one, on a selected day, with no trusted event before it, so someone who was already
 *   using the product does not enter as a new visitor once their cookie resolves to their account.
 * - `site_facts_start` is the first UTC day of any identified page view in that pass. No entry can
 *   precede it, so it cuts nothing; it is returned so the section can say why an earlier range is
 *   empty instead of drawing a funnel from data the site was not yet sending.
 * - `step_events` hash-joins the step rows in the range to `actor_first_events`, each bounded to its
 *   own actor's `[first page view of pageKind, + 7 days]`, and each step is then a `GROUP BY` joined
 *   to the step above it.
 *
 * Every later step is the same actor within seven days of the entry, at or after the step above it:
 * a `site_app_entry_clicked` with `target = 'web_app'` from any site page, a web `app_opened` sent on
 * an account credential (`authenticated_client`), and a first `review_answered`. Opening the web app
 * and signing in are one step: signed-out events are held until sign-in and web has no guests, so a
 * trusted web open is always a signed-in one, and reading only those opens avoids scanning every
 * `authenticated_client` row in the range. The review count runs from that first answer to the seven-day bound, and the
 * return day is one of those answers on a later UTC day than the entry. The in-app steps take
 * `buildTrustedActorRowsFilterSql`, so a credential-free claim never advances anybody.
 */
export function buildSiteEntryFunnelSql(
  filters: AnalyticsFilterState,
  pageKind: SiteEntryPageKind,
  reportLabel: string,
): string {
  const { from, to } = assertValidDateRange(filters.dateRange, reportLabel);
  const rangeStartSql = `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const rangeEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;
  const stepWindowEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`;
  const windowSql = `INTERVAL '${catalogInstallConversionWindowDays} days'`;
  const pageViewSql = buildSiteFactSql("resolved", "site_page_viewed");

  return [
    "WITH actor_first_events AS MATERIALIZED (",
    "  SELECT",
    "    resolved.actor_id,",
    `    MIN(resolved.occurred_at) FILTER (WHERE ${pageViewSql}) AS first_page_viewed_at,`,
    "    MIN(resolved.occurred_at) FILTER (",
    `      WHERE ${pageViewSql}`,
    `        AND resolved.event_properties ->> 'page_kind' = ${escapeSqlStringLiteral(pageKind)}`,
    `        AND ${buildEventPlatformsFilterSql("resolved.platform", filters.eventPlatforms)}`,
    "    ) AS first_entry_viewed_at,",
    `    MIN(resolved.occurred_at) FILTER (WHERE ${buildTrustedActorRowsFilterSql("resolved.trust_level")}) AS first_trusted_event_at`,
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.actor_id IS NOT NULL",
    `    AND (${buildTrustedActorRowsFilterSql("resolved.trust_level")} OR (${pageViewSql}))`,
    `    AND resolved.occurred_at < ${rangeEndSql}`,
    "  GROUP BY resolved.actor_id",
    "), site_facts_start AS MATERIALIZED (",
    "  SELECT CASE",
    "    WHEN MIN(history.first_page_viewed_at) IS NULL THEN NULL",
    "    ELSE GREATEST(",
    `      ${escapeSqlStringLiteral(from)}::date,`,
    "      (MIN(history.first_page_viewed_at) AT TIME ZONE 'UTC')::date",
    "    )",
    "  END AS effective_from_date",
    "  FROM actor_first_events AS history",
    "), entries AS MATERIALIZED (",
    "  SELECT history.actor_id, history.first_entry_viewed_at AS entered_at",
    "  FROM actor_first_events AS history",
    `  WHERE history.first_entry_viewed_at >= ${rangeStartSql}`,
    "    AND history.first_entry_viewed_at = history.first_page_viewed_at",
    "    AND (",
    "      history.first_trusted_event_at IS NULL",
    "      OR history.first_trusted_event_at >= history.first_entry_viewed_at",
    "    )",
    "), cohort AS MATERIALIZED (",
    "  SELECT candidate.actor_id, candidate.entered_at",
    "  FROM entries AS candidate",
    "  WHERE TRUE",
    ...buildExcludedActorFilterSqlLines(),
    `    AND ${buildConnectionCountriesFilterSql("candidate.actor_id::text", filters.connectionCountries, filters.dateRange)}`,
    `    AND ${buildAppUiLanguagesFilterSql("candidate.actor_id::text", filters.appUiLanguages, filters.dateRange)}`,
    "), step_events AS MATERIALIZED (",
    "  SELECT",
    "    history.actor_id,",
    "    history.first_entry_viewed_at AS entered_at,",
    "    CASE",
    `      WHEN ${buildSiteFactSql("step_event", "site_app_entry_clicked")} THEN 'app_entry_click'`,
    "      WHEN step_event.event_name = 'review_answered' THEN 'review'",
    "      ELSE 'web_sign_in'",
    "    END AS step,",
    "    step_event.occurred_at",
    "  FROM analytics.product_events_resolved AS step_event",
    "  INNER JOIN actor_first_events AS history",
    "    ON history.actor_id = step_event.actor_id",
    "    AND step_event.occurred_at >= history.first_entry_viewed_at",
    `    AND step_event.occurred_at <= history.first_entry_viewed_at + ${windowSql}`,
    "  WHERE (",
    `      (${buildSiteFactSql("step_event", "site_app_entry_clicked")}`,
    "        AND step_event.event_properties ->> 'target' = 'web_app')",
    `      OR (${buildTrustedActorRowsFilterSql("step_event.trust_level")} AND (`,
    "        step_event.event_name = 'review_answered'",
    "        OR (",
    "          step_event.event_name = 'app_opened'",
    "          AND step_event.platform = 'web'",
    "          AND step_event.trust_level = 'authenticated_client'",
    "        )",
    "      ))",
    "    )",
    `    AND step_event.occurred_at >= ${rangeStartSql}`,
    `    AND step_event.occurred_at < ${stepWindowEndSql}`,
    "), app_entry_clicks AS MATERIALIZED (",
    "  SELECT click.actor_id, MIN(click.occurred_at) AS clicked_at",
    "  FROM step_events AS click",
    "  WHERE click.step = 'app_entry_click'",
    "  GROUP BY click.actor_id",
    "), sessions AS MATERIALIZED (",
    "  SELECT session_event.actor_id, MIN(session_event.occurred_at) AS signed_in_at",
    "  FROM step_events AS session_event",
    "  INNER JOIN app_entry_clicks AS clicked",
    "    ON clicked.actor_id = session_event.actor_id",
    "    AND session_event.occurred_at >= clicked.clicked_at",
    "  WHERE session_event.step = 'web_sign_in'",
    "  GROUP BY session_event.actor_id",
    "), first_reviews AS MATERIALIZED (",
    "  SELECT review_event.actor_id, MIN(review_event.occurred_at) AS first_review_at",
    "  FROM step_events AS review_event",
    "  INNER JOIN sessions AS signed_in",
    "    ON signed_in.actor_id = review_event.actor_id",
    "    AND review_event.occurred_at >= signed_in.signed_in_at",
    "  WHERE review_event.step = 'review'",
    "  GROUP BY review_event.actor_id",
    "), person_engagement AS MATERIALIZED (",
    "  SELECT",
    "    review.actor_id,",
    "    COUNT(*)::int AS review_count,",
    "    bool_or(",
    "      (review.occurred_at AT TIME ZONE 'UTC')::date",
    "        > (review.entered_at AT TIME ZONE 'UTC')::date",
    "    ) AS has_return_day",
    "  FROM step_events AS review",
    "  INNER JOIN first_reviews AS first_review",
    "    ON first_review.actor_id = review.actor_id",
    "    AND review.occurred_at >= first_review.first_review_at",
    "  WHERE review.step = 'review'",
    "  GROUP BY review.actor_id",
    ")",
    "SELECT",
    "  COUNT(*)::int AS entry_view_count,",
    "  COUNT(clicked.clicked_at)::int AS app_entry_click_count,",
    "  COUNT(signed_in.signed_in_at)::int AS signed_in_count,",
    "  COUNT(first_review.first_review_at)::int AS one_review_count,",
    "  (COUNT(*) FILTER (",
    `    WHERE engagement.review_count >= ${siteEntryEngagedReviewThreshold}`,
    "  ))::int AS engaged_count,",
    "  (COUNT(*) FILTER (",
    `    WHERE engagement.review_count >= ${siteEntryEngagedReviewThreshold}`,
    "      AND engagement.has_return_day",
    "  ))::int AS engaged_returning_count,",
    "  (COUNT(*) FILTER (",
    `    WHERE cohort.entered_at + ${windowSql} > now()`,
    "  ))::int AS maturing_count,",
    "  (SELECT facts.effective_from_date::text FROM site_facts_start AS facts) AS effective_from_date",
    "FROM cohort",
    "LEFT JOIN app_entry_clicks AS clicked ON clicked.actor_id = cohort.actor_id",
    "LEFT JOIN sessions AS signed_in ON signed_in.actor_id = cohort.actor_id",
    "LEFT JOIN first_reviews AS first_review ON first_review.actor_id = cohort.actor_id",
    "LEFT JOIN person_engagement AS engagement ON engagement.actor_id = cohort.actor_id",
  ].join("\n");
}

export async function loadSiteEntryFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  pageKind: SiteEntryPageKind,
  reportLabel: string,
): Promise<SiteEntryFunnelReport> {
  const response = await runAdminQuery(config, buildSiteEntryFunnelSql(filters, pageKind, reportLabel));
  if (response.resultSets.length !== 1) {
    throw new Error(`${reportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  const row = response.resultSets[0]?.rows[0];
  if (row === undefined || response.resultSets[0]?.rows.length !== 1) {
    throw new Error(
      `${reportLabel} must return exactly one row. Got ${response.resultSets[0]?.rows.length ?? 0}.`,
    );
  }

  const effectiveFromDate = row.effective_from_date ?? null;
  const count = (fieldName: string): number => toInteger(row[fieldName] ?? null, reportLabel, fieldName);

  return {
    generatedAtUtc: response.executedAtUtc,
    entryViewCount: count("entry_view_count"),
    appEntryClickCount: count("app_entry_click_count"),
    signedInCount: count("signed_in_count"),
    oneReviewCount: count("one_review_count"),
    engagedCount: count("engaged_count"),
    engagedReturningCount: count("engaged_returning_count"),
    maturingCount: count("maturing_count"),
    effectiveFromDate: effectiveFromDate === null
      ? null
      : assertIsString(effectiveFromDate, reportLabel, "effective_from_date"),
  };
}

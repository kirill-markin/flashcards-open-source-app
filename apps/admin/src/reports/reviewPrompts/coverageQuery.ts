import { useCallback, useEffect, useState } from "react";
import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { buildExcludedActorSqlLines, buildTrustedActorRowsFilterSql } from "../../filters/filterSql";
import { assertIsString, parseActivityDate } from "../reportValues";
import {
  reviewPromptIds,
  type ReviewPromptCoverage,
  type ReviewPromptCoverageSubject,
  type ReviewPromptFirstSeen,
  type ReviewPromptPlatform,
} from "./reviewPromptDefinitions";
import {
  buildPromptIdCaseSql,
  buildValueListSql,
  guestUpgradesCteBodySql,
  paywallPromptIdsByReviewTrigger,
  promptIdsByScreen,
} from "./showingsSql";

const reportLabel = "Review prompt coverage";

const coverageSubjects: ReadonlyArray<ReviewPromptCoverageSubject> = [...reviewPromptIds, "notification-opened"];

const coveragePlatforms: ReadonlyArray<ReviewPromptPlatform> = ["web", "ios", "android"];

/** The latest app version in use is the highest one opened in this many days. */
const latestVersionLookbackDays = 7;

/** The server-validated version shape, as an `int[]` that orders as semver does, or NULL. */
function buildVersionKeySql(appVersionSqlExpression: string): string {
  return `CASE WHEN ${appVersionSqlExpression} ~ '^[0-9]{1,4}(\\.[0-9]{1,4}){0,2}$'
    THEN pg_catalog.string_to_array(${appVersionSqlExpression}, '.')::int[] END`;
}

/**
 * Two statements over all time, independent of the selection. The first returns each subject's
 * first UTC day and lowest app version per platform, from the event that marks a showing (as in
 * `showingsSql.ts`) or a step's own event; the second the highest app version opened per mobile
 * platform lately. Both read trusted rows of people no report excludes.
 */
export function buildReviewPromptCoverageSql(): string {
  return `WITH guest_upgrades AS (
  ${guestUpgradesCteBodySql}
), coverage_events AS (
  SELECT CASE event.event_name
      WHEN 'paywall_shown' THEN ${buildPromptIdCaseSql("event.event_properties ->> 'review_trigger'", paywallPromptIdsByReviewTrigger)}
      WHEN 'screen_viewed' THEN ${buildPromptIdCaseSql("event.screen", promptIdsByScreen)}
      WHEN 'store_review_requested' THEN 'rating-request'
      WHEN 'notification_opened' THEN 'notification-opened'
    END AS subject,
    event.platform, event.app_version, event.actor_id::text AS actor_id, event.occurred_at
  FROM analytics.product_events_resolved AS event
  WHERE event.event_name IN ('paywall_shown', 'screen_viewed', 'store_review_requested', 'notification_opened')
    AND (event.event_name <> 'paywall_shown' OR (event.event_properties ->> 'entry_point' = 'review'
      AND event.event_properties ->> 'review_trigger' IN (${buildValueListSql(Object.keys(paywallPromptIdsByReviewTrigger))})))
    AND (event.event_name <> 'screen_viewed' OR event.screen IN (${buildValueListSql(Object.keys(promptIdsByScreen))}))
    AND event.actor_id IS NOT NULL
    AND ${buildTrustedActorRowsFilterSql("event.trust_level")}
    AND event.occurred_at <= now()
  UNION ALL
  SELECT 'automatic-feedback' AS subject, prompt_shown.platform, prompt_shown.app_version,
    COALESCE(guest_upgrade.account_user_id::text, pg_catalog.lower(prompt_shown.user_id)) AS actor_id,
    prompt_shown.created_at_server AS occurred_at
  FROM support.feedback_prompt_events AS prompt_shown
  LEFT JOIN guest_upgrades AS guest_upgrade
    ON guest_upgrade.guest_user_id::text = pg_catalog.lower(prompt_shown.user_id)
  WHERE prompt_shown.event_type = 'automatic_prompt_shown'
), actor_coverage AS MATERIALIZED (
  -- One row per person first, so the exclusion rule judges people rather than every event.
  SELECT coverage.subject, coverage.platform, coverage.actor_id,
    MIN(coverage.occurred_at) AS first_seen_at,
    MIN(CASE WHEN coverage.platform <> 'web' THEN ${buildVersionKeySql("coverage.app_version")} END) AS lowest_version_key
  FROM coverage_events AS coverage
  WHERE coverage.subject IS NOT NULL
    AND coverage.platform IN (${buildValueListSql(coveragePlatforms)})
  GROUP BY coverage.subject, coverage.platform, coverage.actor_id
)
SELECT coverage.subject, coverage.platform,
  to_char(MIN(coverage.first_seen_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS first_seen_on,
  pg_catalog.array_to_string(MIN(coverage.lowest_version_key), '.') AS lowest_version
FROM actor_coverage AS coverage
WHERE TRUE
${buildExcludedActorSqlLines("coverage.actor_id").join("\n")}
GROUP BY coverage.subject, coverage.platform;
SELECT opened.platform,
  pg_catalog.array_to_string(MAX(${buildVersionKeySql("opened.app_version")}), '.') AS latest_version
FROM (
  SELECT event.platform, event.app_version, event.actor_id::text AS actor_id
  FROM analytics.product_events_resolved AS event
  WHERE event.event_name = 'app_opened'
    AND event.occurred_at >= now() - INTERVAL '${latestVersionLookbackDays} days'
    AND event.occurred_at <= now()
    AND event.platform IN ('ios', 'android')
    AND event.actor_id IS NOT NULL
    AND ${buildTrustedActorRowsFilterSql("event.trust_level")}
) AS opened
WHERE TRUE
${buildExcludedActorSqlLines("opened.actor_id").join("\n")}
GROUP BY opened.platform`;
}

function parseSubject(value: string): ReviewPromptCoverageSubject {
  const subject = coverageSubjects.find((candidate) => candidate === value);
  if (subject === undefined) {
    throw new Error(`${reportLabel} returned an unknown subject "${value}".`);
  }

  return subject;
}

function parsePlatform(value: string): ReviewPromptPlatform {
  const platform = coveragePlatforms.find((candidate) => candidate === value);
  if (platform === undefined) {
    throw new Error(`${reportLabel} returned an unknown platform "${value}".`);
  }

  return platform;
}

export async function loadReviewPromptCoverage(config: AdminAppConfig, signal: AbortSignal): Promise<ReviewPromptCoverage> {
  const response = await runAdminQuery(config, buildReviewPromptCoverageSql(), signal);
  const [firstSeenResult, latestVersionResult] = response.resultSets;
  if (response.resultSets.length !== 2 || firstSeenResult === undefined || latestVersionResult === undefined) {
    throw new Error(`${reportLabel} must return exactly two result sets. Got ${response.resultSets.length}.`);
  }

  const firstSeen: Record<ReviewPromptCoverageSubject, Partial<Record<ReviewPromptPlatform, ReviewPromptFirstSeen>>> = Object.fromEntries(
    coverageSubjects.map((subject) => [subject, {}]),
  ) as Record<ReviewPromptCoverageSubject, Partial<Record<ReviewPromptPlatform, ReviewPromptFirstSeen>>>;
  for (const row of firstSeenResult.rows) {
    const version = row.lowest_version ?? null;
    firstSeen[parseSubject(assertIsString(row.subject ?? null, reportLabel, "subject"))][parsePlatform(assertIsString(row.platform ?? null, reportLabel, "platform"))] = {
      date: parseActivityDate(row.first_seen_on ?? null, reportLabel, "first_seen_on"),
      version: version === null ? null : assertIsString(version, reportLabel, "lowest_version"),
    };
  }

  const latestVersions: Partial<Record<ReviewPromptPlatform, string>> = {};
  for (const row of latestVersionResult.rows) {
    const version = row.latest_version ?? null;
    if (version !== null) {
      latestVersions[parsePlatform(assertIsString(row.platform ?? null, reportLabel, "platform"))] = assertIsString(version, reportLabel, "latest_version");
    }
  }

  return { firstSeen, latestVersions };
}

export type ReviewPromptCoverageState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; coverage: ReviewPromptCoverage }>;

export type ReviewPromptCoverageLoad = Readonly<{ state: ReviewPromptCoverageState; retry: () => void }>;

/** Loads the coverage once per mount, because no filter changes it. */
export function useReviewPromptCoverage(
  config: AdminAppConfig,
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean,
): ReviewPromptCoverageLoad {
  const [state, setState] = useState<ReviewPromptCoverageState>({ status: "loading" });
  const [loadRevision, setLoadRevision] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    void loadReviewPromptCoverage(config, abortController.signal)
      .then((coverage) => {
        if (cancelled === false) {
          setState({ status: "ready", coverage });
        }
      })
      .catch((error: unknown) => {
        if (cancelled || onTerminalAdminError(error, config)) {
          return;
        }

        setState({ status: "error", message: error instanceof Error ? error.message : "Unexpected review prompt coverage error." });
      });

    return () => { cancelled = true; abortController.abort(); };
  }, [config, loadRevision, onTerminalAdminError]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setLoadRevision((revision) => revision + 1);
  }, []);
  return { state, retry };
}

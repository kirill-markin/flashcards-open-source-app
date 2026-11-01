import { runAdminQuery } from "../../adminApi";
import { breakdownOtherValue } from "../../charts/stackedBreakdownChart";
import type { AdminAppConfig } from "../../config";
import { buildDefaultAnalyticsFilterState, type AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildActorAppUiLanguageSql,
  buildActorConnectionCountrySql,
  buildTrustedActorRowsFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import {
  platformFunnelGroupByDimensionId,
  unresolvedFunnelGroupKey,
  type FunnelGroupByDimension,
} from "../funnels/funnelGroupBy";
import type { FunnelWarning } from "../funnels/funnelWarnings";
import { liveSourceBarFreshness, type BreakdownReport } from "../levelOneMetrics/breakdownReport";
import {
  buildReportBucketColumnsSql,
  buildReportBucketSql,
  buildReportBucketsCteSql,
  parseReportBucket,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import { paywallStepWindowDays } from "../paywallFunnel/attributionQuery";
import { assertIsString, assertValidDateRange, parseActivityDate, toInteger } from "../reportValues";
import {
  formatReviewPromptActedWindow,
  getReviewPrompt,
  hardReminderAnswerCount,
  hardReminderHardLimit,
  reviewPromptIds,
  type ReviewPromptActed,
  type ReviewPromptActedWindow,
  type ReviewPromptStepCoverageSubject,
  type ReviewPromptId,
} from "./reviewPromptDefinitions";
import { buildReviewPromptShowingsCtes } from "./showingsSql";

const reportLabel = "Review prompt details";

/** A notification or a mobile app opened counts this long after the showing. */
export const reviewPromptFollowUpDays = 14;

/**
 * One funnel step of a showing. `reachedSql` is the step's own fact as a boolean over `showing`, a
 * `prompt_showings` row; a showing counts at a step only when it also reached every step above it.
 * `coverageSubject` names the step's own event when its first report is its own, else `null`.
 */
export type ReviewPromptStep = Readonly<{
  id: string;
  label: string;
  rule: string;
  reachedSql: string;
  coverageSubject: ReviewPromptStepCoverageSubject | null;
}>;

export type ReviewPromptFunnel = Readonly<{
  anchor: FunnelAnchor<string>;
  steps: ReadonlyArray<ReviewPromptStep>;
  /** The events a step reads past the showings' own follow-up, as a predicate over `event`, or `null`. */
  followUpEventsSql: string | null;
  /** A caveat of the funnel itself, whatever the selection. */
  warning: FunnelWarning | null;
}>;

function buildWindowSql(window: ReviewPromptActedWindow): string {
  return `INTERVAL '${window.amount} ${window.unit}s'`;
}

function getActedRule(promptId: ReviewPromptId): Extract<ReviewPromptActed, { kind: "rule" }> {
  const acted = getReviewPrompt(promptId).acted;
  if (acted.kind !== "rule") {
    throw new Error(`Review prompt "${promptId}" reports no Acted rule.`);
  }

  return acted;
}

const shownStep: ReviewPromptStep = {
  id: "shown",
  label: "Shown",
  rule: "Every showing on a selected day.",
  reachedSql: "TRUE",
  coverageSubject: null,
};

/** The table's Acted, as a step. */
function buildActedStep(promptId: ReviewPromptId, id: string, label: string): ReviewPromptStep {
  const acted = getActedRule(promptId);
  return { id, label, rule: `${acted.rule} within ${formatReviewPromptActedWindow(acted.window)}.`, reachedSql: "showing.acted", coverageSubject: null };
}

/** The prompt's own accept button, inside its Acted window; `prompt_event_rows` holds those answers. */
function buildAcceptedStep(promptId: ReviewPromptId, promptKey: string, id: string, label: string): ReviewPromptStep {
  const window = getActedRule(promptId).window;
  return {
    id,
    label,
    rule: `${label} on the prompt within ${formatReviewPromptActedWindow(window)}.`,
    reachedSql: `showing.showing_id IN (
      SELECT answered.showing_id
      FROM prompt_showings AS answered
      JOIN prompt_event_rows AS answer ON answer.actor_id = answered.actor_id
        AND answer.occurred_at >= answered.shown_at
        AND answer.occurred_at <= answered.shown_at + ${buildWindowSql(window)}
      WHERE answer.event_name = 'prompt_answered'
        AND answer.prompt = ${escapeSqlStringLiteral(promptKey)}
        AND answer.outcome = 'accepted')`,
    coverageSubject: null,
  };
}

/** A `follow_up_events` row by the same person within `reviewPromptFollowUpDays` after the showing. */
function buildFollowUpStep(
  id: string,
  label: string,
  rule: string,
  coverageSubject: ReviewPromptStepCoverageSubject | null,
): ReviewPromptStep {
  return {
    id,
    label,
    rule,
    coverageSubject,
    reachedSql: `showing.showing_id IN (
      SELECT returned.showing_id
      FROM prompt_showings AS returned
      JOIN follow_up_events AS event ON event.actor_id = returned.actor_id
        AND event.occurred_at > returned.shown_at
        AND event.occurred_at <= returned.shown_at + INTERVAL '${reviewPromptFollowUpDays} days')`,
  };
}

/** A paywall choice or checkout linked to the presentation by `flow_outcomes` of the attribution CTEs. */
function buildPaywallFlowStep(flag: "chose_premium" | "checkout", id: string, label: string, rule: string): ReviewPromptStep {
  return {
    id,
    label,
    rule,
    reachedSql: `showing.showing_id IN (SELECT flow.shown_event_id FROM flow_outcomes AS flow WHERE flow.${flag})`,
    coverageSubject: null,
  };
}

function buildPaywallSteps(promptId: ReviewPromptId): ReadonlyArray<ReviewPromptStep> {
  return [
    shownStep,
    buildPaywallFlowStep("chose_premium", "premium-tapped", "Premium tapped", `Premium chosen on this paywall within ${paywallStepWindowDays} days.`),
    buildPaywallFlowStep("checkout", "checkout", "Checkout requested", `A checkout started from this paywall within ${paywallStepWindowDays} days.`),
    buildActedStep(promptId, "paid", "Trial or first payment"),
  ];
}

const reviewPromptSteps: Readonly<Record<ReviewPromptId, ReadonlyArray<ReviewPromptStep>>> = {
  "paywall-initial": buildPaywallSteps("paywall-initial"),
  "paywall-second": buildPaywallSteps("paywall-second"),
  "paywall-periodic": buildPaywallSteps("paywall-periodic"),
  "notifications-pre-prompt": [
    shownStep,
    buildAcceptedStep("notifications-pre-prompt", "notifications_pre_prompt", "continue", "Continue tapped"),
    buildActedStep("notifications-pre-prompt", "granted", "OS granted"),
    buildFollowUpStep(
      "notification-opened",
      "Notification opened",
      `A notification opened within ${reviewPromptFollowUpDays} days, on an app that reports it.`,
      "notification-opened",
    ),
  ],
  "hard-reminder": [
    shownStep,
    buildActedStep("hard-reminder", "fewer-hard", `Under ${hardReminderHardLimit} Hard in the next ${hardReminderAnswerCount}`),
  ],
  "rating-request": [
    {
      id: "requested",
      label: "Requested",
      rule: "A rating dialog requested from Apple or Google, which decide on their own whether it appears.",
      reachedSql: "TRUE",
      coverageSubject: null,
    },
  ],
  "web-mobile-app-promo": [
    shownStep,
    buildActedStep("web-mobile-app-promo", "store-link", "Store link clicked"),
    buildFollowUpStep(
      "mobile-app-opened",
      "Mobile app opened",
      `The same person opened the iOS or Android app within ${reviewPromptFollowUpDays} days.`,
      null,
    ),
  ],
  "automatic-feedback": [shownStep, buildActedStep("automatic-feedback", "submitted", "Submitted")],
  "guest-sign-in": [
    shownStep,
    buildAcceptedStep("guest-sign-in", "signin_after_review_prompt", "sign-in-tapped", "Sign in tapped"),
    buildActedStep("guest-sign-in", "linked", "Account linked"),
  ],
};

const followUpEventsSqlByPrompt: Readonly<Partial<Record<ReviewPromptId, string>>> = {
  "notifications-pre-prompt": "event.event_name = 'notification_opened'",
  "web-mobile-app-promo": "event.event_name = 'app_opened' AND event.platform IN ('ios', 'android')",
};

const funnelWarningsByPrompt: Readonly<Partial<Record<ReviewPromptId, FunnelWarning>>> = {
  "web-mobile-app-promo": {
    id: "same-account",
    label: "same account",
    text: "Mobile app opened links only a person signed in to the same account on iOS or Android; a new mobile guest is a different person, so this step undercounts.",
  },
};

function buildReviewPromptFunnel(promptId: ReviewPromptId): ReviewPromptFunnel {
  const steps = reviewPromptSteps[promptId];
  const [firstStep, ...laterSteps] = steps;
  if (firstStep === undefined) {
    throw new Error(`Review prompt "${promptId}" has no funnel steps.`);
  }

  return {
    anchor: { funnelId: `review-prompt-${promptId}`, stepIds: [firstStep.id, ...laterSteps.map((step) => step.id)] },
    steps,
    followUpEventsSql: followUpEventsSqlByPrompt[promptId] ?? null,
    warning: funnelWarningsByPrompt[promptId] ?? null,
  };
}

export const reviewPromptFunnels = Object.fromEntries(
  reviewPromptIds.map((promptId) => [promptId, buildReviewPromptFunnel(promptId)]),
) as Readonly<Record<ReviewPromptId, ReviewPromptFunnel>>;

const showingNumberGroupByDimensionId = "showing-number";
const connectionCountryGroupByDimensionId = "country";
const appUiLanguageGroupByDimensionId = "language";

/** Each key is a property of the showing, so the groups partition the showings and sum to the funnel. */
export const reviewPromptGroupByDimensions: ReadonlyArray<FunnelGroupByDimension> = [
  { id: platformFunnelGroupByDimensionId, label: "Platform", buildGroupKeySql: () => "showing.platform" },
  { id: "app-version", label: "App version", buildGroupKeySql: () => "NULLIF(showing.app_version, '')" },
  {
    id: showingNumberGroupByDimensionId,
    label: "Showing number",
    buildGroupKeySql: () => "CASE WHEN history.showing_number = 1 THEN '1st' WHEN history.showing_number = 2 THEN '2nd' WHEN history.showing_number >= 3 THEN '3rd+' END",
  },
  {
    id: "sign-in-state",
    label: "Sign-in state",
    // Feedback rows carry no trust level, so they are Unresolved.
    buildGroupKeySql: () => "CASE showing.trust_level WHEN 'guest_client' THEN 'Guest' WHEN 'authenticated_client' THEN 'Signed in' ELSE showing.trust_level END",
  },
  { id: connectionCountryGroupByDimensionId, label: "Connection country", buildGroupKeySql: () => "actor_country.country" },
  { id: appUiLanguageGroupByDimensionId, label: "App interface language", buildGroupKeySql: () => "actor_language.ui_locale" },
];

/** The first UTC day any prompt was shown, where a person's showing number starts. */
const showingHistoryStartDate = "2026-06-05";

/** Reads `prompt_actors`, the people of the prompt's showings in the funnel query. */
const promptActorIdsSql = "SELECT prompt_actor.actor_id FROM prompt_actors AS prompt_actor";

/**
 * Only the source the selected dimension reads, because each is a scan of its own; country and
 * language are placed once, for the prompt's people only. The showing number counts the person's
 * showings of this prompt on every platform from the first day any prompt was shown, whatever the selected range
 * and filters, so it reruns the showings over that whole history.
 */
function buildGroupSourceSql(
  promptId: ReviewPromptId,
  dimension: FunnelGroupByDimension | null,
  filters: AnalyticsFilterState,
): Readonly<{ cte: string; join: string }> {
  if (dimension?.id === showingNumberGroupByDimensionId) {
    const historyFilters = buildDefaultAnalyticsFilterState({
      from: filters.dateRange.from < showingHistoryStartDate ? filters.dateRange.from : showingHistoryStartDate,
      to: filters.dateRange.to,
    });
    return {
      cte: `, showing_history AS MATERIALIZED (
  ${buildReviewPromptShowingsCtes(historyFilters)}
  SELECT history.showing_id,
    row_number() OVER (PARTITION BY history.actor_id ORDER BY history.shown_at, history.showing_id) AS showing_number
  FROM showings AS history
  WHERE history.prompt_id = ${escapeSqlStringLiteral(promptId)}
)`,
      join: "LEFT JOIN showing_history AS history ON history.showing_id = showing.showing_id",
    };
  }

  if (dimension?.id === connectionCountryGroupByDimensionId) {
    return {
      cte: `, actor_country AS MATERIALIZED (
  SELECT placed.actor_id::text AS actor_id, placed.country
  FROM (
${buildActorConnectionCountrySql(filters.dateRange, promptActorIdsSql)}
  ) AS placed
)`,
      join: "LEFT JOIN actor_country ON actor_country.actor_id = showing.actor_id",
    };
  }

  if (dimension?.id === appUiLanguageGroupByDimensionId) {
    return {
      cte: `, actor_language AS MATERIALIZED (
  SELECT placed.actor_id::text AS actor_id, placed.ui_locale
  FROM (
${buildActorAppUiLanguageSql(filters.dateRange, promptActorIdsSql)}
  ) AS placed
)`,
      join: "LEFT JOIN actor_language ON actor_language.actor_id = showing.actor_id",
    };
  }

  return { cte: "", join: "" };
}

/** The showings CTE chain narrowed to one prompt as `prompt_showings`. */
function buildPromptShowingsCtes(promptId: ReviewPromptId, filters: AnalyticsFilterState): string {
  return `${buildReviewPromptShowingsCtes(filters)}, prompt_showings AS MATERIALIZED (
  SELECT showing.* FROM showings AS showing WHERE showing.prompt_id = ${escapeSqlStringLiteral(promptId)}
)`;
}

/** The `follow_up_events` CTE a step of this prompt reads, or nothing for a prompt without one. */
function buildFollowUpEventsCte(promptId: ReviewPromptId, filters: AnalyticsFilterState): string {
  const followUpEventsSql = reviewPromptFunnels[promptId].followUpEventsSql;
  if (followUpEventsSql === null) {
    return "";
  }

  const { from, to } = assertValidDateRange(filters.dateRange, reportLabel);
  return `, follow_up_events AS MATERIALIZED (
  SELECT event.actor_id::text AS actor_id, event.occurred_at
  FROM analytics.product_events_resolved AS event
  WHERE ${followUpEventsSql}
    AND event.actor_id IS NOT NULL
    AND ${buildTrustedActorRowsFilterSql("event.trust_level")}
    AND event.occurred_at >= (${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'
    AND event.occurred_at < (${escapeSqlStringLiteral(to)}::date + INTERVAL '${reviewPromptFollowUpDays + 1} days')::timestamp AT TIME ZONE 'UTC'
    AND event.occurred_at <= now()
    AND event.actor_id = ANY (ARRAY(${promptActorIdsSql}))
)`;
}

/** Showings per step of one group; `stepCounts` follows the funnel's steps, each a subset of the one above. */
export type ReviewPromptFunnelCounts = Readonly<{
  stepCounts: ReadonlyArray<number>;
  /** Showings whose Acted can still change. */
  actedPendingCount: number;
  /** Showings younger than `reviewPromptFollowUpDays`, whose follow-up step can still change. */
  followUpPendingCount: number;
}>;

export type ReviewPromptFunnelGroup = ReviewPromptFunnelCounts & Readonly<{ key: string }>;

/** No group at all when nothing was shown, because every count is grouped. */
export type ReviewPromptFunnelReport = Readonly<{
  generatedAtUtc: string;
  groups: ReadonlyArray<ReviewPromptFunnelGroup>;
}>;

export function buildReviewPromptFunnelSql(
  promptId: ReviewPromptId,
  filters: AnalyticsFilterState,
  dimension: FunnelGroupByDimension | null,
): string {
  const steps = reviewPromptFunnels[promptId].steps;
  const groupKeySql = dimension === null
    ? "'all'::text"
    : `COALESCE(${dimension.buildGroupKeySql(filters)}, ${escapeSqlStringLiteral(unresolvedFunnelGroupKey)})::text`;
  const source = buildGroupSourceSql(promptId, dimension, filters);
  const reachedColumnsSql = steps.map((step, index) => `(${step.reachedSql}) AS reached_${index}`).join(",\n    ");
  const stepCountsSql = steps.map((_step, index) => {
    const reachedSql = steps.slice(0, index + 1).map((_reachedStep, reachedIndex) => `showing.reached_${reachedIndex}`).join(" AND ");
    return `(COUNT(*) FILTER (WHERE ${reachedSql}))::int AS step_${index}_count`;
  }).join(",\n  ");

  return `${buildPromptShowingsCtes(promptId, filters)}, prompt_actors AS MATERIALIZED (
  -- As \`uuid\`, the view's actor id type, so a membership test never casts the view's side; an id
  -- that is no uuid has no event there.
  SELECT DISTINCT showing.actor_id::uuid AS actor_id
  FROM prompt_showings AS showing
  WHERE pg_catalog.pg_input_is_valid(showing.actor_id, 'uuid')
)${buildFollowUpEventsCte(promptId, filters)}, showing_steps AS (
  SELECT showing.*,
    ${reachedColumnsSql}
  FROM prompt_showings AS showing
)${source.cte}
SELECT ${groupKeySql} AS group_key,
  ${stepCountsSql},
  (COUNT(*) FILTER (WHERE showing.acted_settles_at > now()))::int AS acted_pending_count,
  (COUNT(*) FILTER (WHERE showing.shown_at + INTERVAL '${reviewPromptFollowUpDays} days' > now()))::int AS follow_up_pending_count
FROM showing_steps AS showing
${source.join}
GROUP BY group_key`;
}

export async function loadReviewPromptFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  promptId: ReviewPromptId,
  dimension: FunnelGroupByDimension | null,
  signal: AbortSignal,
): Promise<ReviewPromptFunnelReport> {
  const response = await runAdminQuery(config, buildReviewPromptFunnelSql(promptId, filters, dimension), signal);
  if (response.resultSets.length !== 1) {
    throw new Error(`${reportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  const steps = reviewPromptFunnels[promptId].steps;
  return {
    generatedAtUtc: response.executedAtUtc,
    groups: (response.resultSets[0]?.rows ?? []).map((row) => {
      const count = (fieldName: string): number => toInteger(row[fieldName] ?? null, reportLabel, fieldName);
      return {
        key: assertIsString(row.group_key ?? null, reportLabel, "group_key"),
        stepCounts: steps.map((_step, index) => count(`step_${index}_count`)),
        actedPendingCount: count("acted_pending_count"),
        followUpPendingCount: count("follow_up_pending_count"),
      };
    }),
  };
}

/** Every showing's one outcome, stacked in this order from the bottom; `Other` takes the neutral grey. */
const reviewPromptOutcomes = [
  { value: "Acted", conditionSql: "showing.acted" },
  // Not acted yet while its Gone or Acted window is still open, so it can still move.
  { value: "Maturing", conditionSql: "showing.gone_state = 'maturing' OR showing.acted_settles_at > now()" },
  { value: "Gone", conditionSql: "showing.gone_state = 'gone'" },
  { value: breakdownOtherValue, conditionSql: "TRUE" },
] as const;

function listPromptOutcomes(promptId: ReviewPromptId): ReadonlyArray<(typeof reviewPromptOutcomes)[number]> {
  return getReviewPrompt(promptId).acted.kind === "rule"
    ? reviewPromptOutcomes
    : reviewPromptOutcomes.filter((outcome) => outcome.value !== "Acted");
}

export function buildReviewPromptOutcomesSql(
  promptId: ReviewPromptId,
  filters: AnalyticsFilterState,
  period: ReportPeriod,
): string {
  const outcomes = listPromptOutcomes(promptId);
  const outcomeCaseSql = outcomes.map((outcome) => `WHEN ${outcome.conditionSql} THEN ${escapeSqlStringLiteral(outcome.value)}`).join("\n      ");
  const countsSql = outcomes.map((outcome, index) => (
    `(COUNT(*) FILTER (WHERE outcome.outcome = ${escapeSqlStringLiteral(outcome.value)}))::int AS outcome_${index}_count`
  )).join(",\n  ");

  return `${buildPromptShowingsCtes(promptId, filters)}, ${buildReportBucketsCteSql(period, filters.dateRange)}, showing_outcomes AS (
  SELECT ${buildReportBucketSql(period, "(showing.shown_at AT TIME ZONE 'UTC')::date")} AS bucket_date,
    CASE ${outcomeCaseSql} END AS outcome
  FROM prompt_showings AS showing
)
SELECT ${buildReportBucketColumnsSql("bucket")},
  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today,
  ${countsSql}
FROM report_buckets AS bucket
LEFT JOIN showing_outcomes AS outcome ON outcome.bucket_date = bucket.bucket_date
GROUP BY bucket.bucket_date, bucket.selected_from, bucket.selected_to
ORDER BY bucket.bucket_date`;
}

export async function loadReviewPromptOutcomesReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  promptId: ReviewPromptId,
  period: ReportPeriod,
  signal: AbortSignal,
): Promise<BreakdownReport> {
  const response = await runAdminQuery(config, buildReviewPromptOutcomesSql(promptId, filters, period), signal);
  const rows = response.resultSets.length === 1 ? response.resultSets[0]?.rows ?? [] : null;
  const firstRow = rows?.[0];
  if (rows === null || firstRow === undefined) {
    throw new Error(`${reportLabel} outcomes must return one result set with a row per bucket. Got ${response.resultSets.length} result sets.`);
  }

  const outcomes = listPromptOutcomes(promptId);
  return {
    generatedAtUtc: response.executedAtUtc,
    period,
    today: parseActivityDate(firstRow.today ?? null, reportLabel, "today"),
    values: outcomes.map((outcome) => outcome.value),
    valueLabels: null,
    buckets: rows.map((row) => {
      const bucket = parseReportBucket(row, reportLabel);
      return {
        bucket,
        countsByValue: new Map(outcomes.map((outcome, index) => [
          outcome.value,
          toInteger(row[`outcome_${index}_count`] ?? null, reportLabel, `outcome_${index}_count`),
        ])),
        freshness: liveSourceBarFreshness(bucket),
      };
    }),
  };
}

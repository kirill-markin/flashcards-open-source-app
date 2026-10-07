import { runAdminQuery, type AdminQueryObject, type AdminQueryValue } from "../adminApi";
import type { AdminAppConfig } from "../config";
import type { AnalyticsDateRange } from "../filters/analyticsFilters";
import {
  buildConnectionCountrySamplesSql,
  buildExcludedActorReasonSql,
  buildTrustedActorRowsFilterSql,
} from "../filters/filterSql";
import { formatCalendarDate } from "../reports/reportValues";
import { buildDataTableSqlClauses, type DataTableSqlClauses } from "../table/dataTableSql";
import type { DataTableColumn, DataTableState } from "../table/dataTableModel";
import { userSettingsFields, type UserSettingsField, type UserSettingsFieldId } from "./userSettingsFields";

const reportLabel = "Users";

export type UserKind = "account" | "guest";

/** A boolean setting reads `on`, `off` or `unanswered` for NULL, so it is filtered as an enum. */
export type UserSettingsValues = Readonly<Record<UserSettingsFieldId, string | null>>;

export type UserRow = Readonly<{
  userId: string;
  email: string | null;
  kind: UserKind;
  mergedIntoUserId: string | null;
  /** `auth.guest_upgrade_history` rows naming this person as the account a guest merged into. */
  guestsMergedInCount: number;
  guestSessionCount: number;
  createdAt: string;
  /** The earliest `auth.user_identities` row; null for a guest. */
  identityCreatedAt: string | null;
  /** Trusted rows only, as `buildTrustedActorRowsFilterSql` defines them, like the platforms, app version and UI locale. */
  firstSeenAt: string | null;
  lastActiveAt: string | null;
  activeDays: number;
  eventCount: number;
  /** Every trust level, as the profile's Totals count them. */
  everyTrustFirstSeenAt: string | null;
  everyTrustLastSeenAt: string | null;
  everyTrustActiveDays: number;
  everyTrustEventCount: number;
  platforms: ReadonlyArray<string>;
  latestAppVersion: string | null;
  /** Every country a retained connection sample places the person in; samples are kept 90 days. */
  connectionCountries: ReadonlyArray<string>;
  latestUiLocale: string | null;
  reviewCount: number;
  cardCount: number;
  deckCount: number;
  workspaceCount: number;
  /** The workspace `settings.workspace_id` names; every one of these is null when it names none. */
  currentWorkspaceName: string | null;
  currentWorkspaceRole: string | null;
  currentWorkspaceMemberCount: number | null;
  currentWorkspaceFsrsAlgorithm: string | null;
  currentWorkspaceDesiredRetention: number | null;
  currentWorkspaceLearningSteps: string | null;
  currentWorkspaceRelearningSteps: string | null;
  currentWorkspaceMaximumIntervalDays: number | null;
  currentWorkspaceFuzz: boolean | null;
  currentWorkspaceFsrsUpdatedAt: string | null;
  aiUserMessageCount: number;
  aiCharacterCount: number;
  aiCallCount: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiCacheReadTokens: number;
  aiCacheWriteTokens: number;
  aiReasoningTokens: number;
  everPurchasedAt: string | null;
  trialConsumedAt: string | null;
  trialProvider: string | null;
  /** Purchases held now or previously, as the profile's Purchases section lists them. */
  purchaseCount: number;
  latestPurchaseTier: string | null;
  latestPurchaseStatus: string | null;
  latestPurchaseProvider: string | null;
  latestPurchaseKind: string | null;
  latestPurchaseEnvironment: string | null;
  latestPurchaseTrial: boolean | null;
  latestPurchaseWillRenew: boolean | null;
  latestPurchaseUntil: string | null;
  latestPurchaseGraceUntil: string | null;
  /** Every grant, revoked and expired ones included. */
  grantCount: number;
  activeGrantTiers: ReadonlyArray<string>;
  feedbackCount: number;
  friendCount: number;
  hasPublicProfile: boolean;
  friendInvitationsCreated: number;
  friendInvitationsAcceptedByOthers: number;
  friendInvitationsAccepted: number;
  leaderboardParticipation: boolean | null;
  /** The arms of the analytics exclusion rule the person matches; empty for a person every report counts. */
  exclusionReason: ReadonlyArray<string>;
  /** `analytics.excluded_actors` rows on the folded id, restored ones included. */
  exclusionListEntryCount: number;
  settings: UserSettingsValues;
}>;

type UserField = Exclude<keyof UserRow, "settings">;

export function utcInstantSql(sqlExpression: string): string {
  return `to_char(${sqlExpression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
}

const actorIdSql = "pg_catalog.lower(settings.user_id)";

const exclusionReasonSql = buildExcludedActorReasonSql(actorIdSql);

/**
 * The SQL each Users-list column's filter and sort read, keyed by the column ids `UsersPage` declares, over
 * the joins of `usersFromSql`. A date is the raw `timestamptz`, and a list a `text[]`, empty for no values.
 */
const userColumnSql = {
  "user-id": "settings.user_id",
  email: "settings.email",
  kind: "CASE WHEN identities.user_id IS NULL THEN 'guest' ELSE 'account' END",
  "merged-guest": "merged_guests.account_user_id IS NOT NULL",
  "merged-into": "merged_guests.account_user_id",
  "guests-merged-in": "COALESCE(guest_upgrades.merged_in_count, 0)",
  "guest-sessions": "COALESCE(guest_session_counts.session_count, 0)",
  excluded: `${exclusionReasonSql} <> ''`,
  "exclusion-reason": `COALESCE(string_to_array(NULLIF(${exclusionReasonSql}, ''), ', '), ARRAY[]::text[])`,
  "exclusion-list-entries": "COALESCE(exclusion_entries.entry_count, 0)",
  created: "settings.created_at",
  "identity-created": "identities.created_at",
  "first-seen": "activity.first_seen_at",
  "last-active": "activity.last_active_at",
  "active-days": "COALESCE(activity.active_days, 0)",
  events: "COALESCE(activity.event_count, 0)",
  "first-seen-every-trust": "activity.every_trust_first_seen_at",
  "last-seen-every-trust": "activity.every_trust_last_seen_at",
  "active-days-every-trust": "COALESCE(activity.every_trust_active_days, 0)",
  "events-every-trust": "COALESCE(activity.every_trust_event_count, 0)",
  platforms: "COALESCE(activity.platforms, ARRAY[]::text[])",
  "app-version": "activity.app_version",
  countries: "COALESCE(countries.countries, ARRAY[]::text[])",
  "ui-locale": "activity.ui_locale",
  reviews: "COALESCE(reviews.review_count, 0)",
  cards: "COALESCE(workspace_content.card_count, 0)",
  decks: "COALESCE(workspace_content.deck_count, 0)",
  workspaces: "COALESCE(workspace_content.workspace_count, 0)",
  "workspace-name": "current_workspace.name",
  "workspace-role": "current_membership.role",
  "workspace-members": "CASE WHEN current_workspace.workspace_id IS NOT NULL THEN COALESCE(current_workspace_members.member_count, 0) END",
  "workspace-fsrs-algorithm": "current_workspace.fsrs_algorithm",
  "workspace-desired-retention": "current_workspace.fsrs_desired_retention",
  "workspace-learning-steps": "current_workspace.fsrs_learning_steps_minutes::text",
  "workspace-relearning-steps": "current_workspace.fsrs_relearning_steps_minutes::text",
  "workspace-maximum-interval": "current_workspace.fsrs_maximum_interval_days",
  "workspace-fuzz": "current_workspace.fsrs_enable_fuzz",
  "workspace-fsrs-updated": "current_workspace.fsrs_updated_at",
  "ai-messages": "COALESCE(chat.ai_user_messages, 0)",
  "ai-chars": "COALESCE(chat.ai_chars, 0)",
  "ai-calls": "COALESCE(ai_usage.call_count, 0)",
  "ai-input-tokens": "COALESCE(ai_usage.input_tokens, 0)",
  "ai-output-tokens": "COALESCE(ai_usage.output_tokens, 0)",
  "ai-cache-read-tokens": "COALESCE(ai_usage.cache_read_tokens, 0)",
  "ai-cache-write-tokens": "COALESCE(ai_usage.cache_write_tokens, 0)",
  "ai-reasoning-tokens": "COALESCE(ai_usage.reasoning_tokens, 0)",
  "ever-purchased": "billing_state.ever_purchased_at",
  "trial-consumed": "billing_state.trial_consumed_at",
  "trial-provider": "billing_state.trial_provider",
  purchases: "COALESCE(purchase_counts.purchase_count, 0)",
  "purchase-tier": "latest_purchases.tier",
  "purchase-status": "latest_purchases.status",
  "purchase-provider": "latest_purchases.provider",
  "purchase-kind": "latest_purchases.kind",
  "purchase-environment": "latest_purchases.environment",
  "purchase-trial": "latest_purchases.is_trial",
  "purchase-will-renew": "latest_purchases.will_renew",
  "purchase-until": "latest_purchases.until",
  "purchase-grace-until": "latest_purchases.grace_until",
  grants: "COALESCE(grant_totals.grant_count, 0)",
  "grant-tiers": "COALESCE(grant_totals.active_tiers, ARRAY[]::text[])",
  feedback: "COALESCE(feedback.feedback_count, 0)",
  friends: "COALESCE(friends.friend_count, 0)",
  "public-profile": "profiles.user_id IS NOT NULL",
  "invitations-created": "COALESCE(invitations_sent.created_count, 0)",
  "invitations-accepted-by-others": "COALESCE(invitations_sent.accepted_by_others_count, 0)",
  "invitations-accepted": "COALESCE(invitations_accepted.accepted_count, 0)",
  leaderboard: "profiles.leaderboard_participation",
} as const;

/** A boolean setting as the enum `UserSettingsValues` describes. */
function buildUserSettingSql(field: UserSettingsField): string {
  return field.kind === "boolean"
    ? `CASE WHEN ${field.sql} IS NULL THEN 'unanswered' WHEN ${field.sql} THEN 'on' ELSE 'off' END`
    : field.sql;
}

const columnSqlById: Readonly<Record<string, string>> = {
  ...userColumnSql,
  ...Object.fromEntries(userSettingsFields.map((field) => [field.id, buildUserSettingSql(field)])),
};

// Positional order of every row's JSON array, followed by `userSettingsFields`; see `buildUsersPageSql`.
const userFieldSql: Readonly<Record<UserField, string>> = {
  userId: userColumnSql["user-id"],
  email: userColumnSql.email,
  kind: userColumnSql.kind,
  mergedIntoUserId: userColumnSql["merged-into"],
  guestsMergedInCount: userColumnSql["guests-merged-in"],
  guestSessionCount: userColumnSql["guest-sessions"],
  createdAt: utcInstantSql(userColumnSql.created),
  identityCreatedAt: utcInstantSql(userColumnSql["identity-created"]),
  firstSeenAt: utcInstantSql(userColumnSql["first-seen"]),
  lastActiveAt: utcInstantSql(userColumnSql["last-active"]),
  activeDays: userColumnSql["active-days"],
  eventCount: userColumnSql.events,
  everyTrustFirstSeenAt: utcInstantSql(userColumnSql["first-seen-every-trust"]),
  everyTrustLastSeenAt: utcInstantSql(userColumnSql["last-seen-every-trust"]),
  everyTrustActiveDays: userColumnSql["active-days-every-trust"],
  everyTrustEventCount: userColumnSql["events-every-trust"],
  platforms: `to_json(${userColumnSql.platforms})`,
  latestAppVersion: userColumnSql["app-version"],
  connectionCountries: `to_json(${userColumnSql.countries})`,
  latestUiLocale: userColumnSql["ui-locale"],
  reviewCount: userColumnSql.reviews,
  cardCount: userColumnSql.cards,
  deckCount: userColumnSql.decks,
  workspaceCount: userColumnSql.workspaces,
  currentWorkspaceName: userColumnSql["workspace-name"],
  currentWorkspaceRole: userColumnSql["workspace-role"],
  currentWorkspaceMemberCount: userColumnSql["workspace-members"],
  currentWorkspaceFsrsAlgorithm: userColumnSql["workspace-fsrs-algorithm"],
  currentWorkspaceDesiredRetention: userColumnSql["workspace-desired-retention"],
  currentWorkspaceLearningSteps: userColumnSql["workspace-learning-steps"],
  currentWorkspaceRelearningSteps: userColumnSql["workspace-relearning-steps"],
  currentWorkspaceMaximumIntervalDays: userColumnSql["workspace-maximum-interval"],
  currentWorkspaceFuzz: userColumnSql["workspace-fuzz"],
  currentWorkspaceFsrsUpdatedAt: utcInstantSql(userColumnSql["workspace-fsrs-updated"]),
  aiUserMessageCount: userColumnSql["ai-messages"],
  aiCharacterCount: userColumnSql["ai-chars"],
  aiCallCount: userColumnSql["ai-calls"],
  aiInputTokens: userColumnSql["ai-input-tokens"],
  aiOutputTokens: userColumnSql["ai-output-tokens"],
  aiCacheReadTokens: userColumnSql["ai-cache-read-tokens"],
  aiCacheWriteTokens: userColumnSql["ai-cache-write-tokens"],
  aiReasoningTokens: userColumnSql["ai-reasoning-tokens"],
  everPurchasedAt: utcInstantSql(userColumnSql["ever-purchased"]),
  trialConsumedAt: utcInstantSql(userColumnSql["trial-consumed"]),
  trialProvider: userColumnSql["trial-provider"],
  purchaseCount: userColumnSql.purchases,
  latestPurchaseTier: userColumnSql["purchase-tier"],
  latestPurchaseStatus: userColumnSql["purchase-status"],
  latestPurchaseProvider: userColumnSql["purchase-provider"],
  latestPurchaseKind: userColumnSql["purchase-kind"],
  latestPurchaseEnvironment: userColumnSql["purchase-environment"],
  latestPurchaseTrial: userColumnSql["purchase-trial"],
  latestPurchaseWillRenew: userColumnSql["purchase-will-renew"],
  latestPurchaseUntil: utcInstantSql(userColumnSql["purchase-until"]),
  latestPurchaseGraceUntil: utcInstantSql(userColumnSql["purchase-grace-until"]),
  grantCount: userColumnSql.grants,
  activeGrantTiers: `to_json(${userColumnSql["grant-tiers"]})`,
  feedbackCount: userColumnSql.feedback,
  friendCount: userColumnSql.friends,
  hasPublicProfile: userColumnSql["public-profile"],
  friendInvitationsCreated: userColumnSql["invitations-created"],
  friendInvitationsAcceptedByOthers: userColumnSql["invitations-accepted-by-others"],
  friendInvitationsAccepted: userColumnSql["invitations-accepted"],
  leaderboardParticipation: userColumnSql.leaderboard,
  exclusionReason: `to_json(${userColumnSql["exclusion-reason"]})`,
  exclusionListEntryCount: userColumnSql["exclusion-list-entries"],
};

const userFields = Object.keys(userFieldSql) as ReadonlyArray<UserField>;

const rowSql: ReadonlyArray<string> = [
  ...userFields.map((field) => userFieldSql[field]),
  ...userSettingsFields.map((field) => field.kind === "date" ? utcInstantSql(buildUserSettingSql(field)) : buildUserSettingSql(field)),
];

/**
 * The per-person aggregates `usersFromSql` joins, each over the whole population; together they are
 * what makes a Users query take seconds.
 *
 * The analytics columns read `analytics.product_events_resolved` on the row's own id as `actor_id`,
 * without the credential-free collector's rows, for the reason `buildTrustedActorRowsFilterSql`
 * gives, except the `everyTrust` activity, which counts every trust level as the profile's Totals do;
 * the countries come from the retained connection samples the country filter reads, because the
 * trusted events themselves carry no country. A guest later merged into an account resolves onto
 * that account, so its own analytics columns stay empty and `mergedIntoUserId` names the account
 * that carries them. Every other column reads the stored rows keyed on the raw id. Cards and decks
 * are the live rows of every workspace the person is a member of, so a shared workspace counts for
 * each member.
 */
function buildUsersCtesSql(countrySampleRange: AnalyticsDateRange): string {
  const trustedSql = buildTrustedActorRowsFilterSql("events.trust_level");
  return `merged_guests AS (
    SELECT DISTINCT ON (identity_links.anonymous_id)
      identity_links.anonymous_id::text AS guest_user_id,
      identity_links.user_id::text AS account_user_id
    FROM analytics.identity_links AS identity_links
    WHERE identity_links.source = 'server_derived'
    ORDER BY identity_links.anonymous_id, identity_links.linked_at, identity_links.link_id
  ), identities AS (
    SELECT user_id, min(created_at) AS created_at
    FROM auth.user_identities
    GROUP BY user_id
  ), activity AS (
    SELECT events.actor_id::text AS actor_id,
      min(events.occurred_at) FILTER (WHERE ${trustedSql}) AS first_seen_at,
      max(events.occurred_at) FILTER (WHERE ${trustedSql}) AS last_active_at,
      count(DISTINCT (events.occurred_at AT TIME ZONE 'UTC')::date) FILTER (WHERE ${trustedSql})::int AS active_days,
      count(*) FILTER (WHERE ${trustedSql})::int AS event_count,
      array_agg(DISTINCT COALESCE(events.platform, 'unattributed') ORDER BY COALESCE(events.platform, 'unattributed')) FILTER (WHERE ${trustedSql}) AS platforms,
      (array_agg(events.app_version ORDER BY events.occurred_at DESC) FILTER (WHERE events.app_version IS NOT NULL AND ${trustedSql}))[1] AS app_version,
      (array_agg(events.ui_locale ORDER BY events.occurred_at DESC) FILTER (WHERE events.ui_locale IS NOT NULL AND ${trustedSql}))[1] AS ui_locale,
      min(events.occurred_at) AS every_trust_first_seen_at,
      max(events.occurred_at) AS every_trust_last_seen_at,
      count(DISTINCT (events.occurred_at AT TIME ZONE 'UTC')::date)::int AS every_trust_active_days,
      count(*)::int AS every_trust_event_count
    FROM analytics.product_events_resolved AS events
    WHERE events.actor_id IS NOT NULL
    GROUP BY events.actor_id
  ), countries AS (
    SELECT country_samples.actor_id::text AS actor_id,
      array_agg(DISTINCT country_samples.country ORDER BY country_samples.country) AS countries
    FROM (
${buildConnectionCountrySamplesSql(countrySampleRange, null)}
    ) AS country_samples
    WHERE country_samples.country IS NOT NULL
    GROUP BY country_samples.actor_id
  ), reviews AS (
    SELECT reviewed_by_user_id AS user_id, count(*)::int AS review_count
    FROM content.review_events
    GROUP BY reviewed_by_user_id
  ), workspace_cards AS (
    SELECT workspace_id, count(*)::int AS card_count
    FROM content.cards
    WHERE deleted_at IS NULL
    GROUP BY workspace_id
  ), workspace_decks AS (
    SELECT workspace_id, count(*)::int AS deck_count
    FROM content.decks
    WHERE deleted_at IS NULL
    GROUP BY workspace_id
  ), workspace_content AS (
    SELECT memberships.user_id,
      count(*)::int AS workspace_count,
      COALESCE(sum(workspace_cards.card_count), 0)::int AS card_count,
      COALESCE(sum(workspace_decks.deck_count), 0)::int AS deck_count
    FROM org.workspace_memberships AS memberships
    LEFT JOIN workspace_cards ON workspace_cards.workspace_id = memberships.workspace_id
    LEFT JOIN workspace_decks ON workspace_decks.workspace_id = memberships.workspace_id
    GROUP BY memberships.user_id
  ), workspace_members AS (
    SELECT workspace_id, count(*)::int AS member_count
    FROM org.workspace_memberships
    GROUP BY workspace_id
  ), chat AS (
    SELECT chat_sessions.user_id,
      count(*) FILTER (WHERE chat_items.role = 'user')::int AS ai_user_messages,
      COALESCE(sum(chat_items.content_char_count), 0)::int AS ai_chars
    FROM ai.chat_items AS chat_items
    JOIN ai.chat_sessions AS chat_sessions ON chat_sessions.session_id = chat_items.session_id
    WHERE chat_items.role IN ('user', 'assistant')
    GROUP BY chat_sessions.user_id
  ), ai_usage AS (
    SELECT usage_events.user_id,
      count(*)::int AS call_count,
      COALESCE(sum(usage_events.input_tokens), 0)::bigint AS input_tokens,
      COALESCE(sum(usage_events.output_tokens), 0)::bigint AS output_tokens,
      COALESCE(sum(usage_events.cache_read_tokens), 0)::bigint AS cache_read_tokens,
      COALESCE(sum(usage_events.cache_write_tokens), 0)::bigint AS cache_write_tokens,
      COALESCE(sum(usage_events.reasoning_tokens), 0)::bigint AS reasoning_tokens
    FROM ai.usage_events AS usage_events
    GROUP BY usage_events.user_id
  ), latest_purchases AS (
    SELECT DISTINCT ON (user_id) user_id, tier, status, provider, kind, environment, is_trial, will_renew, until, grace_until
    FROM billing.purchases
    ORDER BY user_id, created_at DESC, purchase_id
  ), purchase_counts AS (
    SELECT holders.user_id, count(DISTINCT purchases.purchase_id)::int AS purchase_count
    FROM billing.purchases AS purchases
    CROSS JOIN LATERAL (VALUES (purchases.user_id), (purchases.previous_user_id)) AS holders (user_id)
    WHERE holders.user_id IS NOT NULL
    GROUP BY holders.user_id
  ), grant_totals AS (
    SELECT user_id,
      count(*)::int AS grant_count,
      array_agg(DISTINCT tier ORDER BY tier) FILTER (WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS active_tiers
    FROM billing.grants
    GROUP BY user_id
  ), feedback AS (
    SELECT user_id, count(*)::int AS feedback_count
    FROM support.feedback_submissions
    WHERE user_id IS NOT NULL
    GROUP BY user_id
  ), friends AS (
    SELECT viewer_user_id AS user_id, count(*)::int AS friend_count
    FROM community.friendships
    GROUP BY viewer_user_id
  ), invitations_sent AS (
    SELECT inviter_user_id AS user_id,
      count(*)::int AS created_count,
      count(*) FILTER (WHERE accepted_at IS NOT NULL)::int AS accepted_by_others_count
    FROM community.friend_invitations
    GROUP BY inviter_user_id
  ), invitations_accepted AS (
    SELECT accepted_by_user_id AS user_id, count(*)::int AS accepted_count
    FROM community.friend_invitations
    WHERE accepted_by_user_id IS NOT NULL
    GROUP BY accepted_by_user_id
  ), profiles AS (
    SELECT user_id, bool_or(leaderboard_participation_enabled) AS leaderboard_participation
    FROM community.public_profiles
    GROUP BY user_id
  ), guest_upgrades AS (
    SELECT target_user_id AS user_id, count(*)::int AS merged_in_count
    FROM auth.guest_upgrade_history
    GROUP BY target_user_id
  ), guest_session_counts AS (
    SELECT user_id, count(*)::int AS session_count
    FROM auth.guest_sessions
    GROUP BY user_id
  ), exclusion_entries AS (
    SELECT actor_id, count(*)::int AS entry_count
    FROM analytics.excluded_actors
    GROUP BY actor_id
  )`;
}

/** One row per `org.user_settings` row, so a deleted account, whose settings row is gone, is absent. */
const usersFromSql = `FROM org.user_settings AS settings
  LEFT JOIN identities ON identities.user_id = settings.user_id
  LEFT JOIN merged_guests ON merged_guests.guest_user_id = ${actorIdSql}
  LEFT JOIN guest_upgrades ON guest_upgrades.user_id = settings.user_id
  LEFT JOIN guest_session_counts ON guest_session_counts.user_id = settings.user_id
  LEFT JOIN activity ON activity.actor_id = ${actorIdSql}
  LEFT JOIN countries ON countries.actor_id = ${actorIdSql}
  LEFT JOIN reviews ON reviews.user_id = settings.user_id
  LEFT JOIN workspace_content ON workspace_content.user_id = settings.user_id
  LEFT JOIN org.workspaces AS current_workspace ON current_workspace.workspace_id = settings.workspace_id
  LEFT JOIN org.workspace_memberships AS current_membership
    ON current_membership.workspace_id = settings.workspace_id AND current_membership.user_id = settings.user_id
  LEFT JOIN workspace_members AS current_workspace_members ON current_workspace_members.workspace_id = current_workspace.workspace_id
  LEFT JOIN chat ON chat.user_id = settings.user_id
  LEFT JOIN ai_usage ON ai_usage.user_id = settings.user_id
  LEFT JOIN billing.user_billing_state AS billing_state ON billing_state.user_id = settings.user_id
  LEFT JOIN latest_purchases ON latest_purchases.user_id = settings.user_id
  LEFT JOIN purchase_counts ON purchase_counts.user_id = settings.user_id
  LEFT JOIN grant_totals ON grant_totals.user_id = settings.user_id
  LEFT JOIN feedback ON feedback.user_id = settings.user_id
  LEFT JOIN friends ON friends.user_id = settings.user_id
  LEFT JOIN invitations_sent ON invitations_sent.user_id = settings.user_id
  LEFT JOIN invitations_accepted ON invitations_accepted.user_id = settings.user_id
  LEFT JOIN profiles ON profiles.user_id = settings.user_id
  LEFT JOIN exclusion_entries ON exclusion_entries.actor_id = ${actorIdSql}`;

const defaultOrderBySql = "settings.created_at DESC";

const tiebreakOrderBySql = "settings.user_id";

/**
 * The page at the clauses' offset and the total matching their filters, in one statement, so the
 * aggregates run once: `matched_users` is every matching row in table order, read by both.
 *
 * Each row is one JSON array in `rowSql` order rather than named columns, which keeps a page compact.
 */
function buildUsersPageSql(countrySampleRange: AnalyticsDateRange, clauses: DataTableSqlClauses): string {
  return `WITH ${buildUsersCtesSql(countrySampleRange)}, matched_users AS MATERIALIZED (
    SELECT json_build_array(
      ${rowSql.join(",\n      ")}
    ) AS u,
      row_number() OVER (${clauses.orderBySql}) AS position
    ${usersFromSql}
    WHERE ${clauses.whereConditionSql}
  )
  SELECT json_build_array(
    (SELECT count(*)::int FROM matched_users),
    (
      SELECT COALESCE(json_agg(page_users.u ORDER BY page_users.position), '[]'::json)
      FROM (
        SELECT matched_users.u, matched_users.position
        FROM matched_users
        ORDER BY matched_users.position
        ${clauses.limitOffsetSql}
      ) AS page_users
    )
  ) AS p`;
}

type UserFieldReader = Readonly<{
  string: (field: UserField) => string;
  nullableString: (field: UserField) => string | null;
  stringArray: (field: UserField) => ReadonlyArray<string>;
  count: (field: UserField) => number;
  nullableNumber: (field: UserField) => number | null;
  boolean: (field: UserField) => boolean;
  nullableBoolean: (field: UserField) => boolean | null;
  setting: (field: UserSettingsField, settingIndex: number) => string | null;
}>;

function createUserFieldReader(values: ReadonlyArray<AdminQueryValue>, rowIndex: number): UserFieldReader {
  function read(field: UserField): AdminQueryValue {
    const value = values[userFields.indexOf(field)];
    if (value === undefined) {
      throw new Error(`${reportLabel} row ${rowIndex} is missing "${field}".`);
    }
    return value;
  }

  function nullableBoolean(field: UserField): boolean | null {
    const value = read(field);
    if (value !== null && typeof value !== "boolean") {
      throw new Error(`${reportLabel} row ${rowIndex} field "${field}" must be a boolean or null.`);
    }
    return value;
  }

  function nullableString(field: UserField): string | null {
    const value = read(field);
    if (value !== null && typeof value !== "string") {
      throw new Error(`${reportLabel} row ${rowIndex} field "${field}" must be a string or null.`);
    }
    return value;
  }

  return {
    string: (field) => {
      const value = nullableString(field);
      if (value === null) {
        throw new Error(`${reportLabel} row ${rowIndex} field "${field}" must not be null.`);
      }
      return value;
    },
    nullableString,
    stringArray: (field) => {
      const value = read(field);
      if (!Array.isArray(value)) {
        throw new Error(`${reportLabel} row ${rowIndex} field "${field}" must be an array of strings.`);
      }
      const elements: ReadonlyArray<AdminQueryValue> = value;
      return elements.map((element, elementIndex) => {
        if (typeof element !== "string") {
          throw new Error(`${reportLabel} row ${rowIndex} field "${field}" element ${elementIndex} must be a string.`);
        }
        return element;
      });
    },
    count: (field) => {
      const value = read(field);
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${reportLabel} row ${rowIndex} field "${field}" must be a non-negative integer.`);
      }
      return value;
    },
    nullableNumber: (field) => {
      const value = read(field);
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
        throw new Error(`${reportLabel} row ${rowIndex} field "${field}" must be a finite number or null.`);
      }
      return value;
    },
    boolean: (field) => {
      const value = nullableBoolean(field);
      if (value === null) {
        throw new Error(`${reportLabel} row ${rowIndex} field "${field}" must not be null.`);
      }
      return value;
    },
    nullableBoolean,
    setting: (field, settingIndex) => {
      const value = values[userFields.length + settingIndex];
      if (value === undefined || (value !== null && typeof value !== "string")) {
        throw new Error(`${reportLabel} row ${rowIndex} setting "${field.id}" must be a string or null.`);
      }
      return value;
    },
  };
}

function parseOneOf<Value extends string>(value: string, allowed: ReadonlyArray<Value>, field: UserField): Value {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new Error(`${reportLabel} field "${field}" has unsupported value: ${value}`);
  }
  return match;
}

function parseUserRow(value: AdminQueryValue | undefined, rowIndex: number): UserRow {
  if (!Array.isArray(value) || value.length !== rowSql.length) {
    throw new Error(`${reportLabel} row ${rowIndex} must be an array of ${rowSql.length} values.`);
  }
  const reader = createUserFieldReader(value, rowIndex);
  return {
    userId: reader.string("userId"),
    email: reader.nullableString("email"),
    kind: parseOneOf(reader.string("kind"), ["account", "guest"], "kind"),
    mergedIntoUserId: reader.nullableString("mergedIntoUserId"),
    guestsMergedInCount: reader.count("guestsMergedInCount"),
    guestSessionCount: reader.count("guestSessionCount"),
    createdAt: reader.string("createdAt"),
    identityCreatedAt: reader.nullableString("identityCreatedAt"),
    firstSeenAt: reader.nullableString("firstSeenAt"),
    lastActiveAt: reader.nullableString("lastActiveAt"),
    activeDays: reader.count("activeDays"),
    eventCount: reader.count("eventCount"),
    everyTrustFirstSeenAt: reader.nullableString("everyTrustFirstSeenAt"),
    everyTrustLastSeenAt: reader.nullableString("everyTrustLastSeenAt"),
    everyTrustActiveDays: reader.count("everyTrustActiveDays"),
    everyTrustEventCount: reader.count("everyTrustEventCount"),
    platforms: reader.stringArray("platforms"),
    latestAppVersion: reader.nullableString("latestAppVersion"),
    connectionCountries: reader.stringArray("connectionCountries"),
    latestUiLocale: reader.nullableString("latestUiLocale"),
    reviewCount: reader.count("reviewCount"),
    cardCount: reader.count("cardCount"),
    deckCount: reader.count("deckCount"),
    workspaceCount: reader.count("workspaceCount"),
    currentWorkspaceName: reader.nullableString("currentWorkspaceName"),
    currentWorkspaceRole: reader.nullableString("currentWorkspaceRole"),
    currentWorkspaceMemberCount: reader.nullableNumber("currentWorkspaceMemberCount"),
    currentWorkspaceFsrsAlgorithm: reader.nullableString("currentWorkspaceFsrsAlgorithm"),
    currentWorkspaceDesiredRetention: reader.nullableNumber("currentWorkspaceDesiredRetention"),
    currentWorkspaceLearningSteps: reader.nullableString("currentWorkspaceLearningSteps"),
    currentWorkspaceRelearningSteps: reader.nullableString("currentWorkspaceRelearningSteps"),
    currentWorkspaceMaximumIntervalDays: reader.nullableNumber("currentWorkspaceMaximumIntervalDays"),
    currentWorkspaceFuzz: reader.nullableBoolean("currentWorkspaceFuzz"),
    currentWorkspaceFsrsUpdatedAt: reader.nullableString("currentWorkspaceFsrsUpdatedAt"),
    aiUserMessageCount: reader.count("aiUserMessageCount"),
    aiCharacterCount: reader.count("aiCharacterCount"),
    aiCallCount: reader.count("aiCallCount"),
    aiInputTokens: reader.count("aiInputTokens"),
    aiOutputTokens: reader.count("aiOutputTokens"),
    aiCacheReadTokens: reader.count("aiCacheReadTokens"),
    aiCacheWriteTokens: reader.count("aiCacheWriteTokens"),
    aiReasoningTokens: reader.count("aiReasoningTokens"),
    everPurchasedAt: reader.nullableString("everPurchasedAt"),
    trialConsumedAt: reader.nullableString("trialConsumedAt"),
    trialProvider: reader.nullableString("trialProvider"),
    purchaseCount: reader.count("purchaseCount"),
    latestPurchaseTier: reader.nullableString("latestPurchaseTier"),
    latestPurchaseStatus: reader.nullableString("latestPurchaseStatus"),
    latestPurchaseProvider: reader.nullableString("latestPurchaseProvider"),
    latestPurchaseKind: reader.nullableString("latestPurchaseKind"),
    latestPurchaseEnvironment: reader.nullableString("latestPurchaseEnvironment"),
    latestPurchaseTrial: reader.nullableBoolean("latestPurchaseTrial"),
    latestPurchaseWillRenew: reader.nullableBoolean("latestPurchaseWillRenew"),
    latestPurchaseUntil: reader.nullableString("latestPurchaseUntil"),
    latestPurchaseGraceUntil: reader.nullableString("latestPurchaseGraceUntil"),
    grantCount: reader.count("grantCount"),
    activeGrantTiers: reader.stringArray("activeGrantTiers"),
    feedbackCount: reader.count("feedbackCount"),
    friendCount: reader.count("friendCount"),
    hasPublicProfile: reader.boolean("hasPublicProfile"),
    friendInvitationsCreated: reader.count("friendInvitationsCreated"),
    friendInvitationsAcceptedByOthers: reader.count("friendInvitationsAcceptedByOthers"),
    friendInvitationsAccepted: reader.count("friendInvitationsAccepted"),
    leaderboardParticipation: reader.nullableBoolean("leaderboardParticipation"),
    exclusionReason: reader.stringArray("exclusionReason"),
    exclusionListEntryCount: reader.count("exclusionListEntryCount"),
    // `Object.fromEntries` widens the keys to `string`.
    settings: Object.fromEntries(
      userSettingsFields.map((field, settingIndex) => [field.id, reader.setting(field, settingIndex)]),
    ) as UserSettingsValues,
  };
}

// Connection samples are retained for 90 days, so this window is everything a sample can still say.
const countrySampleLookbackDays = 90;

function buildCountrySampleRange(now: Date): AnalyticsDateRange {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - countrySampleLookbackDays);
  return { from: formatCalendarDate(from), to: formatCalendarDate(now) };
}

export type UsersPageResult = Readonly<{
  generatedAtUtc: string;
  /** The users matching the filters across every page. */
  totalCount: number;
  rows: ReadonlyArray<UserRow>;
}>;

/** The page at `state.page` and the matching total, in one request of one statement. */
export async function loadUsersPage(
  config: AdminAppConfig,
  state: DataTableState,
  columns: ReadonlyArray<DataTableColumn<UserRow>>,
): Promise<UsersPageResult> {
  const clauses = buildDataTableSqlClauses(state, columns, columnSqlById, defaultOrderBySql, tiebreakOrderBySql);
  const response = await runAdminQuery(config, buildUsersPageSql(buildCountrySampleRange(new Date()), clauses));
  const pageValue = response.resultSets[0]?.rows[0]?.p;
  if (response.resultSets.length !== 1 || !Array.isArray(pageValue) || pageValue.length !== 2) {
    throw new Error(`${reportLabel} query must return exactly one result set with one [total, rows] row.`);
  }
  const pageValues: ReadonlyArray<AdminQueryValue> = pageValue;
  const [totalCount, rows] = pageValues;
  if (typeof totalCount !== "number" || !Number.isSafeInteger(totalCount) || totalCount < 0) {
    throw new Error(`${reportLabel} total must be a non-negative integer.`);
  }
  if (!Array.isArray(rows)) {
    throw new Error(`${reportLabel} page rows must be an array.`);
  }
  const rowValues: ReadonlyArray<AdminQueryValue> = rows;
  return {
    generatedAtUtc: response.executedAtUtc,
    totalCount,
    rows: rowValues.map((row, rowIndex) => parseUserRow(row, rowIndex)),
  };
}

type UserColumnId = keyof typeof userColumnSql;

const plainEnumColumnIds: ReadonlyArray<string> = [
  ...([
    "kind",
    "app-version",
    "ui-locale",
    "workspace-role",
    "workspace-fsrs-algorithm",
    "trial-provider",
    "purchase-tier",
    "purchase-status",
    "purchase-provider",
    "purchase-kind",
    "purchase-environment",
  ] satisfies ReadonlyArray<UserColumnId>),
  ...userSettingsFields.filter((field) => field.kind === "enum" || field.kind === "boolean").map((field) => field.id),
];

const enumListColumnIds: ReadonlyArray<UserColumnId> = ["exclusion-reason", "platforms", "countries", "grant-tiers"];

/** Every enum and enum-list column `UsersPage` declares. */
const userEnumColumnIds: ReadonlyArray<string> = [...plainEnumColumnIds, ...enumListColumnIds];

function requireColumnSql(columnId: string): string {
  const sqlExpression = columnSqlById[columnId];
  if (sqlExpression === undefined) {
    throw new Error(`${reportLabel} column "${columnId}" has no SQL expression.`);
  }
  return sqlExpression;
}

function buildDistinctOptionsSql(valueSql: string): string {
  return `COALESCE(json_agg(DISTINCT ${valueSql} ORDER BY ${valueSql}), '[]'::json)`;
}

/** Every value each enum column holds across every user, NULL or an empty list as `""`. */
function buildUsersEnumOptionsSql(countrySampleRange: AnalyticsDateRange): string {
  const optionColumnSql = (columnId: string): string => `option_users."${columnId}"`;
  const plainOptionsSql = plainEnumColumnIds.map((columnId) => `'${columnId}', (
    SELECT ${buildDistinctOptionsSql(`COALESCE(${optionColumnSql(columnId)}, '')`)}
    FROM option_users
  )`);
  const listOptionsSql = enumListColumnIds.map((columnId) => `'${columnId}', (
    SELECT ${buildDistinctOptionsSql("list_values.value")}
    FROM option_users
    CROSS JOIN LATERAL unnest(
      CASE WHEN cardinality(${optionColumnSql(columnId)}) = 0 THEN ARRAY['']::text[] ELSE ${optionColumnSql(columnId)} END
    ) AS list_values(value)
  )`);
  return `WITH ${buildUsersCtesSql(countrySampleRange)}, option_users AS MATERIALIZED (
    SELECT ${userEnumColumnIds.map((columnId) => `${requireColumnSql(columnId)} AS "${columnId}"`).join(",\n      ")}
    ${usersFromSql}
  )
  SELECT json_build_object(
    ${[...plainOptionsSql, ...listOptionsSql].join(",\n    ")}
  ) AS o`;
}

export type UsersEnumOptions = ReadonlyMap<string, ReadonlyArray<string>>;

/** Every enum column with no options, which the table shows until `loadUsersEnumOptions` answers. */
export const emptyUsersEnumOptions: UsersEnumOptions = new Map(userEnumColumnIds.map((columnId) => [columnId, []] as const));

function isObjectValue(value: AdminQueryValue | undefined): value is AdminQueryObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOptionList(value: AdminQueryValue | undefined, columnId: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    throw new Error(`${reportLabel} options for column "${columnId}" must be an array.`);
  }
  const options: ReadonlyArray<AdminQueryValue> = value;
  return options.map((option, index) => {
    if (typeof option !== "string") {
      throw new Error(`${reportLabel} option ${index} of column "${columnId}" must be a string.`);
    }
    return option;
  });
}

export async function loadUsersEnumOptions(config: AdminAppConfig): Promise<UsersEnumOptions> {
  const response = await runAdminQuery(config, buildUsersEnumOptionsSql(buildCountrySampleRange(new Date())));
  const optionsValue = response.resultSets[0]?.rows[0]?.o;
  if (response.resultSets.length !== 1 || !isObjectValue(optionsValue)) {
    throw new Error(`${reportLabel} options query must return exactly one result set with one object row.`);
  }
  return new Map(userEnumColumnIds.map((columnId) => [columnId, parseOptionList(optionsValue[columnId], columnId)] as const));
}

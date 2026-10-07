import { runAdminQuery, type AdminQueryValue } from "../adminApi";
import type { AdminAppConfig } from "../config";
import type { AnalyticsDateRange } from "../filters/analyticsFilters";
import {
  buildConnectionCountrySamplesSql,
  buildExcludedActorReasonSql,
  buildTrustedActorRowsFilterSql,
} from "../filters/filterSql";
import { formatCalendarDate } from "../reports/reportValues";
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
  createdAt: string;
  /** The earliest `auth.user_identities` row; null for a guest. */
  identityCreatedAt: string | null;
  firstSeenAt: string | null;
  lastActiveAt: string | null;
  activeDays: number;
  eventCount: number;
  platforms: ReadonlyArray<string>;
  latestAppVersion: string | null;
  /** Every country a retained connection sample places the person in; samples are kept 90 days. */
  connectionCountries: ReadonlyArray<string>;
  latestUiLocale: string | null;
  reviewCount: number;
  cardCount: number;
  deckCount: number;
  aiUserMessageCount: number;
  aiCharacterCount: number;
  everPurchasedAt: string | null;
  trialConsumedAt: string | null;
  latestPurchaseTier: string | null;
  latestPurchaseStatus: string | null;
  activeGrantTiers: ReadonlyArray<string>;
  feedbackCount: number;
  friendCount: number;
  leaderboardParticipation: boolean | null;
  /** The arms of the analytics exclusion rule the person matches; empty for a person every report counts. */
  exclusionReason: ReadonlyArray<string>;
  settings: UserSettingsValues;
}>;

type UserField = Exclude<keyof UserRow, "settings">;

export function utcInstantSql(sqlExpression: string): string {
  return `to_char(${sqlExpression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
}

const actorIdSql = "pg_catalog.lower(settings.user_id)";

// Positional order of every row's JSON array, followed by `userSettingsFields`; see `buildUsersSql`.
const userFieldSql: Readonly<Record<UserField, string>> = {
  userId: "settings.user_id",
  email: "settings.email",
  kind: "CASE WHEN identities.user_id IS NULL THEN 'guest' ELSE 'account' END",
  mergedIntoUserId: "merged_guests.account_user_id",
  createdAt: utcInstantSql("settings.created_at"),
  identityCreatedAt: utcInstantSql("identities.created_at"),
  firstSeenAt: utcInstantSql("activity.first_seen_at"),
  lastActiveAt: utcInstantSql("activity.last_active_at"),
  activeDays: "COALESCE(activity.active_days, 0)",
  eventCount: "COALESCE(activity.event_count, 0)",
  platforms: "COALESCE(activity.platforms, '[]'::json)",
  latestAppVersion: "activity.app_version",
  connectionCountries: "COALESCE(countries.countries, '[]'::json)",
  latestUiLocale: "activity.ui_locale",
  reviewCount: "COALESCE(reviews.review_count, 0)",
  cardCount: "COALESCE(workspace_content.card_count, 0)",
  deckCount: "COALESCE(workspace_content.deck_count, 0)",
  aiUserMessageCount: "COALESCE(chat.ai_user_messages, 0)",
  aiCharacterCount: "COALESCE(chat.ai_chars, 0)",
  everPurchasedAt: utcInstantSql("billing_state.ever_purchased_at"),
  trialConsumedAt: utcInstantSql("billing_state.trial_consumed_at"),
  latestPurchaseTier: "latest_purchases.tier",
  latestPurchaseStatus: "latest_purchases.status",
  activeGrantTiers: "COALESCE(active_grants.tiers, '[]'::json)",
  feedbackCount: "COALESCE(feedback.feedback_count, 0)",
  friendCount: "COALESCE(friends.friend_count, 0)",
  leaderboardParticipation: "profiles.leaderboard_participation",
  exclusionReason: `COALESCE(to_json(string_to_array(NULLIF(${buildExcludedActorReasonSql(actorIdSql)}, ''), ', ')), '[]'::json)`,
};

const userFields = Object.keys(userFieldSql) as ReadonlyArray<UserField>;

const rowSql: ReadonlyArray<string> = [
  ...userFields.map((field) => userFieldSql[field]),
  ...userSettingsFields.map((field) => field.kind === "date" ? utcInstantSql(field.sql) : field.sql),
];

/**
 * One row per `org.user_settings` row, so a deleted account, whose settings row is gone, is absent.
 *
 * The analytics columns read `analytics.product_events_resolved` on the row's own id as `actor_id`,
 * without the credential-free collector's rows, for the reason `buildTrustedActorRowsFilterSql`
 * gives; the countries come from the retained connection samples the country filter reads, because
 * the trusted events themselves carry no country. A guest later merged into an account resolves onto
 * that account, so its own analytics columns stay empty and `mergedIntoUserId` names the account
 * that carries them. Every other column reads the stored rows keyed on the raw id. Cards and decks
 * are the live rows of every workspace the person is a member of, so a shared workspace counts for
 * each member.
 *
 * Each row is one JSON array in `rowSql` order rather than named columns: repeating the key
 * names on every one of ~8k rows more than doubles the response, which has to stay well under the
 * Lambda response limit.
 */
export function buildUsersSql(countrySampleRange: AnalyticsDateRange): string {
  return `WITH merged_guests AS (
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
      min(events.occurred_at) AS first_seen_at,
      max(events.occurred_at) AS last_active_at,
      count(DISTINCT (events.occurred_at AT TIME ZONE 'UTC')::date)::int AS active_days,
      count(*)::int AS event_count,
      json_agg(DISTINCT COALESCE(events.platform, 'unattributed') ORDER BY COALESCE(events.platform, 'unattributed')) AS platforms,
      (array_agg(events.app_version ORDER BY events.occurred_at DESC) FILTER (WHERE events.app_version IS NOT NULL))[1] AS app_version,
      (array_agg(events.ui_locale ORDER BY events.occurred_at DESC) FILTER (WHERE events.ui_locale IS NOT NULL))[1] AS ui_locale
    FROM analytics.product_events_resolved AS events
    WHERE events.actor_id IS NOT NULL
      AND ${buildTrustedActorRowsFilterSql("events.trust_level")}
    GROUP BY events.actor_id
  ), countries AS (
    SELECT country_samples.actor_id::text AS actor_id,
      json_agg(DISTINCT country_samples.country ORDER BY country_samples.country) AS countries
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
      COALESCE(sum(workspace_cards.card_count), 0)::int AS card_count,
      COALESCE(sum(workspace_decks.deck_count), 0)::int AS deck_count
    FROM org.workspace_memberships AS memberships
    LEFT JOIN workspace_cards ON workspace_cards.workspace_id = memberships.workspace_id
    LEFT JOIN workspace_decks ON workspace_decks.workspace_id = memberships.workspace_id
    GROUP BY memberships.user_id
  ), chat AS (
    SELECT chat_sessions.user_id,
      count(*) FILTER (WHERE chat_items.role = 'user')::int AS ai_user_messages,
      COALESCE(sum(chat_items.content_char_count), 0)::int AS ai_chars
    FROM ai.chat_items AS chat_items
    JOIN ai.chat_sessions AS chat_sessions ON chat_sessions.session_id = chat_items.session_id
    WHERE chat_items.role IN ('user', 'assistant')
    GROUP BY chat_sessions.user_id
  ), latest_purchases AS (
    SELECT DISTINCT ON (user_id) user_id, tier, status
    FROM billing.purchases
    ORDER BY user_id, created_at DESC, purchase_id
  ), active_grants AS (
    SELECT user_id, json_agg(DISTINCT tier ORDER BY tier) AS tiers
    FROM billing.grants
    WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
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
  ), profiles AS (
    SELECT user_id, bool_or(leaderboard_participation_enabled) AS leaderboard_participation
    FROM community.public_profiles
    GROUP BY user_id
  )
  SELECT json_build_array(
    ${rowSql.join(",\n    ")}
  ) AS u
  FROM org.user_settings AS settings
  LEFT JOIN identities ON identities.user_id = settings.user_id
  LEFT JOIN merged_guests ON merged_guests.guest_user_id = ${actorIdSql}
  LEFT JOIN activity ON activity.actor_id = ${actorIdSql}
  LEFT JOIN countries ON countries.actor_id = ${actorIdSql}
  LEFT JOIN reviews ON reviews.user_id = settings.user_id
  LEFT JOIN workspace_content ON workspace_content.user_id = settings.user_id
  LEFT JOIN chat ON chat.user_id = settings.user_id
  LEFT JOIN billing.user_billing_state AS billing_state ON billing_state.user_id = settings.user_id
  LEFT JOIN latest_purchases ON latest_purchases.user_id = settings.user_id
  LEFT JOIN active_grants ON active_grants.user_id = settings.user_id
  LEFT JOIN feedback ON feedback.user_id = settings.user_id
  LEFT JOIN friends ON friends.user_id = settings.user_id
  LEFT JOIN profiles ON profiles.user_id = settings.user_id
  ORDER BY settings.created_at DESC, settings.user_id`;
}

type UserFieldReader = Readonly<{
  string: (field: UserField) => string;
  nullableString: (field: UserField) => string | null;
  stringArray: (field: UserField) => ReadonlyArray<string>;
  count: (field: UserField) => number;
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
    nullableBoolean: (field) => {
      const value = read(field);
      if (value !== null && typeof value !== "boolean") {
        throw new Error(`${reportLabel} row ${rowIndex} field "${field}" must be a boolean or null.`);
      }
      return value;
    },
    setting: (field, settingIndex) => {
      const value = values[userFields.length + settingIndex];
      if (value === undefined) {
        throw new Error(`${reportLabel} row ${rowIndex} is missing setting "${field.id}".`);
      }
      switch (field.kind) {
        case "text":
        case "enum":
        case "date":
          if (value === null || typeof value === "string") return value;
          throw new Error(`${reportLabel} row ${rowIndex} setting "${field.id}" must be a string or null.`);
        case "boolean":
          if (value === null) return "unanswered";
          if (typeof value === "boolean") return value ? "on" : "off";
          throw new Error(`${reportLabel} row ${rowIndex} setting "${field.id}" must be a boolean or null.`);
      }
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
    createdAt: reader.string("createdAt"),
    identityCreatedAt: reader.nullableString("identityCreatedAt"),
    firstSeenAt: reader.nullableString("firstSeenAt"),
    lastActiveAt: reader.nullableString("lastActiveAt"),
    activeDays: reader.count("activeDays"),
    eventCount: reader.count("eventCount"),
    platforms: reader.stringArray("platforms"),
    latestAppVersion: reader.nullableString("latestAppVersion"),
    connectionCountries: reader.stringArray("connectionCountries"),
    latestUiLocale: reader.nullableString("latestUiLocale"),
    reviewCount: reader.count("reviewCount"),
    cardCount: reader.count("cardCount"),
    deckCount: reader.count("deckCount"),
    aiUserMessageCount: reader.count("aiUserMessageCount"),
    aiCharacterCount: reader.count("aiCharacterCount"),
    everPurchasedAt: reader.nullableString("everPurchasedAt"),
    trialConsumedAt: reader.nullableString("trialConsumedAt"),
    latestPurchaseTier: reader.nullableString("latestPurchaseTier"),
    latestPurchaseStatus: reader.nullableString("latestPurchaseStatus"),
    activeGrantTiers: reader.stringArray("activeGrantTiers"),
    feedbackCount: reader.count("feedbackCount"),
    friendCount: reader.count("friendCount"),
    leaderboardParticipation: reader.nullableBoolean("leaderboardParticipation"),
    exclusionReason: reader.stringArray("exclusionReason"),
    // `Object.fromEntries` widens the keys to `string`.
    settings: Object.fromEntries(
      userSettingsFields.map((field, settingIndex) => [field.id, reader.setting(field, settingIndex)]),
    ) as UserSettingsValues,
  };
}

export type UsersReport = Readonly<{
  generatedAtUtc: string;
  users: ReadonlyArray<UserRow>;
}>;

// Connection samples are retained for 90 days, so this window is everything a sample can still say.
const countrySampleLookbackDays = 90;

function buildCountrySampleRange(now: Date): AnalyticsDateRange {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - countrySampleLookbackDays);
  return { from: formatCalendarDate(from), to: formatCalendarDate(now) };
}

export async function loadUsersReport(config: AdminAppConfig): Promise<UsersReport> {
  const response = await runAdminQuery(config, buildUsersSql(buildCountrySampleRange(new Date())));
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined) {
    throw new Error(`${reportLabel} query must return exactly one result set.`);
  }
  return {
    generatedAtUtc: response.executedAtUtc,
    users: result.rows.map((row, rowIndex) => parseUserRow(row.u, rowIndex)),
  };
}

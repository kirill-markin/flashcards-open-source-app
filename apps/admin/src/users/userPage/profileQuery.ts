import { runAdminQuery, type AdminQueryObject, type AdminQueryValue } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { buildExcludedActorReasonSql } from "../../filters/filterSql";
import { utcInstantSql, type UserKind } from "../usersQuery";
import { buildMatchesUserIdSql, buildUserSubjectSql, type UserSubjectSql } from "./userSubjectSql";

const reportLabel = "User profile";

/** `user` is a text cell holding another person's id, rendered as a link to their page. */
export type ProfileFieldKind = "text" | "enum" | "date" | "number" | "boolean" | "user";

/** `sql` is the raw expression; a `date` field is rendered to an ISO-8601 UTC instant around it. */
export type ProfileField = Readonly<{ id: string; label: string; kind: ProfileFieldKind; sql: string }>;

export type ProfileCell = string | number | boolean | null;

type ProfileSectionBase = Readonly<{
  id: string;
  title: string;
  fields: ReadonlyArray<ProfileField>;
  /** Everything after the select list; a record without one is a single row of scalar subqueries. */
  fromSql: string;
}>;

/**
 * One row at most; a second matching row fails the query rather than being dropped. `emptyText` is
 * null for a record built over aggregates, which always has its row: an all-zero, all-NULL one.
 */
export type ProfileRecordSection = ProfileSectionBase & Readonly<{ kind: "record"; emptyText: string | null }>;

export type ProfileListSection = ProfileSectionBase & Readonly<{ kind: "list"; orderSql: string }>;

export type ProfileSection = ProfileRecordSection | ProfileListSection;

export type ProfileSectionData =
  | Readonly<{ kind: "record"; section: ProfileRecordSection; cells: ReadonlyArray<ProfileCell> | null }>
  | Readonly<{ kind: "list"; section: ProfileListSection; rows: ReadonlyArray<ReadonlyArray<ProfileCell>> }>;

export type UserProfileHeader = Readonly<{
  email: string | null;
  /** NULL for an id with no settings row, sign-in identity or guest session: a deleted or anonymized actor. */
  kind: UserKind | null;
  identityCreatedAt: string | null;
  /** The account a guest's analytics history resolves onto, by the same first link the resolved view takes. */
  mergedIntoUserId: string | null;
  /** Comma-separated arms of the analytics exclusion rule; null for a person every report counts. */
  exclusionReason: string | null;
}>;

export type UserProfile = Readonly<{
  generatedAtUtc: string;
  header: UserProfileHeader;
  sections: ReadonlyArray<ProfileSectionData>;
}>;

function text(id: string, label: string, sql: string): ProfileField {
  return { id, label, kind: "text", sql };
}

function enumField(id: string, label: string, sql: string): ProfileField {
  return { id, label, kind: "enum", sql };
}

function date(id: string, label: string, sql: string): ProfileField {
  return { id, label, kind: "date", sql };
}

function numberField(id: string, label: string, sql: string): ProfileField {
  return { id, label, kind: "number", sql };
}

function flag(id: string, label: string, sql: string): ProfileField {
  return { id, label, kind: "boolean", sql };
}

function user(id: string, label: string, sql: string): ProfileField {
  return { id, label, kind: "user", sql };
}

/**
 * Every source the page reads about the person, in render order. Text keys match on the folded id
 * and uuid keys on the id as a UUID, so an id with no settings row - a guest merged away, a deleted or
 * anonymized actor - still shows whatever else names it.
 */
function buildProfileSections(subject: UserSubjectSql): ReadonlyArray<ProfileSection> {
  const matches = (textColumnSql: string): string => buildMatchesUserIdSql(textColumnSql, subject);
  return [
    {
      kind: "record",
      id: "settings",
      title: "Settings",
      emptyText: "No settings row exists for this id: a guest merged into an account, or a deleted or anonymized actor.",
      fields: [
        text("user-id", "User ID", "settings.user_id"),
        text("email", "Email", "settings.email"),
        date("created", "Created", "settings.created_at"),
        text("locale", "Locale", "settings.locale"),
        text("workspace", "Current workspace", "settings.workspace_id::text"),
        text("time-zone", "Progress time zone", "settings.progress_time_zone"),
        text("analytics-consent", "Analytics consent", "settings.analytics_consent"),
        flag("product-analytics", "Product analytics", "settings.product_analytics_enabled"),
        flag("reaction-animations", "Review reaction animations", "settings.review_reaction_animations_enabled"),
        text("accent-color", "Accent color", "settings.accent_color"),
      ],
      fromSql: `FROM org.user_settings AS settings WHERE ${matches("settings.user_id")}`,
    },
    {
      kind: "list",
      id: "exclusion-list",
      title: "Exclusion list entries",
      fields: [
        date("excluded", "Excluded", "excluded_actors.excluded_at"),
        text("excluded-by", "Excluded by", "excluded_actors.excluded_by"),
        text("reason", "Reason", "excluded_actors.reason"),
        enumField("source", "Source", "excluded_actors.source"),
        date("restored", "Restored", "excluded_actors.restored_at"),
        text("restored-by", "Restored by", "excluded_actors.restored_by"),
      ],
      fromSql: `FROM analytics.excluded_actors AS excluded_actors WHERE excluded_actors.actor_id = ${subject.lowerIdSql}`,
      orderSql: "excluded_actors.excluded_at DESC",
    },
    {
      kind: "list",
      id: "workspaces",
      title: "Workspaces",
      fields: [
        text("workspace-id", "Workspace ID", "workspaces.workspace_id::text"),
        text("name", "Name", "workspaces.name"),
        enumField("role", "Role", "memberships.role"),
        flag("current", "Current", "workspaces.workspace_id = settings.workspace_id"),
        date("joined", "Joined", "memberships.created_at"),
        date("created", "Created", "workspaces.created_at"),
        numberField("cards", "Live cards", "(SELECT count(*) FROM content.cards AS cards WHERE cards.workspace_id = workspaces.workspace_id AND cards.deleted_at IS NULL)::int"),
        numberField("decks", "Live decks", "(SELECT count(*) FROM content.decks AS decks WHERE decks.workspace_id = workspaces.workspace_id AND decks.deleted_at IS NULL)::int"),
        numberField("members", "Members", "(SELECT count(*) FROM org.workspace_memberships AS members WHERE members.workspace_id = workspaces.workspace_id)::int"),
        enumField("fsrs-algorithm", "FSRS algorithm", "workspaces.fsrs_algorithm"),
        numberField("desired-retention", "Desired retention", "workspaces.fsrs_desired_retention"),
        text("learning-steps", "Learning steps (min)", "workspaces.fsrs_learning_steps_minutes::text"),
        text("relearning-steps", "Relearning steps (min)", "workspaces.fsrs_relearning_steps_minutes::text"),
        numberField("maximum-interval", "Maximum interval (days)", "workspaces.fsrs_maximum_interval_days"),
        flag("fuzz", "Fuzz", "workspaces.fsrs_enable_fuzz"),
        date("fsrs-updated", "FSRS updated", "workspaces.fsrs_updated_at"),
      ],
      fromSql: `FROM org.workspace_memberships AS memberships
      JOIN org.workspaces AS workspaces ON workspaces.workspace_id = memberships.workspace_id
      LEFT JOIN org.user_settings AS settings ON settings.user_id = memberships.user_id
      WHERE ${matches("memberships.user_id")}`,
      orderSql: "memberships.created_at DESC, workspaces.workspace_id",
    },
    {
      kind: "list",
      id: "installations",
      title: "Devices: sync installations",
      fields: [
        text("installation-id", "Installation ID", "installations.installation_id::text"),
        enumField("platform", "Platform", "installations.platform"),
        enumField("app-version", "App version", "installations.app_version"),
        flag("automation", "Automation", "installations.is_automation"),
        date("created", "Created", "installations.created_at"),
        date("last-seen", "Last seen", "installations.last_seen_at"),
      ],
      fromSql: `FROM sync.installations AS installations WHERE ${matches("installations.user_id")}`,
      orderSql: "installations.last_seen_at DESC NULLS LAST, installations.installation_id",
    },
    {
      kind: "list",
      id: "installation-profiles",
      title: "Devices: analytics installation profiles",
      fields: [
        text("anonymous-id", "Anonymous ID", "profiles.anonymous_id::text"),
        enumField("platform", "Platform", "profiles.platform"),
        enumField("app-version", "App version", "profiles.app_version"),
        enumField("os-version", "OS version", "profiles.os_version"),
        enumField("device-locale", "Device locale", "profiles.device_locale"),
        enumField("timezone", "Time zone", "profiles.timezone"),
        enumField("first-country", "First country", "profiles.first_country"),
        date("first-seen", "First seen", "profiles.first_seen"),
        date("last-seen", "Last seen", "profiles.last_seen"),
      ],
      fromSql: `FROM analytics.installation_profiles AS profiles WHERE profiles.user_id = ${subject.uuidSql}`,
      orderSql: "profiles.last_seen DESC NULLS LAST, profiles.anonymous_id, profiles.platform",
    },
    {
      kind: "list",
      id: "replicas",
      title: "Devices: workspace replicas",
      fields: [
        text("replica-id", "Replica ID", "replicas.replica_id::text"),
        text("workspace-id", "Workspace ID", "replicas.workspace_id::text"),
        enumField("actor-kind", "Actor kind", "replicas.actor_kind"),
        text("installation-id", "Installation ID", "replicas.installation_id::text"),
        enumField("platform", "Platform", "replicas.platform"),
        enumField("app-version", "App version", "replicas.app_version"),
        date("created", "Created", "replicas.created_at"),
        date("last-seen", "Last seen", "replicas.last_seen_at"),
      ],
      fromSql: `FROM sync.workspace_replicas AS replicas WHERE ${matches("replicas.user_id")}`,
      orderSql: "replicas.last_seen_at DESC NULLS LAST, replicas.replica_id",
    },
    {
      kind: "list",
      id: "guest-sessions",
      title: "Guest sessions",
      fields: [
        text("session-id", "Session ID", "guest_sessions.session_id::text"),
        enumField("platform", "Platform", "guest_sessions.platform"),
        date("created", "Created", "guest_sessions.created_at"),
        date("last-seen", "Last seen", "guest_sessions.last_seen_at"),
        date("revoked", "Revoked", "guest_sessions.revoked_at"),
        enumField("analytics-consent", "Analytics consent", "guest_sessions.analytics_consent"),
        flag("product-analytics", "Product analytics", "guest_sessions.product_analytics_enabled"),
      ],
      fromSql: `FROM auth.guest_sessions AS guest_sessions WHERE ${matches("guest_sessions.user_id")}`,
      orderSql: "guest_sessions.created_at DESC, guest_sessions.session_id",
    },
    {
      kind: "list",
      id: "guest-upgrades",
      title: "Guest upgrades",
      fields: [
        enumField("direction", "Direction", `CASE WHEN ${matches("upgrades.source_guest_user_id")} THEN 'this guest merged into' ELSE 'guest merged into this account' END`),
        user("other-user", "Other user", `CASE WHEN ${matches("upgrades.source_guest_user_id")} THEN upgrades.target_user_id ELSE upgrades.source_guest_user_id END`),
        enumField("selection", "Selection", "upgrades.selection_type"),
        text("source-workspace", "Guest workspace", "upgrades.source_guest_workspace_id::text"),
        text("target-workspace", "Target workspace", "upgrades.target_workspace_id::text"),
        date("merged", "Merged", "upgrades.merged_at"),
      ],
      fromSql: `FROM auth.guest_upgrade_history AS upgrades
      WHERE ${matches("upgrades.source_guest_user_id")} OR ${matches("upgrades.target_user_id")}`,
      orderSql: "upgrades.merged_at DESC, upgrades.upgrade_id",
    },
    {
      kind: "record",
      id: "billing-state",
      title: "Billing state",
      emptyText: "No billing state row exists for this id.",
      fields: [
        date("trial-consumed", "Trial consumed", "billing_state.trial_consumed_at"),
        text("trial-provider", "Trial provider", "billing_state.trial_provider"),
        date("ever-purchased", "Ever purchased", "billing_state.ever_purchased_at"),
        date("created", "Created", "billing_state.created_at"),
        date("updated", "Updated", "billing_state.updated_at"),
      ],
      fromSql: `FROM billing.user_billing_state AS billing_state WHERE ${matches("billing_state.user_id")}`,
    },
    {
      kind: "list",
      id: "purchases",
      title: "Purchases",
      fields: [
        enumField("held-as", "Held as", `CASE WHEN ${matches("purchases.user_id")} THEN 'owner' ELSE 'previous owner' END`),
        user("other-user", "Other owner", `CASE WHEN ${matches("purchases.user_id")} THEN purchases.previous_user_id ELSE purchases.user_id END`),
        enumField("provider", "Provider", "purchases.provider"),
        enumField("kind", "Kind", "purchases.kind"),
        enumField("tier", "Tier", "purchases.tier"),
        enumField("status", "Status", "purchases.status"),
        enumField("provider-status", "Provider status", "purchases.provider_status_raw"),
        flag("trial", "Trial", "purchases.is_trial"),
        flag("will-renew", "Will renew", "purchases.will_renew"),
        date("until", "Until", "purchases.until"),
        date("grace-until", "Grace until", "purchases.grace_until"),
        enumField("environment", "Environment", "purchases.environment"),
        text("provider-purchase-id", "Provider purchase ID", "purchases.provider_purchase_id"),
        text("linked-from", "Linked from", "purchases.linked_from_purchase_id"),
        date("invalidated", "Invalidated", "purchases.invalidated_at"),
        date("account-deleted", "Account deleted", "purchases.account_deleted_at"),
        date("created", "Created", "purchases.created_at"),
        date("updated", "Updated", "purchases.updated_at"),
      ],
      fromSql: `FROM billing.purchases AS purchases
      WHERE ${matches("purchases.user_id")} OR ${matches("purchases.previous_user_id")}`,
      orderSql: "purchases.created_at DESC, purchases.purchase_id",
    },
    {
      kind: "list",
      id: "grants",
      title: "Grants",
      fields: [
        enumField("tier", "Tier", "grants.tier"),
        enumField("source", "Source", "grants.source"),
        date("granted", "Granted", "grants.granted_at"),
        date("expires", "Expires", "grants.expires_at"),
        date("revoked", "Revoked", "grants.revoked_at"),
        text("reason", "Reason", "grants.reason"),
        text("grant-id", "Grant ID", "grants.grant_id::text"),
      ],
      fromSql: `FROM billing.grants AS grants WHERE ${matches("grants.user_id")}`,
      orderSql: "grants.granted_at DESC, grants.grant_id",
    },
    {
      kind: "record",
      id: "community",
      title: "Community",
      emptyText: null,
      fields: [
        text("public-profile", "Public profile ID", "public_profiles.public_profile_id::text"),
        date("profile-created", "Public profile created", "public_profiles.created_at"),
        flag("leaderboard", "Leaderboard participation", "public_profiles.leaderboard_participation_enabled"),
        numberField("friends", "Friends", `(SELECT count(*) FROM community.friendships AS friendships WHERE ${matches("friendships.viewer_user_id")})::int`),
        numberField("invitations-created", "Friend invitations created", `(SELECT count(*) FROM community.friend_invitations AS invitations WHERE ${matches("invitations.inviter_user_id")})::int`),
        numberField("invitations-accepted-by-others", "Their invitations accepted", `(SELECT count(*) FROM community.friend_invitations AS invitations WHERE ${matches("invitations.inviter_user_id")} AND invitations.accepted_at IS NOT NULL)::int`),
        numberField("invitations-accepted", "Invitations they accepted", `(SELECT count(*) FROM community.friend_invitations AS invitations WHERE ${matches("invitations.accepted_by_user_id")})::int`),
      ],
      fromSql: `FROM (SELECT 1) AS anchor
      LEFT JOIN community.public_profiles AS public_profiles ON ${matches("public_profiles.user_id")}`,
    },
    {
      kind: "record",
      id: "totals",
      title: "Totals",
      emptyText: null,
      fields: [
        numberField("events", "Analytics events (every trust level)", "event_totals.event_count"),
        numberField("active-days", "Active days (UTC)", "event_totals.active_days"),
        date("first-seen", "First seen", "event_totals.first_seen_at"),
        date("last-seen", "Last seen", "event_totals.last_seen_at"),
        numberField("reviews", "Reviews", `(SELECT count(*) FROM content.review_events AS reviews WHERE ${matches("reviews.reviewed_by_user_id")})::int`),
        numberField("ai-messages", "AI messages sent", "chat_totals.user_messages"),
        numberField("ai-chars", "AI chat characters", "chat_totals.characters"),
        numberField("ai-calls", "AI provider calls", "usage_totals.call_count"),
        numberField("input-tokens", "Input tokens", "usage_totals.input_tokens"),
        numberField("output-tokens", "Output tokens", "usage_totals.output_tokens"),
        numberField("cache-read-tokens", "Cache read tokens", "usage_totals.cache_read_tokens"),
        numberField("cache-write-tokens", "Cache write tokens", "usage_totals.cache_write_tokens"),
        numberField("reasoning-tokens", "Reasoning tokens", "usage_totals.reasoning_tokens"),
        numberField("feedback", "Feedback submissions", `(SELECT count(*) FROM support.feedback_submissions AS feedback WHERE ${matches("feedback.user_id")})::int`),
      ],
      fromSql: `FROM (
        SELECT count(*)::int AS event_count,
          count(DISTINCT (events.occurred_at AT TIME ZONE 'UTC')::date)::int AS active_days,
          min(events.occurred_at) AS first_seen_at,
          max(events.occurred_at) AS last_seen_at
        FROM analytics.product_events_resolved AS events
        WHERE events.actor_id = ${subject.uuidSql}
      ) AS event_totals
      CROSS JOIN (
        SELECT count(*) FILTER (WHERE chat_items.role = 'user')::int AS user_messages,
          COALESCE(sum(chat_items.content_char_count), 0)::bigint AS characters
        FROM ai.chat_sessions AS chat_sessions
        JOIN ai.chat_items AS chat_items ON chat_items.session_id = chat_sessions.session_id
        WHERE ${matches("chat_sessions.user_id")} AND chat_items.role IN ('user', 'assistant')
      ) AS chat_totals
      CROSS JOIN (
        SELECT count(*)::int AS call_count,
          COALESCE(sum(usage.input_tokens), 0) AS input_tokens,
          COALESCE(sum(usage.output_tokens), 0) AS output_tokens,
          COALESCE(sum(usage.cache_read_tokens), 0) AS cache_read_tokens,
          COALESCE(sum(usage.cache_write_tokens), 0) AS cache_write_tokens,
          COALESCE(sum(usage.reasoning_tokens), 0) AS reasoning_tokens
        FROM ai.usage_events AS usage
        WHERE ${matches("usage.user_id")}
      ) AS usage_totals`,
    },
  ];
}

function buildFieldsArraySql(fields: ReadonlyArray<ProfileField>): string {
  return `json_build_array(${fields.map((field) => field.kind === "date" ? utcInstantSql(field.sql) : field.sql).join(", ")})`;
}

function buildSectionSql(section: ProfileSection): string {
  switch (section.kind) {
    case "record":
      return `(SELECT ${buildFieldsArraySql(section.fields)} ${section.fromSql})`;
    case "list":
      return `(SELECT COALESCE(json_agg(${buildFieldsArraySql(section.fields)} ORDER BY ${section.orderSql}), '[]'::json) ${section.fromSql})`;
  }
}

/**
 * The whole profile as one row: the header array, then one entry per section in
 * `buildProfileSections` order - a record's single array or NULL, a list's array of arrays. Arrays
 * rather than named keys keep the payload small on the few people with thousands of device rows.
 */
function buildUserProfileSql(subject: UserSubjectSql, sections: ReadonlyArray<ProfileSection>): string {
  const matches = (textColumnSql: string): string => buildMatchesUserIdSql(textColumnSql, subject);
  const settingsRowSql = `SELECT 1 FROM org.user_settings AS settings WHERE ${matches("settings.user_id")}`;
  const identitySql = `SELECT 1 FROM auth.user_identities AS identities WHERE ${matches("identities.user_id")}`;
  const guestSessionSql = `SELECT 1 FROM auth.guest_sessions AS guest_sessions WHERE ${matches("guest_sessions.user_id")}`;
  return `SELECT json_build_object(
  'header', json_build_array(
    (SELECT settings.email FROM org.user_settings AS settings WHERE ${matches("settings.user_id")}),
    CASE WHEN EXISTS (${identitySql}) THEN 'account'
      WHEN EXISTS (${settingsRowSql}) OR EXISTS (${guestSessionSql}) THEN 'guest' END,
    (SELECT ${utcInstantSql("min(identities.created_at)")} FROM auth.user_identities AS identities WHERE ${matches("identities.user_id")}),
    (SELECT links.user_id::text FROM analytics.identity_links AS links
      WHERE links.source = 'server_derived' AND links.anonymous_id = ${subject.uuidSql}
      ORDER BY links.linked_at, links.link_id LIMIT 1),
    NULLIF(${buildExcludedActorReasonSql(subject.lowerIdSql)}, '')
  ),
  'sections', json_build_array(
    ${sections.map(buildSectionSql).join(",\n    ")}
  )
) AS profile`;
}

function parseCell(value: AdminQueryValue | undefined, field: ProfileField, location: string): ProfileCell {
  if (value === undefined) {
    throw new Error(`${reportLabel} ${location} is missing "${field.id}".`);
  }
  if (value === null) {
    return null;
  }
  switch (field.kind) {
    case "text":
    case "enum":
    case "date":
    case "user":
      if (typeof value === "string") return value;
      break;
    case "number":
      if (typeof value === "number" && Number.isFinite(value)) return value;
      break;
    case "boolean":
      if (typeof value === "boolean") return value;
      break;
  }
  throw new Error(`${reportLabel} ${location} field "${field.id}" must be a ${field.kind} value or null.`);
}

function parseCells(value: AdminQueryValue, section: ProfileSection, location: string): ReadonlyArray<ProfileCell> {
  if (!Array.isArray(value) || value.length !== section.fields.length) {
    throw new Error(`${reportLabel} ${location} must be an array of ${section.fields.length} values.`);
  }
  return section.fields.map((field, index) => parseCell(value[index], field, location));
}

function parseSection(value: AdminQueryValue | undefined, section: ProfileSection): ProfileSectionData {
  if (value === undefined) {
    throw new Error(`${reportLabel} section "${section.id}" is missing.`);
  }
  switch (section.kind) {
    case "record":
      return { kind: "record", section, cells: value === null ? null : parseCells(value, section, `section "${section.id}"`) };
    case "list":
      if (!Array.isArray(value)) {
        throw new Error(`${reportLabel} section "${section.id}" must be an array of rows.`);
      }
      return {
        kind: "list",
        section,
        rows: value.map((row: AdminQueryValue, rowIndex: number) => parseCells(row, section, `section "${section.id}" row ${rowIndex}`)),
      };
  }
}

function readNullableString(values: ReadonlyArray<AdminQueryValue>, index: number, fieldName: string): string | null {
  const value = values[index];
  if (value === undefined || (value !== null && typeof value !== "string")) {
    throw new Error(`${reportLabel} header field "${fieldName}" must be a string or null.`);
  }
  return value;
}

function parseHeader(value: AdminQueryValue | undefined): UserProfileHeader {
  if (!Array.isArray(value) || value.length !== 5) {
    throw new Error(`${reportLabel} header must be an array of 5 values.`);
  }
  const kind = readNullableString(value, 1, "kind");
  if (kind !== null && kind !== "account" && kind !== "guest") {
    throw new Error(`${reportLabel} header field "kind" has unsupported value: ${kind}`);
  }
  return {
    email: readNullableString(value, 0, "email"),
    kind,
    identityCreatedAt: readNullableString(value, 2, "identityCreatedAt"),
    mergedIntoUserId: readNullableString(value, 3, "mergedIntoUserId"),
    exclusionReason: readNullableString(value, 4, "exclusionReason"),
  };
}

function isObjectValue(value: AdminQueryValue | undefined): value is AdminQueryObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadUserProfile(config: AdminAppConfig, userId: string): Promise<UserProfile> {
  const subject = buildUserSubjectSql(userId);
  const sections = buildProfileSections(subject);
  const response = await runAdminQuery(config, buildUserProfileSql(subject, sections));
  const result = response.resultSets[0];
  const row = result?.rows[0];
  if (response.resultSets.length !== 1 || result === undefined || result.rows.length !== 1 || row === undefined) {
    throw new Error(`${reportLabel} query must return exactly one result set with one row.`);
  }
  const profile = row.profile;
  if (!isObjectValue(profile)) {
    throw new Error(`${reportLabel} row must carry a "profile" object.`);
  }
  const sectionValues = profile.sections;
  if (!Array.isArray(sectionValues) || sectionValues.length !== sections.length) {
    throw new Error(`${reportLabel} must carry ${sections.length} sections.`);
  }
  return {
    generatedAtUtc: response.executedAtUtc,
    header: parseHeader(profile.header),
    sections: sections.map((section, index) => parseSection(sectionValues[index], section)),
  };
}

function isEmptyAggregateCell(cell: ProfileCell): boolean {
  return cell === null || cell === 0;
}

/** Every source the page reads is a section, so an id none of them names matched nothing. */
export function hasAnyProfileData(profile: UserProfile): boolean {
  return profile.header.kind !== null || profile.sections.some((data) => {
    switch (data.kind) {
      case "record":
        return data.cells !== null && (data.section.emptyText !== null || !data.cells.every(isEmptyAggregateCell));
      case "list":
        return data.rows.length > 0;
    }
  });
}

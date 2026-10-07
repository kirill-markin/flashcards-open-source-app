import { runAdminQuery, type AdminQueryValue } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { buildExcludedActorReasonSql, buildTrustedActorRowsFilterSql } from "../../filters/filterSql";
import { buildNamedColumnsSql, isObjectValue } from "../../table/dataTableServerQuery";
import { buildCurrentAccessColumnsSql, buildCurrentAccessSql } from "../accessTierSql";
import { userSettingsFields, type UserSettingsField } from "../userSettingsFields";
import { utcInstantSql, type UserKind } from "../usersQuery";
import { buildHasDeviceRowsSql } from "./profileDevicesQuery";
import { readRowBoolean, readRowNullableString, readRowString } from "./queryRowValues";
import { buildMatchesUserIdSql, buildUserSubjectSql, type UserSubjectSql } from "./userSubjectSql";

const reportLabel = "User profile";

/** `user` is a text cell holding another person's id, rendered as a link to their page. */
export type ProfileFieldKind = "text" | "enum" | "date" | "number" | "boolean" | "user";

/** `sql` is the raw expression; a `date` field is rendered to an ISO-8601 UTC instant around it. */
export type ProfileField = Readonly<{ id: string; label: string; kind: ProfileFieldKind; sql: string }>;

export type ProfileCell = string | number | boolean | null;

/** One row of a section, keyed by field id. */
export type ProfileCells = Readonly<Record<string, ProfileCell>>;

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
  | Readonly<{ kind: "record"; section: ProfileRecordSection; cells: ProfileCells | null }>
  | Readonly<{ kind: "list"; section: ProfileListSection; rows: ReadonlyArray<ProfileCells> }>;

/**
 * The account a guest's analytics history resolves onto, by the same first link the resolved view
 * takes. `mergedAt` is that link's `linked_at`, because a guest linked for analytics only has no
 * upgrade history row to take a time from.
 */
export type UserMergedInto = Readonly<{ userId: string; email: string | null; mergedAt: string }>;

export type UserProfileHeader = Readonly<{
  email: string | null;
  /** NULL for an id with no settings row, sign-in identity or guest session: a deleted or anonymized actor. */
  kind: UserKind | null;
  identityCreatedAt: string | null;
  mergedInto: UserMergedInto | null;
  /** Comma-separated arms of the analytics exclusion rule; null for a person every report counts. */
  exclusionReason: string | null;
  /** Whether any device list has a row for the id; those lists load apart from the profile. */
  hasDeviceRows: boolean;
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

function buildSettingsProfileField(field: UserSettingsField): ProfileField {
  switch (field.kind) {
    case "boolean":
      return flag(field.id, field.label, field.sql);
    case "date":
      return date(field.id, field.label, field.sql);
    case "text":
    case "enum":
      return text(field.id, field.label, field.sql);
  }
}

/**
 * Every source the page reads about the person, in render order, except the device lists, which load
 * separately and render after these. Text keys match on the folded id and uuid keys on the id as a
 * UUID, so an id with no settings row - a guest merged away, a deleted or anonymized actor - still
 * shows whatever else names it.
 */
function buildProfileSections(subject: UserSubjectSql): ReadonlyArray<ProfileSection> {
  const matches = (textColumnSql: string): string => buildMatchesUserIdSql(textColumnSql, subject);
  const currentAccessSql = buildCurrentAccessColumnsSql("current_access");
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
        ...userSettingsFields.map(buildSettingsProfileField),
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
      kind: "record",
      id: "current-access",
      title: "Current access",
      // Over the settings row, like the Users list, so an id nothing else names still reads as not found.
      emptyText: "No settings row exists for this id.",
      fields: [
        enumField("tier", "Tier", currentAccessSql.tier),
        enumField("status", "Status", currentAccessSql.status),
        flag("trial", "Is trial", currentAccessSql.isTrial),
        flag("sandbox", "From sandbox", currentAccessSql.fromSandbox),
        date("until", "Until", currentAccessSql.until),
      ],
      fromSql: `FROM org.user_settings AS settings
      LEFT JOIN LATERAL (
        SELECT * FROM (${buildCurrentAccessSql()}) AS every_access WHERE every_access.user_id = settings.user_id
      ) AS current_access ON TRUE
      WHERE ${matches("settings.user_id")}`,
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
        text("ui-locale", "Latest UI locale", "event_totals.ui_locale"),
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
          max(events.occurred_at) AS last_seen_at,
          (array_agg(events.ui_locale ORDER BY events.occurred_at DESC) FILTER (WHERE events.ui_locale IS NOT NULL AND ${buildTrustedActorRowsFilterSql("events.trust_level")}))[1] AS ui_locale
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

/** Each field under its own id, a `date` one as an ISO-8601 UTC instant. */
function buildFieldColumnsSql(fields: ReadonlyArray<ProfileField>): string {
  return buildNamedColumnsSql(Object.fromEntries(fields.map((field) => [
    field.id,
    field.kind === "date" ? utcInstantSql(field.sql) : field.sql,
  ]))).join(", ");
}

/** A record's row as one JSON object or NULL, a list's rows as an array of objects in `orderSql` order. */
function buildSectionSql(section: ProfileSection): string {
  switch (section.kind) {
    case "record":
      return `(SELECT to_json(record_row) FROM (SELECT ${buildFieldColumnsSql(section.fields)} ${section.fromSql}) AS record_row)`;
    case "list":
      return `(SELECT COALESCE(json_agg(to_json(list_rows) ORDER BY list_rows.position), '[]'::json)
      FROM (SELECT ${buildFieldColumnsSql(section.fields)}, row_number() OVER (ORDER BY ${section.orderSql}) AS position ${section.fromSql}) AS list_rows)`;
  }
}

/** The whole profile as one row: the header object, and each section keyed by its id. */
function buildUserProfileSql(subject: UserSubjectSql, sections: ReadonlyArray<ProfileSection>): string {
  const matches = (textColumnSql: string): string => buildMatchesUserIdSql(textColumnSql, subject);
  const settingsRowSql = `SELECT 1 FROM org.user_settings AS settings WHERE ${matches("settings.user_id")}`;
  const identitySql = `SELECT 1 FROM auth.user_identities AS identities WHERE ${matches("identities.user_id")}`;
  const guestSessionSql = `SELECT 1 FROM auth.guest_sessions AS guest_sessions WHERE ${matches("guest_sessions.user_id")}`;
  return `SELECT json_build_object(
  'header', json_build_object(
    'email', (SELECT settings.email FROM org.user_settings AS settings WHERE ${matches("settings.user_id")}),
    'kind', CASE WHEN EXISTS (${identitySql}) THEN 'account'
      WHEN EXISTS (${settingsRowSql}) OR EXISTS (${guestSessionSql}) THEN 'guest' END,
    'identityCreatedAt', (SELECT ${utcInstantSql("min(identities.created_at)")} FROM auth.user_identities AS identities WHERE ${matches("identities.user_id")}),
    'mergedInto', (SELECT json_build_object(
        'userId', links.user_id::text,
        'email', (SELECT settings.email FROM org.user_settings AS settings WHERE pg_catalog.lower(settings.user_id) = links.user_id::text),
        'mergedAt', ${utcInstantSql("links.linked_at")}
      )
      FROM analytics.identity_links AS links
      WHERE links.source = 'server_derived' AND links.anonymous_id = ${subject.uuidSql}
      ORDER BY links.linked_at, links.link_id LIMIT 1),
    'exclusionReason', NULLIF(${buildExcludedActorReasonSql(subject.lowerIdSql)}, ''),
    'hasDeviceRows', ${buildHasDeviceRowsSql(subject)}
  ),
  'sections', json_build_object(
    ${sections.map((section) => `'${section.id}', ${buildSectionSql(section)}`).join(",\n    ")}
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

function parseCells(value: AdminQueryValue, section: ProfileSection, location: string): ProfileCells {
  if (!isObjectValue(value)) {
    throw new Error(`${reportLabel} ${location} must be an object.`);
  }
  return Object.fromEntries(section.fields.map((field) => [field.id, parseCell(value[field.id], field, location)]));
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

function parseMergedInto(value: AdminQueryValue | undefined, location: string): UserMergedInto | null {
  if (value === null) {
    return null;
  }
  const fieldLocation = `${location} field "mergedInto"`;
  if (!isObjectValue(value)) {
    throw new Error(`${fieldLocation} must be an object or null.`);
  }
  return {
    userId: readRowString(value, "userId", fieldLocation),
    email: readRowNullableString(value, "email", fieldLocation),
    mergedAt: readRowString(value, "mergedAt", fieldLocation),
  };
}

function parseHeader(value: AdminQueryValue | undefined): UserProfileHeader {
  const location = `${reportLabel} header`;
  if (!isObjectValue(value)) {
    throw new Error(`${location} must be an object.`);
  }
  const kind = readRowNullableString(value, "kind", location);
  if (kind !== null && kind !== "account" && kind !== "guest") {
    throw new Error(`${location} field "kind" has unsupported value: ${kind}`);
  }
  return {
    email: readRowNullableString(value, "email", location),
    kind,
    identityCreatedAt: readRowNullableString(value, "identityCreatedAt", location),
    mergedInto: parseMergedInto(value.mergedInto, location),
    exclusionReason: readRowNullableString(value, "exclusionReason", location),
    hasDeviceRows: readRowBoolean(value, "hasDeviceRows", location),
  };
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
  if (!isObjectValue(sectionValues)) {
    throw new Error(`${reportLabel} row must carry a "sections" object.`);
  }
  return {
    generatedAtUtc: response.executedAtUtc,
    header: parseHeader(profile.header),
    sections: sections.map((section) => parseSection(sectionValues[section.id], section)),
  };
}

function isEmptyAggregateCell(cell: ProfileCell): boolean {
  return cell === null || cell === 0;
}

/** Every source the page reads is a section or a device list, so an id none of them names matched nothing. */
export function hasAnyProfileData(profile: UserProfile): boolean {
  return profile.header.kind !== null || profile.header.hasDeviceRows || profile.sections.some((data) => {
    switch (data.kind) {
      case "record": {
        const cells = data.cells;
        return cells !== null
          && (data.section.emptyText !== null || !data.section.fields.every((field) => isEmptyAggregateCell(cells[field.id] ?? null)));
      }
      case "list":
        return data.rows.length > 0;
    }
  });
}

import { randomUUID } from "node:crypto";
import {
  applyUserDatabaseScopeInExecutor,
  transactionWithUserScope,
  type DatabaseExecutor,
} from "../database";
import { unsafeTransaction } from "../database/unsafe";
import { ensureUserSelectedWorkspaceInExecutor } from "../workspaces/selection";
import { assertSubjectIsNotDeletedInExecutor } from "./deletedSubjects";
import {
  bindCognitoIdentityMappingInExecutor,
  loadCognitoIdentityMappingInExecutor,
  lockCognitoIdentityLifecycleInExecutor,
} from "./userIdentities";

/** A recorded analytics consent decision. No decision is null, never a third choice value. */
export type AnalyticsConsentChoice = "granted" | "declined";

/**
 * The product-analytics off switch. `false` is an explicit opt-out, `true` an explicit opt-in, and
 * null no answer on this row, which reads as collection allowed: the basis is legitimate interest,
 * so nothing prompts for it. Deliberately not derived from `analyticsConsent`, which answers the
 * separate cookie-banner question; refusing that cookie leaves this switch unanswered and on.
 */
export type AccountPreferences = Readonly<{
  accentColor: string;
  reviewReactionAnimationsEnabled: boolean;
  analyticsConsent: AnalyticsConsentChoice | null;
  productAnalyticsEnabled: boolean | null;
}>;

export type UserProfile = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
  email: string | null;
  locale: string;
  createdAt: string;
  preferences: AccountPreferences;
}>;

type UserSettingsRow = Readonly<{
  accent_color: string;
  workspace_id: string | null;
  email: string | null;
  locale: string;
  review_reaction_animations_enabled: boolean;
  analytics_consent: AnalyticsConsentChoice | null;
  product_analytics_enabled: boolean | null;
  created_at: Date | string;
}>;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const upsertUserSettingsSql = [
  "INSERT INTO org.user_settings (user_id, email)",
  "VALUES ($1, $2)",
  "ON CONFLICT (user_id) DO UPDATE",
  "SET email = EXCLUDED.email",
  "WHERE org.user_settings.email IS NULL",
  "AND EXCLUDED.email IS NOT NULL",
].join(" ");

export async function ensureUserProfileInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  email: string | null,
): Promise<UserProfile> {
  await executor.query(
    upsertUserSettingsSql,
    [userId, email],
  );

  const existing = await executor.query<UserSettingsRow>(
    [
      "SELECT workspace_id, email, locale, review_reaction_animations_enabled, analytics_consent,",
      "product_analytics_enabled, accent_color, created_at",
      "FROM org.user_settings",
      "WHERE user_id = $1",
      "FOR UPDATE",
    ].join(" "),
    [userId],
  );

  if (existing.rows.length === 0) {
    throw new Error("Failed to load user settings after upsert");
  }

  const settings = existing.rows[0];
  const selectedWorkspaceId = await ensureUserSelectedWorkspaceInExecutor(
    executor,
    userId,
    settings.workspace_id,
  );

  return {
    userId,
    selectedWorkspaceId,
    email: settings.email,
    locale: settings.locale,
    createdAt: toIsoString(settings.created_at),
    preferences: {
      accentColor: settings.accent_color,
      reviewReactionAnimationsEnabled: settings.review_reaction_animations_enabled,
      analyticsConsent: settings.analytics_consent,
      productAnalyticsEnabled: settings.product_analytics_enabled,
    },
  };
}

export async function ensureUserProfile(userId: string, email: string | null): Promise<UserProfile> {
  return transactionWithUserScope({ userId }, async (executor) => ensureUserProfileInExecutor(executor, userId, email));
}

/** Reads under the caller's scope, so the caller applies the scope of the id it is asking about. */
async function userSettingsRowExistsInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<boolean> {
  const result = await executor.query<Readonly<{ user_id: string }>>(
    "SELECT user_id FROM org.user_settings WHERE user_id = $1 LIMIT 1",
    [userId],
  );

  return result.rows[0] !== undefined;
}

/**
 * Resolves the application user behind a verified Cognito subject, provisioning the account on a
 * first-ever request. A new account's id is minted here and only then bound to the subject, so the
 * two are independent values from the start.
 */
export async function ensureCognitoUserProfileInExecutor(
  executor: DatabaseExecutor,
  subjectUserId: string,
  email: string | null,
): Promise<UserProfile> {
  await lockCognitoIdentityLifecycleInExecutor(executor, subjectUserId);
  await assertSubjectIsNotDeletedInExecutor(executor, subjectUserId);
  const existingMapping = await loadCognitoIdentityMappingInExecutor(executor, subjectUserId);

  if (existingMapping !== null) {
    await applyUserDatabaseScopeInExecutor(executor, { userId: existingMapping.userId });
    return ensureUserProfileInExecutor(executor, existingMapping.userId, email);
  }

  // An account can be stored under the subject itself with no mapping row until something binds
  // one. Adopting it under that id is what keeps this person from getting a second account.
  await applyUserDatabaseScopeInExecutor(executor, { userId: subjectUserId });
  if (await userSettingsRowExistsInExecutor(executor, subjectUserId)) {
    const adoptedProfile = await ensureUserProfileInExecutor(executor, subjectUserId, email);
    await bindCognitoIdentityMappingInExecutor(executor, subjectUserId, subjectUserId);
    return adoptedProfile;
  }

  const mintedUserId = randomUUID();
  await applyUserDatabaseScopeInExecutor(executor, { userId: mintedUserId });
  // ensureUserProfileInExecutor upserts, so a minted id that somehow already names an account would
  // otherwise hand this subject that account instead of failing.
  if (await userSettingsRowExistsInExecutor(executor, mintedUserId)) {
    throw new Error(
      `Minted user id ${mintedUserId} already names an account; refusing to bind Cognito subject ${subjectUserId} to it.`,
    );
  }

  // Profile before mapping: auth.user_identities.user_id references org.user_settings(user_id)
  // (db/migrations/0031_guest_ai_identity_and_quota.sql).
  const mintedProfile = await ensureUserProfileInExecutor(executor, mintedUserId, email);
  await bindCognitoIdentityMappingInExecutor(executor, subjectUserId, mintedUserId);

  return mintedProfile;
}

export async function ensureCognitoUserProfile(
  subjectUserId: string,
  email: string | null,
): Promise<UserProfile> {
  return unsafeTransaction(
    async (executor) => ensureCognitoUserProfileInExecutor(executor, subjectUserId, email),
  );
}

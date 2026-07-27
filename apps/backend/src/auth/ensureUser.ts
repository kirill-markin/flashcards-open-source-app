/**
 * Ensure the authenticated user has a profile row and an accessible selected
 * workspace. New users are auto-provisioned with a default workspace.
 */
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

export type AccountPreferences = Readonly<{
  reviewReactionAnimationsEnabled: boolean;
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
  workspace_id: string | null;
  email: string | null;
  locale: string;
  review_reaction_animations_enabled: boolean;
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
      "SELECT workspace_id, email, locale, review_reaction_animations_enabled, created_at",
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
      reviewReactionAnimationsEnabled: settings.review_reaction_animations_enabled,
    },
  };
}

export async function ensureUserProfile(userId: string, email: string | null): Promise<UserProfile> {
  return transactionWithUserScope({ userId }, async (executor) => ensureUserProfileInExecutor(executor, userId, email));
}

export async function ensureCognitoUserProfileInExecutor(
  executor: DatabaseExecutor,
  subjectUserId: string,
  email: string | null,
): Promise<UserProfile> {
  await lockCognitoIdentityLifecycleInExecutor(executor, subjectUserId);
  await assertSubjectIsNotDeletedInExecutor(executor, subjectUserId);
  const existingMapping = await loadCognitoIdentityMappingInExecutor(executor, subjectUserId);
  const authoritativeUserId = existingMapping?.userId ?? subjectUserId;

  await applyUserDatabaseScopeInExecutor(executor, { userId: authoritativeUserId });
  const profile = await ensureUserProfileInExecutor(executor, authoritativeUserId, email);

  if (existingMapping === null) {
    await bindCognitoIdentityMappingInExecutor(executor, subjectUserId, subjectUserId);
  }

  return profile;
}

export async function ensureCognitoUserProfile(
  subjectUserId: string,
  email: string | null,
): Promise<UserProfile> {
  return unsafeTransaction(
    async (executor) => ensureCognitoUserProfileInExecutor(executor, subjectUserId, email),
  );
}

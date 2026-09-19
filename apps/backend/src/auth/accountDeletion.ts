import { randomUUID } from "node:crypto";
import { deleteCognitoUser } from "./cognitoUsers";
import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../database";
import { unsafeTransaction } from "../database/unsafe";
import {
  isDeletedSubjectInExecutor,
  markDeletedSubjectInExecutor,
} from "./deletedSubjects";
import {
  loadCognitoIdentityMappingInExecutor,
  lockCognitoIdentityLifecycleInExecutor,
} from "./userIdentities";
import { isConfiguredDemoEmail } from "./demoEmailAccess";
import { HttpError } from "../shared/errors";
import {
  lockUserWorkspaceAccessLifecyclesInExecutor,
  lockWorkspaceMembershipLifecyclesInExecutor,
} from "../workspaces/accessLocks";

export const deleteAccountConfirmationText: string = "delete my account";

type AccountDeletionInput = Readonly<{
  authSubjectUserId: string;
  email: string | null;
  cognitoUsername: string | null;
  confirmationText: string;
}>;

type AccountDeletionDependencies = Readonly<{
  unsafeTransaction: typeof unsafeTransaction;
  deleteCognitoUser: (cognitoUsername: string) => Promise<void>;
  isConfiguredDemoEmail: (email: string | null) => boolean;
}>;

type WorkspaceIdRow = Readonly<{
  workspace_id: string;
}>;

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
  user_id: string;
}>;

type UserSettingsEmailRow = Readonly<{
  email: string | null;
}>;

type AnalyticsPersonUserIdRow = Readonly<{
  user_id: string;
}>;

const defaultAccountDeletionDependencies: AccountDeletionDependencies = {
  unsafeTransaction,
  deleteCognitoUser,
  isConfiguredDemoEmail,
};

function assertValidConfirmationText(confirmationText: string): void {
  if (confirmationText !== deleteAccountConfirmationText) {
    throw new HttpError(
      400,
      `Type "${deleteAccountConfirmationText}" exactly to confirm account deletion.`,
      "ACCOUNT_DELETE_CONFIRMATION_INVALID",
    );
  }
}

function assertCognitoUsername(cognitoUsername: string | null): string {
  if (cognitoUsername === null || cognitoUsername.trim() === "") {
    throw new HttpError(
      500,
      "Account deletion could not resolve the Cognito username for this user.",
      "ACCOUNT_DELETE_IDENTITY_DELETE_FAILED",
    );
  }

  return cognitoUsername;
}

// Both guest upgrades and explicit guest-identity links can connect a person's older identities.
// Walk both server-owned edges; client-chosen anonymous IDs must never enter this namespace.
async function loadAnalyticsUserIdsForPersonInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
): Promise<Array<string>> {
  const result = await executor.query<AnalyticsPersonUserIdRow>(
    [
      "WITH RECURSIVE identity_edges AS (",
      "SELECT source_guest_user_id AS source_user_id, target_user_id",
      "FROM auth.guest_upgrade_history",
      "UNION",
      "SELECT anonymous_id::text, user_id::text FROM analytics.identity_links",
      "WHERE source = 'server_derived'",
      "), person_user_ids AS (",
      "SELECT $1::text AS user_id, ARRAY[$1::text] AS visited_user_ids",
      "UNION ALL",
      "SELECT edge.source_user_id,",
      "person_user_ids.visited_user_ids || edge.source_user_id",
      "FROM identity_edges AS edge",
      "JOIN person_user_ids ON edge.target_user_id = person_user_ids.user_id",
      "WHERE NOT edge.source_user_id = ANY(person_user_ids.visited_user_ids)",
      ")",
      "SELECT DISTINCT user_id FROM person_user_ids",
    ].join(" "),
    [appUserId],
  );
  const userIds = new Set<string>([appUserId]);

  for (const row of result.rows) {
    userIds.add(row.user_id);
  }

  return [...userIds];
}

/**
 * Anonymizes the analytics history of one account instead of erasing it.
 *
 * The replacement pseudonym is generated here and stored nowhere, the links that
 * could resolve it back to the person are removed in the same transaction, and
 * every remaining column that a table outliving account deletion could join on
 * is cleared, the identity, session and workspace columns alike. So this is
 * one-way: no mapping survives anywhere and it cannot be undone.
 *
 * One pseudonym covers every id the person ever produced events under, guest
 * phase included, so their whole history collapses to a single unlinkable
 * identity rather than to several that stay separable from each other.
 *
 * Returns the person-wide ids it covered, which only a permanent deletion goes on
 * to erase the analytics exclusion rows for.
 */
async function anonymizeProductAnalyticsInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
): Promise<Array<string>> {
  const anonymizedUserId = randomUUID();
  const personUserIds = await loadAnalyticsUserIdsForPersonInExecutor(executor, appUserId);

  // Resolve installations before clearing event identities and links. Shared-device profiles are
  // removed in full: their first country and sparse history may predate the latest owner.
  await executor.query(
    [
      "DELETE FROM analytics.installation_profiles",
      "WHERE user_id = ANY($1::uuid[])",
      "OR (anonymous_id, platform) IN (",
      "SELECT anonymous_id, platform FROM analytics.product_events",
      "WHERE user_id = ANY($1::uuid[]) AND anonymous_id IS NOT NULL",
      ")",
      "OR anonymous_id IN (",
      "SELECT anonymous_id FROM analytics.identity_links",
      "WHERE user_id = ANY($1::uuid[]) AND source = 'authenticated_client'",
      ")",
    ].join(" "),
    [personUserIds],
  );

  await executor.query(
    [
      "UPDATE analytics.product_events SET",
      "user_id = $1::uuid,",
      "subject_user_id = $1::uuid,",
      "anonymous_id = NULL,",
      "session_id = NULL,",
      "guest_session_id = NULL,",
      "workspace_id = NULL,",
      "request_id = NULL,",
      "device_model = NULL,",
      "os_version = NULL,",
      "timezone = NULL,",
      "device_locale = NULL,",
      "ui_locale = NULL,",
      "country = NULL,",
      "identity_state = 'anonymized'",
      "WHERE user_id = ANY($2::uuid[])",
    ].join(" "),
    [anonymizedUserId, personUserIds],
  );
  // Keyed by the real ids, which are still the parameter here: a surviving link resolves an
  // anonymous_id back to this person and would make the rewrite above reversible.
  await executor.query(
    "DELETE FROM analytics.identity_links WHERE user_id = ANY($1::uuid[])",
    [personUserIds],
  );

  return personUserIds;
}

/**
 * Erases the analytics exclusion rows that still name one permanently deleted person.
 *
 * An exclusion row names the person by id, so it outlives the anonymization above. Erasing it is
 * a delete because actor_id is the primary key and this role holds no UPDATE beside the restore
 * columns, and the ids are folded to the normalization the column stores under. This is the one
 * caller that db/migrations/0140_analytics_excluded_actors.sql granted DELETE for and wrote its
 * excluded_actors_restore_survives_live_account guard around, so that migration's "does not exist
 * yet" reads as superseded by this function.
 *
 * Call it only once org.user_settings is gone, which is what lets that guard pass for a restored
 * row; reaching this table any earlier raises there and aborts the whole account deletion. Only a
 * permanent deletion may call it: a path that reuses the account id leaves a live person behind,
 * and erasing there would silently undo a human restore and let the detector re-exclude that
 * actor on its next run, the exact reversal the guard exists to refuse.
 */
async function eraseAnalyticsExclusionsInExecutor(
  executor: DatabaseExecutor,
  personUserIds: ReadonlyArray<string>,
): Promise<void> {
  await executor.query(
    [
      "DELETE FROM analytics.excluded_actors",
      "WHERE actor_id IN (",
      "SELECT pg_catalog.lower(pg_catalog.btrim(person_user_id))",
      "FROM pg_catalog.unnest($1::text[]) AS person_user_id",
      ")",
    ].join(" "),
    [personUserIds],
  );
}

/** Returns the person-wide analytics ids whose data this cleared. */
async function deleteAccountDataInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
): Promise<Array<string>> {
  const userSettingsResult = await executor.query<UserSettingsEmailRow>(
    "SELECT email FROM org.user_settings WHERE user_id = $1 FOR UPDATE",
    [appUserId],
  );
  const workspaceRows = await executor.query<WorkspaceIdRow>(
    "SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1",
    [appUserId],
  );
  const workspaceIds = workspaceRows.rows.map((row) => row.workspace_id);
  const email = userSettingsResult.rows[0]?.email ?? null;
  const soleMemberWorkspaceIds: Array<string> = [];

  if (workspaceIds.length > 0) {
    await lockWorkspaceMembershipLifecyclesInExecutor(executor, workspaceIds);
    await lockUserWorkspaceAccessLifecyclesInExecutor(executor, appUserId, workspaceIds);

    await executor.query(
      "SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1 FOR UPDATE",
      [appUserId],
    );

    const workspaceMembershipRows = await executor.query<WorkspaceMembershipRow>(
      [
        "SELECT workspace_id, user_id",
        "FROM org.workspace_memberships",
        "WHERE workspace_id = ANY($1::uuid[])",
        "FOR UPDATE",
      ].join(" "),
      [workspaceIds],
    );
    const membershipCounts = new Map<string, number>();

    for (const row of workspaceMembershipRows.rows) {
      const currentCount = membershipCounts.get(row.workspace_id) ?? 0;
      membershipCounts.set(row.workspace_id, currentCount + 1);
    }

    for (const workspaceId of workspaceIds) {
      const memberCount = membershipCounts.get(workspaceId) ?? 0;
      if (memberCount === 1) {
        soleMemberWorkspaceIds.push(workspaceId);
      }
    }

    if (soleMemberWorkspaceIds.length > 0) {
      await executor.query(
        "DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])",
        [soleMemberWorkspaceIds],
      );
    }
  }

  await executor.query(
    "SELECT auth.delete_user_auth_artifacts($1, $2)",
    [appUserId, email],
  );
  await executor.query("DELETE FROM org.user_settings WHERE user_id = $1", [appUserId]);

  return await anonymizeProductAnalyticsInExecutor(executor, appUserId);
}

/**
 * Fully deletes one real account, including the stale-token tombstone that
 * blocks the removed Cognito identity from reprovisioning.
 *
 * This path is not used for the insecure review accounts configured via
 * `DEMO_EMAIL_DOSTIP`. Those `@example.com` review accounts keep their Cognito
 * identity so they can be reused after their app data is cleared.
 */
async function deleteRealAccountDataInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
  authSubjectUserId: string,
): Promise<void> {
  const personUserIds = await deleteAccountDataInExecutor(executor, appUserId);
  await eraseAnalyticsExclusionsInExecutor(executor, personUserIds);
  await markDeletedSubjectInExecutor(executor, authSubjectUserId);
}

/**
 * Clears app data for one configured insecure review account while
 * preserving the Cognito identity for reuse.
 *
 * This path exists only for the explicit `DEMO_EMAIL_DOSTIP` allowlist inside
 * the `@example.com` domain. Real user accounts must not use it.
 *
 * The account id survives the reset and signs in again, so no person is erased here
 * and any analytics exclusion row naming that id stays, restore included.
 */
async function deleteDemoAccountDataInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
): Promise<void> {
  await deleteAccountDataInExecutor(executor, appUserId);
}

async function deleteCognitoIdentity(
  cognitoUsername: string,
  dependencies: AccountDeletionDependencies,
): Promise<void> {
  try {
    await dependencies.deleteCognitoUser(cognitoUsername);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(
      503,
      `Account deletion could not finish the Cognito cleanup step. Retry the delete request. (${message})`,
      "ACCOUNT_DELETE_IDENTITY_DELETE_FAILED",
    );
  }
}

export async function deleteAccountForAuthenticatedUser(
  input: AccountDeletionInput,
  dependencies: AccountDeletionDependencies = defaultAccountDeletionDependencies,
): Promise<void> {
  assertValidConfirmationText(input.confirmationText);
  const isDemoAccount = dependencies.isConfiguredDemoEmail(input.email);

  await dependencies.unsafeTransaction(async (executor) => {
    await lockCognitoIdentityLifecycleInExecutor(executor, input.authSubjectUserId);
    if (await isDeletedSubjectInExecutor(executor, input.authSubjectUserId)) {
      return;
    }

    const mapping = await loadCognitoIdentityMappingInExecutor(executor, input.authSubjectUserId);
    const authoritativeUserId = mapping?.userId ?? input.authSubjectUserId;
    await applyUserDatabaseScopeInExecutor(executor, { userId: authoritativeUserId });

    if (isDemoAccount) {
      await deleteDemoAccountDataInExecutor(executor, authoritativeUserId);
      return;
    }

    await deleteRealAccountDataInExecutor(executor, authoritativeUserId, input.authSubjectUserId);
  });

  if (isDemoAccount) {
    return;
  }

  const cognitoUsername = assertCognitoUsername(input.cognitoUsername);
  await deleteCognitoIdentity(cognitoUsername, dependencies);
}

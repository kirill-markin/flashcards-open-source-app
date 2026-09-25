import { randomUUID } from "node:crypto";
import { deleteCognitoUser } from "./cognitoUsers";
import { anonymizeAiUsageForDeletedPersonInExecutor } from "../aiUsage/identity";
import { anonymizeBillingForDeletedPersonInExecutor } from "../billing/identity";
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
  bindCognitoIdentityMappingInExecutor,
  loadCognitoIdentityMappingInExecutor,
  lockCognitoIdentityLifecycleInExecutor,
} from "./userIdentities";
import { isConfiguredDemoEmail } from "./demoEmailAccess";
import { recordAccountDeletedAnalytics } from "../productAnalytics/serverFacts/decisionFacts";
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
 * The replacement pseudonym is minted by the caller and stored nowhere, the links
 * that could resolve it back to the person are removed in the same transaction, and
 * every remaining column that a table outliving account deletion could join on
 * is cleared, the identity, session and workspace columns alike. So this is
 * one-way: no mapping survives anywhere and it cannot be undone.
 *
 * One pseudonym covers every id the person ever produced events under, guest
 * phase included, so their whole history collapses to a single unlinkable
 * identity rather than to several that stay separable from each other.
 *
 * Returns the person-wide ids it covered, which the billing and usage rewrites need
 * and which only a permanent deletion goes on to erase the analytics exclusion rows for.
 */
async function anonymizeProductAnalyticsInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
  anonymizedUserId: string,
): Promise<Array<string>> {
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

/**
 * Clears one account's product data, leaving its analytics history for the caller to anonymize.
 *
 * The anonymization is the caller's because only a real deletion reports itself to analytics first,
 * and that report has to be stored before the sweep to be swept with everything else.
 *
 * Returns whether there was an account here at all, as the profile read under `FOR UPDATE` below
 * saw it; the review-account reset needs the answer before it restores anything. Nothing on the
 * real-deletion path reads it.
 */
async function deleteAccountDataInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
): Promise<boolean> {
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

  // A row read above is locked, so the DELETE removes exactly it. An empty read locks nothing, and it
  // still matches the DELETE for two reasons. A mapped id always has a profile, because
  // auth.user_identities.user_id references org.user_settings(user_id)
  // (db/migrations/0031_guest_ai_identity_and_quota.sql), so an empty read means appUserId is the
  // unmapped subject. And every path that creates or binds an account for a subject takes the
  // identity lifecycle lock deleteAccountForAuthenticatedUser holds. The writers that skip it
  // (ensureUserSettingsAndSelectWorkspace in apps/auth, ensureUserSettingsRowInExecutor,
  // ensureUserProfile) upsert only an id resolved earlier, so one reaches this subject only if it
  // resolved it before an earlier deletion and writes after it.
  return userSettingsResult.rows.length > 0;
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
  await deleteAccountDataInExecutor(executor, appUserId);
  // Reported before the sweep below, never after it: the analytics writer commits on its own
  // connection, so the row is already stored when the sweep runs and is collapsed onto the same
  // pseudonym as the rest of this person's history. See recordAccountDeletedAnalytics.
  await recordAccountDeletedAnalytics(appUserId);
  // One pseudonym for all three histories, minted here rather than inside any of them: an anonymiser
  // that minted its own would leave one person's analytics, purchases and AI spend under identifiers
  // nothing could ever bring back together (docs/premium-entitlements.md, "Deletion"). Analytics keys on
  // a UUID column while billing and AI usage key on the textual org.user_settings.user_id space, where a
  // Cognito subject is a UUID string too, so one value is the right shape for both.
  const anonymizedUserId = randomUUID();
  const personUserIds = await anonymizeProductAnalyticsInExecutor(
    executor,
    appUserId,
    anonymizedUserId,
  );
  // Both rewrites take the person-wide ids the analytics walk resolved rather than the account id: a
  // purchase or an AI call made during the guest phase belongs to the same person.
  await anonymizeBillingForDeletedPersonInExecutor(executor, personUserIds, anonymizedUserId);
  await anonymizeAiUsageForDeletedPersonInExecutor(executor, personUserIds, anonymizedUserId);
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
 * and any analytics exclusion row naming that id stays, restore included. Its billing rows and AI usage
 * facts stay under that id for the same reason: nobody has left, and stamping a purchase as belonging to
 * a deleted account would strip the review account of access it still holds.
 *
 * Surviving is not automatic. The sweep ends in `DELETE FROM org.user_settings`, which cascades any
 * `auth.user_identities` binding away with it, and the returning subject would then be minted a
 * brand-new id (`apps/backend/src/auth/ensureUser.ts`) that none of those rows name. So the profile
 * and the binding are written back under the same id before this transaction commits.
 *
 * The binding written back is not always one the cascade removed. An account can have its profile
 * and no `auth.user_identities` row until something binds one, and `appUserId` is then the subject
 * because nothing mapped it; the write is that account's adopt bind, the same one
 * `apps/backend/src/auth/ensureUser.ts` makes when it adopts such an account. Either shape leaves
 * the account under the id it already had, which is the point.
 *
 * Written back only when the sweep found an account to clear. `POST /v1/me/delete` authenticates
 * without ensuring a profile, so a configured review subject that has never been provisioned
 * reaches here with nothing to delete, and `appUserId` is then the Cognito subject itself. Writing
 * the profile and the binding on that would not restore an account, it would create a new one whose
 * id is the provider's subject rather than a minted one (`docs/auth-service.md`). A subject with no
 * account keeps it that way and is provisioned like anyone else on its next request.
 *
 * It reports no `account_deleted` for the same reason: nobody left, and the same review account is
 * reset again on every review cycle, so counting these would make the deletion metric a measure of
 * how often the review accounts are recycled.
 */
async function deleteDemoAccountDataInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
  authSubjectUserId: string,
): Promise<void> {
  const accountExisted = await deleteAccountDataInExecutor(executor, appUserId);

  if (accountExisted) {
    // Only user_id is restored. Everything the next sign-in fills in itself, the email included, is
    // left to it, so the review account comes back as empty as the sweep left it.
    await executor.query("INSERT INTO org.user_settings (user_id) VALUES ($1)", [appUserId]);
    // Profile before mapping: auth.user_identities.user_id references org.user_settings(user_id)
    // (db/migrations/0031_guest_ai_identity_and_quota.sql).
    await bindCognitoIdentityMappingInExecutor(executor, authSubjectUserId, appUserId);
  }

  await anonymizeProductAnalyticsInExecutor(executor, appUserId, randomUUID());
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
      await deleteDemoAccountDataInExecutor(executor, authoritativeUserId, input.authSubjectUserId);
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

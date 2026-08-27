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

/**
 * Resolves every user id this person's analytics rows were written under.
 *
 * A destructive guest upgrade binds the person onto an account id that is
 * permanently different from the guest user id they browsed under, and the
 * events from that guest phase keep the guest id in both identity columns
 * forever. `auth.guest_upgrade_history` is the append-only record of those
 * merges and account deletion cannot remove it, so a reporting reader could
 * join those surviving rows straight back to the deleted account unless the
 * guest ids are anonymized together with the account id.
 *
 * The walk is recursive because merges chain. A guest session survives the
 * non-destructive upgrade that binds its guest id onto an account id, so that
 * same id can later be merged into a different account as a source, and the
 * history then reaches an older guest id only through the middle one. A
 * single-level lookup would stop at the middle id and leave the older one
 * carrying its real value, and anonymization runs once, so a missed ancestor
 * stays identified forever. `visited_user_ids` keeps the walk from revisiting
 * an id, so a cycle in the history terminates instead of looping.
 *
 * The history columns are `TEXT` while the analytics identity columns are
 * `UUID`, so the lookup compares as text here and the result is cast back to
 * `uuid` by the callers.
 */
async function loadAnalyticsUserIdsForPersonInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
): Promise<Array<string>> {
  const result = await executor.query<AnalyticsPersonUserIdRow>(
    [
      "WITH RECURSIVE person_user_ids AS (",
      "SELECT $1::text AS user_id, ARRAY[$1::text] AS visited_user_ids",
      "UNION ALL",
      "SELECT history.source_guest_user_id,",
      "person_user_ids.visited_user_ids || history.source_guest_user_id",
      "FROM auth.guest_upgrade_history AS history",
      "JOIN person_user_ids ON history.target_user_id = person_user_ids.user_id",
      "WHERE NOT history.source_guest_user_id = ANY(person_user_ids.visited_user_ids)",
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
 */
async function anonymizeProductAnalyticsInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
): Promise<void> {
  const anonymizedUserId = randomUUID();
  const personUserIds = await loadAnalyticsUserIdsForPersonInExecutor(executor, appUserId);

  // One shared pseudonym per person keeps retention and cohort arithmetic working, because the
  // rows still describe one distinct person. country, event_properties and experiment_assignments
  // stay: they name a place, and catalog-allowlisted enum, numeric and fixed-format values, never
  // free text.
  //
  // workspace_id is cleared even though it names a resource rather than a person.
  // auth.guest_upgrade_history survives account deletion, carries source_guest_workspace_id and
  // target_workspace_id next to the user ids, and is readable by reporting_readonly, so a retained
  // workspace_id joins right back to the deleted person's real user id through the very table the
  // widened id set above exists to defeat. Clearing it for every anonymized row, rather than only
  // for the workspaces that appear in that history, is deliberate: anonymization runs once and can
  // never be reapplied, so a predicate narrowed to today's surviving tables would rot silently the
  // first time another one joined a workspace to a user. The cost is the departed person's share of
  // workspace-level aggregates.
  //
  // Matching user_id alone is enough, and it keeps the predicate to one column so a single-column
  // index can serve it. No producer can name this person in subject_user_id without naming one of
  // the ids above in user_id: a row carrying a request context repeats user_id or the Cognito
  // subject of the account itself, and the server-derived guest_upgrade_completed row pairs the
  // account in user_id with the guest id in subject_user_id, which the recursive query above already
  // collected. subject_user_id is still rewritten below, because the Cognito subject it carries
  // identifies the person just as directly.
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
}

async function deleteAccountDataInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
): Promise<void> {
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
  await anonymizeProductAnalyticsInExecutor(executor, appUserId);
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
  await markDeletedSubjectInExecutor(executor, authSubjectUserId);
}

/**
 * Clears app data for one configured insecure review account while
 * preserving the Cognito identity for reuse.
 *
 * This path exists only for the explicit `DEMO_EMAIL_DOSTIP` allowlist inside
 * the `@example.com` domain. Real user accounts must not use it.
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

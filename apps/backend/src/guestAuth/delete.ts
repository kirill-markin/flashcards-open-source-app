import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../db";
import { HttpError } from "../errors";
import { loadWorkspaceManagementRowInExecutor } from "../workspaces/queries";
import {
  assertWorkspaceIsSoleMember,
  assertWorkspaceOwner,
} from "../workspaces/shared";
import {
  deleteUserSettingsInExecutor,
  hasCognitoIdentityMappingForUserInExecutor,
  deleteWorkspaceInExecutor as deleteGuestWorkspaceInExecutor,
  loadGuestSessionInExecutor,
  loadGuestWorkspaceIdInExecutor,
  revokeGuestSessionInExecutor,
} from "./store";

async function assertGuestWorkspaceCleanupAllowedInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  const managedWorkspace = await loadWorkspaceManagementRowInExecutor(
    executor,
    guestUserId,
    guestWorkspaceId,
  );
  assertWorkspaceOwner(managedWorkspace.role);
  assertWorkspaceIsSoleMember(managedWorkspace.member_count);
}

export async function cleanupGuestSessionSourceInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestSessionId: string,
  guestWorkspaceId: string,
): Promise<void> {
  await assertGuestWorkspaceCleanupAllowedInExecutor(executor, guestUserId, guestWorkspaceId);
  await revokeGuestSessionInExecutor(executor, guestUserId, guestSessionId);
  await deleteGuestWorkspaceInExecutor(executor, guestUserId, guestWorkspaceId);
  await deleteUserSettingsInExecutor(executor, guestUserId);
}

/**
 * Deletes one live guest session and its server-owned source rows.
 *
 * This operation is intentionally not idempotent. Callers must provide a live
 * non-revoked guest token, and later attempts fail with `GUEST_AUTH_INVALID`.
 */
export async function deleteGuestSessionInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
): Promise<void> {
  const guestSession = await loadGuestSessionInExecutor(executor, guestToken, true);
  if (await hasCognitoIdentityMappingForUserInExecutor(executor, guestSession.userId)) {
    throw new HttpError(
      409,
      "Guest session is already linked to a signed-in account. Use /me/delete from that account instead.",
      "GUEST_SESSION_DELETE_LINKED_ACCOUNT",
    );
  }
  const guestWorkspaceId = await loadGuestWorkspaceIdInExecutor(executor, guestSession.userId);
  await cleanupGuestSessionSourceInExecutor(
    executor,
    guestSession.userId,
    guestSession.sessionId,
    guestWorkspaceId,
  );
}

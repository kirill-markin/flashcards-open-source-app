import type { DatabaseExecutor } from "../db";
import { HttpError } from "../errors";
import {
  deleteUserSettingsInExecutor,
  hasCognitoIdentityMappingForUserInExecutor,
  deleteWorkspaceInExecutor,
  loadGuestSessionInExecutor,
  loadGuestWorkspaceIdInExecutor,
  revokeGuestSessionInExecutor,
} from "./store";

export async function cleanupGuestSessionSourceInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestSessionId: string,
  guestWorkspaceId: string,
): Promise<void> {
  await revokeGuestSessionInExecutor(executor, guestUserId, guestSessionId);
  await deleteWorkspaceInExecutor(executor, guestUserId, guestWorkspaceId);
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

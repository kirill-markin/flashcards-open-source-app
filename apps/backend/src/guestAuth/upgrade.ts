import type { DatabaseExecutor } from "../db";
import { HttpError } from "../errors";
import {
  AUTO_CREATED_WORKSPACE_NAME,
  createWorkspaceInExecutor,
} from "../workspaces";
import { mergeGuestWorkspaceIntoTargetInExecutor } from "./merge";
import {
  assertTargetWorkspaceAccessInExecutor,
  bindIdentityMappingInExecutor,
  deleteUserSettingsInExecutor,
  deleteWorkspaceInExecutor,
  loadGuestSessionInExecutor,
  loadGuestSessionRecordInExecutor,
  loadGuestUpgradeReplayInExecutor,
  loadGuestWorkspaceIdInExecutor,
  loadIdentityMappingInExecutor,
  loadWorkspaceNameInExecutor,
  loadWorkspaceSummaryInExecutor,
  recordGuestUpgradeHistoryInExecutor,
  revokeGuestSessionInExecutor,
  selectWorkspaceForUserInExecutor,
  updateUserEmailInExecutor,
} from "./store";
import type {
  GuestUpgradeCompletion,
  GuestUpgradePreparation,
  GuestUpgradeResolution,
  GuestUpgradeSelection,
} from "./types";

function logSuspiciousGuestUpgradeReplay(
  reason: "revoked_session_without_history" | "revoked_session_subject_mismatch",
  guestSessionId: string,
  targetSubjectUserId: string,
  historyTargetSubjectUserId: string | null,
): void {
  console.error(JSON.stringify({
    domain: "backend",
    action: "guest_upgrade_complete_suspicious",
    reason,
    guestSessionId,
    targetSubjectUserId,
    historyTargetSubjectUserId,
  }));
}

async function resolveRevokedGuestUpgradeReplayInExecutor(
  executor: DatabaseExecutor,
  guestSessionId: string,
  cognitoSubject: string,
): Promise<GuestUpgradeCompletion> {
  const replay = await loadGuestUpgradeReplayInExecutor(executor, guestSessionId);
  if (replay === null) {
    logSuspiciousGuestUpgradeReplay(
      "revoked_session_without_history",
      guestSessionId,
      cognitoSubject,
      null,
    );
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  if (replay.targetSubjectUserId !== cognitoSubject) {
    logSuspiciousGuestUpgradeReplay(
      "revoked_session_subject_mismatch",
      guestSessionId,
      cognitoSubject,
      replay.targetSubjectUserId,
    );
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  return {
    workspace: await loadWorkspaceSummaryInExecutor(
      executor,
      replay.targetUserId,
      replay.targetWorkspaceId,
    ),
    outcome: "idempotent_replay",
    guestSessionId,
    targetSubjectUserId: replay.targetSubjectUserId,
    targetUserId: replay.targetUserId,
    targetWorkspaceId: replay.targetWorkspaceId,
  };
}

async function resolveGuestUpgradeTargetInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  targetUserId: string,
  selection: GuestUpgradeSelection,
): Promise<GuestUpgradeResolution> {
  const guestWorkspaceId = await loadGuestWorkspaceIdInExecutor(executor, guestUserId);
  const targetWorkspaceId = selection.type === "existing"
    ? selection.workspaceId
    : await (async (): Promise<string> => {
      const guestWorkspaceName = await loadWorkspaceNameInExecutor(executor, guestUserId, guestWorkspaceId);
      const nextWorkspaceName = guestWorkspaceName === "" ? AUTO_CREATED_WORKSPACE_NAME : guestWorkspaceName;
      const nextWorkspaceId = await createWorkspaceInExecutor(executor, targetUserId, nextWorkspaceName);
      await selectWorkspaceForUserInExecutor(executor, targetUserId, nextWorkspaceId);
      return nextWorkspaceId;
    })();

  await assertTargetWorkspaceAccessInExecutor(executor, targetUserId, targetWorkspaceId);

  return {
    guestWorkspaceId,
    targetUserId,
    targetWorkspaceId,
  };
}

async function persistGuestUpgradeTargetSelectionInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  targetWorkspaceId: string,
): Promise<void> {
  // Keep the target account pointed at the post-merge workspace before guest
  // cleanup starts so replay/idempotency stays anchored to the same selection.
  await selectWorkspaceForUserInExecutor(executor, targetUserId, targetWorkspaceId);
}

async function cleanupGuestUpgradeSourceInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestSessionId: string,
  guestWorkspaceId: string,
): Promise<void> {
  // Cleanup stays in one source-scoped phase so destructive guest-side work is
  // not interleaved with target writes.
  await revokeGuestSessionInExecutor(executor, guestUserId, guestSessionId);
  await deleteWorkspaceInExecutor(executor, guestUserId, guestWorkspaceId);
  await deleteUserSettingsInExecutor(executor, guestUserId);
}

/**
 * Prepares one guest upgrade attempt using the already-open executor.
 *
 * `bound` keeps the existing guest user id and therefore does not create any
 * destructive merge history. Only `merge_required` leads to guest cleanup and
 * history recording later during completion.
 */
export async function prepareGuestUpgradeInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  cognitoSubject: string,
  email: string | null,
): Promise<GuestUpgradePreparation> {
  const guestSession = await loadGuestSessionInExecutor(executor, guestToken, true);
  const existingMappedUserId = await loadIdentityMappingInExecutor(executor, cognitoSubject);

  if (existingMappedUserId === null || existingMappedUserId === guestSession.userId) {
    await bindIdentityMappingInExecutor(executor, cognitoSubject, guestSession.userId);
    await updateUserEmailInExecutor(executor, guestSession.userId, email);

    return {
      mode: "bound",
    };
  }

  return {
    mode: "merge_required",
  };
}

/**
 * Completes one guest upgrade attempt using the already-open executor.
 *
 * For `merge_required`, V1 records durable guest/user/device aliases before the
 * live guest rows are deleted. Server-side guest chat rows still disappear via
 * cascade and are intentionally not copied in this version.
 */
export async function completeGuestUpgradeInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  cognitoSubject: string,
  selection: GuestUpgradeSelection,
): Promise<GuestUpgradeCompletion> {
  // Phase 1: load and lock the guest session.
  const guestSession = await loadGuestSessionRecordInExecutor(executor, guestToken, true);
  if (guestSession === null) {
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  // Phase 2: resolve the mapped target user.
  const targetUserId = await loadIdentityMappingInExecutor(executor, cognitoSubject);
  if (targetUserId === null) {
    throw new HttpError(409, "Create or sign in to the destination account first.", "GUEST_UPGRADE_ACCOUNT_REQUIRED");
  }

  // Phase 3: short-circuit revoked-session replay.
  if (guestSession.revokedAt !== null) {
    return resolveRevokedGuestUpgradeReplayInExecutor(executor, guestSession.sessionId, cognitoSubject);
  }

  // Phase 4: short-circuit same-user bound completion.
  if (targetUserId === guestSession.userId) {
    const guestWorkspaceId = await loadGuestWorkspaceIdInExecutor(executor, guestSession.userId);
    return {
      workspace: await loadWorkspaceSummaryInExecutor(executor, guestSession.userId, guestWorkspaceId),
      outcome: "fresh_completion",
      guestSessionId: guestSession.sessionId,
      targetSubjectUserId: cognitoSubject,
      targetUserId,
      targetWorkspaceId: guestWorkspaceId,
    };
  }

  // Phase 5: resolve explicit source and destination workspace ids.
  const guestUpgradeResolution = await resolveGuestUpgradeTargetInExecutor(
    executor,
    guestSession.userId,
    targetUserId,
    selection,
  );

  // Phase 6: merge guest workspace state into the destination workspace.
  const guestUpgradeHistory = await mergeGuestWorkspaceIntoTargetInExecutor(
    executor,
    {
      guestSessionId: guestSession.sessionId,
      guestUserId: guestSession.userId,
      guestWorkspaceId: guestUpgradeResolution.guestWorkspaceId,
      targetSubjectUserId: cognitoSubject,
      targetUserId: guestUpgradeResolution.targetUserId,
      targetWorkspaceId: guestUpgradeResolution.targetWorkspaceId,
      selectionType: selection.type,
    },
  );

  // Phase 7: record durable merge history and replica aliases.
  await recordGuestUpgradeHistoryInExecutor(executor, guestUpgradeHistory);

  // Phase 8: persist the selected target workspace.
  await persistGuestUpgradeTargetSelectionInExecutor(
    executor,
    guestUpgradeResolution.targetUserId,
    guestUpgradeResolution.targetWorkspaceId,
  );

  // Phase 9: revoke and delete guest source rows.
  await cleanupGuestUpgradeSourceInExecutor(
    executor,
    guestSession.userId,
    guestSession.sessionId,
    guestUpgradeResolution.guestWorkspaceId,
  );

  // Phase 10: load the final workspace summary for the response.
  return {
    workspace: await loadWorkspaceSummaryInExecutor(
      executor,
      guestUpgradeResolution.targetUserId,
      guestUpgradeResolution.targetWorkspaceId,
    ),
    outcome: "fresh_completion",
    guestSessionId: guestSession.sessionId,
    targetSubjectUserId: cognitoSubject,
    targetUserId: guestUpgradeResolution.targetUserId,
    targetWorkspaceId: guestUpgradeResolution.targetWorkspaceId,
  };
}

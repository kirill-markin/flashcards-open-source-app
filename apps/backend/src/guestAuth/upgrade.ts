import type { DatabaseExecutor } from "../db";
import { HttpError } from "../errors";
import {
  AUTO_CREATED_WORKSPACE_NAME,
  createWorkspaceInExecutor,
} from "../workspaces";
import { cleanupGuestSessionSourceInExecutor } from "./delete";
import { mergeGuestWorkspaceIntoTargetInExecutor } from "./merge";
import {
  assertTargetWorkspaceAccessInExecutor,
  bindIdentityMappingInExecutor,
  loadGuestSessionInExecutor,
  loadGuestSessionRecordInExecutor,
  loadGuestUpgradeReplayByGuestTokenInExecutor,
  loadGuestUpgradeReplayInExecutor,
  loadGuestWorkspaceIdInExecutor,
  loadIdentityMappingInExecutor,
  loadWorkspaceNameInExecutor,
  loadWorkspaceSummaryInExecutor,
  recordGuestUpgradeHistoryInExecutor,
  selectWorkspaceForUserInExecutor,
  updateUserEmailInExecutor,
} from "./store";
import { hashGuestToken } from "./shared";
import type {
  GuestUpgradeCompleteCapabilities,
  GuestUpgradeCompletion,
  GuestUpgradePreparation,
  GuestUpgradeDroppedEntities,
  GuestUpgradeResolution,
  GuestUpgradeSelection,
} from "./types";

function createDroppedEntitiesUnsupportedReplayError(): HttpError {
  return new HttpError(
    409,
    "Guest upgrade replay includes dropped entities, but this client did not declare supportsDroppedEntities. Retry /guest-auth/upgrade/complete with supportsDroppedEntities: true.",
    "GUEST_UPGRADE_DROPPED_ENTITIES_UNSUPPORTED",
  );
}

function createGuestWorkspaceNotDrainedError(): HttpError {
  return new HttpError(
    409,
    "Guest upgrade merge requires the current guest workspace to be fully synced and the local guest outbox to be empty. Sync the guest workspace, wait until the guest outbox is empty, then retry /guest-auth/upgrade/complete with guestWorkspaceSyncedAndOutboxDrained: true.",
    "GUEST_UPGRADE_GUEST_SYNC_NOT_DRAINED",
  );
}

function assertGuestWorkspaceSyncedAndOutboxDrained(
  capabilities: GuestUpgradeCompleteCapabilities,
): void {
  if (
    capabilities.requiresGuestWorkspaceSyncedAndOutboxDrained &&
    !capabilities.guestWorkspaceSyncedAndOutboxDrained
  ) {
    throw createGuestWorkspaceNotDrainedError();
  }
}

function logSuspiciousGuestUpgradeReplay(
  reason:
    | "deleted_session_subject_mismatch"
    | "revoked_session_without_history"
    | "revoked_session_subject_mismatch",
  guestSessionId: string | null,
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

async function createGuestUpgradeReplayCompletionInExecutor(
  executor: DatabaseExecutor,
  replay: Readonly<{
    sourceGuestSessionId: string;
    targetSubjectUserId: string;
    targetUserId: string;
    targetWorkspaceId: string;
    droppedEntities?: GuestUpgradeDroppedEntities;
  }>,
  capabilities: GuestUpgradeCompleteCapabilities,
): Promise<GuestUpgradeCompletion> {
  if (replay.droppedEntities !== undefined && !capabilities.supportsDroppedEntities) {
    throw createDroppedEntitiesUnsupportedReplayError();
  }

  return {
    workspace: await loadWorkspaceSummaryInExecutor(
      executor,
      replay.targetUserId,
      replay.targetWorkspaceId,
    ),
    outcome: "idempotent_replay",
    guestSessionId: replay.sourceGuestSessionId,
    targetSubjectUserId: replay.targetSubjectUserId,
    targetUserId: replay.targetUserId,
    targetWorkspaceId: replay.targetWorkspaceId,
    ...(replay.droppedEntities === undefined
      ? {}
      : { droppedEntities: replay.droppedEntities }),
  };
}

/**
 * Replays the post-merge completion payload after the original guest session
 * has already been revoked.
 *
 * This is a temporary backend compatibility path for already released clients
 * that can retry `/guest-auth/upgrade/complete` after the server committed the
 * merge but before the client received the first 200 response. It replays only
 * the already-committed cloud-state merge result; it never accepts client local
 * outbox rows. Remove this path only after the minimum supported client
 * versions no longer rely on revoked-session replay semantics, and update the
 * related compatibility notes in the same change.
 *
 * Because this path only returns stored merge history and never accepts local
 * outbox rows, it intentionally does not require the fresh-merge guest drain
 * assertion. The only replay-time client capability gate is whether the stored
 * result includes dropped entities the caller must be able to handle.
 */
async function resolveRevokedGuestUpgradeReplayInExecutor(
  executor: DatabaseExecutor,
  guestSessionId: string,
  cognitoSubject: string,
  capabilities: GuestUpgradeCompleteCapabilities,
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

  return createGuestUpgradeReplayCompletionInExecutor(executor, replay, capabilities);
}

/**
 * Replays committed merge history when the source guest user cleanup has
 * already cascaded away the original auth.guest_sessions row.
 */
async function resolveDeletedGuestUpgradeReplayInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  cognitoSubject: string,
  capabilities: GuestUpgradeCompleteCapabilities,
): Promise<GuestUpgradeCompletion> {
  const replay = await loadGuestUpgradeReplayByGuestTokenInExecutor(executor, guestToken);
  if (replay === null) {
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  if (replay.targetSubjectUserId !== cognitoSubject) {
    logSuspiciousGuestUpgradeReplay(
      "deleted_session_subject_mismatch",
      replay.sourceGuestSessionId,
      cognitoSubject,
      replay.targetSubjectUserId,
    );
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  return createGuestUpgradeReplayCompletionInExecutor(executor, replay, capabilities);
}

async function resolveGuestUpgradeTargetInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  targetUserId: string,
  selection: GuestUpgradeSelection,
): Promise<GuestUpgradeResolution> {
  const guestWorkspaceId = await loadGuestWorkspaceIdInExecutor(executor, guestUserId);
  if (selection.type === "existing" && selection.workspaceId === guestWorkspaceId) {
    throw new HttpError(
      409,
      "Choose a different destination workspace. The guest workspace cannot be merged into itself.",
      "GUEST_UPGRADE_TARGET_SAME_AS_SOURCE",
    );
  }
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
 * For `merge_required`, the backend moves guest content into the destination
 * workspace from already-synced guest cloud rows without rekeying cards,
 * decks, or review events. Clients must sync the guest workspace and drain the
 * local guest outbox before calling this endpoint; pending local outbox rows are
 * never carried through this merge.
 *
 * The durable replay/history layer below is intentionally narrower than the
 * old V1 alias model from `main`, but it is still legacy compatibility code.
 * Keep it only until released clients no longer depend on idempotent replay
 * after session revocation or stale-client replica routing.
 */
export async function completeGuestUpgradeInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  cognitoSubject: string,
  selection: GuestUpgradeSelection,
  capabilities: GuestUpgradeCompleteCapabilities,
): Promise<GuestUpgradeCompletion> {
  // Phase 1: load and lock the guest session.
  const guestSession = await loadGuestSessionRecordInExecutor(executor, guestToken, true);
  if (guestSession === null) {
    return resolveDeletedGuestUpgradeReplayInExecutor(
      executor,
      guestToken,
      cognitoSubject,
      capabilities,
    );
  }

  // Phase 2: resolve the mapped target user.
  const targetUserId = await loadIdentityMappingInExecutor(executor, cognitoSubject);
  if (targetUserId === null) {
    throw new HttpError(409, "Create or sign in to the destination account first.", "GUEST_UPGRADE_ACCOUNT_REQUIRED");
  }

  // Phase 3: short-circuit revoked-session replay.
  if (guestSession.revokedAt !== null) {
    return resolveRevokedGuestUpgradeReplayInExecutor(
      executor,
      guestSession.sessionId,
      cognitoSubject,
      capabilities,
    );
  }

  // Phase 4: short-circuit same-user bound completion.
  // In this invariant the Cognito subject is already bound to the guest user,
  // so there is no cross-account merge and no guest source deletion. Keep this
  // path before the drain-capability check for released clients that completed
  // the bound flow before those merge-only capabilities existed; there are no
  // dropped entities to report because all rows already belong to the final
  // user/workspace.
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

  // Phase 5: enforce the merge precondition for clients that declare the new
  // drain protocol. Omitted capability fields are the legacy shipped-client
  // route shape and must remain compatible until those clients are out of support.
  assertGuestWorkspaceSyncedAndOutboxDrained(capabilities);

  // Phase 6: resolve explicit source and destination workspace ids.
  const guestUpgradeResolution = await resolveGuestUpgradeTargetInExecutor(
    executor,
    guestSession.userId,
    targetUserId,
    selection,
  );

  // Phase 7: merge already-synced guest cloud state into the destination workspace.
  const guestUpgradeMerge = await mergeGuestWorkspaceIntoTargetInExecutor(
    executor,
    {
      guestSessionId: guestSession.sessionId,
      sourceGuestSessionSecretHash: hashGuestToken(guestToken),
      guestUserId: guestSession.userId,
      guestWorkspaceId: guestUpgradeResolution.guestWorkspaceId,
      targetSubjectUserId: cognitoSubject,
      targetUserId: guestUpgradeResolution.targetUserId,
      targetWorkspaceId: guestUpgradeResolution.targetWorkspaceId,
      selectionType: selection.type,
      supportsDroppedEntities: capabilities.supportsDroppedEntities,
    },
  );

  // Phase 8: record durable merge history and replica aliases.
  // This is legacy/idempotency-only compatibility for shipped clients that can
  // replay completion or resend stale replica-bound operations after the guest
  // session is gone. Remove only after those clients are explicitly out of
  // support.
  await recordGuestUpgradeHistoryInExecutor(executor, guestUpgradeMerge.history);

  // Phase 9: persist the selected target workspace.
  await persistGuestUpgradeTargetSelectionInExecutor(
    executor,
    guestUpgradeResolution.targetUserId,
    guestUpgradeResolution.targetWorkspaceId,
  );

  // Phase 10: revoke and delete guest source rows.
  await cleanupGuestSessionSourceInExecutor(
    executor,
    guestSession.userId,
    guestSession.sessionId,
    guestUpgradeResolution.guestWorkspaceId,
  );

  // Phase 11: load the final workspace summary for the response.
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
    ...(guestUpgradeMerge.history.droppedEntities === undefined
      ? {}
      : { droppedEntities: guestUpgradeMerge.history.droppedEntities }),
  };
}

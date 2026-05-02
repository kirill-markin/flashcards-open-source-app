import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "../../db";
import { HttpError } from "../../errors";
import { completeGuestUpgradeInExecutor } from "../../guestAuth";
import {
  addWorkspaceMembership,
  createGuestUpgradeExecutor,
  createMergeState,
  DROPPED_ENTITIES_UNSUPPORTED,
  GUEST_SYNC_NOT_DRAINED,
  isGuestUpgradeMergeOnlyExecutorQuery,
  membershipKey,
  type GuestUpgradeExecutorParam,
} from "../../guestAuthTestHarness";

test("completeGuestUpgradeInExecutor reassigns guest installation ownership during merge", async () => {
  const guestToken = "guest-token-1";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-1";
  const targetSubject = "cognito-subject-1";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-1",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId,
    guestReplicaId,
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);
  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
    DROPPED_ENTITIES_UNSUPPORTED,
  );

  assert.equal(result.workspace.workspaceId, targetWorkspaceId);
  assert.equal(state.installations.get(installationId)?.user_id, targetUserId);
  assert.equal(state.userSettings.get(targetUserId)?.workspace_id, targetWorkspaceId);
  assert.equal(state.userSettings.has(guestUserId), false);
  assert.equal(state.workspaces.has(guestWorkspaceId), false);
  assert.equal(state.guestSession, null);
  assert.equal(state.guestUpgradeHistory.length, 1);
  assert.equal(state.guestReplicaAliases.length, 1);
  assert.equal(state.guestReplicaAliases[0]?.source_guest_replica_id, guestReplicaId);
  assert.equal(result.outcome, "fresh_completion");
  assert.equal(result.targetWorkspaceId, targetWorkspaceId);

  const targetReplica = state.workspaceReplicas.find((replica) => (
    replica.workspace_id === targetWorkspaceId
    && replica.installation_id === installationId
  ));
  assert.ok(targetReplica);
  assert.equal(targetReplica?.user_id, targetUserId);
});

test("completeGuestUpgradeInExecutor rejects selecting the guest workspace as the merge target", async () => {
  const guestToken = "guest-token-same-workspace";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const installationId = "installation-same-workspace";
  const targetSubject = "cognito-subject-same-workspace";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-same-workspace",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica-same-workspace",
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  addWorkspaceMembership(state, targetUserId, guestWorkspaceId, "member");

  const executor = createGuestUpgradeExecutor(state);

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      targetSubject,
      {
        type: "existing",
        workspaceId: guestWorkspaceId,
      },
      DROPPED_ENTITIES_UNSUPPORTED,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "GUEST_UPGRADE_TARGET_SAME_AS_SOURCE");
      return true;
    },
  );

  assert.equal(state.guestSession?.revoked_at, null);
  assert.equal(state.guestUpgradeHistory.length, 0);
  assert.equal(state.installations.get(installationId)?.user_id, guestUserId);
  assert.equal(state.workspaces.has(guestWorkspaceId), true);
});

test("completeGuestUpgradeInExecutor rejects merge_required completion before guest sync is drained", async () => {
  const guestToken = "guest-token-not-drained";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const installationId = "installation-not-drained";
  const targetSubject = "cognito-subject-not-drained";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-not-drained",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId,
    guestReplicaId: "guest-replica-not-drained",
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      targetSubject,
      {
        type: "existing",
        workspaceId: targetWorkspaceId,
      },
      GUEST_SYNC_NOT_DRAINED,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "GUEST_UPGRADE_GUEST_SYNC_NOT_DRAINED");
      assert.match(error.message, /guest outbox is empty/);
      return true;
    },
  );

  assert.equal(state.guestUpgradeHistory.length, 0);
  assert.equal(state.guestSession?.revoked_at, null);
  assert.equal(state.installations.get(installationId)?.user_id, guestUserId);
  assert.equal(state.workspaces.has(guestWorkspaceId), true);
});

test("completeGuestUpgradeInExecutor completes same-user bound path without guest drain or merge handling", async () => {
  const guestToken = "guest-token-bound-complete";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const linkedUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const installationId = "installation-bound-complete";
  const targetSubject = "cognito-subject-bound-complete";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-bound-complete",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId: linkedUserId,
    targetWorkspaceId,
    guestReplicaId: "guest-replica-bound-complete",
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.identityMappings.set(targetSubject, guestUserId);

  const mergeOnlyQueries: Array<string> = [];
  const baseExecutor = createGuestUpgradeExecutor(state);
  const executor: DatabaseExecutor = {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<GuestUpgradeExecutorParam>,
    ): Promise<pg.QueryResult<Row>> => {
      if (isGuestUpgradeMergeOnlyExecutorQuery(text)) {
        mergeOnlyQueries.push(text);
      }

      return baseExecutor.query<Row>(text, params);
    },
  };

  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
    GUEST_SYNC_NOT_DRAINED,
  );

  assert.equal(result.workspace.workspaceId, guestWorkspaceId);
  assert.equal(result.outcome, "fresh_completion");
  assert.equal(result.targetUserId, guestUserId);
  assert.equal(result.targetWorkspaceId, guestWorkspaceId);
  assert.equal(Object.hasOwn(result, "droppedEntities"), false);
  assert.deepEqual(mergeOnlyQueries, []);
  assert.equal(state.guestUpgradeHistory.length, 0);
  assert.equal(state.guestReplicaAliases.length, 0);
  assert.equal(state.guestSession?.revoked_at, null);
  assert.equal(state.installations.get(installationId)?.user_id, guestUserId);
  assert.equal(state.userSettings.get(guestUserId)?.workspace_id, guestWorkspaceId);
  assert.equal(state.userSettings.get(linkedUserId)?.workspace_id, targetWorkspaceId);
  assert.equal(state.workspaces.has(guestWorkspaceId), true);
});

test("completeGuestUpgradeInExecutor preserves guest entity ids when merging into a different workspace", async () => {
  const guestToken = "guest-token-preserved-ids";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-preserved-ids";
  const targetSubject = "cognito-subject-preserved-ids";
  const sourceCardId = "11111111-1111-4111-8111-111111111111";
  const sourceDeckId = "22222222-2222-4222-8222-222222222222";
  const sourceReviewEventId = "33333333-3333-4333-8333-333333333333";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-preserved-ids",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId,
    guestReplicaId,
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.cards.push({
    card_id: sourceCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Front",
    back_text: "Back",
    tags: ["tag"],
    effort_level: "fast",
    due_at: null,
    created_at: "2026-04-02T14:00:02.000Z",
    reps: 0,
    lapses: 0,
    fsrs_card_state: "new",
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
    client_updated_at: "2026-04-02T14:00:03.000Z",
    last_modified_by_replica_id: guestReplicaId,
    last_operation_id: "guest-card-op",
    updated_at: "2026-04-02T14:00:03.000Z",
    deleted_at: null,
  });
  state.decks.push({
    deck_id: sourceDeckId,
    workspace_id: guestWorkspaceId,
    name: "Deck",
    filter_definition: {
      version: 2,
      effortLevels: ["fast"],
      tags: ["tag"],
    },
    created_at: "2026-04-02T14:00:04.000Z",
    client_updated_at: "2026-04-02T14:00:05.000Z",
    last_modified_by_replica_id: guestReplicaId,
    last_operation_id: "guest-deck-op",
    updated_at: "2026-04-02T14:00:05.000Z",
    deleted_at: null,
  });
  state.reviewEvents.push({
    review_event_id: sourceReviewEventId,
    workspace_id: guestWorkspaceId,
    card_id: sourceCardId,
    replica_id: guestReplicaId,
    client_event_id: "client-event-1",
    rating: 3,
    reviewed_at_client: "2026-04-02T14:00:06.000Z",
    reviewed_at_server: "2026-04-02T14:00:06.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);
  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
    DROPPED_ENTITIES_UNSUPPORTED,
  );

  const targetCard = state.cards.find((card) => card.workspace_id === targetWorkspaceId);
  const targetDeck = state.decks.find((deck) => deck.workspace_id === targetWorkspaceId);
  const targetReviewEvent = state.reviewEvents.find((reviewEvent) => reviewEvent.workspace_id === targetWorkspaceId);

  assert.ok(targetCard);
  assert.equal(targetCard?.card_id, sourceCardId);

  assert.ok(targetDeck);
  assert.equal(targetDeck?.deck_id, sourceDeckId);

  assert.ok(targetReviewEvent);
  assert.equal(targetReviewEvent?.review_event_id, sourceReviewEventId);
  assert.equal(targetReviewEvent?.card_id, sourceCardId);
});

test("completeGuestUpgradeInExecutor repairs legacy invalid guest card fsrs state during merge", async () => {
  const guestToken = "guest-token-invalid-guest-card";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-invalid-guest-card";
  const targetSubject = "cognito-subject-invalid-guest-card";
  const sourceCardId = "77777777-7777-4777-8777-777777777777";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-invalid-guest-card",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId,
    guestReplicaId,
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.cards.push({
    card_id: sourceCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Legacy invalid front",
    back_text: "Legacy invalid back",
    tags: ["legacy"],
    effort_level: "fast",
    due_at: "2026-04-03T14:00:00.000Z",
    created_at: "2026-04-02T14:00:02.000Z",
    reps: 3,
    lapses: 1,
    fsrs_card_state: "new",
    fsrs_step_index: 0,
    fsrs_stability: 0.212,
    fsrs_difficulty: 6.4133,
    fsrs_last_reviewed_at: "2026-04-02T14:00:01.000Z",
    fsrs_scheduled_days: 1,
    client_updated_at: "2026-04-02T14:00:03.000Z",
    last_modified_by_replica_id: guestReplicaId,
    last_operation_id: "guest-invalid-card-op",
    updated_at: "2026-04-02T14:00:03.000Z",
    deleted_at: null,
  });

  const executor = createGuestUpgradeExecutor(state);
  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
    DROPPED_ENTITIES_UNSUPPORTED,
  );

  const targetCard = state.cards.find((card) => (
    card.workspace_id === targetWorkspaceId
    && card.card_id === sourceCardId
  ));

  assert.ok(targetCard);
  assert.equal(targetCard?.due_at, null);
  assert.equal(targetCard?.reps, 0);
  assert.equal(targetCard?.lapses, 0);
  assert.equal(targetCard?.fsrs_card_state, "new");
  assert.equal(targetCard?.fsrs_step_index, null);
  assert.equal(targetCard?.fsrs_stability, null);
  assert.equal(targetCard?.fsrs_difficulty, null);
  assert.equal(targetCard?.fsrs_last_reviewed_at, null);
  assert.equal(targetCard?.fsrs_scheduled_days, null);
});

test("completeGuestUpgradeInExecutor with create_new creates and selects a new target workspace", async () => {
  const guestToken = "guest-token-create-new";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-create-new";
  const targetSubject = "cognito-subject-create-new";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-create-new",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId,
    guestReplicaId,
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:10:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);
  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "create_new",
    },
    DROPPED_ENTITIES_UNSUPPORTED,
  );

  assert.equal(result.outcome, "fresh_completion");
  assert.notEqual(result.targetWorkspaceId, targetWorkspaceId);
  assert.equal(result.workspace.workspaceId, result.targetWorkspaceId);
  assert.equal(state.userSettings.get(targetUserId)?.workspace_id, result.targetWorkspaceId);
  assert.equal(state.workspaces.get(result.targetWorkspaceId)?.name, "Guest workspace");
  assert.ok(state.workspaceMemberships.has(membershipKey(targetUserId, result.targetWorkspaceId)));
});

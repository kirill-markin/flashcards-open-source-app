import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseExecutor } from "./db";
import { HttpError } from "./errors";
import { completeGuestUpgradeInExecutor } from "./guestAuth";
import {
  addWorkspaceMembership,
  createGuestUpgradeExecutor,
  createMergeState,
  createQueryResult,
  createReviewEventClientEventDedupMergeFixture,
  createUserSettingsState,
  createWorkspaceState,
  DROPPED_ENTITIES_SUPPORTED,
  DROPPED_ENTITIES_UNSUPPORTED,
} from "./guestAuth.testHarness";

test("completeGuestUpgradeInExecutor resolves same-id merge conflicts with LWW cards and idempotent review events", async () => {
  const guestToken = "guest-token-same-id-conflicts";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-same-id-conflicts";
  const targetSubject = "cognito-subject-same-id-conflicts";
  const sharedCardId = "44444444-4444-4444-8444-444444444444";
  const sharedDeckId = "55555555-5555-4555-8555-555555555555";
  const sharedReviewEventId = "66666666-6666-4666-8666-666666666666";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-same-id-conflicts",
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
    card_id: sharedCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Guest newer front",
    back_text: "Guest newer back",
    tags: ["guest"],
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
  state.cards.push({
    card_id: sharedCardId,
    workspace_id: targetWorkspaceId,
    front_text: "Target older front",
    back_text: "Target older back",
    tags: ["target"],
    effort_level: "medium",
    due_at: null,
    created_at: "2026-04-02T13:59:59.000Z",
    reps: 1,
    lapses: 0,
    fsrs_card_state: "new",
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
    client_updated_at: "2026-04-02T14:00:00.000Z",
    last_modified_by_replica_id: "target-replica-existing",
    last_operation_id: "target-card-op",
    updated_at: "2026-04-02T14:00:00.000Z",
    deleted_at: null,
  });
  state.decks.push({
    deck_id: sharedDeckId,
    workspace_id: guestWorkspaceId,
    name: "Guest older deck",
    filter_definition: {
      version: 2,
      effortLevels: ["fast"],
      tags: ["guest"],
    },
    created_at: "2026-04-02T14:00:04.000Z",
    client_updated_at: "2026-04-02T14:00:05.000Z",
    last_modified_by_replica_id: guestReplicaId,
    last_operation_id: "guest-deck-op",
    updated_at: "2026-04-02T14:00:05.000Z",
    deleted_at: null,
  });
  state.decks.push({
    deck_id: sharedDeckId,
    workspace_id: targetWorkspaceId,
    name: "Target newer deck",
    filter_definition: {
      version: 2,
      effortLevels: ["medium"],
      tags: ["target"],
    },
    created_at: "2026-04-02T13:59:59.000Z",
    client_updated_at: "2026-04-02T14:10:00.000Z",
    last_modified_by_replica_id: "target-replica-existing",
    last_operation_id: "target-deck-op",
    updated_at: "2026-04-02T14:10:00.000Z",
    deleted_at: null,
  });
  state.reviewEvents.push({
    review_event_id: sharedReviewEventId,
    workspace_id: guestWorkspaceId,
    card_id: sharedCardId,
    replica_id: guestReplicaId,
    client_event_id: "guest-client-event-1",
    rating: 2,
    reviewed_at_client: "2026-04-02T14:00:06.000Z",
    reviewed_at_server: "2026-04-02T14:00:06.000Z",
  });
  state.reviewEvents.push({
    review_event_id: sharedReviewEventId,
    workspace_id: targetWorkspaceId,
    card_id: sharedCardId,
    replica_id: "target-replica-existing",
    client_event_id: "target-client-event-1",
    rating: 4,
    reviewed_at_client: "2026-04-02T14:10:06.000Z",
    reviewed_at_server: "2026-04-02T14:10:06.000Z",
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

  const mergedCards = state.cards.filter((card) => card.card_id === sharedCardId);
  const mergedDecks = state.decks.filter((deck) => deck.deck_id === sharedDeckId);
  const mergedReviewEvents = state.reviewEvents.filter((reviewEvent) => reviewEvent.review_event_id === sharedReviewEventId);

  assert.equal(mergedCards.length, 1);
  assert.equal(mergedCards[0]?.workspace_id, targetWorkspaceId);
  assert.equal(mergedCards[0]?.front_text, "Guest newer front");
  assert.equal(mergedCards[0]?.back_text, "Guest newer back");

  assert.equal(mergedDecks.length, 1);
  assert.equal(mergedDecks[0]?.workspace_id, targetWorkspaceId);
  assert.equal(mergedDecks[0]?.name, "Target newer deck");

  assert.equal(mergedReviewEvents.length, 1);
  assert.equal(mergedReviewEvents[0]?.workspace_id, targetWorkspaceId);
  assert.equal(mergedReviewEvents[0]?.rating, 4);
});

test("completeGuestUpgradeInExecutor drops review events deduped to a different target id for capable clients", async () => {
  const fixture = createReviewEventClientEventDedupMergeFixture();
  const executor = createGuestUpgradeExecutor(fixture.state);
  const result = await completeGuestUpgradeInExecutor(
    executor,
    fixture.guestToken,
    fixture.targetSubject,
    {
      type: "existing",
      workspaceId: fixture.targetWorkspaceId,
    },
    DROPPED_ENTITIES_SUPPORTED,
  );

  assert.equal(result.outcome, "fresh_completion");
  assert.deepEqual(result.droppedEntities, {
    cardIds: [],
    deckIds: [],
    reviewEventIds: [fixture.guestReviewEventId],
  });
  assert.deepEqual(fixture.state.guestUpgradeHistory[0]?.dropped_entities, {
    cardIds: [],
    deckIds: [],
    reviewEventIds: [fixture.guestReviewEventId],
  });

  const targetReviewEvents = fixture.state.reviewEvents.filter((reviewEvent) => (
    reviewEvent.workspace_id === fixture.targetWorkspaceId
  ));
  assert.equal(targetReviewEvents.length, 1);
  assert.equal(targetReviewEvents[0]?.review_event_id, fixture.targetReviewEventId);
  assert.equal(
    targetReviewEvents.some((reviewEvent) => reviewEvent.review_event_id === fixture.guestReviewEventId),
    false,
  );

  const targetCard = fixture.state.cards.find((card) => (
    card.workspace_id === fixture.targetWorkspaceId
    && card.card_id === fixture.cardId
  ));
  assert.ok(targetCard);
  assert.equal(targetCard?.front_text, "Guest front");
});

test("completeGuestUpgradeInExecutor rejects review events deduped to a different target id without droppedEntities support", async () => {
  const fixture = createReviewEventClientEventDedupMergeFixture();
  const executor = createGuestUpgradeExecutor(fixture.state);

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      fixture.guestToken,
      fixture.targetSubject,
      {
        type: "existing",
        workspaceId: fixture.targetWorkspaceId,
      },
      DROPPED_ENTITIES_UNSUPPORTED,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "GUEST_UPGRADE_DROPPED_ENTITIES_UNSUPPORTED");
      assert.match(error.message, new RegExp(fixture.guestReviewEventId));
      assert.match(error.message, new RegExp(fixture.targetReviewEventId));
      return true;
    },
  );

  assert.equal(fixture.state.guestUpgradeHistory.length, 0);
  assert.equal(fixture.state.guestSession?.revoked_at, null);
  assert.equal(
    fixture.state.reviewEvents.some((reviewEvent) => (
      reviewEvent.workspace_id === fixture.targetWorkspaceId
      && reviewEvent.review_event_id === fixture.guestReviewEventId
    )),
    false,
  );
});

test("completeGuestUpgradeInExecutor drops guest entities on third-workspace global-id conflicts and continues", async () => {
  const guestToken = "guest-token-third-workspace-conflicts";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-third-workspace-conflicts";
  const targetSubject = "cognito-subject-third-workspace-conflicts";
  const thirdUserId = "third-user";
  const thirdWorkspaceId = "third-workspace";
  const conflictingCardId = "77777777-7777-4777-8777-777777777777";
  const mergedCardId = "88888888-8888-4888-8888-888888888888";
  const conflictingDeckId = "99999999-9999-4999-8999-999999999999";
  const conflictingReviewEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const skippedReviewEventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const mergedReviewEventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-third-workspace-conflicts",
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
  state.userSettings.set(
    thirdUserId,
    createUserSettingsState(thirdUserId, thirdWorkspaceId, "third@example.com"),
  );
  state.workspaces.set(
    thirdWorkspaceId,
    createWorkspaceState(
      thirdWorkspaceId,
      "Third workspace",
      "2026-04-02T13:30:00.000Z",
      "2026-04-02T13:30:00.000Z",
      "third-replica-existing",
      "third-op",
    ),
  );
  addWorkspaceMembership(state, thirdUserId, thirdWorkspaceId, "owner");
  state.cards.push({
    card_id: conflictingCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Guest conflicting front",
    back_text: "Guest conflicting back",
    tags: ["guest-conflict"],
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
    last_operation_id: "guest-conflicting-card-op",
    updated_at: "2026-04-02T14:00:03.000Z",
    deleted_at: null,
  });
  state.cards.push({
    card_id: mergedCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Guest kept front",
    back_text: "Guest kept back",
    tags: ["guest-kept"],
    effort_level: "medium",
    due_at: null,
    created_at: "2026-04-02T14:00:04.000Z",
    reps: 0,
    lapses: 0,
    fsrs_card_state: "new",
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
    client_updated_at: "2026-04-02T14:00:05.000Z",
    last_modified_by_replica_id: guestReplicaId,
    last_operation_id: "guest-kept-card-op",
    updated_at: "2026-04-02T14:00:05.000Z",
    deleted_at: null,
  });
  state.cards.push({
    card_id: conflictingCardId,
    workspace_id: thirdWorkspaceId,
    front_text: "Third workspace front",
    back_text: "Third workspace back",
    tags: ["third"],
    effort_level: "long",
    due_at: null,
    created_at: "2026-04-02T13:30:02.000Z",
    reps: 5,
    lapses: 1,
    fsrs_card_state: "review",
    fsrs_step_index: null,
    fsrs_stability: 3.5,
    fsrs_difficulty: 5.1,
    fsrs_last_reviewed_at: "2026-04-01T13:30:00.000Z",
    fsrs_scheduled_days: 4,
    client_updated_at: "2026-04-02T13:30:03.000Z",
    last_modified_by_replica_id: "third-replica-existing",
    last_operation_id: "third-card-op",
    updated_at: "2026-04-02T13:30:03.000Z",
    deleted_at: null,
  });
  state.decks.push({
    deck_id: conflictingDeckId,
    workspace_id: guestWorkspaceId,
    name: "Guest conflicting deck",
    filter_definition: {
      version: 2,
      effortLevels: ["fast"],
      tags: ["guest-conflict"],
    },
    created_at: "2026-04-02T14:00:06.000Z",
    client_updated_at: "2026-04-02T14:00:07.000Z",
    last_modified_by_replica_id: guestReplicaId,
    last_operation_id: "guest-conflicting-deck-op",
    updated_at: "2026-04-02T14:00:07.000Z",
    deleted_at: null,
  });
  state.decks.push({
    deck_id: conflictingDeckId,
    workspace_id: thirdWorkspaceId,
    name: "Third workspace deck",
    filter_definition: {
      version: 2,
      effortLevels: ["long"],
      tags: ["third"],
    },
    created_at: "2026-04-02T13:30:04.000Z",
    client_updated_at: "2026-04-02T13:30:05.000Z",
    last_modified_by_replica_id: "third-replica-existing",
    last_operation_id: "third-deck-op",
    updated_at: "2026-04-02T13:30:05.000Z",
    deleted_at: null,
  });
  state.reviewEvents.push({
    review_event_id: skippedReviewEventId,
    workspace_id: guestWorkspaceId,
    card_id: conflictingCardId,
    replica_id: guestReplicaId,
    client_event_id: "guest-skipped-client-event",
    rating: 1,
    reviewed_at_client: "2026-04-02T14:00:08.000Z",
    reviewed_at_server: "2026-04-02T14:00:08.000Z",
  });
  state.reviewEvents.push({
    review_event_id: conflictingReviewEventId,
    workspace_id: guestWorkspaceId,
    card_id: mergedCardId,
    replica_id: guestReplicaId,
    client_event_id: "guest-conflicting-review-event",
    rating: 2,
    reviewed_at_client: "2026-04-02T14:00:09.000Z",
    reviewed_at_server: "2026-04-02T14:00:09.000Z",
  });
  state.reviewEvents.push({
    review_event_id: mergedReviewEventId,
    workspace_id: guestWorkspaceId,
    card_id: mergedCardId,
    replica_id: guestReplicaId,
    client_event_id: "guest-kept-review-event",
    rating: 3,
    reviewed_at_client: "2026-04-02T14:00:10.000Z",
    reviewed_at_server: "2026-04-02T14:00:10.000Z",
  });
  state.reviewEvents.push({
    review_event_id: conflictingReviewEventId,
    workspace_id: thirdWorkspaceId,
    card_id: conflictingCardId,
    replica_id: "third-replica-existing",
    client_event_id: "third-review-event",
    rating: 4,
    reviewed_at_client: "2026-04-02T13:30:06.000Z",
    reviewed_at_server: "2026-04-02T13:30:06.000Z",
  });

  const expectedDroppedEntities = {
    cardIds: [conflictingCardId],
    deckIds: [conflictingDeckId],
    reviewEventIds: [skippedReviewEventId, conflictingReviewEventId],
  };

  const executor = createGuestUpgradeExecutor(state);
  const firstResult = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
    DROPPED_ENTITIES_SUPPORTED,
  );
  const secondResult = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
    DROPPED_ENTITIES_SUPPORTED,
  );

  assert.equal(firstResult.outcome, "fresh_completion");
  assert.deepEqual(firstResult.droppedEntities, expectedDroppedEntities);
  assert.equal(secondResult.outcome, "idempotent_replay");
  assert.deepEqual(secondResult.droppedEntities, expectedDroppedEntities);
  assert.deepEqual(state.guestUpgradeHistory[0]?.dropped_entities, expectedDroppedEntities);

  assert.equal(state.cards.some((card) => card.workspace_id === guestWorkspaceId), false);
  assert.equal(state.decks.some((deck) => deck.workspace_id === guestWorkspaceId), false);
  assert.equal(state.reviewEvents.some((reviewEvent) => reviewEvent.workspace_id === guestWorkspaceId), false);

  const keptTargetCard = state.cards.find((card) => (
    card.workspace_id === targetWorkspaceId
    && card.card_id === mergedCardId
  ));
  assert.ok(keptTargetCard);
  assert.equal(keptTargetCard?.front_text, "Guest kept front");
  assert.equal(keptTargetCard?.back_text, "Guest kept back");

  const conflictingCards = state.cards.filter((card) => card.card_id === conflictingCardId);
  assert.equal(conflictingCards.length, 1);
  assert.equal(conflictingCards[0]?.workspace_id, thirdWorkspaceId);

  const conflictingDecks = state.decks.filter((deck) => deck.deck_id === conflictingDeckId);
  assert.equal(conflictingDecks.length, 1);
  assert.equal(conflictingDecks[0]?.workspace_id, thirdWorkspaceId);

  assert.equal(
    state.reviewEvents.some((reviewEvent) => (
      reviewEvent.workspace_id === targetWorkspaceId
      && reviewEvent.review_event_id === skippedReviewEventId
    )),
    false,
  );

  const keptTargetReviewEvent = state.reviewEvents.find((reviewEvent) => (
    reviewEvent.workspace_id === targetWorkspaceId
    && reviewEvent.review_event_id === mergedReviewEventId
  ));
  assert.ok(keptTargetReviewEvent);
  assert.equal(keptTargetReviewEvent?.card_id, mergedCardId);
  assert.equal(keptTargetReviewEvent?.rating, 3);

  const conflictingReviewEvents = state.reviewEvents.filter((reviewEvent) => (
    reviewEvent.review_event_id === conflictingReviewEventId
  ));
  assert.equal(conflictingReviewEvents.length, 1);
  assert.equal(conflictingReviewEvents[0]?.workspace_id, thirdWorkspaceId);
});

test("completeGuestUpgradeInExecutor rejects third-workspace global-id conflicts without droppedEntities support", async () => {
  const guestToken = "guest-token-third-workspace-unsupported";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-third-workspace-unsupported";
  const targetSubject = "cognito-subject-third-workspace-unsupported";
  const thirdUserId = "third-user";
  const thirdWorkspaceId = "third-workspace";
  const conflictingCardId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-third-workspace-unsupported",
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
  state.userSettings.set(
    thirdUserId,
    createUserSettingsState(thirdUserId, thirdWorkspaceId, "third@example.com"),
  );
  state.workspaces.set(
    thirdWorkspaceId,
    createWorkspaceState(
      thirdWorkspaceId,
      "Third workspace",
      "2026-04-02T13:30:00.000Z",
      "2026-04-02T13:30:00.000Z",
      "third-replica-existing",
      "third-op",
    ),
  );
  addWorkspaceMembership(state, thirdUserId, thirdWorkspaceId, "owner");
  state.cards.push({
    card_id: conflictingCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Guest conflicting front",
    back_text: "Guest conflicting back",
    tags: ["guest-conflict"],
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
    last_operation_id: "guest-conflicting-card-op",
    updated_at: "2026-04-02T14:00:03.000Z",
    deleted_at: null,
  });
  state.cards.push({
    card_id: conflictingCardId,
    workspace_id: thirdWorkspaceId,
    front_text: "Third workspace front",
    back_text: "Third workspace back",
    tags: ["third"],
    effort_level: "long",
    due_at: null,
    created_at: "2026-04-02T13:30:02.000Z",
    reps: 5,
    lapses: 1,
    fsrs_card_state: "review",
    fsrs_step_index: null,
    fsrs_stability: 3.5,
    fsrs_difficulty: 5.1,
    fsrs_last_reviewed_at: "2026-04-01T13:30:00.000Z",
    fsrs_scheduled_days: 4,
    client_updated_at: "2026-04-02T13:30:03.000Z",
    last_modified_by_replica_id: "third-replica-existing",
    last_operation_id: "third-card-op",
    updated_at: "2026-04-02T13:30:03.000Z",
    deleted_at: null,
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
      DROPPED_ENTITIES_UNSUPPORTED,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "GUEST_UPGRADE_DROPPED_ENTITIES_UNSUPPORTED");
      assert.equal(error.message.includes(thirdWorkspaceId), false);
      assert.deepEqual(error.details?.syncConflict, {
        phase: "guest_upgrade_merge",
        entityType: "card",
        entityId: conflictingCardId,
        conflictingWorkspaceId: thirdWorkspaceId,
        constraint: null,
        sqlState: null,
        table: null,
        recoverable: true,
      });
      return true;
    },
  );

  assert.equal(state.guestUpgradeHistory.length, 0);
  assert.equal(state.guestSession?.revoked_at, null);
  assert.equal(
    state.cards.some((card) => (
      card.workspace_id === targetWorkspaceId
      && card.card_id === conflictingCardId
    )),
    false,
  );
});

test("completeGuestUpgradeInExecutor aborts when a conflict still points at the source guest workspace after cleanup", async () => {
  const guestToken = "guest-token-source-conflict";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica-source-conflict";
  const installationId = "installation-source-conflict";
  const targetSubject = "cognito-subject-source-conflict";
  const conflictingCardId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-source-conflict",
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
    card_id: conflictingCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Guest source front",
    back_text: "Guest source back",
    tags: ["guest-source"],
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
    last_operation_id: "guest-source-card-op",
    updated_at: "2026-04-02T14:00:03.000Z",
    deleted_at: null,
  });

  const baseExecutor = createGuestUpgradeExecutor(state);
  const executor: DatabaseExecutor = {
    query: async (text, params) => {
      if (text === "DELETE FROM content.cards WHERE workspace_id = $1") {
        return createQueryResult([]);
      }

      return baseExecutor.query(text, params);
    },
  };

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      targetSubject,
      {
        type: "existing",
        workspaceId: targetWorkspaceId,
      },
      DROPPED_ENTITIES_UNSUPPORTED,
    ),
    (error: unknown) => (
      error instanceof Error
      && error.message
        === "Guest merge cleanup invariant failed for card dddddddd-dddd-4ddd-8ddd-dddddddddddd: "
          + "source workspace guest-workspace still owns the conflicting id after cleanup"
    ),
  );

  assert.equal(
    state.cards.some((card) => (
      card.workspace_id === targetWorkspaceId
      && card.card_id === conflictingCardId
    )),
    false,
  );
  assert.equal(state.cards.filter((card) => card.card_id === conflictingCardId).length, 1);
  assert.equal(state.cards[0]?.workspace_id, guestWorkspaceId);
  assert.equal(state.guestSession?.revoked_at, null);
  assert.equal(state.workspaces.has(guestWorkspaceId), true);
});

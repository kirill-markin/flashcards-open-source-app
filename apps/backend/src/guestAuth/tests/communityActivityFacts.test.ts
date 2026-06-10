import assert from "node:assert/strict";
import test from "node:test";
import { completeGuestUpgradeInExecutor } from "..";
import {
  createGuestUpgradeExecutor,
  createMergeState,
  DROPPED_ENTITIES_UNSUPPORTED,
} from "../../guestAuthTestHarness";

test("completeGuestUpgradeInExecutor reattaches guest review activity facts to the linked account", async () => {
  const guestToken = "guest-token-activity-facts";
  const guestUserId = "guest-user-activity-facts";
  const guestWorkspaceId = "guest-workspace-activity-facts";
  const targetUserId = "linked-user-activity-facts";
  const targetWorkspaceId = "target-workspace-activity-facts";
  const guestReplicaId = "guest-replica-activity-facts";
  const installationId = "installation-activity-facts";
  const targetSubject = "cognito-subject-activity-facts";
  const cardId = "aaaa1111-1111-4111-8111-111111111111";
  const reviewEventId = "bbbb2222-2222-4222-8222-222222222222";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-activity-facts",
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
    card_id: cardId,
    workspace_id: guestWorkspaceId,
    front_text: "Guest front",
    back_text: "Guest back",
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
  state.reviewEvents.push({
    review_event_id: reviewEventId,
    workspace_id: guestWorkspaceId,
    card_id: cardId,
    replica_id: guestReplicaId,
    client_event_id: "guest-client-event-activity-facts",
    rating: 2,
    reviewed_at_client: "2026-04-02T14:00:04.000Z",
    reviewed_at_server: "2026-04-02T14:00:04.000Z",
  });
  // The guest already had a stable opaque identity and an activity fact for the
  // review before linking, pointing at the throwaway guest public profile.
  state.publicProfiles.push({
    user_id: guestUserId,
    public_profile_id: "guest-public-profile-id",
    leaderboard_participation_enabled: true,
  });
  state.publicReviewActivityFacts.push({
    review_event_id: reviewEventId,
    metric_version: "qualified_reviews_v1",
    public_profile_id: "guest-public-profile-id",
    reviewed_by_user_id: guestUserId,
    rating: 2,
    reviewed_at_client: "2026-04-02T14:00:04.000Z",
    reviewed_at_server: "2026-04-02T14:00:04.000Z",
    is_countable: true,
    exclusion_reason: null,
  });

  const executor = createGuestUpgradeExecutor(state);
  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    { type: "existing", workspaceId: targetWorkspaceId },
    DROPPED_ENTITIES_UNSUPPORTED,
  );

  assert.equal(result.outcome, "fresh_completion");
  assert.equal(result.targetUserId, targetUserId);

  // The rewritten review event carries immutable authorship for the linked account.
  const targetReviewEvent = state.reviewEvents.find(
    (reviewEvent) => reviewEvent.workspace_id === targetWorkspaceId && reviewEvent.review_event_id === reviewEventId,
  );
  assert.ok(targetReviewEvent);
  assert.equal(targetReviewEvent?.reviewed_by_user_id, targetUserId);

  const targetProfile = state.publicProfiles.find((profile) => profile.user_id === targetUserId);
  assert.ok(targetProfile, "the linked account has a public profile after upgrade");
  // The guest's stable opaque identity is preserved and now belongs to the linked
  // account (transferred ahead of the merge), not replaced by a throwaway new one.
  assert.equal(targetProfile?.public_profile_id, "guest-public-profile-id");
  assert.equal(state.publicProfiles.some((profile) => profile.user_id === guestUserId), false);

  const factsForReview = state.publicReviewActivityFacts.filter(
    (fact) => fact.review_event_id === reviewEventId,
  );
  assert.equal(factsForReview.length, 1);
  const fact = factsForReview[0];
  assert.equal(fact?.metric_version, "qualified_reviews_v1");
  assert.equal(fact?.reviewed_by_user_id, targetUserId);
  // The fact is reattached to the preserved community identity, now owned by the account.
  assert.equal(fact?.public_profile_id, "guest-public-profile-id");
  assert.equal(fact?.is_countable, true);
  assert.equal(fact?.exclusion_reason, null);
});

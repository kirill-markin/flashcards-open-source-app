import { unsafeTransaction } from "../database/unsafe";
import { unsafeTransactionReportingContentCreations } from "../productAnalytics/contentCreations";
import {
  deriveServerDerivedProductAnalyticsEventId,
  emitServerDerivedProductAnalyticsEvent,
  linkServerDerivedProductAnalyticsIdentity,
} from "../productAnalytics/serverEvents";
import {
  deleteGuestSessionInExecutor,
} from "./delete/index";
import {
  linkGuestAnalyticsIdentityInExecutor,
} from "./identityLink/index";
import {
  authenticateGuestSession,
  bindGuestSessionPlatform,
  createGuestSessionInExecutor,
} from "./session/index";
import {
  completeGuestUpgradeInExecutor,
  prepareGuestUpgradeInExecutor,
} from "./upgrade/index";
import type {
  GuestUpgradeCompleteCapabilities,
  GuestSessionPlatform,
  GuestSessionSnapshot,
  GuestUpgradeCompletion,
  GuestUpgradePreparation,
  GuestUpgradeSelection,
} from "./types";

export type {
  GuestUpgradeCompleteCapabilities,
  GuestSessionPlatform,
  GuestSessionSnapshot,
  GuestUpgradeCompletion,
  GuestUpgradePreparation,
  GuestUpgradeSelection,
} from "./types";

export {
  authenticateGuestSession,
  bindGuestSessionPlatform,
  completeGuestUpgradeInExecutor,
  deleteGuestSessionInExecutor,
  linkGuestAnalyticsIdentityInExecutor,
  prepareGuestUpgradeInExecutor,
};

export async function createGuestSession(
  platform: GuestSessionPlatform | null,
  creationIdempotencyKey: string | null,
): Promise<GuestSessionSnapshot> {
  return unsafeTransaction(
    async (executor) => createGuestSessionInExecutor(executor, platform, creationIdempotencyKey),
  );
}

export async function linkGuestAnalyticsIdentity(
  guestToken: string,
  cognitoSubject: string,
): Promise<void> {
  return unsafeTransaction(
    async (executor) => linkGuestAnalyticsIdentityInExecutor(executor, guestToken, cognitoSubject),
  );
}

export async function prepareGuestUpgrade(
  guestToken: string,
  cognitoSubject: string,
  email: string | null,
): Promise<GuestUpgradePreparation> {
  return unsafeTransaction(
    async (executor) => prepareGuestUpgradeInExecutor(executor, guestToken, cognitoSubject, email),
  );
}

/**
 * Records one completed guest upgrade for product analytics.
 *
 * Runs only after the upgrade transaction committed. The analytics writer commits on its own pool,
 * so emitting from inside the upgrade transaction would leave a permanent event and a permanent
 * identity link behind an upgrade that then rolled back. Neither can be taken back:
 * analytics.product_events is append-only, and analytics.product_events_resolved attributes a guest
 * to the earliest link on its id, so a link from an upgrade that never happened would silently
 * misattribute that guest's whole history if the guest later upgraded into a different account.
 * Keeping the writes out here also keeps the Cognito identity lifecycle lock and both users'
 * org.user_settings row locks from being held across the analytics connection acquisitions.
 *
 * Only a fresh completion is recorded: an idempotent replay returns an upgrade that already
 * happened. That gate is not enough on its own, because the same-user bound path never revokes the
 * guest session and returns a fresh completion again on every repeat of
 * POST /guest-auth/upgrade/complete, so a client retry after a timeout would report a second
 * conversion that never took place. The event id is therefore derived from the guest session id,
 * which is stable across retries on both the bound and the merge path, and the writer drops the
 * replay on the event_id conflict.
 *
 * Both writes are best effort, so a failing analytics database never fails an upgrade that is
 * already committed. On the merge path neither is ever retried, because the guest session is
 * revoked by the time this runs and any repeat of POST /guest-auth/upgrade/complete returns an
 * idempotent replay that never reaches this producer again. The identity link is therefore written
 * first. A lost event costs one row of a conversion metric, while a lost link leaves that guest's
 * whole pre-upgrade history resolving to the guest id instead of the account, so the link is the
 * write that should survive when only one of the two does. That path also records
 * auth.guest_upgrade_history, whose source_guest_user_id, target_user_id and source_guest_session_id
 * reconstruct either write afterwards; docs/analytics-db-access.md documents that route.
 *
 * A bound completion records no history row and writes no link, since the guest user id is already
 * the account id. Its repeat does reach this producer again, and the event id derived from the guest
 * session id is the only thing that keeps the conversion counted once.
 */
async function recordGuestUpgradeCompletedAnalytics(
  completion: GuestUpgradeCompletion,
): Promise<void> {
  // The bound path keeps the guest user id as the account id, so the guest's earlier events already
  // resolve to this account and a link would map the identity to itself.
  if (completion.guestUserId !== completion.targetUserId) {
    // The client's own anonymous_id is not known here, so the link is keyed on the guest user id
    // that the guest's events carried as subject_user_id. analytics.product_events_resolved reads
    // that shape as well as the anonymous_id shape an authenticated ingest request writes, and a
    // guest-transport request writes the guest user id into user_id and subject_user_id alike, so
    // this one link resolves the guest's client events and the events the backend emitted for that
    // guest.
    await linkServerDerivedProductAnalyticsIdentity({
      anonymousId: completion.guestUserId,
      userId: completion.targetUserId,
    });
  }

  // The upgrade is observed as it happens, so the two timestamps are one moment and there is no
  // skew to keep recoverable.
  const observedAt = new Date();
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId(
      "guest_upgrade_completed",
      [completion.guestSessionId],
    ),
    eventName: "guest_upgrade_completed",
    occurredAt: observedAt,
    serverReceivedAt: observedAt,
    userId: completion.targetUserId,
    // The guest identity the client's earlier events already carried, so the row names both sides of
    // the upgrade on its own.
    subjectUserId: completion.guestUserId,
    guestSessionId: completion.guestSessionId,
    workspaceId: completion.targetWorkspaceId,
    // auth.guest_sessions.platform would supply this from a server-stored source, but this path
    // does not read the session row and reporting the platform of upgrades is not what this change
    // is for; a producer that starts reading it may fill this in.
    platform: null,
    properties: {},
    details: null,
  });
}

export async function completeGuestUpgrade(
  guestToken: string,
  cognitoSubject: string,
  selection: GuestUpgradeSelection,
  capabilities: GuestUpgradeCompleteCapabilities,
): Promise<GuestUpgradeCompletion> {
  const completion = await unsafeTransactionReportingContentCreations(
    async (executor) => completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      cognitoSubject,
      selection,
      capabilities,
    ),
    // The merge re-creates the guest's cards and decks inside the target workspace, under the target
    // scope, so the account that adopted them is the actor on those rows and not the guest that
    // wrote them offline. For a card the guest had already created through the sync API that is
    // invisible: the creation is keyed on the card id alone, so the merge's emission conflicts with
    // the guest's original row and the fact keeps the guest identity, which resolves to the account
    // through the upgrade link. It is only visible for a card that entered the guest workspace
    // without ever being reported as created - a catalog install - where the merge is the first and
    // only creation this stream ever sees for that card, and attributing it to the account that kept
    // it is the intended answer.
    (result) => result.targetUserId,
  );
  if (completion.outcome === "fresh_completion") {
    await recordGuestUpgradeCompletedAnalytics(completion);
  }

  return completion;
}

export async function deleteGuestSession(guestToken: string): Promise<void> {
  return unsafeTransaction(async (executor) => deleteGuestSessionInExecutor(executor, guestToken));
}

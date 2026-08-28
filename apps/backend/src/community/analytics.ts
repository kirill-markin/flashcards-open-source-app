import {
  deriveServerDerivedProductAnalyticsEventId,
  emitServerDerivedProductAnalyticsEvent,
} from "../productAnalytics/serverEvents";

export type FriendInvitationCreatedFact = Readonly<{
  friendInvitationId: string;
  inviterUserId: string;
  // community.friend_invitations.created_at.
  createdAt: Date;
}>;

export type FriendshipCreatedFact = Readonly<{
  friendInvitationId: string;
  inviterUserId: string;
  accepterUserId: string;
  // community.friendships.created_at. One statement inserts both directed rows, so this single
  // reading dates both of the events below.
  createdAt: Date;
}>;

/**
 * Reports one friend invite link the inviter created.
 *
 * Every create stores a new invitation row with a fresh id, so a client that repeats the POST really
 * did create a second link and is counted twice. Deriving the id from that row is what keeps this
 * producer replay-safe instead: one invitation row can only ever produce one event id, and the
 * writer's ON CONFLICT (event_id) DO NOTHING turns any second attempt at the same row into nothing.
 */
export async function recordFriendInvitationCreatedAnalytics(
  invitation: FriendInvitationCreatedFact,
): Promise<void> {
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId(
      "friend_invitation_created",
      [invitation.friendInvitationId],
    ),
    eventName: "friend_invitation_created",
    // The row's own created_at is the moment the backend created it, so the two timestamps are one
    // moment and there is no skew to keep recoverable. Reading the Node clock for the second one
    // would file the difference between two machines' clocks as if it were skew.
    occurredAt: invitation.createdAt,
    serverReceivedAt: invitation.createdAt,
    userId: invitation.inviterUserId,
    // The routes take only signed-in human transport, so there is no guest identity behind this
    // fact that user_id does not already name.
    subjectUserId: null,
    guestSessionId: null,
    // community.friend_invitations is account-scoped and names no workspace.
    workspaceId: null,
    // No column the server stored names a device here. An invitation belongs to an account and not
    // to a workspace, so there is no sync.workspace_replicas row to read even carefully, and the
    // route rejects guest transport, so auth.guest_sessions — the one platform column that is safe
    // to read directly — has no row for this request either. The request headers do name a platform
    // and are a client claim this row must not repeat.
    platform: null,
    properties: {},
    details: null,
  });
}

/**
 * Reports one accepted invitation as the two directed community.friendships rows it inserted.
 *
 * Both people gained a friend and each of them sees that when looking only at their own events, so
 * the sum across users stays twice the number of pairs, which is what the admin dashboard's
 * cumulative friend-connections panel already counts off community.friendships.
 *
 * The inviter's row is the first event in this system attributed to somebody who did not make the
 * request. user_id is still a real account the backend resolved itself, so account deletion still
 * sweeps it by user_id like every other row.
 *
 * Ending a friendship emits nothing because the backend has no delete path for community.friendships
 * today, which makes that cumulative chart a running sum that stops being correct the day one is
 * added.
 */
export async function recordFriendshipCreatedAnalytics(
  friendship: FriendshipCreatedFact,
): Promise<void> {
  // The accepter first because the request is theirs. Each emission swallows its own failure, so the
  // inviter's event is still attempted when the accepter's write is the one that is lost.
  await emitFriendshipCreatedForViewer(friendship, friendship.accepterUserId);
  await emitFriendshipCreatedForViewer(friendship, friendship.inviterUserId);
}

async function emitFriendshipCreatedForViewer(
  friendship: FriendshipCreatedFact,
  viewerUserId: string,
): Promise<void> {
  await emitServerDerivedProductAnalyticsEvent({
    // One id per directed row. An invitation is single use and a repeat acceptance is refused, so
    // this producer is reached once per row; deriving the id from the row keeps that true for
    // anything that reconstructs the same rows later.
    eventId: deriveServerDerivedProductAnalyticsEventId(
      "friendship_created",
      [friendship.friendInvitationId, viewerUserId],
    ),
    eventName: "friendship_created",
    // The database dated both directed rows itself, so this is when the friendship happened and
    // when the backend learned of it alike.
    occurredAt: friendship.createdAt,
    serverReceivedAt: friendship.createdAt,
    userId: viewerUserId,
    subjectUserId: null,
    guestSessionId: null,
    // community.friendships is account-scoped and names no workspace.
    workspaceId: null,
    // Same derivation as the invitation above: no workspace and therefore no replica row, no guest
    // session on these routes, and the headers are a client claim. The inviter's row makes the point
    // twice over, because no client of theirs is involved in this moment at all.
    platform: null,
    properties: {},
    details: null,
  });
}

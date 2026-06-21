export type CommunityPublicProfile = Readonly<{
  publicProfileId: string;
  anonymousDisplayName: string;
  leaderboardParticipationEnabled: boolean;
  linkedAccountRequiredForLeaderboard: boolean;
}>;

export type CommunityProfilePatch = Readonly<{
  leaderboardParticipationEnabled: boolean;
}>;

export type FriendInvitationCreateRequest = Readonly<{
  inviteeDisplayName: string;
}>;

export type FriendInvitationCreateResponse = Readonly<{
  inviteUrl: string;
  expiresAt: string;
}>;

export type FriendInvitationPreviewResponse =
  | Readonly<{ status: "active"; expiresAt: string }>
  | Readonly<{ status: "inactive" }>;

export type FriendInvitationAcceptRequest = Readonly<{
  inviterDisplayName: string;
}>;

export type FriendInvitationAcceptResponse =
  | Readonly<{ status: "accepted" }>
  | Readonly<{ status: "already_friends"; existingFriendDisplayName: string }>
  | Readonly<{ status: "inactive" }>;

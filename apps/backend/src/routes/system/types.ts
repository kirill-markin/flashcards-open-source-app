import type { AccountPreferences } from "../../auth/ensureUser";
import type {
  FriendInvitationAcceptInput,
  FriendInvitationAcceptResponse,
  FriendInvitationCreateInput,
  FriendInvitationCreateResponse,
  FriendInvitationPreviewResponse,
} from "../../community/friendInvitations";
import type { PublicProfile } from "../../community/publicProfiles";
import type {
  loadProgressLeaderboard,
  loadStreakLeaderboard,
  loadUserProgressReviewSchedule,
  loadUserProgressSeries,
  loadUserProgressSummary,
} from "../../progress";
import type { loadRequestContextFromRequest } from "../../server/requestContext";

export type SystemRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  loadUserProgressReviewScheduleFn?: typeof loadUserProgressReviewSchedule;
  loadUserProgressSeriesFn?: typeof loadUserProgressSeries;
  loadUserProgressSummaryFn?: typeof loadUserProgressSummary;
  loadProgressLeaderboardFn?: typeof loadProgressLeaderboard;
  loadStreakLeaderboardFn?: typeof loadStreakLeaderboard;
  updateAccountPreferencesFn?: UpdateAccountPreferencesFn;
  ensurePublicProfileForUserFn?: EnsurePublicProfileForUserFn;
  updateLeaderboardParticipationFn?: UpdateLeaderboardParticipationFn;
  createFriendInvitationFn?: CreateFriendInvitationFn;
  previewFriendInvitationFn?: PreviewFriendInvitationFn;
  acceptFriendInvitationFn?: AcceptFriendInvitationFn;
}>;

export type ProgressRequestedParameters = Readonly<{
  timeZone: string | null;
  from: string | null;
  to: string | null;
}>;

export type UpdateAccountPreferencesFn = (
  userId: string,
  preferences: AccountPreferences,
) => Promise<AccountPreferences>;

export type EnsurePublicProfileForUserFn = (userId: string, localeHint: string) => Promise<PublicProfile>;

export type UpdateLeaderboardParticipationFn = (
  userId: string,
  leaderboardParticipationEnabled: boolean,
  localeHint: string,
) => Promise<PublicProfile>;

export type CreateFriendInvitationFn = (
  input: FriendInvitationCreateInput,
) => Promise<FriendInvitationCreateResponse>;

export type PreviewFriendInvitationFn = (
  rawInviteToken: string,
) => Promise<FriendInvitationPreviewResponse>;

export type AcceptFriendInvitationFn = (
  input: FriendInvitationAcceptInput,
) => Promise<FriendInvitationAcceptResponse>;

export type CommunityPublicProfileResponse = PublicProfile & Readonly<{
  linkedAccountRequiredForLeaderboard: boolean;
}>;

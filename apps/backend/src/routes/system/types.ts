import type { AccountPreferences, AnalyticsConsentChoice } from "../../auth/ensureUser";
import type {
  FriendInvitationAcceptInput,
  FriendInvitationAcceptResponse,
  FriendInvitationCreateInput,
  FriendInvitationCreateResponse,
  FriendInvitationPreviewResponse,
} from "../../community/friendInvitations";
import type { PublicProfile } from "../../community/publicProfiles";
import type {
  loadLeaderboardProfile,
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
  loadReviewPlatformSummaryFn?: LoadReviewPlatformSummaryFn;
  loadUserProgressReviewScheduleFn?: typeof loadUserProgressReviewSchedule;
  loadUserProgressSeriesFn?: typeof loadUserProgressSeries;
  loadUserProgressSummaryFn?: typeof loadUserProgressSummary;
  loadLeaderboardProfileFn?: typeof loadLeaderboardProfile;
  loadProgressLeaderboardFn?: typeof loadProgressLeaderboard;
  loadStreakLeaderboardFn?: typeof loadStreakLeaderboard;
  updateAccountPreferencesFn?: UpdateAccountPreferencesFn;
  updateGuestSessionAnalyticsConsentFn?: UpdateGuestSessionAnalyticsConsentFn;
  ensurePublicProfileForUserFn?: EnsurePublicProfileForUserFn;
  updateLeaderboardParticipationFn?: UpdateLeaderboardParticipationFn;
  createFriendInvitationFn?: CreateFriendInvitationFn;
  previewFriendInvitationFn?: PreviewFriendInvitationFn;
  acceptFriendInvitationFn?: AcceptFriendInvitationFn;
}>;

export type ReviewPlatformSummary = Readonly<{
  hasMobileReviewEvent: boolean;
}>;

export type LoadReviewPlatformSummaryFn = (userId: string) => Promise<ReviewPlatformSummary>;

export type ProgressRequestedParameters = Readonly<{
  timeZone: string | null;
  from: string | null;
  to: string | null;
}>;

/** One PATCH body: a field the request left out is null here and keeps its stored value. */
export type AccountPreferencesUpdate = Readonly<{
  reviewReactionAnimationsEnabled: boolean | null;
  analyticsConsent: AnalyticsConsentChoice | null;
}>;

export type UpdateAccountPreferencesFn = (
  userId: string,
  update: AccountPreferencesUpdate,
) => Promise<AccountPreferences>;

/** No null here, unlike above: an omitted field must leave the guest consent column untouched. */
export type UpdateGuestSessionAnalyticsConsentFn = (
  guestUserId: string,
  guestSessionId: string,
  analyticsConsent: AnalyticsConsentChoice,
) => Promise<AnalyticsConsentChoice>;

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

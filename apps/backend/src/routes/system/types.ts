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
  GuestSessionAnalyticsPreferencesUpdate,
  StoredGuestSessionAnalyticsPreferences,
} from "../../guestAuth/store/session";
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
  updateGuestSessionAnalyticsPreferencesFn?: UpdateGuestSessionAnalyticsPreferencesFn;
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

/**
 * Who asked for an analytics preference write.
 *
 * "user_action" is the person answering on the client that sends it. "reconciliation" is a client
 * carrying over an answer it read somewhere earlier, which nothing in the request can order against
 * the stored one: the device read the record before the write it would undo, and neither column has
 * a timestamp. A body that names no origin is "user_action", which is what every client sent before
 * this field existed.
 */
export type AnalyticsPreferenceWriteOrigin = "user_action" | "reconciliation";

/**
 * One PATCH body: a field the request left out is null here and keeps its stored value.
 *
 * The two origins are per column rather than one for the body, because the two columns answer
 * different questions (db/migrations/0149_product_analytics_off_switch.sql forbids deriving either
 * from the other) and one PATCH can carry a person's press on one and a reconciled answer on the
 * other. One shared origin would have to be wrong about one of them: "reconciliation" would refuse
 * a person's own switch, and "user_action" would let a stale answer through, which is the defect
 * this field exists to stop.
 */
export type AccountPreferencesUpdate = Readonly<{
  reviewReactionAnimationsEnabled: boolean | null;
  analyticsConsent: AnalyticsConsentChoice | null;
  analyticsConsentOrigin: AnalyticsPreferenceWriteOrigin;
  productAnalyticsEnabled: boolean | null;
  productAnalyticsEnabledOrigin: AnalyticsPreferenceWriteOrigin;
}>;

export type UpdateAccountPreferencesFn = (
  userId: string,
  update: AccountPreferencesUpdate,
) => Promise<AccountPreferences>;

/** No null here, unlike above: an omitted field must leave the guest consent column untouched. */
/**
 * Both guest-session analytics answers in one call, because they are stored in one transaction.
 * Null in the update is "the request left this field out" and is not written; null in the result is
 * the same field, reported as untouched rather than as an erasure.
 */
export type UpdateGuestSessionAnalyticsPreferencesFn = (
  guestUserId: string,
  guestSessionId: string,
  update: GuestSessionAnalyticsPreferencesUpdate,
) => Promise<StoredGuestSessionAnalyticsPreferences>;

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

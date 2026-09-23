import { parseFriendInvitationDisplayName } from "../../community/friendInvitations";
import {
  createBackendObservationScope,
  type BackendObservationScope,
} from "../../observability/sentry";
import { expectBoolean } from "../../server/requestParsing";
import { HttpError } from "../../shared/errors";
import type { AuthTransport } from "../../auth";
import type { AnalyticsConsentChoice } from "../../auth/ensureUser";
import type { AccountPreferencesUpdate, ProgressRequestedParameters } from "./types";

export function readRequestedProgressParameters(requestUrl: URL): ProgressRequestedParameters {
  return {
    timeZone: requestUrl.searchParams.get("timeZone"),
    from: requestUrl.searchParams.get("from"),
    to: requestUrl.searchParams.get("to"),
  };
}

export function assertProgressHumanTransport(transport: AuthTransport): void {
  if (transport === "api_key") {
    throw new HttpError(
      403,
      "This endpoint requires Guest, Bearer, or Session authentication",
      "PROGRESS_HUMAN_AUTH_REQUIRED",
    );
  }
}

export function assertReviewPlatformSummaryHumanTransport(transport: AuthTransport): void {
  if (transport === "api_key") {
    throw new HttpError(
      403,
      "This endpoint requires Guest, Bearer, or Session authentication",
      "REVIEW_PLATFORM_SUMMARY_HUMAN_AUTH_REQUIRED",
    );
  }
}

export function assertAccountPreferencesHumanTransport(transport: AuthTransport): void {
  if (transport !== "session" && transport !== "bearer" && transport !== "guest") {
    throw new HttpError(
      403,
      "This endpoint requires Guest, Bearer, or Session authentication",
      "ACCOUNT_PREFERENCES_HUMAN_AUTH_REQUIRED",
    );
  }
}

export function assertCommunityProfileHumanTransport(transport: AuthTransport): void {
  if (transport !== "session" && transport !== "bearer" && transport !== "guest") {
    throw new HttpError(
      403,
      "This endpoint requires Guest, Bearer, or Session authentication",
      "COMMUNITY_PROFILE_HUMAN_AUTH_REQUIRED",
    );
  }
}

export function assertFriendInvitationHumanTransport(transport: AuthTransport): void {
  if (transport !== "session" && transport !== "bearer" && transport !== "none") {
    throw new HttpError(
      403,
      "This endpoint requires signed-in human authentication",
      "FRIEND_INVITATION_HUMAN_AUTH_REQUIRED",
    );
  }
}

export function assertFriendInvitationPublicPreviewTransport(request: Request): void {
  const authorizationHeader = request.headers.get("authorization");
  if (authorizationHeader !== null && authorizationHeader.startsWith("ApiKey ")) {
    throw new HttpError(
      403,
      "Friend invitation preview does not support ApiKey authentication",
      "FRIEND_INVITATION_API_KEY_AUTH_UNSUPPORTED",
    );
  }
}

const accountPreferenceFieldNames: ReadonlyArray<string> = [
  "reviewReactionAnimationsEnabled",
  "analyticsConsent",
  "productAnalyticsEnabled",
];

/** Null is refused rather than accepted as an erasure: a withdrawn consent is "declined". */
function expectAnalyticsConsentChoice(value: unknown, fieldName: string): AnalyticsConsentChoice {
  if (value === "granted" || value === "declined") {
    return value;
  }

  throw new HttpError(400, `${fieldName} must be "granted" or "declined"`);
}

export function parseAccountPreferencesInput(body: Record<string, unknown>): AccountPreferencesUpdate {
  const unexpectedKey = Object.keys(body).find((key) => !accountPreferenceFieldNames.includes(key));
  if (unexpectedKey !== undefined) {
    throw new HttpError(
      400,
      `Unexpected preference field: ${unexpectedKey}`,
      "ACCOUNT_PREFERENCES_FIELD_UNKNOWN",
    );
  }

  const update: AccountPreferencesUpdate = {
    reviewReactionAnimationsEnabled: "reviewReactionAnimationsEnabled" in body
      ? expectBoolean(body.reviewReactionAnimationsEnabled, "reviewReactionAnimationsEnabled")
      : null,
    analyticsConsent: "analyticsConsent" in body
      ? expectAnalyticsConsentChoice(body.analyticsConsent, "analyticsConsent")
      : null,
    // expectBoolean refuses an explicit null, so switching the collection off is `false` and never
    // an erasure back to "never answered". A separate field from analyticsConsent on purpose: the
    // cookie decision and the analytics off switch are two different questions.
    productAnalyticsEnabled: "productAnalyticsEnabled" in body
      ? expectBoolean(body.productAnalyticsEnabled, "productAnalyticsEnabled")
      : null,
  };

  if (
    update.reviewReactionAnimationsEnabled === null
    && update.analyticsConsent === null
    && update.productAnalyticsEnabled === null
  ) {
    throw new HttpError(
      400,
      `At least one preference field is required: ${accountPreferenceFieldNames.join(", ")}`,
      "ACCOUNT_PREFERENCES_FIELD_REQUIRED",
    );
  }

  return update;
}

export function parseCommunityProfileInput(body: Record<string, unknown>): Readonly<{
  leaderboardParticipationEnabled: boolean;
}> {
  const unexpectedKey = Object.keys(body).find((key) => key !== "leaderboardParticipationEnabled");
  if (unexpectedKey !== undefined) {
    throw new HttpError(
      400,
      `Unexpected community profile field: ${unexpectedKey}`,
      "COMMUNITY_PROFILE_FIELD_UNKNOWN",
    );
  }

  return {
    leaderboardParticipationEnabled: expectBoolean(
      body.leaderboardParticipationEnabled,
      "leaderboardParticipationEnabled",
    ),
  };
}

export function parseFriendInvitationCreateInput(body: Record<string, unknown>): Readonly<{
  inviteeDisplayName: string;
}> {
  const unexpectedKey = Object.keys(body).find((key) => key !== "inviteeDisplayName");
  if (unexpectedKey !== undefined) {
    throw new HttpError(
      400,
      `Unexpected friend invitation field: ${unexpectedKey}`,
      "FRIEND_INVITATION_FIELD_UNKNOWN",
    );
  }

  return {
    inviteeDisplayName: parseFriendInvitationDisplayName(body.inviteeDisplayName, "inviteeDisplayName"),
  };
}

export function parseFriendInvitationAcceptInput(body: Record<string, unknown>): Readonly<{
  inviterDisplayName: string;
}> {
  const unexpectedKey = Object.keys(body).find((key) => key !== "inviterDisplayName");
  if (unexpectedKey !== undefined) {
    throw new HttpError(
      400,
      `Unexpected friend invitation field: ${unexpectedKey}`,
      "FRIEND_INVITATION_FIELD_UNKNOWN",
    );
  }

  return {
    inviterDisplayName: parseFriendInvitationDisplayName(body.inviterDisplayName, "inviterDisplayName"),
  };
}

export function parseInviteTokenParam(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new HttpError(
      400,
      "inviteToken is required",
      "FRIEND_INVITATION_TOKEN_REQUIRED",
    );
  }

  return value;
}

export function createSystemScope(
  requestId: string,
  route: string,
  method: string,
  userId: string,
  clientAppVersion: string | null,
  clientPlatform: string | null,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    userId,
    null,
    null,
    null,
    null,
    clientAppVersion,
    clientPlatform,
  );
}

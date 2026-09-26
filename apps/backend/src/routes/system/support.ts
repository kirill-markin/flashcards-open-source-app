import { parseFriendInvitationDisplayName } from "../../community/friendInvitations";
import {
  createBackendObservationScope,
  type BackendObservationScope,
} from "../../observability/sentry";
import { expectBoolean } from "../../server/requestParsing";
import { HttpError } from "../../shared/errors";
import type { AuthTransport } from "../../auth";
import type { AnalyticsConsentChoice } from "../../auth/ensureUser";
import type {
  AccountPreferencesUpdate,
  AnalyticsPreferenceWriteOrigin,
  ProgressRequestedParameters,
} from "./types";

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

export function assertAiUsageHumanTransport(transport: AuthTransport): void {
  if (transport !== "session" && transport !== "bearer" && transport !== "guest") {
    throw new HttpError(
      403,
      "This endpoint requires Guest, Bearer, or Session authentication",
      "AI_USAGE_HUMAN_AUTH_REQUIRED",
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
  "accentColor",
  "reviewReactionAnimationsEnabled",
  "analyticsConsent",
  "productAnalyticsEnabled",
];

/**
 * Not preferences: each says who asked for the value beside it, and stores nothing of its own.
 *
 * Kept out of the list above so the "at least one preference field is required" check still means
 * what it says - a body carrying only origins writes nothing and is refused as empty - and so the
 * error naming the writable fields does not offer these two as things to write.
 */
const accountPreferencesRequestFieldNames: ReadonlyArray<string> = [
  ...accountPreferenceFieldNames,
  "analyticsConsentOrigin",
  "productAnalyticsEnabledOrigin",
];

function expectAnalyticsPreferenceWriteOrigin(
  value: unknown,
  fieldName: string,
): AnalyticsPreferenceWriteOrigin {
  if (value === "user_action" || value === "reconciliation") {
    return value;
  }

  throw new HttpError(400, `${fieldName} must be "user_action" or "reconciliation"`);
}

/** Null is refused rather than accepted as an erasure: a withdrawn consent is "declined". */
function expectAnalyticsConsentChoice(value: unknown, fieldName: string): AnalyticsConsentChoice {
  if (value === "granted" || value === "declined") {
    return value;
  }

  throw new HttpError(400, `${fieldName} must be "granted" or "declined"`);
}

function expectAccentColor(value: unknown): string {
  if (typeof value !== "string" || value.length !== 7 || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new HttpError(400, "accentColor must be an opaque RGB color in #RRGGBB format");
  }

  return value.toUpperCase();
}

export function parseAccountPreferencesInput(body: Record<string, unknown>): AccountPreferencesUpdate {
  const unexpectedKey = Object.keys(body).find(
    (key) => !accountPreferencesRequestFieldNames.includes(key),
  );
  if (unexpectedKey !== undefined) {
    throw new HttpError(
      400,
      `Unexpected preference field: ${unexpectedKey}`,
      "ACCOUNT_PREFERENCES_FIELD_UNKNOWN",
    );
  }

  const update: AccountPreferencesUpdate = {
    accentColor: "accentColor" in body ? expectAccentColor(body.accentColor) : null,
    reviewReactionAnimationsEnabled: "reviewReactionAnimationsEnabled" in body
      ? expectBoolean(body.reviewReactionAnimationsEnabled, "reviewReactionAnimationsEnabled")
      : null,
    analyticsConsent: "analyticsConsent" in body
      ? expectAnalyticsConsentChoice(body.analyticsConsent, "analyticsConsent")
      : null,
    // Defaulted rather than required, so a client that never heard of the field keeps the behaviour
    // it was written against: its write is the person's and overwrites whatever is stored.
    analyticsConsentOrigin: "analyticsConsentOrigin" in body
      ? expectAnalyticsPreferenceWriteOrigin(body.analyticsConsentOrigin, "analyticsConsentOrigin")
      : "user_action",
    // expectBoolean refuses an explicit null, so switching the collection off is `false` and never
    // an erasure back to "never answered". A separate field from analyticsConsent on purpose: the
    // cookie decision and the analytics off switch are two different questions.
    productAnalyticsEnabled: "productAnalyticsEnabled" in body
      ? expectBoolean(body.productAnalyticsEnabled, "productAnalyticsEnabled")
      : null,
    productAnalyticsEnabledOrigin: "productAnalyticsEnabledOrigin" in body
      ? expectAnalyticsPreferenceWriteOrigin(
        body.productAnalyticsEnabledOrigin,
        "productAnalyticsEnabledOrigin",
      )
      : "user_action",
  };

  if (
    update.accentColor === null
    && update.reviewReactionAnimationsEnabled === null
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

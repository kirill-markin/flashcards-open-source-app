import { parseFriendInvitationDisplayName } from "../../community/friendInvitations";
import {
  createBackendObservationScope,
  type BackendObservationScope,
} from "../../observability/sentry";
import { expectBoolean } from "../../server/requestParsing";
import { HttpError } from "../../shared/errors";
import type { AuthTransport } from "../../auth";
import type { AccountPreferences } from "../../auth/ensureUser";
import type { ProgressRequestedParameters } from "./types";

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

export function parseAccountPreferencesInput(body: Record<string, unknown>): AccountPreferences {
  const unexpectedKey = Object.keys(body).find((key) => key !== "reviewReactionAnimationsEnabled");
  if (unexpectedKey !== undefined) {
    throw new HttpError(
      400,
      `Unexpected preference field: ${unexpectedKey}`,
      "ACCOUNT_PREFERENCES_FIELD_UNKNOWN",
    );
  }

  return {
    reviewReactionAnimationsEnabled: expectBoolean(
      body.reviewReactionAnimationsEnabled,
      "reviewReactionAnimationsEnabled",
    ),
  };
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
  );
}

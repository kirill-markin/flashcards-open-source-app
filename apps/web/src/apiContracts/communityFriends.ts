import type {
  FriendInvitationAcceptResponse,
  FriendInvitationCreateResponse,
  FriendInvitationPreviewResponse,
} from "../types";
import {
  parseEnum,
  parseObject,
  parseRequiredField,
  parseString,
} from "./core";

export function parseFriendInvitationCreateResponse(
  value: unknown,
  endpoint: string,
): FriendInvitationCreateResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    inviteUrl: parseRequiredField(objectValue, "inviteUrl", endpoint, "", parseString),
    expiresAt: parseRequiredField(objectValue, "expiresAt", endpoint, "", parseString),
  };
}

export function parseFriendInvitationPreviewResponse(
  value: unknown,
  endpoint: string,
): FriendInvitationPreviewResponse {
  const objectValue = parseObject(value, endpoint, "");
  const status = parseRequiredField(
    objectValue,
    "status",
    endpoint,
    "",
    (statusValue, statusEndpoint, statusPath) => parseEnum(statusValue, statusEndpoint, statusPath, ["active", "inactive"] as const),
  );

  if (status === "inactive") {
    return { status: "inactive" };
  }

  return {
    status,
    expiresAt: parseRequiredField(objectValue, "expiresAt", endpoint, "", parseString),
  };
}

export function parseFriendInvitationAcceptResponse(
  value: unknown,
  endpoint: string,
): FriendInvitationAcceptResponse {
  const objectValue = parseObject(value, endpoint, "");
  const status = parseRequiredField(
    objectValue,
    "status",
    endpoint,
    "",
    (statusValue, statusEndpoint, statusPath) => parseEnum(statusValue, statusEndpoint, statusPath, ["accepted", "already_friends", "inactive"] as const),
  );

  if (status === "inactive" || status === "accepted") {
    return { status };
  }

  return {
    status,
    existingFriendDisplayName: parseRequiredField(
      objectValue,
      "existingFriendDisplayName",
      endpoint,
      "",
      parseString,
    ),
  };
}

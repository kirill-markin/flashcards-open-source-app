import {
  parseFriendInvitationAcceptResponse,
  parseFriendInvitationCreateResponse,
  parseFriendInvitationPreviewResponse,
} from "../../apiContracts/communityFriends";
import type {
  FriendInvitationAcceptRequest,
  FriendInvitationAcceptResponse,
  FriendInvitationCreateRequest,
  FriendInvitationCreateResponse,
  FriendInvitationPreviewResponse,
} from "../../types";
import { parseContractResponse } from "../transport/response";
import {
  allowAuthRecovery,
  requestJson,
  skipAuthRecoveryWithTransientNetworkRetry,
} from "../transport/transport";

function encodeInviteToken(inviteToken: string): string {
  return encodeURIComponent(inviteToken);
}

export async function createFriendInvitation(
  request: FriendInvitationCreateRequest,
): Promise<FriendInvitationCreateResponse> {
  return parseContractResponse(
    await requestJson("/me/community/friend-invitations", {
      method: "POST",
      body: JSON.stringify(request),
    }, allowAuthRecovery),
    "POST /me/community/friend-invitations",
    parseFriendInvitationCreateResponse,
  );
}

export async function previewFriendInvitation(inviteToken: string): Promise<FriendInvitationPreviewResponse> {
  const encodedInviteToken = encodeInviteToken(inviteToken);
  return parseContractResponse(
    await requestJson(`/community/friend-invitations/${encodedInviteToken}`, {
      method: "GET",
    }, skipAuthRecoveryWithTransientNetworkRetry),
    `GET /community/friend-invitations/${encodedInviteToken}`,
    parseFriendInvitationPreviewResponse,
  );
}

export async function acceptFriendInvitation(
  inviteToken: string,
  request: FriendInvitationAcceptRequest,
): Promise<FriendInvitationAcceptResponse> {
  const encodedInviteToken = encodeInviteToken(inviteToken);
  return parseContractResponse(
    await requestJson(`/me/community/friend-invitations/${encodedInviteToken}/accept`, {
      method: "POST",
      body: JSON.stringify(request),
    }, allowAuthRecovery),
    `POST /me/community/friend-invitations/${encodedInviteToken}/accept`,
    parseFriendInvitationAcceptResponse,
  );
}

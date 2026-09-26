import {
  parseAgentApiKeyConnectionsEnvelopeResponse,
  parseAgentApiKeyCreateResponse,
  parseAgentApiKeyRevokeResponse,
  parseAccountPreferencesEnvelopeResponse,
  parseCommunityPublicProfileResponse,
  parseDeleteAccountResponse,
} from "../../apiContracts/account";
import type {
  AccountPreferencesEnvelope,
  AccountPreferencesUpdate,
  AgentApiKeyConnection,
  AgentApiKeyConnectionsResponse,
  AgentApiKeyCreateResponse,
  AgentApiKeyRevokeResponse,
  CommunityProfilePatch,
  CommunityPublicProfile,
} from "../../types";
import { parseContractResponse } from "../transport/response";
import { allowAuthRecovery, requestJson } from "../transport/transport";

const collectionPageLimit = 100;

export async function listAgentApiKeys(): Promise<AgentApiKeyConnectionsResponse> {
  const connections: Array<AgentApiKeyConnection> = [];
  let instructions = "";
  let nextCursor: string | null = null;

  do {
    const searchParams = new URLSearchParams({
      limit: String(collectionPageLimit),
    });
    if (nextCursor !== null) {
      searchParams.set("cursor", nextCursor);
    }

    const payload = parseContractResponse(
      await requestJson(`/agent-api-keys?${searchParams.toString()}`, { method: "GET" }, allowAuthRecovery),
      "GET /agent-api-keys",
      parseAgentApiKeyConnectionsEnvelopeResponse,
    );
    connections.push(...payload.connections);
    instructions = payload.instructions;
    nextCursor = payload.nextCursor;
  } while (nextCursor !== null);

  return {
    connections,
    instructions,
  };
}

export async function createAgentApiKey(label: string): Promise<AgentApiKeyCreateResponse> {
  return parseContractResponse(
    await requestJson("/agent-api-keys", {
      method: "POST",
      body: JSON.stringify({ label }),
    }, allowAuthRecovery),
    "POST /agent-api-keys",
    parseAgentApiKeyCreateResponse,
  );
}

export async function revokeAgentApiKey(connectionId: string): Promise<AgentApiKeyRevokeResponse> {
  return parseContractResponse(
    await requestJson(`/agent-api-keys/${connectionId}/revoke`, { method: "POST" }, allowAuthRecovery),
    `POST /agent-api-keys/${connectionId}/revoke`,
    parseAgentApiKeyRevokeResponse,
  );
}

/** Writes only the fields the caller names; anything it leaves out keeps its stored value. */
export async function updateAccountPreferences(
  request: AccountPreferencesUpdate,
  identity?: Readonly<{ userId: string; signal: AbortSignal }>,
): Promise<AccountPreferencesEnvelope> {
  return parseContractResponse(await requestJson("/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(request),
    signal: identity?.signal,
  }, { ...allowAuthRecovery, expectedUserId: identity?.userId ?? null }), "PATCH /me/preferences", parseAccountPreferencesEnvelopeResponse);
}

export async function loadCommunityProfile(): Promise<CommunityPublicProfile> {
  return parseContractResponse(await requestJson("/me/community/profile", {
    method: "GET",
  }, allowAuthRecovery), "GET /me/community/profile", parseCommunityPublicProfileResponse);
}

export async function updateCommunityProfile(
  request: CommunityProfilePatch,
): Promise<CommunityPublicProfile> {
  return parseContractResponse(await requestJson("/me/community/profile", {
    method: "PATCH",
    body: JSON.stringify(request),
  }, allowAuthRecovery), "PATCH /me/community/profile", parseCommunityPublicProfileResponse);
}

export async function deleteMyAccount(confirmationText: string): Promise<Readonly<{ ok: true }>> {
  return parseContractResponse(await requestJson("/me/delete", {
    method: "POST",
    body: JSON.stringify({
      confirmationText,
    }),
  }, allowAuthRecovery), "POST /me/delete", parseDeleteAccountResponse);
}

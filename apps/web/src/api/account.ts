import {
  parseAgentApiKeyConnectionsEnvelopeResponse,
  parseAgentApiKeyRevokeResponse,
  parseDeleteAccountResponse,
} from "../apiContracts/account";
import type {
  AgentApiKeyConnection,
  AgentApiKeyConnectionsResponse,
  AgentApiKeyRevokeResponse,
} from "../types";
import { parseContractResponse } from "./response";
import { allowAuthRecovery, requestJson } from "./transport";

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

export async function revokeAgentApiKey(connectionId: string): Promise<AgentApiKeyRevokeResponse> {
  return parseContractResponse(
    await requestJson(`/agent-api-keys/${connectionId}/revoke`, { method: "POST" }, allowAuthRecovery),
    `POST /agent-api-keys/${connectionId}/revoke`,
    parseAgentApiKeyRevokeResponse,
  );
}

export async function deleteMyAccount(confirmationText: string): Promise<Readonly<{ ok: true }>> {
  return parseContractResponse(await requestJson("/me/delete", {
    method: "POST",
    body: JSON.stringify({
      confirmationText,
    }),
  }, allowAuthRecovery), "POST /me/delete", parseDeleteAccountResponse);
}

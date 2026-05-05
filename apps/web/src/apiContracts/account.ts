import type {
  AgentApiKeyConnection,
  DeleteWorkspaceResponse,
  ResetWorkspaceProgressResponse,
  SessionInfo,
  WorkspaceDeletePreview,
  WorkspaceResetProgressPreview,
  WorkspaceSummary,
} from "../types";
import {
  parseArray,
  parseBoolean,
  parseLiteral,
  parseNullableString,
  parseNumber,
  parseObject,
  parseRequiredField,
  parseString,
} from "./core";

export type WorkspacesEnvelope = Readonly<{
  workspaces: ReadonlyArray<WorkspaceSummary>;
  nextCursor: string | null;
}>;

export type WorkspaceEnvelope = Readonly<{
  workspace: WorkspaceSummary;
}>;

export type AgentApiKeyConnectionsEnvelope = Readonly<{
  connections: ReadonlyArray<AgentApiKeyConnection>;
  instructions: string;
  nextCursor: string | null;
}>;

function parseWorkspaceSummary(value: unknown, endpoint: string, path: string): WorkspaceSummary {
  const objectValue = parseObject(value, endpoint, path);
  return {
    workspaceId: parseRequiredField(objectValue, "workspaceId", endpoint, path, parseString),
    name: parseRequiredField(objectValue, "name", endpoint, path, parseString),
    createdAt: parseRequiredField(objectValue, "createdAt", endpoint, path, parseString),
    isSelected: parseRequiredField(objectValue, "isSelected", endpoint, path, parseBoolean),
  };
}

function parseWorkspaceSummaryArray(value: unknown, endpoint: string, path: string): ReadonlyArray<WorkspaceSummary> {
  return parseArray(value, endpoint, path, parseWorkspaceSummary);
}

function parseAgentApiKeyConnection(value: unknown, endpoint: string, path: string): AgentApiKeyConnection {
  const objectValue = parseObject(value, endpoint, path);
  return {
    connectionId: parseRequiredField(objectValue, "connectionId", endpoint, path, parseString),
    label: parseRequiredField(objectValue, "label", endpoint, path, parseString),
    createdAt: parseRequiredField(objectValue, "createdAt", endpoint, path, parseString),
    lastUsedAt: parseRequiredField(objectValue, "lastUsedAt", endpoint, path, parseNullableString),
    revokedAt: parseRequiredField(objectValue, "revokedAt", endpoint, path, parseNullableString),
  };
}

function parseAgentApiKeyConnectionArray(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<AgentApiKeyConnection> {
  return parseArray(value, endpoint, path, parseAgentApiKeyConnection);
}

export function parseSessionInfoResponse(value: unknown, endpoint: string): SessionInfo {
  const objectValue = parseObject(value, endpoint, "");
  const profileValue = parseRequiredField(objectValue, "profile", endpoint, "", parseObject);

  return {
    userId: parseRequiredField(objectValue, "userId", endpoint, "", parseString),
    selectedWorkspaceId: parseRequiredField(objectValue, "selectedWorkspaceId", endpoint, "", parseNullableString),
    authTransport: parseRequiredField(objectValue, "authTransport", endpoint, "", parseString),
    csrfToken: parseRequiredField(objectValue, "csrfToken", endpoint, "", parseNullableString),
    profile: {
      email: parseRequiredField(profileValue, "email", endpoint, "profile", parseNullableString),
      locale: parseRequiredField(profileValue, "locale", endpoint, "profile", parseString),
      createdAt: parseRequiredField(profileValue, "createdAt", endpoint, "profile", parseString),
    },
  };
}

export function parseWorkspaceEnvelopeResponse(value: unknown, endpoint: string): WorkspaceEnvelope {
  const objectValue = parseObject(value, endpoint, "");
  return {
    workspace: parseRequiredField(objectValue, "workspace", endpoint, "", parseWorkspaceSummary),
  };
}

export function parseWorkspacesEnvelopeResponse(value: unknown, endpoint: string): WorkspacesEnvelope {
  const objectValue = parseObject(value, endpoint, "");
  return {
    workspaces: parseRequiredField(objectValue, "workspaces", endpoint, "", parseWorkspaceSummaryArray),
    nextCursor: parseRequiredField(objectValue, "nextCursor", endpoint, "", parseNullableString),
  };
}

export function parseWorkspaceDeletePreviewResponse(value: unknown, endpoint: string): WorkspaceDeletePreview {
  const objectValue = parseObject(value, endpoint, "");
  return {
    workspaceId: parseRequiredField(objectValue, "workspaceId", endpoint, "", parseString),
    workspaceName: parseRequiredField(objectValue, "workspaceName", endpoint, "", parseString),
    activeCardCount: parseRequiredField(objectValue, "activeCardCount", endpoint, "", parseNumber),
    confirmationText: parseRequiredField(objectValue, "confirmationText", endpoint, "", parseString),
    isLastAccessibleWorkspace: parseRequiredField(objectValue, "isLastAccessibleWorkspace", endpoint, "", parseBoolean),
  };
}

export function parseDeleteWorkspaceResponse(value: unknown, endpoint: string): DeleteWorkspaceResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    ok: parseLiteral(parseRequiredField(objectValue, "ok", endpoint, "", parseBoolean), endpoint, "ok", true),
    deletedWorkspaceId: parseRequiredField(objectValue, "deletedWorkspaceId", endpoint, "", parseString),
    deletedCardsCount: parseRequiredField(objectValue, "deletedCardsCount", endpoint, "", parseNumber),
    workspace: parseRequiredField(objectValue, "workspace", endpoint, "", parseWorkspaceSummary),
  };
}

export function parseWorkspaceResetProgressPreviewResponse(
  value: unknown,
  endpoint: string,
): WorkspaceResetProgressPreview {
  const objectValue = parseObject(value, endpoint, "");
  return {
    workspaceId: parseRequiredField(objectValue, "workspaceId", endpoint, "", parseString),
    workspaceName: parseRequiredField(objectValue, "workspaceName", endpoint, "", parseString),
    cardsToResetCount: parseRequiredField(objectValue, "cardsToResetCount", endpoint, "", parseNumber),
    confirmationText: parseRequiredField(objectValue, "confirmationText", endpoint, "", parseString),
  };
}

export function parseResetWorkspaceProgressResponse(
  value: unknown,
  endpoint: string,
): ResetWorkspaceProgressResponse {
  const objectValue = parseObject(value, endpoint, "");
  return {
    ok: parseLiteral(parseRequiredField(objectValue, "ok", endpoint, "", parseBoolean), endpoint, "ok", true),
    workspaceId: parseRequiredField(objectValue, "workspaceId", endpoint, "", parseString),
    cardsResetCount: parseRequiredField(objectValue, "cardsResetCount", endpoint, "", parseNumber),
  };
}

export function parseAgentApiKeyConnectionsEnvelopeResponse(
  value: unknown,
  endpoint: string,
): AgentApiKeyConnectionsEnvelope {
  const objectValue = parseObject(value, endpoint, "");
  return {
    connections: parseRequiredField(objectValue, "connections", endpoint, "", parseAgentApiKeyConnectionArray),
    instructions: parseRequiredField(objectValue, "instructions", endpoint, "", parseString),
    nextCursor: parseRequiredField(objectValue, "nextCursor", endpoint, "", parseNullableString),
  };
}

export function parseAgentApiKeyRevokeResponse(value: unknown, endpoint: string): Readonly<{
  ok: true;
  connection: AgentApiKeyConnection;
  instructions: string;
}> {
  const objectValue = parseObject(value, endpoint, "");
  return {
    ok: parseLiteral(parseRequiredField(objectValue, "ok", endpoint, "", parseBoolean), endpoint, "ok", true),
    connection: parseRequiredField(objectValue, "connection", endpoint, "", parseAgentApiKeyConnection),
    instructions: parseRequiredField(objectValue, "instructions", endpoint, "", parseString),
  };
}

export function parseDeleteAccountResponse(value: unknown, endpoint: string): Readonly<{ ok: true }> {
  const objectValue = parseObject(value, endpoint, "");
  return {
    ok: parseLiteral(parseRequiredField(objectValue, "ok", endpoint, "", parseBoolean), endpoint, "ok", true),
  };
}

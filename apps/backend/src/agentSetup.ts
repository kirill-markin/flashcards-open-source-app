import type { AgentApiKeyConnection } from "./agentApiKeys";
import {
  createAgentEnvelope,
  createAgentErrorEnvelope,
  type AgentEnvelope,
  type AgentErrorEnvelope,
} from "./agentEnvelope";
import type { AuthTransport } from "./auth";
import type { HttpErrorDetails } from "./errors";
import { getPublicApiBaseUrl } from "./publicUrls";
import type { RequestContext } from "./server/requestContext";
import type { WorkspaceSummary } from "./workspaces";

type AccountData = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
  authTransport: AuthTransport;
  profile: Readonly<{
    email: string | null;
    locale: string;
    createdAt: string;
  }>;
}>;

type WorkspacesData = Readonly<{
  workspaces: ReadonlyArray<WorkspaceSummary>;
  nextCursor: string | null;
}>;

type WorkspaceData = Readonly<{
  workspace: WorkspaceSummary;
}>;

function buildPermissionGuidanceLine(): string {
  return "For routine low-risk writes, a clear user request already counts as permission. Ask again only for risky or unclear actions.";
}

function buildAccountBootstrapInstructions(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return [
    `Next call GET ${apiBaseUrl}/agent/workspaces?limit=100 to inspect available workspaces for this API key.`,
    `If data.nextCursor is not null, continue with the same endpoint and cursor=data.nextCursor until it becomes null.`,
    `If no workspace is selected, call POST ${apiBaseUrl}/agent/workspaces/{workspaceId}/select.`,
    `If no workspace exists, create one with POST ${apiBaseUrl}/agent/workspaces using {"name":"Personal"}.`,
    `After a workspace is selected, use POST ${apiBaseUrl}/agent/sql for reads, writes, and SQL introspection.`,
    buildPermissionGuidanceLine(),
    "If you need more than 100 writes, split the work into multiple batches of at most 100 records across separate SQL statements or separate tool calls.",
    "Read payload from data.* and use docs.openapiUrl for the full contract.",
  ].join(" ");
}

function buildNoWorkspaceInstructions(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return [
    `No workspace is currently available for this API key.`,
    `Create one with POST ${apiBaseUrl}/agent/workspaces using {"name":"Personal"}.`,
    `After the workspace is created, use POST ${apiBaseUrl}/agent/sql for reads, writes, and SQL introspection.`,
    buildPermissionGuidanceLine(),
    "If you need more than 100 writes, split the work into multiple batches of at most 100 records across separate SQL statements or separate tool calls.",
    "Read payload from data.* and use docs.openapiUrl for the full contract.",
  ].join(" ");
}

function buildSelectWorkspaceInstructions(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return [
    `Select a workspace with POST ${apiBaseUrl}/agent/workspaces/{workspaceId}/select.`,
    `If data.nextCursor is not null, continue listing with GET ${apiBaseUrl}/agent/workspaces?limit=100 and cursor=data.nextCursor until it becomes null.`,
    `After a workspace is selected, use POST ${apiBaseUrl}/agent/sql for reads, writes, and SQL introspection.`,
    buildPermissionGuidanceLine(),
    "If you need more than 100 writes, split the work into multiple batches of at most 100 records across separate SQL statements or separate tool calls.",
    "Read payload from data.* and use docs.openapiUrl for the full contract.",
  ].join(" ");
}

function buildWorkspaceReadyInstructions(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return [
    `Workspace bootstrap is complete.`,
    `Use POST ${apiBaseUrl}/agent/sql for reads, writes, and SQL introspection.`,
    `Start discovery with SHOW TABLES or DESCRIBE cards when helpful.`,
    buildPermissionGuidanceLine(),
    "This endpoint accepts the published SQL dialect, not full PostgreSQL.",
    "SELECT returns at most 100 rows per statement, and INSERT, UPDATE, and DELETE may affect at most 100 rows per statement.",
    "If you need more than 100 writes, split the work into multiple batches of at most 100 records across separate SQL statements or separate tool calls.",
    "Read payload from data.* and use docs.openapiUrl for the full contract.",
  ].join(" ");
}

export function shouldUseAgentSetupEnvelope(transport: AuthTransport): boolean {
  return transport === "api_key";
}

export function createAgentAccountEnvelope(
  requestUrl: string,
  requestContext: RequestContext,
): AgentEnvelope<AccountData> {
  return createAgentEnvelope(
    requestUrl,
    {
      userId: requestContext.userId,
      selectedWorkspaceId: requestContext.selectedWorkspaceId,
      authTransport: requestContext.transport,
      profile: {
        email: requestContext.email,
        locale: requestContext.locale,
        createdAt: requestContext.userSettingsCreatedAt,
      },
    },
    buildAccountBootstrapInstructions(requestUrl),
  );
}

export function createAgentWorkspacesEnvelope(
  requestUrl: string,
  workspaces: ReadonlyArray<WorkspaceSummary>,
  nextCursor: string | null,
): AgentEnvelope<WorkspacesData> {
  if (workspaces.length === 0 && nextCursor === null) {
    return createAgentEnvelope(
      requestUrl,
      { workspaces, nextCursor },
      buildNoWorkspaceInstructions(requestUrl),
    );
  }

  if (workspaces.some((workspace) => workspace.isSelected)) {
    return createAgentEnvelope(
      requestUrl,
      { workspaces, nextCursor },
      buildWorkspaceReadyInstructions(requestUrl),
    );
  }

  return createAgentEnvelope(
    requestUrl,
    { workspaces, nextCursor },
    buildSelectWorkspaceInstructions(requestUrl),
  );
}

export function createAgentWorkspaceReadyEnvelope(
  requestUrl: string,
  workspace: WorkspaceSummary,
): AgentEnvelope<WorkspaceData> {
  return createAgentEnvelope(
    requestUrl,
    { workspace },
    buildWorkspaceReadyInstructions(requestUrl),
  );
}

export function createAgentSetupErrorEnvelope(
  requestUrl: string,
  code: string,
  message: string,
  instructions: string,
  requestId?: string,
  details?: HttpErrorDetails,
): AgentErrorEnvelope {
  return createAgentErrorEnvelope(requestUrl, code, message, instructions, requestId, details);
}

export type AgentConnectionListEnvelope = Readonly<{
  connections: ReadonlyArray<AgentApiKeyConnection>;
  instructions: string;
}>;

export function createAgentConnectionListEnvelope(
  connections: ReadonlyArray<AgentApiKeyConnection>,
): AgentConnectionListEnvelope {
  return {
    connections,
    instructions: "These are the current long-lived bot connections for this account. Revoking a connection invalidates its API key immediately.",
  };
}

export type AgentConnectionRevokeEnvelope = Readonly<{
  ok: true;
  connection: AgentApiKeyConnection;
  instructions: string;
}>;

export type AgentConnectionManagementErrorEnvelope = Readonly<{
  ok: false;
  error: Readonly<{
    code: string;
    message: string;
  }>;
  instructions: string;
  requestId?: string;
}>;

export function createAgentConnectionManagementErrorEnvelope(
  code: string,
  message: string,
  instructions: string,
  requestId?: string,
): AgentConnectionManagementErrorEnvelope {
  return {
    ok: false,
    error: {
      code,
      message,
    },
    instructions,
    requestId,
  };
}

export function createAgentConnectionRevokeEnvelope(connection: AgentApiKeyConnection): AgentConnectionRevokeEnvelope {
  return {
    ok: true,
    connection,
    instructions: "This bot connection has been revoked. Its API key is no longer valid for future requests.",
  };
}

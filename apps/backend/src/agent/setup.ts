import type { AgentApiKeyConnection } from "./apiKeys";
import {
  createAgentEnvelope,
  createAgentErrorEnvelope,
  type AgentEnvelope,
  type AgentErrorEnvelope,
} from "./envelope";
import { ensureAgentSyncReplica } from "./syncIdentity";
import {
  MAX_SQL_BATCH_STATEMENT_COUNT,
  MAX_SQL_RECORD_LIMIT,
} from "../aiTools/toolContract/sqlToolLimits";
import type { AuthTransport } from "../auth";
import type { PublicHttpErrorDetails } from "../shared/errors";
import { getPublicApiBaseUrl } from "../shared/publicUrls";
import type { RequestContext } from "../server/requestContext";
import type { WorkspaceSummary } from "../workspaces";

type AccountData = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
  agentWorkspaceReplicaId: string | null;
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

function buildBulkWriteSplitLine(): string {
  return `Bulk-write split arithmetic: at most ${MAX_SQL_RECORD_LIMIT} rows affected per statement, at most ${MAX_SQL_BATCH_STATEMENT_COUNT} statements per batch, and a batch must not mix read and write statements. Split larger work across separate statements or separate requests.`;
}

function buildMediaDiscoveryGuidanceLine(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return `Use GET ${apiBaseUrl}/agent for the full media-capable discovery surface, including workspace-scoped image ingestion, multipart upload session, part URL, complete, abort, metadata, and download URL templates. Before creating a media asset, call GET ${apiBaseUrl}/agent/me after workspace selection and use data.agentWorkspaceReplicaId as lastModifiedByReplicaId.`;
}

function buildAccountBootstrapInstructions(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return [
    `Next call GET ${apiBaseUrl}/agent/workspaces?limit=100 to inspect available workspaces for this API key.`,
    `If data.nextCursor is not null, continue with the same endpoint and cursor=data.nextCursor until it becomes null.`,
    `If no workspace is selected, call POST ${apiBaseUrl}/agent/workspaces/{workspaceId}/select.`,
    `If no workspace exists, create one with POST ${apiBaseUrl}/agent/workspaces using {"name":"Personal"}.`,
    `After a workspace is selected, use POST ${apiBaseUrl}/agent/sql/query for reads and SQL introspection and POST ${apiBaseUrl}/agent/sql/execute for writes.`,
    buildMediaDiscoveryGuidanceLine(requestUrl),
    buildPermissionGuidanceLine(),
    buildBulkWriteSplitLine(),
    "Read payload from data.* and use docs.openapiUrl for the published external agent contract.",
  ].join(" ");
}

function buildNoWorkspaceInstructions(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return [
    `No workspace is currently available for this API key.`,
    `Create one with POST ${apiBaseUrl}/agent/workspaces using {"name":"Personal"}.`,
    `After the workspace is created, use POST ${apiBaseUrl}/agent/sql/query for reads and SQL introspection and POST ${apiBaseUrl}/agent/sql/execute for writes.`,
    buildMediaDiscoveryGuidanceLine(requestUrl),
    buildPermissionGuidanceLine(),
    buildBulkWriteSplitLine(),
    "Read payload from data.* and use docs.openapiUrl for the published external agent contract.",
  ].join(" ");
}

function buildSelectWorkspaceInstructions(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return [
    `Select a workspace with POST ${apiBaseUrl}/agent/workspaces/{workspaceId}/select.`,
    `If data.nextCursor is not null, continue listing with GET ${apiBaseUrl}/agent/workspaces?limit=100 and cursor=data.nextCursor until it becomes null.`,
    `After a workspace is selected, use POST ${apiBaseUrl}/agent/sql/query for reads and SQL introspection and POST ${apiBaseUrl}/agent/sql/execute for writes.`,
    buildMediaDiscoveryGuidanceLine(requestUrl),
    buildPermissionGuidanceLine(),
    buildBulkWriteSplitLine(),
    "Read payload from data.* and use docs.openapiUrl for the published external agent contract.",
  ].join(" ");
}

function buildWorkspaceReadyInstructions(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return [
    `Workspace bootstrap is complete.`,
    `Use POST ${apiBaseUrl}/agent/sql/query for reads and SQL introspection and POST ${apiBaseUrl}/agent/sql/execute for writes.`,
    `Start discovery with SHOW TABLES or DESCRIBE cards through POST ${apiBaseUrl}/agent/sql/query when helpful.`,
    buildMediaDiscoveryGuidanceLine(requestUrl),
    buildPermissionGuidanceLine(),
    "This endpoint accepts the published SQL dialect, not full PostgreSQL.",
    `SELECT returns at most ${MAX_SQL_RECORD_LIMIT} rows per statement.`,
    buildBulkWriteSplitLine(),
    "Read payload from data.* and use docs.openapiUrl for the published external agent contract.",
  ].join(" ");
}

export function shouldUseAgentSetupEnvelope(transport: AuthTransport): boolean {
  return transport === "api_key";
}

export async function loadAgentWorkspaceReplicaIdForSetup(requestContext: RequestContext): Promise<string | null> {
  if (requestContext.transport !== "api_key" || requestContext.selectedWorkspaceId === null) {
    return null;
  }

  if (requestContext.connectionId === null) {
    throw new Error("API key request context is missing connectionId");
  }

  return ensureAgentSyncReplica(
    requestContext.selectedWorkspaceId,
    requestContext.userId,
    requestContext.connectionId,
  );
}

export function createAgentAccountEnvelope(
  requestUrl: string,
  requestContext: RequestContext,
  agentWorkspaceReplicaId: string | null,
): AgentEnvelope<AccountData> {
  return createAgentEnvelope(
    requestUrl,
    {
      userId: requestContext.userId,
      selectedWorkspaceId: requestContext.selectedWorkspaceId,
      agentWorkspaceReplicaId,
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
  details?: PublicHttpErrorDetails,
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

export type AgentConnectionCreateEnvelope = Readonly<{
  ok: true;
  apiKey: string;
  connection: AgentApiKeyConnection;
  instructions: string;
}>;

export function createAgentConnectionCreateEnvelope(
  apiKey: string,
  connection: AgentApiKeyConnection,
): AgentConnectionCreateEnvelope {
  return {
    ok: true,
    apiKey,
    connection,
    instructions: "Store this API key now. It is shown only once and cannot be retrieved again; if you lose it, revoke this connection and create a new one.",
  };
}

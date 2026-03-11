import type { AgentApiKeyConnection } from "./agentApiKeys";
import {
  createAgentCreateWorkspaceAction,
  createAgentEnvelope,
  createAgentErrorEnvelope,
  createAgentListToolsAction,
  createAgentListWorkspacesAction,
  createAgentOpenApiAction,
  createAgentSelectWorkspaceAction,
  createAgentToolAction,
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
}>;

type WorkspaceData = Readonly<{
  workspace: WorkspaceSummary;
}>;

function buildWorkspaceReadyActions(requestUrl: string) {
  return [
    createAgentListToolsAction(requestUrl),
    createAgentToolAction(requestUrl, "get_workspace_context"),
    createAgentToolAction(requestUrl, "search_cards"),
    createAgentToolAction(requestUrl, "create_cards"),
  ] as const;
}

function buildAccountBootstrapInstructions(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return [
    `Call GET ${apiBaseUrl}/agent/me to load account context.`,
    `Then call GET ${apiBaseUrl}/agent/workspaces to inspect available workspaces for this API key.`,
    `If needed, create with POST ${apiBaseUrl}/agent/workspaces or select with POST ${apiBaseUrl}/agent/workspaces/{workspaceId}/select before tool calls.`,
    "Read payload from data.* and do not expect resource fields at the top level.",
    "Select the next endpoint from instructions and confirm it with actions.",
  ].join(" ");
}

function buildNoWorkspaceInstructions(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return `No workspace is available for this API key yet. Create one with POST ${apiBaseUrl}/agent/workspaces using {\"name\":\"Personal\"}, then continue with tools. Read payload from data.* and do not expect resource fields at the top level. Select the next endpoint from instructions and confirm it with actions.`;
}

function buildSelectWorkspaceInstructions(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return `Select a workspace for this API key by calling POST ${apiBaseUrl}/agent/workspaces/{workspaceId}/select after listing with GET ${apiBaseUrl}/agent/workspaces. Read payload from data.* and do not expect resource fields at the top level. Select the next endpoint from instructions and confirm it with actions.`;
}

function buildWorkspaceReadyInstructions(requestUrl: string): string {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  return `Workspace bootstrap is complete. Call GET ${apiBaseUrl}/agent/tools and then POST ${apiBaseUrl}/agent/tools/get_workspace_context to continue. Read payload from data.* and do not expect resource fields at the top level. Select the next endpoint from instructions and confirm it with actions.`;
}

export function shouldUseAgentSetupEnvelope(transport: AuthTransport): boolean {
  return transport === "api_key";
}

/**
 * Returns the authenticated account context plus the next recommended action
 * for an ApiKey-based external AI agent.
 */
export function createAgentAccountEnvelope(
  requestUrl: string,
  requestContext: RequestContext,
): AgentEnvelope<AccountData> {
  const actions = [createAgentListWorkspacesAction(requestUrl)];

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
    actions,
    buildAccountBootstrapInstructions(requestUrl),
  );
}

/**
 * Guides an ApiKey-authenticated external AI agent toward creating or
 * selecting a workspace before calling tool endpoints.
 */
export function createAgentWorkspacesEnvelope(
  requestUrl: string,
  workspaces: ReadonlyArray<WorkspaceSummary>,
): AgentEnvelope<WorkspacesData> {
  if (workspaces.length === 0) {
    const actions = [createAgentCreateWorkspaceAction(requestUrl)];
    return createAgentEnvelope(
      requestUrl,
      { workspaces },
      actions,
      buildNoWorkspaceInstructions(requestUrl),
    );
  }

  if (workspaces.length === 1 || workspaces.some((workspace) => workspace.isSelected)) {
    const actions = buildWorkspaceReadyActions(requestUrl);
    return createAgentEnvelope(
      requestUrl,
      { workspaces },
      actions,
      buildWorkspaceReadyInstructions(requestUrl),
    );
  }

  const actions = [createAgentSelectWorkspaceAction(requestUrl)];
  return createAgentEnvelope(
    requestUrl,
    { workspaces },
    actions,
    buildSelectWorkspaceInstructions(requestUrl),
  );
}

/**
 * Confirms that workspace bootstrap is complete and points the external AI
 * agent at the compact tool surface.
 */
export function createAgentWorkspaceReadyEnvelope(
  requestUrl: string,
  workspace: WorkspaceSummary,
): AgentEnvelope<WorkspaceData> {
  const actions = buildWorkspaceReadyActions(requestUrl);

  return createAgentEnvelope(
    requestUrl,
    { workspace },
    actions,
    buildWorkspaceReadyInstructions(requestUrl),
  );
}

/**
 * Builds a deterministic error payload for ApiKey-authenticated bootstrap and
 * tool onboarding requests.
 */
export function createAgentSetupErrorEnvelope(
  requestUrl: string,
  code: string,
  message: string,
  instructions: string,
  requestId?: string,
  details?: HttpErrorDetails,
): AgentErrorEnvelope {
  const actions = code === "WORKSPACE_SELECTION_REQUIRED"
    ? [createAgentListWorkspacesAction(requestUrl), createAgentSelectWorkspaceAction(requestUrl)]
    : code === "AGENT_TOOL_INPUT_INVALID"
      ? [createAgentListToolsAction(requestUrl), createAgentOpenApiAction(requestUrl)]
      : [];

  return createAgentErrorEnvelope(requestUrl, code, message, instructions, requestId, details, actions);
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

export function createAgentConnectionRevokeEnvelope(connection: AgentApiKeyConnection): AgentConnectionRevokeEnvelope {
  return {
    ok: true,
    connection,
    instructions: "This bot connection has been revoked. Its API key is no longer valid for future requests.",
  };
}

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

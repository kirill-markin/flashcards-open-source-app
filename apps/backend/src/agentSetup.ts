import type { AgentApiKeyConnection } from "./agentApiKeys";
import {
  buildAgentNextStepsInstructions,
  createAgentCreateWorkspaceAction,
  createAgentEnvelope,
  createAgentErrorEnvelope,
  createAgentListToolsAction,
  createAgentListWorkspacesAction,
  createAgentSelectWorkspaceAction,
  createAgentToolAction,
  type AgentEnvelope,
  type AgentErrorEnvelope,
} from "./agentEnvelope";
import type { AuthTransport } from "./auth";
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
    buildAgentNextStepsInstructions(actions),
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
      buildAgentNextStepsInstructions(actions),
    );
  }

  if (workspaces.length === 1 || workspaces.some((workspace) => workspace.isSelected)) {
    const actions = buildWorkspaceReadyActions(requestUrl);
    return createAgentEnvelope(
      requestUrl,
      { workspaces },
      actions,
      buildAgentNextStepsInstructions(actions),
    );
  }

  const actions = [createAgentSelectWorkspaceAction(requestUrl)];
  return createAgentEnvelope(
    requestUrl,
    { workspaces },
    actions,
    buildAgentNextStepsInstructions(actions),
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
    buildAgentNextStepsInstructions(actions),
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
): AgentErrorEnvelope {
  return createAgentErrorEnvelope(requestUrl, code, message, instructions, requestId);
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

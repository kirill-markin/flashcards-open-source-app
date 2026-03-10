import type { AgentApiKeyConnection } from "./agentApiKeys";
import type { AuthTransport } from "./auth";
import type { RequestContext } from "./server/requestContext";
import type { WorkspaceSummary } from "./workspaces";

/**
 * Small agent-facing setup envelope builders. The shape stays intentionally
 * narrow so terminal clients can follow the next step without a generic
 * hypermedia implementation.
 */
export type AgentSetupAction = Readonly<{
  name: "load_account" | "list_workspaces" | "create_workspace" | "select_workspace";
  method: "GET" | "POST";
  url?: string;
  urlTemplate?: string;
  input?: Readonly<{
    required?: ReadonlyArray<string>;
  }>;
  auth?: Readonly<{
    scheme: "ApiKey";
  }>;
}>;

export type AgentSetupEnvelope<Data> = Readonly<{
  ok: true;
  data: Data;
  actions: ReadonlyArray<AgentSetupAction>;
  instructions: string;
}>;

export type AgentSetupErrorEnvelope = Readonly<{
  ok: false;
  data: Record<string, never>;
  actions: ReadonlyArray<AgentSetupAction>;
  instructions: string;
  error: Readonly<{
    code: string;
    message: string;
  }>;
  requestId?: string;
}>;

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

function buildApiBaseUrl(): string {
  const configuredBaseUrl = process.env.PUBLIC_API_BASE_URL;
  if (configuredBaseUrl !== undefined && configuredBaseUrl !== "") {
    return configuredBaseUrl.endsWith("/") ? configuredBaseUrl.slice(0, -1) : configuredBaseUrl;
  }

  return "http://localhost:8080/v1";
}

function createEnvelope<Data>(
  data: Data,
  actions: ReadonlyArray<AgentSetupAction>,
  instructions: string,
): AgentSetupEnvelope<Data> {
  return {
    ok: true,
    data,
    actions,
    instructions,
  };
}

function createErrorEnvelope(
  code: string,
  message: string,
  instructions: string,
  requestId?: string,
): AgentSetupErrorEnvelope {
  return {
    ok: false,
    data: {},
    actions: [],
    instructions,
    error: {
      code,
      message,
    },
    requestId,
  };
}

export function shouldUseAgentSetupEnvelope(transport: AuthTransport): boolean {
  return transport === "api_key";
}

/**
 * Returns the authenticated account context plus the next recommended action
 * for an ApiKey-based terminal client.
 */
export function createAgentAccountEnvelope(requestContext: RequestContext): AgentSetupEnvelope<AccountData> {
  const apiBaseUrl = buildApiBaseUrl();
  return createEnvelope(
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
    [{
      name: "list_workspaces",
      method: "GET",
      url: `${apiBaseUrl}/workspaces`,
      auth: {
        scheme: "ApiKey",
      },
    }],
    "Authentication succeeded. Next, call list_workspaces to load the user's workspaces. If none exist, create one. If several exist, select the correct one before using workspace-scoped actions.",
  );
}

/**
 * Guides a newly authenticated terminal client toward creating or selecting a
 * workspace before it starts workspace-scoped actions.
 */
export function createAgentWorkspacesEnvelope(workspaces: ReadonlyArray<WorkspaceSummary>): AgentSetupEnvelope<WorkspacesData> {
  const apiBaseUrl = buildApiBaseUrl();
  if (workspaces.length === 0) {
    return createEnvelope(
      { workspaces },
      [{
        name: "create_workspace",
        method: "POST",
        url: `${apiBaseUrl}/workspaces`,
        auth: {
          scheme: "ApiKey",
        },
        input: {
          required: ["name"],
        },
      }],
      "No workspaces exist yet. Create the first workspace with create_workspace and provide a human-readable workspace name.",
    );
  }

  if (workspaces.length === 1 || workspaces.some((workspace) => workspace.isSelected)) {
    return createEnvelope(
      { workspaces },
      [],
      "A workspace is already available and selected. You can now use workspace-scoped endpoints and the chat endpoint.",
    );
  }

  return createEnvelope(
    { workspaces },
    [{
      name: "select_workspace",
      method: "POST",
      urlTemplate: `${apiBaseUrl}/workspaces/{workspaceId}/select`,
      auth: {
        scheme: "ApiKey",
      },
      input: {
        required: ["workspaceId"],
      },
    }],
    "Multiple workspaces exist. Select the correct one with select_workspace before using workspace-scoped endpoints.",
  );
}

/**
 * Confirms that workspace bootstrap is complete and no more setup action is
 * required before card or chat operations.
 */
export function createAgentWorkspaceReadyEnvelope(workspace: WorkspaceSummary): AgentSetupEnvelope<WorkspaceData> {
  return createEnvelope(
    { workspace },
    [],
    "The workspace is ready. You can now search cards, create cards, create decks, and use AI chat with this account.",
  );
}

/**
 * Builds a deterministic error payload for ApiKey-authenticated setup and
 * workspace bootstrap requests.
 */
export function createAgentSetupErrorEnvelope(
  code: string,
  message: string,
  instructions: string,
  requestId?: string,
): AgentSetupErrorEnvelope {
  return createErrorEnvelope(code, message, instructions, requestId);
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

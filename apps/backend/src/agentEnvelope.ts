import type { ExternalAgentToolDefinition, ExternalAgentToolName } from "./externalAgentTools";
import { EXTERNAL_AGENT_TOOL_DEFINITIONS } from "./externalAgentTools";
import { getPublicAgentDocs, getPublicApiBaseUrl } from "./publicUrls";

export type AgentActionName =
  | "openapi"
  | "list_tools"
  | "load_account"
  | "list_workspaces"
  | "create_workspace"
  | "select_workspace"
  | ExternalAgentToolName;

export type AgentAction = Readonly<{
  name: AgentActionName;
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

export type AgentDocs = Readonly<{
  openapiUrl: string;
  swaggerUrl: string;
}>;

export type AgentEnvelope<Data> = Readonly<{
  ok: true;
  data: Data;
  actions: ReadonlyArray<AgentAction>;
  instructions: string;
  docs: AgentDocs;
}>;

export type AgentErrorEnvelope = Readonly<{
  ok: false;
  data: Record<string, never>;
  actions: ReadonlyArray<AgentAction>;
  instructions: string;
  docs: AgentDocs;
  error: Readonly<{
    code: string;
    message: string;
  }>;
  requestId?: string;
}>;

export type AgentToolCatalogItem = Readonly<{
  name: ExternalAgentToolName;
  method: "POST";
  url: string;
  description: string;
}>;

const API_KEY_AUTH = Object.freeze({
  scheme: "ApiKey",
} satisfies Readonly<{ scheme: "ApiKey" }>);

/**
 * Builds one absolute agent-tool URL list from the public API base. The
 * external AI-agent contract stays intentionally compact and excludes shared
 * first-party transport endpoints.
 */
export function buildAgentToolCatalog(requestUrl: string): ReadonlyArray<AgentToolCatalogItem> {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);

  return EXTERNAL_AGENT_TOOL_DEFINITIONS.map((tool): AgentToolCatalogItem => ({
    name: tool.name,
    method: "POST",
    url: `${apiBaseUrl}/agent/tools/${tool.name}`,
    description: tool.description,
  }));
}

export function createAgentEnvelope<Data>(
  requestUrl: string,
  data: Data,
  actions: ReadonlyArray<AgentAction>,
  instructions: string,
): AgentEnvelope<Data> {
  return {
    ok: true,
    data,
    actions,
    instructions,
    docs: getPublicAgentDocs(requestUrl),
  };
}

export function createAgentErrorEnvelope(
  requestUrl: string,
  code: string,
  message: string,
  instructions: string,
  requestId?: string,
): AgentErrorEnvelope {
  return {
    ok: false,
    data: {},
    actions: [],
    instructions,
    docs: getPublicAgentDocs(requestUrl),
    error: {
      code,
      message,
    },
    requestId,
  };
}

export function createAgentOpenApiAction(requestUrl: string): AgentAction {
  const docs = getPublicAgentDocs(requestUrl);

  return {
    name: "openapi",
    method: "GET",
    url: docs.openapiUrl,
  };
}

export function createAgentListToolsAction(requestUrl: string): AgentAction {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);

  return {
    name: "list_tools",
    method: "GET",
    url: `${apiBaseUrl}/agent/tools`,
    auth: API_KEY_AUTH,
  };
}

export function createAgentLoadAccountAction(requestUrl: string): AgentAction {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);

  return {
    name: "load_account",
    method: "GET",
    url: `${apiBaseUrl}/agent/me`,
    auth: API_KEY_AUTH,
  };
}

export function createAgentListWorkspacesAction(requestUrl: string): AgentAction {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);

  return {
    name: "list_workspaces",
    method: "GET",
    url: `${apiBaseUrl}/agent/workspaces`,
    auth: API_KEY_AUTH,
  };
}

export function createAgentCreateWorkspaceAction(requestUrl: string): AgentAction {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);

  return {
    name: "create_workspace",
    method: "POST",
    url: `${apiBaseUrl}/agent/workspaces`,
    auth: API_KEY_AUTH,
    input: {
      required: ["name"],
    },
  };
}

export function createAgentSelectWorkspaceAction(requestUrl: string): AgentAction {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);

  return {
    name: "select_workspace",
    method: "POST",
    urlTemplate: `${apiBaseUrl}/agent/workspaces/{workspaceId}/select`,
    auth: API_KEY_AUTH,
    input: {
      required: ["workspaceId"],
    },
  };
}

export function createAgentToolAction(
  requestUrl: string,
  toolName: ExternalAgentToolName,
): AgentAction {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);

  return {
    name: toolName,
    method: "POST",
    url: `${apiBaseUrl}/agent/tools/${toolName}`,
    auth: API_KEY_AUTH,
  };
}

export function buildAgentNextStepsInstructions(actions: ReadonlyArray<AgentAction>): string {
  if (actions.length === 0) {
    return "See openApiUrl for the full external AI-agent schema.";
  }

  return `Next actions: ${actions.map((action) => action.name).join(", ")}. See openApiUrl for full schema.`;
}

export function getAgentToolDefinition(
  toolName: ExternalAgentToolName,
): ExternalAgentToolDefinition {
  const definition = EXTERNAL_AGENT_TOOL_DEFINITIONS.find((tool) => tool.name === toolName);
  if (definition === undefined) {
    throw new Error(`Unknown external agent tool: ${toolName}`);
  }

  return definition;
}

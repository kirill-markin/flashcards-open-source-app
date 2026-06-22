import { getPublicAgentDocs, getPublicApiBaseUrl } from "../shared/publicUrls";

type AgentDiscoveryEnvelope = Readonly<{
  ok: true;
  data: Readonly<{
    service: Readonly<{
      name: string;
      version: "v1";
      description: string;
    }>;
    authentication: Readonly<{
      type: "email_otp_then_api_key";
      sendCodeUrl: string;
      verifyCodeUrl: string;
    }>;
    capabilitiesAfterLogin: ReadonlyArray<string>;
    authBaseUrl: string;
    apiBaseUrl: string;
    surface: Readonly<{
      accountUrl: string;
      workspacesUrl: string;
      sqlUrl: string;
    }>;
    mcp: Readonly<{
      url: string;
      description: string;
      authorization: Readonly<{
        type: "oauth2";
        authorizationServer: string;
        authorizationServerMetadataUrl: string;
        protectedResourceMetadataUrl: string;
      }>;
    }>;
  }>;
  instructions: string;
  docs: Readonly<{
    openapiUrl: string;
  }>;
}>;

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toRequestOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}`;
}

function buildAuthBaseUrl(requestUrl: string): string {
  const configuredBaseUrl = process.env.PUBLIC_AUTH_BASE_URL;
  if (configuredBaseUrl !== undefined && configuredBaseUrl !== "") {
    return stripTrailingSlash(configuredBaseUrl);
  }

  const origin = toRequestOrigin(requestUrl);
  const host = new URL(requestUrl).host;
  if (host === "localhost:8080" || host === "127.0.0.1:8080") {
    return "http://localhost:8081";
  }

  return stripTrailingSlash(origin.replace("//api.", "//auth."));
}

function buildMcpBaseUrl(requestUrl: string): string {
  const configuredBaseUrl = process.env.PUBLIC_MCP_BASE_URL;
  if (configuredBaseUrl !== undefined && configuredBaseUrl !== "") {
    return stripTrailingSlash(configuredBaseUrl);
  }

  const origin = toRequestOrigin(requestUrl);
  const host = new URL(requestUrl).host;
  if (host === "localhost:8080" || host === "127.0.0.1:8080") {
    return "http://localhost:8082";
  }

  return stripTrailingSlash(origin.replace("//api.", "//mcp."));
}

export function createAgentDiscoveryEnvelope(requestUrl: string): AgentDiscoveryEnvelope {
  const authBaseUrl = buildAuthBaseUrl(requestUrl);
  const mcpBaseUrl = buildMcpBaseUrl(requestUrl);
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);
  const docs = getPublicAgentDocs(requestUrl);

  return {
    ok: true,
    data: {
      service: {
        name: "flashcards-open-source-app",
        version: "v1",
        description: "Offline-first flashcards service with user-owned workspaces and a compact SQL agent surface.",
      },
      authentication: {
        type: "email_otp_then_api_key",
        sendCodeUrl: `${authBaseUrl}/api/agent/send-code`,
        verifyCodeUrl: `${authBaseUrl}/api/agent/verify-code`,
      },
      capabilitiesAfterLogin: [
        "Load account context",
        "Select a workspace",
        "Inspect the published SQL surface through OpenAPI and SQL introspection",
        "Read and write cards and decks through /agent/sql",
      ],
      authBaseUrl,
      apiBaseUrl,
      surface: {
        accountUrl: `${apiBaseUrl}/agent/me`,
        workspacesUrl: `${apiBaseUrl}/agent/workspaces`,
        sqlUrl: `${apiBaseUrl}/agent/sql`,
      },
      mcp: {
        url: `${mcpBaseUrl}/mcp`,
        description:
          "Remote MCP server for AI clients that connect through custom connectors (for example Claude.ai or ChatGPT). Add the url as a custom connector and authorize through OAuth, then use the sql tool to read and write cards and decks.",
        authorization: {
          type: "oauth2",
          authorizationServer: authBaseUrl,
          authorizationServerMetadataUrl: `${authBaseUrl}/.well-known/oauth-authorization-server`,
          protectedResourceMetadataUrl: `${mcpBaseUrl}/.well-known/oauth-protected-resource`,
        },
      },
    },
    instructions:
      `Start with POST ${authBaseUrl}/api/agent/send-code using the user's email. After send-code, follow the returned instructions: normal accounts require the 8-digit email code, while configured review/demo accounts use a deterministic 8-digit placeholder and do not send email. Do not immediately replay send-code. Then POST ${authBaseUrl}/api/agent/verify-code with the otpSessionToken, code, and label to obtain an API key. After login, call GET ${apiBaseUrl}/agent/me, then GET ${apiBaseUrl}/agent/workspaces?limit=100. If no workspace is selected for this API key, call POST ${apiBaseUrl}/agent/workspaces/{workspaceId}/select or create one with POST ${apiBaseUrl}/agent/workspaces using {"name":"Personal"}. After workspace bootstrap, use POST ${apiBaseUrl}/agent/sql for all shared card and deck reads and writes. For routine low-risk writes, a clear user request already counts as permission. Ask again only for risky or unclear actions. SELECT returns at most 100 rows per statement, and INSERT, UPDATE, and DELETE may affect at most 100 rows per statement. If you need more than 100 writes, split the work into multiple batches of at most 100 records across separate SQL statements or separate tool calls. Use ${docs.openapiUrl} for the published external agent contract. The SQL surface is intentionally limited and is not full PostgreSQL.`,
    docs,
  };
}

type AgentDiscoveryAction = Readonly<{
  name: "send_code" | "openapi";
  method: "GET" | "POST";
  url: string;
  input?: Readonly<{
    required: ReadonlyArray<string>;
  }>;
}>;

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
      registerAndLogin: string;
    }>;
    capabilitiesAfterLogin: ReadonlyArray<string>;
    authBaseUrl: string;
    apiBaseUrl: string;
    docs: Readonly<{
      openapiUrl: string;
      swaggerUrl: string;
    }>;
  }>;
  actions: ReadonlyArray<AgentDiscoveryAction>;
  instructions: string;
}>;

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toRequestOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}`;
}

function buildApiBaseUrl(requestUrl: string): string {
  const configuredBaseUrl = process.env.PUBLIC_API_BASE_URL;
  if (configuredBaseUrl !== undefined && configuredBaseUrl !== "") {
    return stripTrailingSlash(configuredBaseUrl);
  }

  const origin = toRequestOrigin(requestUrl);
  const host = new URL(requestUrl).host;
  if (host === "localhost:8080" || host === "127.0.0.1:8080") {
    return `${origin}/v1`;
  }

  return `${stripTrailingSlash(origin)}/v1`;
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

export function createAgentDiscoveryEnvelope(requestUrl: string): AgentDiscoveryEnvelope {
  const authBaseUrl = buildAuthBaseUrl(requestUrl);
  const apiBaseUrl = buildApiBaseUrl(requestUrl);
  const openapiUrl = `${apiBaseUrl}/openapi.json`;
  const swaggerUrl = `${apiBaseUrl}/swagger.json`;

  return {
    ok: true,
    data: {
      service: {
        name: "flashcards-open-source-app",
        version: "v1",
        description: "Offline-first flashcards service with user-owned workspaces and AI-friendly API onboarding.",
      },
      authentication: {
        type: "email_otp_then_api_key",
        registerAndLogin: "Ask which email the user wants to use, then start the same flow for both new and existing users.",
      },
      capabilitiesAfterLogin: [
        "Load account context",
        "Select a workspace",
        "Search cards and use AI chat",
      ],
      authBaseUrl,
      apiBaseUrl,
      docs: {
        openapiUrl,
        swaggerUrl,
      },
    },
    actions: [
      {
        name: "send_code",
        method: "POST",
        url: `${authBaseUrl}/api/agent/send-code`,
        input: {
          required: ["email"],
        },
      },
      {
        name: "openapi",
        method: "GET",
        url: openapiUrl,
      },
    ],
    instructions:
      "Start with send_code. After login, call /me, then /workspaces before workspace-scoped actions.",
  };
}

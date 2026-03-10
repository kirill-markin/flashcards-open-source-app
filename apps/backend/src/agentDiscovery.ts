type AgentDiscoveryAction = Readonly<{
  name: "send_code";
  method: "POST";
  url: string;
  input: Readonly<{
    required: ReadonlyArray<string>;
  }>;
}>;

type AgentDiscoveryEnvelope = Readonly<{
  ok: true;
  data: Readonly<{
    service: Readonly<{
      name: string;
      description: string;
    }>;
    authentication: Readonly<{
      type: "email_otp_then_api_key";
      registerAndLogin: string;
    }>;
    capabilitiesAfterLogin: ReadonlyArray<string>;
    authBaseUrl: string;
    apiBaseUrl: string;
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

  return {
    ok: true,
    data: {
      service: {
        name: "flashcards-open-source-app",
        description: "Offline-first flashcards service with user-owned workspaces and AI-friendly API onboarding.",
      },
      authentication: {
        type: "email_otp_then_api_key",
        registerAndLogin: "Ask which email the user wants to use, then start the same flow for both new and existing users.",
      },
      capabilitiesAfterLogin: [
        "Load account context",
        "List, create, and select workspaces",
        "Search cards and decks",
        "Use AI chat to inspect and create cards",
      ],
      authBaseUrl,
      apiBaseUrl,
    },
    actions: [{
      name: "send_code",
      method: "POST",
      url: `${authBaseUrl}/api/agent/send-code`,
      input: {
        required: ["email"],
      },
    }],
    instructions:
      "This endpoint is the discovery entrypoint for AI agents. Ask which email address the user wants to use, call send_code with that email, ask for the confirmation code from the email, and continue onboarding so the user can start using the service for free. The same flow covers both registration and login. Every later response includes the next action and short English instructions.",
  };
}

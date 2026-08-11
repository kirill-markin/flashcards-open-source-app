function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toRequestOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}`;
}

/**
 * Resolves the public auth base URL used inside agent-facing action payloads.
 * Local development falls back to the current request origin.
 */
export function getPublicAuthBaseUrl(requestUrl: string): string {
  const configuredValue = process.env.PUBLIC_AUTH_BASE_URL;
  if (configuredValue !== undefined && configuredValue !== "") {
    return stripTrailingSlash(configuredValue);
  }

  return stripTrailingSlash(toRequestOrigin(requestUrl));
}

/**
 * Resolves the public API base URL used inside agent-facing next-step payloads.
 * Local development defaults to the existing backend dev server.
 */
export function getPublicApiBaseUrl(requestUrl: string): string {
  const configuredValue = process.env.PUBLIC_API_BASE_URL;
  if (configuredValue !== undefined && configuredValue !== "") {
    return stripTrailingSlash(configuredValue);
  }

  const requestOrigin = toRequestOrigin(requestUrl);
  const host = new URL(requestUrl).host;
  if (host === "localhost:8081" || host === "127.0.0.1:8081") {
    return "http://localhost:8080/v1";
  }

  return stripTrailingSlash(requestOrigin.replace("//auth.", "//api.")) + "/v1";
}

/**
 * Resolves the canonical MCP protected-resource identifier
 * (`https://mcp.<domain>/mcp`) that authorization codes and access tokens must
 * be bound to. The backend validates `oauth_access_tokens.resource` against this
 * exact value (apps/backend lambda-mcp.ts), so the /authorize endpoint binds the
 * code to it. `MCP_RESOURCE` overrides; otherwise it is derived from the public
 * auth origin by swapping the `auth.` subdomain for `mcp.` and appending `/mcp`.
 */
export function getMcpResource(requestUrl: string): string {
  const configuredValue = process.env.MCP_RESOURCE;
  if (configuredValue !== undefined && configuredValue !== "") {
    return stripTrailingSlash(configuredValue);
  }

  const authBaseUrl = getPublicAuthBaseUrl(requestUrl);
  const url = new URL(authBaseUrl);
  url.hostname = url.hostname.startsWith("auth.")
    ? `mcp.${url.hostname.slice("auth.".length)}`
    : url.hostname;
  return `${stripTrailingSlash(`${url.protocol}//${url.host}`)}/mcp`;
}

export type PublicSourceLinks = Readonly<{
  repositoryUrl: string;
  agentRoutesUrl: string;
  authRoutesUrl: string;
}>;

export type PublicAgentDocs = Readonly<{
  discoveryUrl: string;
  source: PublicSourceLinks;
}>;

export function getPublicSourceLinks(): PublicSourceLinks {
  const repositoryUrl = "https://github.com/kirill-markin/flashcards-open-source-app";

  return {
    repositoryUrl,
    agentRoutesUrl: `${repositoryUrl}/tree/main/apps/backend/src/routes`,
    authRoutesUrl: `${repositoryUrl}/tree/main/apps/auth/src/routes/agent`,
  };
}

/**
 * Builds the public runtime-discovery and implementation-source links surfaced
 * inside AI-agent responses.
 */
export function getPublicAgentDocs(requestUrl: string): PublicAgentDocs {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);

  return {
    discoveryUrl: `${apiBaseUrl}/`,
    source: getPublicSourceLinks(),
  };
}

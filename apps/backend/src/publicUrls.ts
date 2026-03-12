function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toRequestOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}`;
}

/**
 * Resolves the public backend base URL used by external AI-agent responses.
 * The public contract is versioned under `/v1`, even when the current request
 * arrives through an alias route such as `/v1/agent`.
 */
export function getPublicApiBaseUrl(requestUrl: string): string {
  const configuredValue = process.env.PUBLIC_API_BASE_URL;
  if (configuredValue !== undefined && configuredValue !== "") {
    return stripTrailingSlash(configuredValue);
  }

  const requestOrigin = toRequestOrigin(requestUrl);
  const host = new URL(requestUrl).host;
  if (host === "localhost:8080" || host === "127.0.0.1:8080") {
    return `${requestOrigin}/v1`;
  }

  return `${stripTrailingSlash(requestOrigin)}/v1`;
}

/**
 * Builds the public AI-agent documentation URLs. The agent-specific aliases
 * are the primary links surfaced inside responses, while the root aliases stay
 * available as equivalent entrypoints.
 */
export function getPublicAgentDocs(requestUrl: string): Readonly<{
  openapiUrl: string;
}> {
  const apiBaseUrl = getPublicApiBaseUrl(requestUrl);

  return {
    openapiUrl: `${apiBaseUrl}/agent/openapi.json`,
  };
}

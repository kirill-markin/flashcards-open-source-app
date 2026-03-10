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

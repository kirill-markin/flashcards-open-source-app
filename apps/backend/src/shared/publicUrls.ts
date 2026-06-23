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

/**
 * Resolves the public marketing-site base URL (the apex origin, e.g.
 * `https://flashcards-open-source-app.com`). Self-hosters set their own domain,
 * so this is env-driven via `PUBLIC_SITE_BASE_URL` first; when unset it derives
 * the apex origin from the request by stripping a leading `api.`/`auth.`/`mcp.`
 * subdomain. The returned value never carries a trailing slash; the conventional
 * trailing-slash legal paths are appended by `getPublicLegalLinks`.
 */
export function getPublicSiteBaseUrl(requestUrl: string): string {
  const configuredValue = process.env.PUBLIC_SITE_BASE_URL;
  if (configuredValue !== undefined && configuredValue.trim() !== "") {
    return stripTrailingSlash(configuredValue.trim());
  }

  const origin = toRequestOrigin(requestUrl);
  const host = new URL(requestUrl).host;
  if (host === "localhost:8080" || host === "127.0.0.1:8080") {
    return stripTrailingSlash(origin);
  }

  return stripTrailingSlash(origin.replace(/\/\/(api|auth|mcp)\./, "//"));
}

/**
 * Builds the public site, privacy, terms, support, and docs links. The domain
 * comes from `getPublicSiteBaseUrl` (env-driven); the paths are conventional
 * trailing-slash constants matching the marketing site (`trailingSlash: true`).
 */
export function getPublicLegalLinks(requestUrl: string): Readonly<{
  websiteUrl: string;
  privacyUrl: string;
  termsUrl: string;
  supportUrl: string;
  docsUrl: string;
}> {
  const siteBaseUrl = getPublicSiteBaseUrl(requestUrl);

  return {
    websiteUrl: `${siteBaseUrl}/`,
    privacyUrl: `${siteBaseUrl}/privacy/`,
    termsUrl: `${siteBaseUrl}/terms/`,
    supportUrl: `${siteBaseUrl}/support/`,
    docsUrl: `${siteBaseUrl}/docs/`,
  };
}

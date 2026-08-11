function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toRequestOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}`;
}

const fixedLocalPublicOrigin = "http://localhost:3000";

function isLocalOrLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/u, "");
  if (
    normalizedHostname === "localhost"
    || normalizedHostname.endsWith(".localhost")
    || normalizedHostname === "0.0.0.0"
    || normalizedHostname === "[::]"
    || normalizedHostname === "[::1]"
    || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/u.test(normalizedHostname)
  ) {
    return true;
  }

  const ipv4Match = /^(\d{1,3})\./u.exec(normalizedHostname);
  return ipv4Match !== null && Number(ipv4Match[1]) === 127;
}

function assertConfiguredLocalOriginPolicy(
  url: URL,
  rawValue: string,
  variableName: string,
): void {
  if (isLocalOrLoopbackHostname(url.hostname) && rawValue !== fixedLocalPublicOrigin) {
    throw new Error(
      `${variableName} local or loopback origin must be exactly ${fixedLocalPublicOrigin}`,
    );
  }
}

export function parsePublicOrigin(value: string, variableName: string): string {
  if (
    value.trim() !== value
    || /[\\\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(
      `${variableName} must be an absolute HTTP or HTTPS origin without control characters or backslashes, surrounding whitespace, or non-canonical representation`,
    );
  }

  if (/^https?:\/\/[^/?#]+$/iu.test(value) === false) {
    throw new Error(
      `${variableName} must be an absolute HTTP or HTTPS origin without credentials, path, query, or fragment and in canonical form`,
    );
  }

  const authorityStart = value.indexOf("://") + 3;
  const rawAuthority = value.slice(authorityStart);
  if (rawAuthority.includes("@")) {
    throw new Error(
      `${variableName} must be an absolute HTTP or HTTPS origin without credentials, path, query, or fragment and in canonical form`,
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be an absolute HTTP or HTTPS origin in canonical form`);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username !== ""
    || url.password !== ""
    || url.hostname.includes("*")
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error(
      `${variableName} must be an absolute HTTP or HTTPS origin without credentials, path, query, or fragment and in canonical form`,
    );
  }

  assertConfiguredLocalOriginPolicy(url, value, variableName);

  if (value !== url.origin) {
    throw new Error(
      `${variableName} must be an absolute HTTP or HTTPS origin that exactly matches its canonical serialized form`,
    );
  }

  return url.origin;
}

function isExplicitLocalPublicUrlPolicyEnabled(): boolean {
  return process.env.AUTH_MODE === "none"
    && process.env.ALLOW_INSECURE_LOCAL_AUTH === "true";
}

export function validatePublicUrlConfiguration(): void {
  const publicAppBaseUrl = process.env.PUBLIC_APP_BASE_URL;
  if (publicAppBaseUrl === undefined || publicAppBaseUrl === "") {
    if (isExplicitLocalPublicUrlPolicyEnabled() === false) {
      throw new Error(
        "PUBLIC_APP_BASE_URL is required outside explicit local development",
      );
    }
  } else {
    parsePublicOrigin(publicAppBaseUrl, "PUBLIC_APP_BASE_URL");
  }

  const publicSiteBaseUrl = process.env.PUBLIC_SITE_BASE_URL;
  if (publicSiteBaseUrl !== undefined && publicSiteBaseUrl !== "") {
    parsePublicOrigin(publicSiteBaseUrl, "PUBLIC_SITE_BASE_URL");
  }
}

export function getConfiguredPublicCatalogCorsOrigins(): ReadonlyArray<string> {
  const origins: Array<string> = [];
  const publicSiteBaseUrl = process.env.PUBLIC_SITE_BASE_URL;
  if (publicSiteBaseUrl !== undefined && publicSiteBaseUrl !== "") {
    origins.push(parsePublicOrigin(publicSiteBaseUrl, "PUBLIC_SITE_BASE_URL"));
  }

  const publicAppBaseUrl = process.env.PUBLIC_APP_BASE_URL;
  if (publicAppBaseUrl !== undefined && publicAppBaseUrl !== "") {
    origins.push(parsePublicOrigin(publicAppBaseUrl, "PUBLIC_APP_BASE_URL"));
  }

  return origins;
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
 * Resolves the public web-app origin used by exact catalog installation links.
 * Deployed Lambdas receive `PUBLIC_APP_BASE_URL=https://app.<baseDomain>` from
 * CDK. Explicit local development uses the fixed Vite origin; other
 * environments must configure the app origin and fail closed when it is absent.
 */
export function getPublicAppBaseUrl(requestUrl: string): string {
  const configuredValue = process.env.PUBLIC_APP_BASE_URL;
  if (configuredValue !== undefined && configuredValue !== "") {
    return parsePublicOrigin(configuredValue, "PUBLIC_APP_BASE_URL");
  }

  const requestUrlValue = new URL(requestUrl);
  if (requestUrlValue.host === "localhost:8080" || requestUrlValue.host === "127.0.0.1:8080") {
    if (isExplicitLocalPublicUrlPolicyEnabled()) {
      return fixedLocalPublicOrigin;
    }
  }

  throw new Error(
    "PUBLIC_APP_BASE_URL is required for non-local public catalog requests",
  );
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
  if (configuredValue !== undefined && configuredValue !== "") {
    return parsePublicOrigin(configuredValue, "PUBLIC_SITE_BASE_URL");
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

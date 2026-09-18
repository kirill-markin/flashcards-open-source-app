/**
 * Which public host an MCP request arrived on, and the OAuth identifiers derived
 * from it.
 *
 * The MCP server answers on the primary host `mcp.<MCP_BASE_DOMAIN>` and, when
 * `MCP_ALTERNATE_HOST` is configured, on one additional host served by the same
 * API Gateway (infra/aws/lib/mcp-alternate-host.ts). RFC 9728 makes the
 * protected-resource identifier a per-host fact: a client that reached the
 * alternate host and is handed metadata naming the primary host sees an origin
 * mismatch and refuses to authorize. Everything below is therefore keyed on the
 * host the request actually used.
 *
 * A token is consequently valid only on the host whose resource identifier it
 * carries. `authenticateMcpAccessToken` compares the stored `resource` against
 * the expected one (apps/backend/src/auth/mcpTokens.ts), so a token minted for
 * the primary host keeps working there and is rejected on the alternate host,
 * and the reverse. The authorization server is the same for both hosts.
 *
 * These are pure functions over explicit arguments so the environment is read in
 * exactly one place, the entrypoint (apps/backend/src/entrypoints/lambda-mcp.ts).
 */

export function getPrimaryMcpHost(baseDomain: string): string {
  return `mcp.${baseDomain}`;
}

/**
 * Normalizes a `Host` header into a comparable hostname: lower-cased, without a
 * port, without a trailing root dot, and without surrounding whitespace. Returns
 * `null` when there is nothing usable to compare.
 *
 * The value is client-controlled, so it is only ever compared against the two
 * configured hosts and never used to build a URL directly.
 */
export function normalizeRequestHost(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") {
    return null;
  }

  // IPv6 literals keep their brackets; only a trailing `:port` is dropped.
  const withoutPort = trimmed.startsWith("[")
    ? trimmed.replace(/](:\d+)$/, "]")
    : trimmed.replace(/:\d+$/, "");
  const withoutRootDot = withoutPort.replace(/\.$/, "");

  return withoutRootDot === "" ? null : withoutRootDot;
}

/**
 * Resolves which configured MCP host serves this request.
 *
 * Only the primary host and the configured alternate host are accepted; anything
 * else -- no header, the raw execute-api hostname, a spoofed value -- falls back
 * to the primary host, which is byte-for-byte today's behaviour.
 */
export function resolveMcpHost(
  requestHost: string | null | undefined,
  baseDomain: string,
  alternateHost: string | null | undefined,
): string {
  const primaryHost = getPrimaryMcpHost(baseDomain);
  const normalizedRequestHost = normalizeRequestHost(requestHost);
  if (normalizedRequestHost === null) {
    return primaryHost;
  }

  if (normalizedRequestHost === normalizeRequestHost(primaryHost)) {
    return primaryHost;
  }

  const normalizedAlternateHost = normalizeRequestHost(alternateHost);
  if (normalizedAlternateHost !== null && normalizedRequestHost === normalizedAlternateHost) {
    return normalizedAlternateHost;
  }

  return primaryHost;
}

/**
 * The hosts the Streamable HTTP transport's DNS-rebinding protection accepts.
 * The primary host alone when no alternate is configured, so an unconfigured
 * deployment keeps exactly the allowlist it has today.
 */
export function getAllowedMcpHosts(
  baseDomain: string,
  alternateHost: string | null | undefined,
): ReadonlyArray<string> {
  const primaryHost = getPrimaryMcpHost(baseDomain);
  const normalizedAlternateHost = normalizeRequestHost(alternateHost);
  if (normalizedAlternateHost === null || normalizedAlternateHost === normalizeRequestHost(primaryHost)) {
    return [primaryHost];
  }

  return [primaryHost, normalizedAlternateHost];
}

/**
 * The OAuth protected-resource identifier of an MCP host. Access tokens are
 * bound to this exact string, and the authorization server builds it the same
 * way (apps/auth/src/server/publicUrls.ts).
 */
export function getMcpResourceUrl(mcpHost: string): string {
  return `https://${mcpHost}/mcp`;
}

/**
 * RFC 9728 §3.1 path-aware Protected Resource Metadata URL. Because the resource
 * identifier carries a `/mcp` path, the well-known suffix is inserted between the
 * host and the path, so spec-current MCP clients that derive the metadata URL
 * from the resource find the document and the `resource` field matches what they
 * expect.
 */
export function getMcpProtectedResourceMetadataUrl(mcpHost: string): string {
  return `https://${mcpHost}/.well-known/oauth-protected-resource/mcp`;
}

/**
 * The PRM document for one host. `resource` names the host the client actually
 * used; the authorization server is shared by every MCP host and stays on the
 * base domain.
 */
export function buildMcpProtectedResourceMetadata(
  mcpHost: string,
  authorizationServerUrl: string,
  supportedScopes: ReadonlyArray<string>,
): Record<string, unknown> {
  return {
    resource: getMcpResourceUrl(mcpHost),
    authorization_servers: [authorizationServerUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: [...supportedScopes],
  };
}

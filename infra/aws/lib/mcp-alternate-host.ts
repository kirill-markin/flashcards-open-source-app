/**
 * The optional second public MCP host, served by the same MCP API as the primary
 * `mcp.<baseDomain>`.
 *
 * It is configured through two CDK context values that only count when both are
 * set (`mcpAlternateDomainName` and `mcpAlternateCertificateArn`). With either
 * missing this resolves to `undefined` and every consumer -- the gateway, the
 * MCP Lambda environment, the auth Lambda environment, the heartbeat and the
 * alarms -- stays exactly as it is without this feature.
 *
 * One module owns the resolution because those consumers must agree on the exact
 * host string: the API Gateway custom domain, the host the MCP handler accepts,
 * the resource the authorization server mints tokens for, and the CloudWatch
 * metric dimension the heartbeat alarm reads are the same name or the feature is
 * silently half-on.
 */

/**
 * Raised when the alternate host names the primary MCP host. API Gateway allows
 * one custom domain per name, so CloudFormation would otherwise fail the deploy
 * partway through with a generic duplicate-domain error; this names the actual
 * mistake at synth time instead.
 */
export class McpAlternateDomainConflictError extends Error {
  constructor(primaryMcpHost: string) {
    super(
      `The alternate MCP domain must differ from the primary MCP host "${primaryMcpHost}". `
      + "Unset CDK_MCP_ALTERNATE_DOMAIN_NAME, or point it at the second host.",
    );
    this.name = "McpAlternateDomainConflictError";
  }
}

/**
 * Normalizes a configured host into the form every consumer compares against: a
 * lower-case name without surrounding whitespace or a trailing root dot. An
 * empty value means "not configured".
 */
function normalizeHost(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  return normalized === "" ? undefined : normalized;
}

export function getPrimaryMcpHost(baseDomain: string): string {
  return `mcp.${baseDomain}`;
}

/**
 * Resolves the alternate MCP host, or `undefined` when the feature is off.
 *
 * The conflict check runs on the configured name alone, before the certificate
 * is considered: naming the primary host here is a configuration mistake in
 * every case, and it should fail loudly rather than depend on whether the second
 * variable happens to be set.
 */
export function resolveMcpAlternateHost(
  baseDomain: string,
  mcpAlternateDomainName: string | undefined,
  mcpAlternateCertificateArn: string | undefined,
): string | undefined {
  const alternateHost = normalizeHost(mcpAlternateDomainName);
  if (alternateHost === undefined) {
    return undefined;
  }

  const primaryMcpHost = getPrimaryMcpHost(baseDomain);
  if (alternateHost === normalizeHost(primaryMcpHost)) {
    throw new McpAlternateDomainConflictError(primaryMcpHost);
  }

  // The certificate is what makes the host servable, so a name without one stays
  // inert instead of creating a custom domain that cannot terminate TLS.
  if (normalizeHost(mcpAlternateCertificateArn) === undefined) {
    return undefined;
  }

  return alternateHost;
}

/**
 * Whether the alternate host has been declared live, meaning its DNS record
 * exists and it can be held to an availability promise.
 *
 * Deliberately separate from `resolveMcpAlternateHost`, and deliberately absent
 * from every Lambda environment: the custom domain has to be created before its
 * CNAME can be pointed at the `McpAlternateCustomDomainTarget` output, so the
 * deploy that creates the host cannot be the deploy that starts paging when the
 * host does not resolve. Only the liveness heartbeat and its alarm read this.
 */
export function isMcpAlternateHostLive(mcpAlternateHostLive: string | undefined): boolean {
  return (mcpAlternateHostLive ?? "").trim().toLowerCase() === "true";
}

/**
 * The OAuth protected-resource identifier of an MCP host. Tokens are bound to
 * this exact value, so the authorization server and the MCP handler must build
 * it the same way (apps/auth/src/server/publicUrls.ts,
 * apps/backend/src/mcp/hosts.ts).
 */
export function getMcpResourceUrl(mcpHost: string): string {
  return `https://${mcpHost}/mcp`;
}

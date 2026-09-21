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
 * silently half-on. The name rule itself is shared with the other alternate
 * hosts (./alternate-host.ts).
 */

import type { AlternateHostConfig } from "./alternate-host";
import { isAlternateHostLive, resolveAlternateHost } from "./alternate-host";

export function getPrimaryMcpHost(baseDomain: string): string {
  return `mcp.${baseDomain}`;
}

/**
 * The MCP entry in the stack-wide alternate host set (./alternate-host.ts), so
 * the MCP host is resolved and collision-checked alongside the other two.
 */
export function mcpAlternateHostConfig(
  baseDomain: string,
  mcpAlternateDomainName: string | undefined,
  mcpAlternateCertificateArn: string | undefined,
): AlternateHostConfig {
  return {
    hostRole: "MCP",
    primaryHost: getPrimaryMcpHost(baseDomain),
    contextVariableName: "CDK_MCP_ALTERNATE_DOMAIN_NAME",
    alternateDomainName: mcpAlternateDomainName,
    alternateCertificateArn: mcpAlternateCertificateArn,
  };
}

/**
 * Resolves the alternate MCP host, or `undefined` when the feature is off.
 * Throws AlternateHostConflictError when it names the primary MCP host.
 */
export function resolveMcpAlternateHost(
  baseDomain: string,
  mcpAlternateDomainName: string | undefined,
  mcpAlternateCertificateArn: string | undefined,
): string | undefined {
  return resolveAlternateHost(
    mcpAlternateHostConfig(baseDomain, mcpAlternateDomainName, mcpAlternateCertificateArn),
  );
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
  return isAlternateHostLive(mcpAlternateHostLive);
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

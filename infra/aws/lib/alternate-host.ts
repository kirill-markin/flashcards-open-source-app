/**
 * Resolution shared by every optional second public host on an API Gateway
 * stage: the REST API (`api.`), the auth API (`auth.`) and the MCP API (`mcp.`).
 *
 * Each of those hosts is configured through two CDK context values that only
 * count when both are set. One module owns the rule so the three hosts cannot
 * drift apart in how they normalize a name, when they consider the feature on,
 * or how they report a name that repeats a host the stack already serves.
 */

/**
 * Raised when a configured alternate host names a host this stack already
 * serves: its own primary host, another pair's primary host, or another
 * alternate. API Gateway allows one custom domain per name, so CloudFormation
 * would otherwise fail the deploy partway through with a generic
 * duplicate-domain error; this names the actual mistake at synth time instead.
 */
export class AlternateHostConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlternateHostConflictError";
  }
}

/**
 * Normalizes a configured host into the form every consumer compares against: a
 * lower-case name without surrounding whitespace or a trailing root dot. An
 * empty value means "not configured".
 */
export function normalizeHost(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  return normalized === "" ? undefined : normalized;
}

/**
 * Whether an alternate host has been declared live, meaning its DNS record
 * exists and it can be held to an availability promise. Only the liveness
 * heartbeat and its alarm read this; see the caller for why it is a separate
 * switch from creating the host.
 */
export function isAlternateHostLive(alternateHostLive: string | undefined): boolean {
  return (alternateHostLive ?? "").trim().toLowerCase() === "true";
}

export interface AlternateHostConfig {
  // Named in the synth-time conflict error, for example "API", "auth" or "MCP".
  hostRole: string;
  primaryHost: string;
  // The repository variable an operator has to clear to turn the host off.
  contextVariableName: string;
  alternateDomainName: string | undefined;
  alternateCertificateArn: string | undefined;
}

export interface ResolvedAlternateHosts {
  readonly api: string | undefined;
  readonly auth: string | undefined;
  readonly mcp: string | undefined;
}

export type AlternateHostRole = keyof ResolvedAlternateHosts;

const alternateHostRoles: ReadonlyArray<AlternateHostRole> = ["api", "auth", "mcp"];

/**
 * Resolves one alternate host, or `undefined` when the feature is off.
 *
 * The conflict check runs on the configured name alone, before the certificate
 * is considered: naming the primary host here is a configuration mistake in
 * every case, and it should fail loudly rather than depend on whether the second
 * variable happens to be set.
 */
export function resolveAlternateHost(config: AlternateHostConfig): string | undefined {
  const alternateHost = normalizeHost(config.alternateDomainName);
  if (alternateHost === undefined) {
    return undefined;
  }

  if (alternateHost === normalizeHost(config.primaryHost)) {
    throw new AlternateHostConflictError(
      `The alternate ${config.hostRole} domain must differ from the primary ${config.hostRole} host `
      + `"${config.primaryHost}". Unset ${config.contextVariableName}, or point it at the second host.`,
    );
  }

  // The certificate is what makes the host servable, so a name without one stays
  // inert instead of creating a custom domain that cannot terminate TLS.
  if (normalizeHost(config.alternateCertificateArn) === undefined) {
    return undefined;
  }

  return alternateHost;
}

/**
 * Resolves every alternate host of the stack in one place, so the set can be
 * checked as a set: a name is a conflict as soon as anything else in the stack
 * already answers on it, not only when it repeats its own primary. One API
 * Gateway custom domain exists per name, so two alternates pointed at the same
 * host, or an alternate pointed at another pair's primary host, would otherwise
 * pass synth and fail the deploy halfway with a generic duplicate-domain error.
 *
 * Only resolved hosts are compared, because those are the domains the stack
 * actually creates. A half-configured pair stays inert here and reaches this
 * check on the later synth that completes it, which is still before its deploy.
 */
export function resolveAlternateHosts(
  configs: Readonly<Record<AlternateHostRole, AlternateHostConfig>>,
): ResolvedAlternateHosts {
  const hostOwners = new Map<string, string>();
  for (const role of alternateHostRoles) {
    const primaryHost = normalizeHost(configs[role].primaryHost);
    if (primaryHost !== undefined) {
      hostOwners.set(primaryHost, `the primary ${configs[role].hostRole} host`);
    }
  }

  const resolvedHosts: Record<AlternateHostRole, string | undefined> = {
    api: undefined,
    auth: undefined,
    mcp: undefined,
  };
  for (const role of alternateHostRoles) {
    const config = configs[role];
    const alternateHost = resolveAlternateHost(config);
    if (alternateHost === undefined) {
      continue;
    }

    const owner = hostOwners.get(alternateHost);
    if (owner !== undefined) {
      throw new AlternateHostConflictError(
        `The alternate ${config.hostRole} domain "${alternateHost}" is already ${owner} of this stack. `
        + `Unset ${config.contextVariableName}, or point it at a host nothing else serves.`,
      );
    }

    hostOwners.set(alternateHost, `the alternate ${config.hostRole} host`);
    resolvedHosts[role] = alternateHost;
  }

  return resolvedHosts;
}

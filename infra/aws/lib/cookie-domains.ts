import { normalizeHost } from "./alternate-host";

/**
 * Raised when a browser-facing host this stack creates sits under none of the
 * `COOKIE_DOMAIN` candidates.
 *
 * The runtime resolver already refuses such a host (apps/backend/src/shared/cookieDomain.ts),
 * but only once a real browser reaches it, and by then the damage is done: a
 * sign-in 500s after Cognito has already authenticated the person, and
 * `/v1/analytics/visitor` 500s on page load. The candidate set and the hosts are
 * both known at synth, so the mismatch is a synth failure naming the host, in
 * the same spirit as `AlternateHostConflictError` in ./alternate-host.ts.
 */
export class CookieDomainCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookieDomainCoverageError";
  }
}

export interface CookieDomainsProps {
  baseDomain: string;
  // Adds one more candidate domain; unset leaves the set at baseDomain alone.
  cookieDomain: string | undefined;
  // Every host of this stack a browser can reach that sets or reads a cookie,
  // already resolved, and undefined unless the stack actually creates it. The
  // MCP hosts are absent on purpose: MCP is bearer-token authenticated and sets
  // no cookie.
  apiAlternateHost: string | undefined;
  authAlternateHost: string | undefined;
  webAdditionalHost: string | undefined;
  adminAdditionalHost: string | undefined;
}

interface BrowserHost {
  // Named in the synth-time coverage error, for example "alternate auth host".
  readonly hostRole: string;
  readonly host: string | undefined;
  // The repository variable an operator has to clear to turn the host off.
  readonly contextVariableName: string;
}

function browserHostsOf(props: CookieDomainsProps): ReadonlyArray<BrowserHost> {
  return [
    {
      hostRole: "alternate API host",
      host: props.apiAlternateHost,
      contextVariableName: "CDK_API_ALTERNATE_DOMAIN_NAME",
    },
    {
      hostRole: "alternate auth host",
      host: props.authAlternateHost,
      contextVariableName: "CDK_AUTH_ALTERNATE_DOMAIN_NAME",
    },
    {
      hostRole: "second web host",
      host: props.webAdditionalHost,
      contextVariableName: "CDK_WEB_ADDITIONAL_DOMAIN_NAME",
    },
    {
      hostRole: "second admin host",
      host: props.adminAdditionalHost,
      contextVariableName: "CDK_ADMIN_ADDITIONAL_DOMAIN_NAME",
    },
  ];
}

/**
 * A candidate in the form the runtime compares against, which is `normalizeHost`
 * plus the leading dot of the conventional `.example.com` cookie-domain
 * spelling. RFC 6265 section 4.1.2.3 ignores that dot, but a suffix comparison
 * does not: `.example.com` would match no host at all, and it would break the
 * suffix chain that lets the longest matching candidate win. Stripping it here,
 * rather than in the request-host normalization the two services share, keeps
 * the `Host` comparison in apps/backend/src/mcp/hosts.ts untouched.
 */
function normalizeCandidate(value: string | undefined): string | undefined {
  const normalized = normalizeHost(value);
  if (normalized === undefined) {
    return undefined;
  }

  const withoutLeadingDot = normalized.replace(/^\.+/, "");
  return withoutLeadingDot === "" ? undefined : withoutLeadingDot;
}

/**
 * The `COOKIE_DOMAIN` value both browser-facing services receive.
 *
 * It is a candidate set, not a switch. Each service resolves one domain per
 * request from the host the request arrived on
 * (apps/backend/src/shared/cookieDomain.ts, mirrored in
 * apps/auth/src/server/cookieDomain.ts), because a cookie carries one explicit
 * `Domain` and a browser discards a `Set-Cookie` naming a domain the request
 * host is not under. With two registrable domains serving browsers at once, no
 * single value is correct for both.
 *
 * `<domain>` is always a candidate and is never replaced: `auth.<domain>` stays
 * the pinned OAuth authorization server (`PUBLIC_AUTH_BASE_URL` below and
 * apps/backend/src/mcp/hosts.ts), so its cookies have to keep working for as
 * long as the MCP clients issued against it exist. `CDK_COOKIE_DOMAIN` adds a
 * second one; unset, the list is `<domain>` alone, which is byte-for-byte the
 * behaviour before browsers were served from two domains.
 *
 * The set is configured, but it is checked here against the hosts the stack
 * actually creates instead of being trusted on its own, so a host no candidate
 * covers stops the synth rather than the browser. A host left undefined is not
 * checked: `resolveAlternateHost` and `resolveDistributionHosts` both return
 * undefined for a half-configured pair, and a host the stack does not create
 * serves nobody.
 *
 * Both gateways call this with the same props, so the two services cannot be
 * given different sets and disagree about which domain a browser belongs to.
 */
export function buildCookieDomains(props: CookieDomainsProps): string {
  const domains = [normalizeCandidate(props.baseDomain) ?? props.baseDomain];
  const additionalDomain = normalizeCandidate(props.cookieDomain);
  if (additionalDomain !== undefined && domains.includes(additionalDomain) === false) {
    domains.push(additionalDomain);
  }

  for (const browserHost of browserHostsOf(props)) {
    const host = normalizeHost(browserHost.host);
    if (host === undefined) {
      continue;
    }

    const covered = domains.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
    if (covered === false) {
      throw new CookieDomainCoverageError(
        `The ${browserHost.hostRole} "${host}" sits under none of the COOKIE_DOMAIN candidates `
        + `(${domains.join(", ")}), so every browser cookie set on it would be discarded and the `
        + `request would fail instead. Add its domain to CDK_COOKIE_DOMAIN before that host carries `
        + `browsers, or unset ${browserHost.contextVariableName}.`,
      );
    }
  }

  return domains.join(",");
}

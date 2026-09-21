/**
 * The optional second public host of a CloudFront distribution, served by the
 * same distribution as its primary host, for example a rebranded domain.
 *
 * It is configured through two CDK context values that only count when both are
 * set. With either missing this resolves to the aliases and certificate the
 * distribution has today, so the synthesized stack is unchanged.
 *
 * CloudFront accepts many alternate domain names but exactly one viewer
 * certificate, and that certificate must cover every alias, so the certificate
 * named here is not an addition: it replaces the primary one and must itself
 * cover both hosts. It has to live in us-east-1 like every CloudFront viewer
 * certificate. Changing aliases and the viewer certificate updates the existing
 * distribution in place, so the distribution and its `*.cloudfront.net` name
 * survive the rollout.
 */

/**
 * Raised when the additional host repeats an alias the stack already claims,
 * whether on this distribution or on another one. CloudFront refuses to serve
 * the same alternate domain name twice, so CloudFormation would otherwise fail
 * the deploy partway through with `CNAMEAlreadyExists`; this names the actual
 * mistake at synth time instead.
 */
export class AdditionalDistributionHostConflictError extends Error {
  constructor(additionalHost: string, claimedHost: string) {
    super(
      `The additional distribution host "${additionalHost}" is already claimed by this stack as "${claimedHost}". `
      + "Unset the additional domain name, or point it at a host the stack does not serve yet.",
    );
    this.name = "AdditionalDistributionHostConflictError";
  }
}

/** Trims a configured value; an empty value means "not configured". */
function normalizeValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Normalizes a configured host into the form aliases are compared in: a
 * lower-case name without surrounding whitespace or a trailing root dot.
 */
function normalizeHost(value: string | undefined): string | undefined {
  const trimmed = normalizeValue(value);
  if (trimmed === undefined) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase().replace(/\.$/, "");
  return normalized === "" ? undefined : normalized;
}

export interface DistributionHosts {
  /** The distribution aliases, `undefined` when it serves no custom domain. */
  domainNames: string[] | undefined;
  /** The single viewer certificate covering every alias above. */
  certificateArn: string | undefined;
  /** The primary host when this distribution serves it, `undefined` otherwise. */
  primaryCustomDomain: string | undefined;
}

/**
 * Resolves the aliases and the viewer certificate of one distribution.
 *
 * `stackClaimedHosts` is every alias the stack claims elsewhere; the primary
 * host is always checked too. The conflict check runs on the configured name
 * alone, before the certificate is considered: repeating a claimed host here is
 * a configuration mistake in every case, and it should fail loudly rather than
 * depend on whether the second value happens to be set.
 *
 * With the primary certificate unset the primary host is never forced into the
 * alias list, so a self-hoster who configured only the additional pair gets only
 * their own host and does not need a certificate covering a host they never
 * intended to serve.
 */
export function resolveDistributionHosts(
  primaryHost: string,
  primaryCertificateArnUsEast1: string | undefined,
  additionalDomainName: string | undefined,
  additionalCertificateArnUsEast1: string | undefined,
  stackClaimedHosts: readonly string[],
): DistributionHosts {
  const additionalHost = normalizeHost(additionalDomainName);
  if (additionalHost !== undefined) {
    const claimedHost = [primaryHost, ...stackClaimedHosts]
      .find((host) => normalizeHost(host) === additionalHost);
    if (claimedHost !== undefined) {
      throw new AdditionalDistributionHostConflictError(additionalHost, claimedHost);
    }
  }

  // The certificate is what makes the host servable, so a name without one stays
  // inert instead of adding an alias CloudFront would refuse.
  const additionalCertificateArn = normalizeValue(additionalCertificateArnUsEast1);
  if (additionalHost === undefined || additionalCertificateArn === undefined) {
    const primaryCustomDomain = primaryCertificateArnUsEast1 === undefined ? undefined : primaryHost;
    return {
      domainNames: primaryCustomDomain === undefined ? undefined : [primaryHost],
      certificateArn: primaryCertificateArnUsEast1,
      primaryCustomDomain,
    };
  }

  if (primaryCertificateArnUsEast1 === undefined) {
    return {
      domainNames: [additionalHost],
      certificateArn: additionalCertificateArn,
      primaryCustomDomain: undefined,
    };
  }

  return {
    domainNames: [primaryHost, additionalHost],
    certificateArn: additionalCertificateArn,
    primaryCustomDomain: primaryHost,
  };
}

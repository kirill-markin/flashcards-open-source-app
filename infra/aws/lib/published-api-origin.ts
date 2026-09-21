/**
 * The optional override for the API origin the stack advertises
 * (docs/published-api-origin.md), checked against the hosts this stack actually
 * serves.
 *
 * AI agents follow the advertised origin, the auth Lambda calls it for sign-in
 * analytics, and the catalog dump bakes it into an artifact cached for a year, so
 * a typo or a host that does not answer yet fails silently in all three. The
 * override may therefore name only the primary API host, or the alternate API
 * host once it is created (both of its context values, ./alternate-host.ts) and
 * declared live, the same switch that starts the heartbeat probing it.
 */

import { normalizeHost } from "./alternate-host";

export class PublishedApiOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishedApiOriginError";
  }
}

export interface PublishedApiOriginInput {
  baseDomain: string;
  // Already canonicalized by parsePublicOrigin; undefined when not configured.
  configuredApiBaseUrl: string | undefined;
  // The raw alternate name, to tell "not created yet" apart from "not ours".
  apiAlternateDomainName: string | undefined;
  // The resolved alternate host: defined only when its certificate is configured.
  apiAlternateHost: string | undefined;
  apiAlternateHostLive: boolean;
}

/**
 * Returns the override unchanged, or `undefined` when it is not configured so the
 * gateways keep deriving `https://api.<baseDomain>`. Throws
 * PublishedApiOriginError at synth time for any other value.
 */
export function resolvePublishedApiOrigin(input: PublishedApiOriginInput): string | undefined {
  const configuredApiBaseUrl = input.configuredApiBaseUrl;
  if (configuredApiBaseUrl === undefined) {
    return undefined;
  }

  if (configuredApiBaseUrl === `https://api.${input.baseDomain}`) {
    return configuredApiBaseUrl;
  }

  const alternateDomainName = normalizeHost(input.apiAlternateDomainName);
  if (alternateDomainName !== undefined && configuredApiBaseUrl === `https://${alternateDomainName}`) {
    if (input.apiAlternateHost === undefined) {
      throw new PublishedApiOriginError(
        `apiBaseUrl "${configuredApiBaseUrl}" names the alternate API host, which this deploy does not `
        + "create: CDK_API_ALTERNATE_CERTIFICATE_ARN is unset. Set it, or unset CDK_API_BASE_URL.",
      );
    }
    if (!input.apiAlternateHostLive) {
      throw new PublishedApiOriginError(
        `apiBaseUrl "${configuredApiBaseUrl}" names the alternate API host before it is declared live. `
        + "Point its DNS record at the ApiAlternateCustomDomainTarget output, set "
        + "CDK_API_ALTERNATE_HOST_LIVE=true, then set CDK_API_BASE_URL.",
      );
    }
    return configuredApiBaseUrl;
  }

  const allowedOrigins = [
    `https://api.${input.baseDomain}`,
    ...(input.apiAlternateHost === undefined ? [] : [`https://${input.apiAlternateHost}`]),
  ];
  throw new PublishedApiOriginError(
    `apiBaseUrl "${configuredApiBaseUrl}" is not an API host this stack serves. `
    + `Set CDK_API_BASE_URL to one of ${allowedOrigins.map((origin) => `"${origin}"`).join(", ")}, or unset it.`,
  );
}

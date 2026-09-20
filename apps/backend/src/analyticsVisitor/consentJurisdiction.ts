/**
 * Whether the caller's country may be given an analytics identity before it has asked for one.
 */

/**
 * Every ISO 3166-1 alpha-2 code — not every member state — where storing a non-essential identifier
 * on a device needs prior consent, because an ISO code is what the GeoLite reader returns
 * (apps/backend/src/geolocation/country.ts) and several EU territories carry one of their own.
 * The basis is the ePrivacy Directive article 5(3) as transposed across the EEA, and PECR
 * regulation 6 in the UK. Everywhere else this identity is set without asking.
 *
 * The first three lines are the EU 27, the three remaining EEA states (Iceland, Liechtenstein,
 * Norway) and the United Kingdom. The fourth holds the EU territories that ISO separates from their
 * member state and the law does not: Åland (Finland) and the French outermost regions. The
 * Canaries, Azores and Madeira need no entry, because ISO reports them as `ES` and `PT`.
 */
const consentRequiredCountryCodes: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
  "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE",
  "SI", "SK", "GB",
  "AX", "GF", "GP", "MQ", "MF", "RE", "YT",
]);

/** An unresolved country is treated as consent-required: not knowing is not permission. */
export function isConsentRequiredCountry(countryCode: string | null): boolean {
  if (countryCode === null) {
    return true;
  }

  return consentRequiredCountryCodes.has(countryCode);
}

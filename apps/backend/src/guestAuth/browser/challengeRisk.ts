import { unsafeQuery } from "../../database/unsafe";
import { createCountryLookupFailureReporter } from "../../geolocation/countryLookupFailure";
import { getDirectRequestNetworkAsnLookup, isDirectRequestSourceUnknown } from "../../geolocation/requestCountry";
import { normalizeCaughtError, type BackendObservationScope } from "../../observability/sentry";
import { isAutomatedUserAgent } from "../../productAnalytics/automatedClient";
import { parseClientHintChromiumMajor, parseUserAgentChromeMajor } from "../../productAnalytics/browserVersion";

// Mirrors the cloud_networks lists of db/migrations/0241_probable_scraper_fleet_install_and_burst.sql;
// change them together.
export const guestChallengeCloudNetworkAsns: ReadonlySet<number> = new Set([
  16509, 14618, // Amazon AWS
  15169, 396982, // Google, Google Cloud
  8075, // Microsoft
  45102, 37963, // Alibaba Cloud
  132203, 45090, // Tencent Cloud
  136907, 55990, // Huawei Cloud
  31898, // Oracle Cloud
  14061, // DigitalOcean
  16276, // OVH
  24940, // Hetzner
  63949, // Linode / Akamai
  20473, // Vultr
]);

// The same lag the fleet rule marks for app events.
const staleChromeMajorLag = 4;
// The same burst the fleet rule of db/migrations/0241_probable_scraper_fleet_install_and_burst.sql marks.
const chromeVersionBurstAllowedGuests = 10;

export type GuestChallengeFlag =
  | "cloud_network"
  | "network_unknown"
  | "client_hint_mismatch"
  | "stale_chrome"
  | "chrome_version_burst"
  | "automated_user_agent";

export type GuestChallengeRequestFacts = Readonly<{
  userAgent: string | null;
  networkAsn: number | null;
  /** The network could not be derived, so a cloud network cannot be ruled out. */
  networkUnknown: boolean;
  userAgentChromeMajor: number | null;
  clientHintChromiumMajor: number | null;
  currentChromiumMajor: number | null;
  /**
   * Guests created without a check since 00:00 UTC today for the claimed Chrome major; null unless
   * that major is below the current one.
   */
  sameMajorAllowedGuestsToday: number | null;
}>;

export function evaluateGuestChallengeFlags(facts: GuestChallengeRequestFacts): ReadonlyArray<GuestChallengeFlag> {
  const flags: Array<GuestChallengeFlag> = [];
  if (facts.networkAsn !== null && guestChallengeCloudNetworkAsns.has(facts.networkAsn)) {
    flags.push("cloud_network");
  }
  if (facts.networkUnknown) {
    flags.push("network_unknown");
  }
  if (facts.userAgentChromeMajor !== null && facts.clientHintChromiumMajor !== facts.userAgentChromeMajor) {
    flags.push("client_hint_mismatch");
  }
  if (
    facts.userAgentChromeMajor !== null
    && facts.currentChromiumMajor !== null
    && facts.userAgentChromeMajor <= facts.currentChromiumMajor - staleChromeMajorLag
  ) {
    flags.push("stale_chrome");
  }
  if (
    facts.sameMajorAllowedGuestsToday !== null
    && facts.sameMajorAllowedGuestsToday >= chromeVersionBurstAllowedGuests
  ) {
    flags.push("chrome_version_burst");
  }
  if (isAutomatedUserAgent(facts.userAgent)) {
    flags.push("automated_user_agent");
  }
  return flags;
}

async function loadCurrentChromiumMajor(): Promise<number | null> {
  const result = await unsafeQuery<Readonly<{ chromium_major: number }>>(
    `SELECT chromium_major
     FROM analytics.current_chromium_by_day
     WHERE chromium_major IS NOT NULL
     ORDER BY received_on DESC
     LIMIT 1`,
    [],
  );
  return result.rows[0]?.chromium_major ?? null;
}

async function loadSameMajorAllowedGuestsToday(userAgentChromeMajor: number): Promise<number> {
  const result = await unsafeQuery<Readonly<{ allowed_guests: number }>>(
    `SELECT count(*)::int AS allowed_guests
     FROM analytics.guest_browser_checks
     WHERE outcome = 'allowed'
       AND user_agent_chrome_major = $1
       AND checked_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [userAgentChromeMajor],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Counting today's guests created without a check for one Chrome major returned no row.");
  }
  return row.allowed_guests;
}

type ChromeFacts = Readonly<{ currentChromiumMajor: number | null; sameMajorAllowedGuestsToday: number | null }>;

async function loadChromeFacts(userAgentChromeMajor: number | null): Promise<ChromeFacts> {
  if (userAgentChromeMajor === null) {
    return { currentChromiumMajor: null, sameMajorAllowedGuestsToday: null };
  }
  const currentChromiumMajor = await loadCurrentChromiumMajor();
  if (currentChromiumMajor === null || userAgentChromeMajor >= currentChromiumMajor) {
    return { currentChromiumMajor, sameMajorAllowedGuestsToday: null };
  }
  return {
    currentChromiumMajor,
    sameMajorAllowedGuestsToday: await loadSameMajorAllowedGuestsToday(userAgentChromeMajor),
  };
}

const reportNetworkAsnLookupFailure = createCountryLookupFailureReporter();

type NetworkFacts = Readonly<{ networkAsn: number | null; networkUnknown: boolean }>;

// An unknown network fails toward the challenge: a relay marker is caller-controlled on this route
// (the auth service relays only analytics ingest), and a broken GeoLite database must not turn into
// a 500 for every new guest.
async function loadNetworkFacts(scope: BackendObservationScope): Promise<NetworkFacts> {
  if (isDirectRequestSourceUnknown()) {
    return { networkAsn: null, networkUnknown: true };
  }
  const networkAsnLookup = getDirectRequestNetworkAsnLookup();
  if (networkAsnLookup === null) {
    return { networkAsn: null, networkUnknown: false };
  }
  try {
    return { networkAsn: await networkAsnLookup(), networkUnknown: false };
  } catch (error) {
    reportNetworkAsnLookupFailure({
      action: "guest_browser_challenge_network_asn_lookup_failed",
      message: "Guest browser challenge network ASN lookup failed; the request is treated as network_unknown.",
      scope,
      details: { errorMessage: normalizeCaughtError(error).message },
    });
    return { networkAsn: null, networkUnknown: true };
  }
}

export async function loadGuestChallengeRequestFacts(
  userAgent: string | null,
  secChUa: string | null,
  scope: BackendObservationScope,
): Promise<GuestChallengeRequestFacts> {
  const userAgentChromeMajor = parseUserAgentChromeMajor(userAgent);
  const [networkFacts, chromeFacts] = await Promise.all([
    loadNetworkFacts(scope),
    loadChromeFacts(userAgentChromeMajor),
  ]);
  return {
    userAgent,
    networkAsn: networkFacts.networkAsn,
    networkUnknown: networkFacts.networkUnknown,
    userAgentChromeMajor,
    clientHintChromiumMajor: parseClientHintChromiumMajor(secChUa),
    currentChromiumMajor: chromeFacts.currentChromiumMajor,
    sameMajorAllowedGuestsToday: chromeFacts.sameMajorAllowedGuestsToday,
  };
}

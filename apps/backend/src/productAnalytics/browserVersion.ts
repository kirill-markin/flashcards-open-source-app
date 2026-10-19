// Both headers are attacker-controlled request data, so a malformed or out-of-range value is an
// unknown version and never a server failure.

const userAgentChromeMajorPattern = /\bChrome\/(\d+)/u;
// A Sec-CH-UA list member is `"<brand>";v="<version>"`; GREASE brands never contain a comma or a
// double quote, so a member starting with the Chromium brand cannot be spoofed from inside another.
const clientHintChromiumMajorPattern = /(?:^|,)\s*"Chromium"\s*;\s*v\s*=\s*"(\d+)"/u;

function parseMajorVersion(digits: string | undefined): number | null {
  if (digits === undefined) return null;
  const major = Number(digits);
  return Number.isInteger(major) && major > 0 && major < 1000 ? major : null;
}

/** The major of the first `Chrome/<major>` token, or null when the User-Agent claims none. */
export function parseUserAgentChromeMajor(userAgent: string | null): number | null {
  if (userAgent === null) return null;
  return parseMajorVersion(userAgentChromeMajorPattern.exec(userAgent)?.[1]);
}

/** The `"Chromium";v="<major>"` brand of a Sec-CH-UA value, or null when it carries none. */
export function parseClientHintChromiumMajor(secChUa: string | null): number | null {
  if (secChUa === null) return null;
  return parseMajorVersion(clientHintChromiumMajorPattern.exec(secChUa)?.[1]);
}

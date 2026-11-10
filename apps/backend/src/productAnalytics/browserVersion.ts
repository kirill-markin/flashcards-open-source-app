// Both headers are attacker-controlled request data, so a malformed or out-of-range value is an
// unknown version and never a server failure.

const userAgentChromeMajorPattern = /\bChrome\/(\d+)/u;
const userAgentFirefoxPattern = /\b(?:Firefox|FxiOS)\/(\d*)/u;
const userAgentChromiumPattern = /\b(?:Chrome|CriOS)\/(\d*)/u;
const userAgentSafariVersionPattern = /\bVersion\/(\d*)/u;
const userAgentSafariTokenPattern = /\bSafari\//u;
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

export type UserAgentBrowser = Readonly<{
  browser: "chrome" | "firefox" | "safari" | "other";
  major: number | null;
}>;

/**
 * The browser family and major a User-Agent claims. Checked in this order because Chromium browsers
 * (Edge, Opera) also carry `Safari/`, and Firefox and Chrome on iOS also carry `Version/` or `Safari/`.
 */
export function parseUserAgentBrowser(userAgent: string | null): UserAgentBrowser {
  if (userAgent === null) return { browser: "other", major: null };
  const firefox = userAgentFirefoxPattern.exec(userAgent);
  if (firefox !== null) return { browser: "firefox", major: parseMajorVersion(firefox[1]) };
  const chrome = userAgentChromiumPattern.exec(userAgent);
  if (chrome !== null) return { browser: "chrome", major: parseMajorVersion(chrome[1]) };
  const safariVersion = userAgentSafariVersionPattern.exec(userAgent);
  if (safariVersion !== null && userAgentSafariTokenPattern.test(userAgent)) {
    return { browser: "safari", major: parseMajorVersion(safariVersion[1]) };
  }
  return { browser: "other", major: null };
}

/** The `"Chromium";v="<major>"` brand of a Sec-CH-UA value, or null when it carries none. */
export function parseClientHintChromiumMajor(secChUa: string | null): number | null {
  if (secChUa === null) return null;
  return parseMajorVersion(clientHintChromiumMajorPattern.exec(secChUa)?.[1]);
}

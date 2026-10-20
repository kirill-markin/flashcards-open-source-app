export type ClientPlatform = "ios" | "android" | "desktop";

/**
 * Resolves the device family the visitor is browsing from.
 *
 * Android is checked first because Android user agents also contain `Linux`.
 * An iPad that reports `iPad` resolves to `ios` on purpose; it only lands in
 * `desktop` when iPadOS masquerades as a Macintosh, which is a user-agent
 * limitation rather than the intent.
 */
export function resolveClientPlatform(userAgent: string): ClientPlatform {
  if (userAgent.includes("Android")) {
    return "android";
  }

  if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
    return "ios";
  }

  return "desktop";
}

export type ClientDevice = "iphone" | "ipad" | "android" | "desktop";

/**
 * Resolves the device the visitor is browsing from, telling an iPad from an iPhone.
 *
 * iPadOS reports a `Macintosh` user agent by default; a Mac has no touch screen,
 * so a `Macintosh` user agent with more than one touch point is an iPad.
 */
export function resolveClientDevice(userAgent: string, maxTouchPoints: number): ClientDevice {
  if (userAgent.includes("Android")) {
    return "android";
  }

  if (userAgent.includes("iPhone")) {
    return "iphone";
  }

  if (userAgent.includes("iPad") || (userAgent.includes("Macintosh") && maxTouchPoints > 1)) {
    return "ipad";
  }

  return "desktop";
}

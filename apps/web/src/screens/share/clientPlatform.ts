export type ClientPlatform = "ios" | "android" | "desktop";

/**
 * Resolves the device family the visitor is browsing from.
 *
 * Android is checked first because Android user agents also contain `Linux`.
 * iPadOS reports a Macintosh user agent, so an iPad resolves to `desktop` on purpose.
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

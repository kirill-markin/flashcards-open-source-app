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

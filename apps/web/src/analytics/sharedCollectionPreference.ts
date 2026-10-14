import { getAppConfig } from "../config";

const collectionCookieName = "product_analytics_collection";
const collectionCookieMaxAgeSeconds = 395 * 24 * 60 * 60;

export function readSharedProductAnalyticsCollection(): boolean | null {
  for (const entry of document.cookie.split(";")) {
    const separator = entry.indexOf("=");
    if (separator === -1 || entry.slice(0, separator).trim() !== collectionCookieName) {
      continue;
    }

    const value = entry.slice(separator + 1).trim();
    return value === "1" ? true : false;
  }

  return null;
}

/** A preference without an identifier, shared with auth independently of visitor-cookie consent. */
export function writeSharedProductAnalyticsCollection(isCollectionEnabled: boolean): void {
  if (readSharedProductAnalyticsCollection() === isCollectionEnabled) {
    return;
  }

  const apiHostname = new URL(getAppConfig().apiBaseUrl).hostname;
  const separator = apiHostname.indexOf(".");
  const baseDomain = separator === -1 ? "" : apiHostname.slice(separator + 1);
  const domainAttribute = baseDomain.includes(".") ? ` Domain=${baseDomain};` : "";
  const secureAttribute = window.location.protocol === "https:" ? " Secure;" : "";
  document.cookie = `${collectionCookieName}=${isCollectionEnabled ? "1" : "0"};${domainAttribute} Path=/; Max-Age=${collectionCookieMaxAgeSeconds};${secureAttribute} SameSite=Lax`;
}

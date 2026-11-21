export type BrowserDeviceType = "phone" | "tablet" | "desktop";

export function readBrowserDeviceType(): BrowserDeviceType | null {
  const browser = globalThis.navigator;
  const userAgent = browser?.userAgent?.toLowerCase() ?? "";
  const isAndroid = userAgent.includes("android");
  const isMobile = userAgent.includes("mobile");
  // iPadOS can send a Macintosh user agent even though it still reports multitouch.
  const isDesktopModeIpad = userAgent.includes("macintosh") && (browser?.maxTouchPoints ?? 0) > 1;
  if (userAgent.includes("ipad") || isDesktopModeIpad || userAgent.includes("tablet") || (isAndroid && !isMobile)) {
    return "tablet";
  }

  if (isMobile || userAgent.includes("iphone") || userAgent.includes("ipod")) {
    return "phone";
  }

  if (/\b(?:windows nt|macintosh|x11|cros|linux x86_64)\b/u.test(userAgent)) {
    return "desktop";
  }

  return null;
}

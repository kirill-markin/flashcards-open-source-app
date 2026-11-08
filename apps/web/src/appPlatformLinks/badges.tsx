import type { ReactElement } from "react";
import type { AnalyticsStoreDevice } from "../analytics/events";

const appStoreBadgeSrc: string = "/home/app-store-badge.svg";
const googlePlayLockupSrc: string = "/home/google-play-lockup.png";

export function AppStoreBadge(): ReactElement {
  return (
    <img
      alt=""
      className="app-platform-links-badge app-platform-links-badge-app-store"
      height={40}
      src={appStoreBadgeSrc}
      width={120}
    />
  );
}

export function GooglePlayBadge(): ReactElement {
  return (
    <img
      alt=""
      className="app-platform-links-badge app-platform-links-badge-google-play"
      height={61}
      src={googlePlayLockupSrc}
      width={300}
    />
  );
}

export function WebAppIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      className="app-platform-links-icon"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.25" />
      <path d="M3.75 12h16.5" />
      <path d="M12 3.75c2.2 2.2 3.5 5.13 3.5 8.25S14.2 18.05 12 20.25c-2.2-2.2-3.5-5.13-3.5-8.25S9.8 5.95 12 3.75Z" />
    </svg>
  );
}

/** Copied from the marketing site's `DeviceIcon` in `src/components/HomeDeviceLinks.tsx` (website repo). */
export function DeviceIcon({ device }: Readonly<{ device: AnalyticsStoreDevice }>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="header-store-button-icon"
      aria-hidden="true"
    >
      {device === "iphone" && <><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M10 5h4M11 19h2" /></>}
      {device === "ipad" && <><rect x="3" y="2" width="18" height="20" rx="2.5" /><path d="M11 19h2" /></>}
      {device === "mac" && <><rect x="4" y="3" width="16" height="13" rx="1.5" /><path d="m4 16-2 4h20l-2-4M10 17h4" /></>}
      {device === "android" && <><path d="M6 8h12a1 1 0 0 1 1 1v8H5V9a1 1 0 0 1 1-1Zm0 0a6 6 0 0 1 12 0M8 3 6 1m10 2 2-2M2 9v7m20-7v7M8 17v5m8-5v5" /><path d="M8 6h.01M16 6h.01" /></>}
    </svg>
  );
}

/** The official MCP logo, drawn as a line icon to match `DeviceIcon`. */
export function McpIcon(): ReactElement {
  return (
    <svg
      viewBox="2 7 190 190"
      fill="none"
      stroke="currentColor"
      strokeWidth="12.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="header-store-button-icon"
      aria-hidden="true"
    >
      <path d="M25 97.8528L92.8823 29.9706C102.255 20.598 117.451 20.598 126.823 29.9706C136.196 39.3431 136.196 54.5391 126.823 63.9117L75.5581 115.177" />
      <path d="M76.2653 114.47L126.823 63.9117C136.196 54.5391 151.392 54.5391 160.765 63.9117L161.118 64.2652C170.491 73.6378 170.491 88.8338 161.118 98.2063L99.7248 159.6C96.6006 162.724 96.6006 167.789 99.7248 170.913L112.331 183.52" />
      <path d="M109.853 46.9411L59.6482 97.1457C50.2757 106.518 50.2757 121.714 59.6482 131.087C69.0208 140.459 84.2168 140.459 93.5894 131.087L143.794 80.8822" />
    </svg>
  );
}

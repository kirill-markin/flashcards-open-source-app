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

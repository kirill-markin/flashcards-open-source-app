import type { ReactElement } from "react";

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

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

export function AppleLogoIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="header-store-button-icon" aria-hidden="true">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

export function GooglePlayIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="header-store-button-icon" aria-hidden="true">
      <path fill="#4285F4" d="M3.5 2 13 12 3.5 22Z" />
      <path fill="#34A853" d="M3.5 2 16.1 9 13 12Z" />
      <path fill="#FBBC04" d="M16.1 9 21 12 16.1 15 13 12Z" />
      <path fill="#EA4335" d="M13 12 16.1 15 3.5 22Z" />
    </svg>
  );
}

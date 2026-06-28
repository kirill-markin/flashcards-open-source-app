import type { ReactElement } from "react";
import { Link } from "react-router-dom";

const appStoreBadgeSrc: string = "/home/app-store-badge.svg";
const googlePlayLockupSrc: string = "/home/google-play-lockup.png";

export type AppPlatformStoreLinks = Readonly<{
  ios: string;
  android: string;
}>;

export const defaultAppPlatformStoreLinks: AppPlatformStoreLinks = {
  ios: "https://apps.apple.com/us/app/flashcards-open-source-app/id6760538964",
  android: "https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&pcampaignid=web_share",
};

export type AppPlatformLinkLabels = Readonly<{
  ios: string;
  android: string;
  web: string;
}>;

type AppPlatformLinksProps = Readonly<{
  labels: AppPlatformLinkLabels;
  storeLinks: AppPlatformStoreLinks;
  webRoute: string;
  webHref: string;
  gridTestId: string;
  webHrefTestId: string;
}>;

function WebAppIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      className="invite-platform-icon"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.25" />
      <path d="M3.75 12h16.5" />
      <path d="M12 3.75c2.2 2.2 3.5 5.13 3.5 8.25S14.2 18.05 12 20.25c-2.2-2.2-3.5-5.13-3.5-8.25S9.8 5.95 12 3.75Z" />
    </svg>
  );
}

export function AppPlatformLinks({
  labels,
  storeLinks,
  webRoute,
  webHref,
  gridTestId,
  webHrefTestId,
}: AppPlatformLinksProps): ReactElement {
  return (
    <div className="invite-link-grid" data-testid={gridTestId}>
      <a
        className="invite-platform-link"
        href={storeLinks.ios}
        rel="noreferrer"
        target="_blank"
        aria-label={labels.ios}
        data-testid="app-platform-link-ios"
      >
        <img
          alt=""
          className="invite-platform-badge invite-platform-badge-app-store"
          height={40}
          src={appStoreBadgeSrc}
          width={120}
        />
      </a>
      <a
        className="invite-platform-link"
        href={storeLinks.android}
        rel="noreferrer"
        target="_blank"
        aria-label={labels.android}
        data-testid="app-platform-link-android"
      >
        <img
          alt=""
          className="invite-platform-badge invite-platform-badge-google-play"
          height={61}
          src={googlePlayLockupSrc}
          width={300}
        />
      </a>
      <Link
        className="invite-platform-link"
        to={webRoute}
        aria-label={labels.web}
        data-testid="app-platform-link-web"
      >
        <WebAppIcon />
        <span className="invite-platform-label">{labels.web}</span>
      </Link>
      <span data-testid={webHrefTestId} hidden>{webHref}</span>
    </div>
  );
}

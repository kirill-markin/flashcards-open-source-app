import type { ReactElement } from "react";
import {
  AppPlatformLinksGrid,
  buildAppPlatformOptions,
  resolveClientPlatform,
  type AppPlatformStoreLinks,
} from "../../appPlatformLinks";
import { getAppConfig } from "../../config";
import { useI18n } from "../../i18n";
import { reviewRoute } from "../../routes";

export const shareAppStoreLinks: AppPlatformStoreLinks = {
  ios: "https://apps.apple.com/app/apple-store/id6760538964?pt=128797295&ct=share_app&mt=8",
  android: "https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&utm_source=flashcards_website&utm_medium=referral&utm_campaign=share_app",
};

export function ShareAppScreen(): ReactElement {
  const { t } = useI18n();
  const webHref: string = `${getAppConfig().appBaseUrl}${reviewRoute}`;

  return (
    <main className="invite-page">
      <section className="content-card invite-panel" data-testid="share-app-screen">
        <h1 className="title">{t("shareApp.title")}</h1>
        <p className="subtitle">{t("shareApp.body")}</p>
        <AppPlatformLinksGrid
          options={buildAppPlatformOptions({
            platforms: ["ios", "android", "web", "mcp"],
            storeLinks: shareAppStoreLinks,
            webHref,
            labels: {
              ios: t("appPlatformLinks.ios"),
              android: t("appPlatformLinks.android"),
              web: t("appPlatformLinks.web"),
              mcp: t("appPlatformLinks.mcp.label"),
            },
            qrTitles: {
              ios: t("appPlatformLinks.qr.ios"),
              android: t("appPlatformLinks.qr.android"),
            },
            clientPlatform: resolveClientPlatform(navigator.userAgent),
          })}
          testIdPrefix="share-app"
        />
      </section>
    </main>
  );
}

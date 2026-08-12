import type { ReactElement } from "react";
import {
  AppPlatformLinksGrid,
  buildAppPlatformOptions,
  resolveClientPlatform,
  shareAppStoreLinks,
} from "../../appPlatformLinks";
import { getAppConfig } from "../../config";
import { useI18n } from "../../i18n";
import { reviewRoute } from "../../routes";

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

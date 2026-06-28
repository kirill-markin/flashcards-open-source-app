import type { ReactElement } from "react";
import { getAppConfig } from "../../config";
import { useI18n } from "../../i18n";
import { reviewRoute } from "../../routes";
import { AppPlatformLinks, type AppPlatformStoreLinks } from "./AppPlatformLinks";

const shareAppStoreLinks: AppPlatformStoreLinks = {
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
        <AppPlatformLinks
          labels={{
            ios: t("shareApp.links.ios"),
            android: t("shareApp.links.android"),
            web: t("shareApp.links.web"),
          }}
          storeLinks={shareAppStoreLinks}
          webRoute={reviewRoute}
          webHref={webHref}
          gridTestId="share-app-platform-links"
          webHrefTestId="share-app-web-link-value"
        />
      </section>
    </main>
  );
}

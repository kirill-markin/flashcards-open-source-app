import type { ReactElement } from "react";
import { getAppConfig } from "../../config";
import { useI18n } from "../../i18n";
import { reviewRoute } from "../../routes";
import { AppPlatformLinks } from "./AppPlatformLinks";

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
          webRoute={reviewRoute}
          webHref={webHref}
          gridTestId="share-app-platform-links"
          webHrefTestId="share-app-web-link-value"
        />
      </section>
    </main>
  );
}

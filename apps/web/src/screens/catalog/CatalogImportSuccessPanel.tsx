import type { ReactElement } from "react";
import {
  AppPlatformLinksGrid,
  buildAppPlatformOptions,
  catalogImportStoreLinks,
  resolveClientPlatform,
} from "../../appPlatformLinks";
import { getAppConfig } from "../../config";
import { useI18n } from "../../i18n";
import { reviewRoute } from "../../routes";

type CatalogImportSuccessPanelProps = Readonly<{
  cardCount: number;
  importTag: string | null;
  workspaceName: string;
  accountEmail: string | null;
}>;

function CatalogImportSuccessCheck(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      className="catalog-import-success-check"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m7.9 12.3 2.7 2.7 5.5-5.8" />
    </svg>
  );
}

export function CatalogImportSuccessPanel(props: CatalogImportSuccessPanelProps): ReactElement {
  const { cardCount, importTag, workspaceName, accountEmail } = props;
  const { t } = useI18n();
  const platformOptions = buildAppPlatformOptions({
    platforms: ["ios", "android", "web", "mcp"],
    storeLinks: catalogImportStoreLinks,
    webHref: `${getAppConfig().appBaseUrl}${reviewRoute}`,
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
  });
  const summaryMessage = importTag === null
    ? t("catalogImport.success", { count: cardCount })
    : t("catalogImport.successWithTag", { count: cardCount, tag: importTag });
  const sameEmailNote = accountEmail === null
    ? t("catalogImport.successSameEmailNote")
    : t("catalogImport.successSameEmailNoteWithAddress", { email: accountEmail });

  return (
    <section className="content-card invite-panel" data-testid="catalog-import-success">
      <div className="catalog-import-success-header">
        <CatalogImportSuccessCheck />
        <div className="catalog-import-success-headline">
          <strong className="panel-subtitle">{t("catalogImport.successTitle")}</strong>
          <p className="subtitle" data-testid="workspace-import-success">{summaryMessage}</p>
        </div>
      </div>
      {accountEmail === null ? null : (
        <p className="catalog-import-target">
          <span className="catalog-import-target-label">{t("catalogImport.successAccountLabel")}</span>
          <strong
            className="catalog-import-target-account"
            data-testid="catalog-import-success-account"
          >
            {accountEmail}
          </strong>
        </p>
      )}
      <p className="catalog-import-target">
        <span className="catalog-import-target-label">{t("catalogImport.successWorkspaceLabel")}</span>
        <strong data-testid="catalog-import-success-workspace">{workspaceName}</strong>
      </p>
      <p className="invite-note" data-testid="catalog-import-success-email-note">{sameEmailNote}</p>
      <AppPlatformLinksGrid options={platformOptions} testIdPrefix="catalog-import-success" />
    </section>
  );
}

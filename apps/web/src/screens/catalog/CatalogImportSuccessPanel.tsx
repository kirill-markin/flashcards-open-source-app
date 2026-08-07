import type { ReactElement } from "react";
import { getAppConfig } from "../../config";
import { type TranslationKey, type TranslationValues, useI18n } from "../../i18n";
import { reviewRoute } from "../../routes";
import {
  AppStoreBadge,
  GooglePlayBadge,
  WebAppIcon,
  type AppPlatformStoreLinks,
} from "../share/AppPlatformLinks";
import { MobileAppQrCode } from "../share/MobileAppQrCode";
import { type ClientPlatform, resolveClientPlatform } from "../share/clientPlatform";

export const catalogImportStoreLinks: AppPlatformStoreLinks = {
  ios: "https://apps.apple.com/app/apple-store/id6760538964?pt=128797295&ct=catalog_import&mt=8",
  android: "https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&utm_source=flashcards_website&utm_medium=referral&utm_campaign=catalog_import",
};

type CatalogImportSuccessPanelProps = Readonly<{
  cardCount: number;
  importTag: string | null;
  workspaceName: string;
  accountEmail: string | null;
}>;

type CatalogImportSuccessOption = Readonly<{
  platform: "ios" | "android" | "web";
  href: string;
  label: string;
  badge: ReactElement;
  qrTitle: string | null;
}>;

type TranslateFunction = (key: TranslationKey, values?: TranslationValues) => string;

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

/**
 * A QR code only helps when the visitor can scan it with another physical device,
 * so the platform they are already browsing from never shows one, and the web
 * option never shows one at all.
 */
function buildCatalogImportSuccessOptions(
  clientPlatform: ClientPlatform,
  t: TranslateFunction,
): ReadonlyArray<CatalogImportSuccessOption> {
  const iosOption: CatalogImportSuccessOption = {
    platform: "ios",
    href: catalogImportStoreLinks.ios,
    label: t("catalogImport.successOpenIos"),
    badge: <AppStoreBadge />,
    qrTitle: clientPlatform === "ios" ? null : t("mobileAppPromo.ios.qrLabel"),
  };
  const androidOption: CatalogImportSuccessOption = {
    platform: "android",
    href: catalogImportStoreLinks.android,
    label: t("catalogImport.successOpenAndroid"),
    badge: <GooglePlayBadge />,
    qrTitle: clientPlatform === "android" ? null : t("mobileAppPromo.android.qrLabel"),
  };
  const webOption: CatalogImportSuccessOption = {
    platform: "web",
    href: `${getAppConfig().appBaseUrl}${reviewRoute}`,
    label: t("catalogImport.successOpenWeb"),
    badge: (
      <>
        <WebAppIcon />
        <span className="catalog-import-success-option-label">{t("catalogImport.successOpenWeb")}</span>
      </>
    ),
    qrTitle: null,
  };

  return clientPlatform === "android"
    ? [androidOption, iosOption, webOption]
    : [iosOption, androidOption, webOption];
}

export function CatalogImportSuccessPanel(props: CatalogImportSuccessPanelProps): ReactElement {
  const { cardCount, importTag, workspaceName, accountEmail } = props;
  const { t } = useI18n();
  const options = buildCatalogImportSuccessOptions(resolveClientPlatform(navigator.userAgent), t);
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
      <div className="catalog-import-success-platforms">
        {options.map((option) => (
          <a
            key={option.platform}
            className={`catalog-import-success-option catalog-import-success-option-${option.platform}`}
            href={option.href}
            rel="noreferrer"
            target="_blank"
            aria-label={option.label}
            data-testid={`catalog-import-success-link-${option.platform}`}
          >
            {option.badge}
            {option.qrTitle === null ? null : (
              <span className="catalog-import-success-qr-frame">
                <MobileAppQrCode
                  title={option.qrTitle}
                  value={option.href}
                  testId={`catalog-import-success-qr-${option.platform}`}
                />
              </span>
            )}
          </a>
        ))}
      </div>
    </section>
  );
}

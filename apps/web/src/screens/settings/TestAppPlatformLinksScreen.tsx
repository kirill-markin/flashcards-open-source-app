import type { ReactElement } from "react";
import {
  AppPlatformLinksGrid,
  buildAppPlatformOptions,
  resolveClientPlatform,
  type AppPlatformKind,
  type AppPlatformStoreLinks,
} from "../../appPlatformLinks";
import { getAppConfig } from "../../config";
import { type TranslationKey, type TranslationValues, useI18n } from "../../i18n";
import { progressLeaderboardRoute, reviewRoute } from "../../routes";
import { CatalogImportSuccessPanel, catalogImportStoreLinks } from "../catalog/CatalogImportSuccessPanel";
import { friendInviteStoreLinks } from "../invite/FriendInviteScreen";
import { webReviewMobilePromptStoreLinks } from "../review/mobileAppPromo/MobileAppPromotionDialog";
import { shareAppStoreLinks } from "../share/ShareAppScreen";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;

type TestAppPlatformSurface = Readonly<{
  id: string;
  heading: string;
  platforms: ReadonlyArray<AppPlatformKind>;
  storeLinks: AppPlatformStoreLinks;
  webHref: string | null;
}>;

const testCatalogImportSuccessCardCount: number = 42;
const testCatalogImportSuccessImportTag: string = "spanish-a1";
const testCatalogImportSuccessWorkspaceName: string = "Personal";
const testCatalogImportSuccessAccountEmail: string = "learner@example.com";

function buildTestAppPlatformSurfaces(t: Translate, appBaseUrl: string): ReadonlyArray<TestAppPlatformSurface> {
  const reviewWebHref: string = `${appBaseUrl}${reviewRoute}`;

  return [
    {
      id: "share",
      heading: t("settingsTest.appPlatformLinks.surfaces.share"),
      platforms: ["ios", "android", "web", "mcp"],
      storeLinks: shareAppStoreLinks,
      webHref: reviewWebHref,
    },
    {
      id: "review-promo",
      heading: t("settingsTest.appPlatformLinks.surfaces.reviewPromo"),
      platforms: ["ios", "android", "mcp"],
      storeLinks: webReviewMobilePromptStoreLinks,
      webHref: null,
    },
    {
      id: "catalog-import",
      heading: t("settingsTest.appPlatformLinks.surfaces.catalogImport"),
      platforms: ["ios", "android", "web", "mcp"],
      storeLinks: catalogImportStoreLinks,
      webHref: reviewWebHref,
    },
    {
      id: "friend-invite",
      heading: t("settingsTest.appPlatformLinks.surfaces.friendInvite"),
      platforms: ["ios", "android", "web", "mcp"],
      storeLinks: friendInviteStoreLinks,
      webHref: `${appBaseUrl}${progressLeaderboardRoute}`,
    },
  ];
}

export function TestAppPlatformLinksScreen(): ReactElement {
  const { t } = useI18n();
  const clientPlatform = resolveClientPlatform(navigator.userAgent);
  const surfaces = buildTestAppPlatformSurfaces(t, getAppConfig().appBaseUrl);

  return (
    <SettingsShell
      title={t("settingsTest.appPlatformLinks.screenTitle")}
      subtitle={t("settingsTest.appPlatformLinks.screenSubtitle")}
      activeTab="test"
    >
      <div className="settings-test-app-platform-links-list" data-testid="test-app-platform-links-screen">
        {surfaces.map((surface) => (
          <SettingsGroup key={surface.id} title={surface.heading}>
            <AppPlatformLinksGrid
              options={buildAppPlatformOptions({
                platforms: surface.platforms,
                storeLinks: surface.storeLinks,
                webHref: surface.webHref,
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
                clientPlatform,
              })}
              testIdPrefix={`test-app-platform-links-${surface.id}`}
            />
          </SettingsGroup>
        ))}
      </div>
    </SettingsShell>
  );
}

export function TestCatalogImportSuccessScreen(): ReactElement {
  const { t } = useI18n();

  return (
    <SettingsShell
      title={t("settingsTest.catalogImportSuccess.screenTitle")}
      subtitle={t("settingsTest.catalogImportSuccess.screenSubtitle")}
      activeTab="test"
    >
      <div data-testid="test-catalog-import-success-screen">
        <CatalogImportSuccessPanel
          cardCount={testCatalogImportSuccessCardCount}
          importTag={testCatalogImportSuccessImportTag}
          workspaceName={testCatalogImportSuccessWorkspaceName}
          accountEmail={testCatalogImportSuccessAccountEmail}
        />
      </div>
    </SettingsShell>
  );
}

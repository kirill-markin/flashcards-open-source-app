import type { ReactElement } from "react";
import { useAppData } from "../appData";
import { webAppBuild, webAppVersion } from "../clientIdentity";
import { autoLocalePreference, supportedLocales, type Locale, type LocalePreference, type TranslationKey, useI18n } from "../i18n";
import { SettingsShell } from "./SettingsShared";

type WebDeviceInfo = Readonly<{
  operatingSystem: string;
  browser: string;
  version: string;
  build: string;
  client: string;
  storage: string;
  installationId: string;
  workspaceScope: string;
}>;

type WebDeviceInfoStaticStrings = Readonly<{
  clientBrowser: string;
  storage: string;
  unavailable: string;
  workspaceScope: string;
}>;

function formatUnavailable(value: string | null, unavailableLabel: string): string {
  if (value === null || value.trim() === "") {
    return unavailableLabel;
  }

  return value;
}

function detectOperatingSystem(userAgent: string): string {
  if (userAgent.includes("Windows")) {
    return "Windows";
  }

  if (userAgent.includes("Mac OS X")) {
    return "macOS";
  }

  if (userAgent.includes("Android")) {
    return "Android";
  }

  if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
    return "iOS";
  }

  if (userAgent.includes("Linux")) {
    return "Linux";
  }

  return "";
}

function detectBrowser(userAgent: string): string {
  if (userAgent.includes("Edg/")) {
    return "Microsoft Edge";
  }

  if (userAgent.includes("Chrome/") && userAgent.includes("Edg/") === false) {
    return "Chrome";
  }

  if (userAgent.includes("Firefox/")) {
    return "Firefox";
  }

  if (userAgent.includes("Safari/") && userAgent.includes("Chrome/") === false) {
    return "Safari";
  }

  return "";
}

function localeNameKey(locale: Locale): TranslationKey {
  return locale === "es" ? "locale.names.es" : "locale.names.en";
}

function parseLocalePreference(value: string): LocalePreference {
  if (value === autoLocalePreference) {
    return autoLocalePreference;
  }

  const locale = supportedLocales.find((supportedLocale) => supportedLocale === value);
  if (locale !== undefined) {
    return locale;
  }

  throw new Error(`Unsupported locale preference: ${value}`);
}

function formatLocalePreferenceLabel(
  localePreference: LocalePreference,
  t: (key: TranslationKey) => string,
): string {
  if (localePreference === "auto") {
    return t("locale.preferenceAuto");
  }

  return t(localeNameKey(localePreference));
}

function buildWebDeviceInfo(installationId: string, strings: WebDeviceInfoStaticStrings): WebDeviceInfo {
  const userAgent = navigator.userAgent;

  return {
    operatingSystem: formatUnavailable(detectOperatingSystem(userAgent), strings.unavailable),
    browser: formatUnavailable(detectBrowser(userAgent), strings.unavailable),
    version: webAppVersion,
    build: formatUnavailable(webAppBuild, strings.unavailable),
    client: strings.clientBrowser,
    storage: strings.storage,
    installationId,
    workspaceScope: strings.workspaceScope,
  };
}

export function ThisDeviceSettingsScreen(): ReactElement {
  const { activeWorkspace, cloudSettings } = useAppData();
  const { locale, localePreference, setLocalePreference, t } = useI18n();
  const unavailableLabel = t("common.unavailable");
  const deviceInfo = buildWebDeviceInfo(cloudSettings?.installationId ?? unavailableLabel, {
    unavailable: unavailableLabel,
    clientBrowser: t("settingsDevice.values.clientBrowser"),
    storage: t("settingsDevice.values.storage"),
    workspaceScope: t("settingsDevice.values.workspaceScope"),
  });
  const localeLabel = t(localeNameKey(locale));
  const localePreferenceLabel = formatLocalePreferenceLabel(localePreference, t);

  return (
    <SettingsShell
      title={t("settingsDevice.title")}
      subtitle={t("settingsDevice.subtitle")}
      activeTab="device"
    >
      <div className="settings-nav-list">
        <article className="content-card settings-summary-card" data-testid="device-language-preference-card">
          <div className="cell-stack">
            <strong className="panel-subtitle">{t("settingsDevice.languageCardTitle")}</strong>
            <p className="subtitle">{t("settingsDevice.languageCardDescription")}</p>
          </div>
          <label className="cell-stack" htmlFor="device-language-preference">
            <span className="cell-secondary">{t("locale.labels.languageSelection")}</span>
            <select
              id="device-language-preference"
              className="settings-select"
              value={localePreference}
              data-testid="device-language-preference-select"
              onChange={(event) => {
                setLocalePreference(parseLocalePreference(event.target.value));
              }}
            >
              <option value={autoLocalePreference}>{t("locale.preferenceAuto")}</option>
              {supportedLocales.map((supportedLocale) => (
                <option key={supportedLocale} value={supportedLocale}>
                  {t(localeNameKey(supportedLocale))}
                </option>
              ))}
            </select>
          </label>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("locale.labels.appLanguage")}</span>
          <strong className="panel-subtitle">{localeLabel}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("locale.labels.languagePreference")}</span>
          <strong className="panel-subtitle">{localePreferenceLabel}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("settingsDevice.labels.workspace")}</span>
          <strong className="panel-subtitle">{activeWorkspace?.name ?? unavailableLabel}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("settingsDevice.labels.operatingSystem")}</span>
          <strong className="panel-subtitle">{deviceInfo.operatingSystem}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("settingsDevice.labels.browser")}</span>
          <strong className="panel-subtitle">{deviceInfo.browser}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("settingsDevice.labels.appVersion")}</span>
          <strong className="panel-subtitle">{deviceInfo.version}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("settingsDevice.labels.build")}</span>
          <strong className="panel-subtitle">{deviceInfo.build}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("settingsDevice.labels.client")}</span>
          <strong className="panel-subtitle">{deviceInfo.client}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("settingsDevice.labels.storage")}</span>
          <strong className="panel-subtitle">{deviceInfo.storage}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("settingsDevice.labels.installationId")}</span>
          <strong className="panel-subtitle txn-cell-mono">{deviceInfo.installationId}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("settingsDevice.labels.workspaceScope")}</span>
          <p className="subtitle">{deviceInfo.workspaceScope}</p>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("settingsDevice.labels.localData")}</span>
          <p className="subtitle">{t("settingsDevice.values.localData")}</p>
        </article>
      </div>
    </SettingsShell>
  );
}

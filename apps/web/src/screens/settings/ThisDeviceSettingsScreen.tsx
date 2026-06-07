import { useRef, type ReactElement } from "react";
import { useAppData } from "../../appData";
import { webAppBuild, webAppVersion } from "../../clientIdentity";
import { useI18n } from "../../i18n";
import { useTestMode } from "../../testMode";
import { useTransientMessage } from "../../useTransientMessage";
import { SettingsShell } from "./SettingsShared";

const testModeUnlockRequiredTapCount: number = 5;
const testModeUnlockMaximumTapIntervalMillis: number = 2000;

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
  const { t } = useI18n();
  const { toggleTestMode } = useTestMode();
  const { message, showMessage } = useTransientMessage(3000);
  const appVersionTapCountRef = useRef<number>(0);
  const lastAppVersionTapAtRef = useRef<number | null>(null);
  const unavailableLabel = t("common.unavailable");
  const deviceInfo = buildWebDeviceInfo(cloudSettings?.installationId ?? unavailableLabel, {
    unavailable: unavailableLabel,
    clientBrowser: t("settingsDevice.values.clientBrowser"),
    storage: t("settingsDevice.values.storage"),
    workspaceScope: t("settingsDevice.values.workspaceScope"),
  });

  function handleAppVersionTap(now: number): void {
    const lastAppVersionTapAt = lastAppVersionTapAtRef.current;
    const nextTapCount = lastAppVersionTapAt !== null
      && now - lastAppVersionTapAt <= testModeUnlockMaximumTapIntervalMillis
      ? appVersionTapCountRef.current + 1
      : 1;

    lastAppVersionTapAtRef.current = now;

    if (nextTapCount < testModeUnlockRequiredTapCount) {
      appVersionTapCountRef.current = nextTapCount;
      return;
    }

    appVersionTapCountRef.current = 0;
    lastAppVersionTapAtRef.current = null;

    const isEnabled = toggleTestMode();
    showMessage(isEnabled ? t("testMode.enabledMessage") : t("testMode.disabledMessage"));
  }

  return (
    <SettingsShell
      title={t("settingsDevice.title")}
      subtitle={t("settingsDevice.subtitle")}
      activeTab="device"
    >
      {message === "" ? null : <p className="settings-temporary-banner" role="status">{message}</p>}

      <div className="settings-nav-list">
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
          <button
            className="settings-hidden-trigger"
            type="button"
            onClick={() => handleAppVersionTap(Date.now())}
          >
            <strong className="panel-subtitle">{deviceInfo.version}</strong>
          </button>
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

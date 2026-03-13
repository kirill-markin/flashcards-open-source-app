import type { ReactElement } from "react";
import { getStableDeviceId, webAppBuild, webAppVersion } from "../clientIdentity";
import { SettingsShell } from "./SettingsShared";
import { useAppData } from "../appData";

type WebDeviceInfo = Readonly<{
  operatingSystem: string;
  browser: string;
  version: string;
  build: string;
  client: string;
  storage: string;
  deviceId: string;
  workspaceScope: string;
}>;

function formatUnavailable(value: string | null): string {
  if (value === null || value.trim() === "") {
    return "Unavailable";
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

  return "Unavailable";
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

  return "Unavailable";
}

function buildWebDeviceInfo(deviceId: string): WebDeviceInfo {
  const userAgent = navigator.userAgent;

  return {
    operatingSystem: formatUnavailable(detectOperatingSystem(userAgent)),
    browser: formatUnavailable(detectBrowser(userAgent)),
    version: formatUnavailable(webAppVersion),
    build: formatUnavailable(webAppBuild),
    client: "Browser",
    storage: "IndexedDB + localStorage",
    deviceId,
    workspaceScope: "Future sync stays scoped to the currently selected workspace on this device.",
  };
}

export function ThisDeviceSettingsScreen(): ReactElement {
  const { activeWorkspace } = useAppData();
  const deviceInfo = buildWebDeviceInfo(getStableDeviceId());

  return (
    <SettingsShell
      title="This Device"
      subtitle="Review browser-local behavior for this workspace on this device."
      activeSection="workspace"
    >
      <div className="settings-nav-list">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Workspace</span>
          <strong className="panel-subtitle">{activeWorkspace?.name ?? "Unavailable"}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Operating system</span>
          <strong className="panel-subtitle">{deviceInfo.operatingSystem}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Browser</span>
          <strong className="panel-subtitle">{deviceInfo.browser}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">App version</span>
          <strong className="panel-subtitle">{deviceInfo.version}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Build</span>
          <strong className="panel-subtitle">{deviceInfo.build}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Client</span>
          <strong className="panel-subtitle">{deviceInfo.client}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Storage</span>
          <strong className="panel-subtitle">{deviceInfo.storage}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Device ID</span>
          <strong className="panel-subtitle txn-cell-mono">{deviceInfo.deviceId}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Workspace scope</span>
          <p className="subtitle">{deviceInfo.workspaceScope}</p>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Local data</span>
          <p className="subtitle">The local cache keeps cards, decks, scheduler settings, and pending sync operations on this device.</p>
        </article>
      </div>
    </SettingsShell>
  );
}

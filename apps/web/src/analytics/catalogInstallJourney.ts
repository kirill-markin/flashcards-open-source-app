import { ApiContractError } from "../apiContracts/core";
import { ApiError, ApiNetworkError, AuthRedirectError } from "../api/transport/errors";
import { getAppConfig } from "../config";
import { isAnalyticsEnabledForCurrentRuntime } from "./client";
import { analyticsUuidPattern } from "./events";
import { createAnalyticsUuidV7 } from "./identity";
import { readAnalyticsUiLocale } from "./wire";

export type CatalogInstallFailureStage =
  | "landing"
  | "signin"
  | "preview"
  | "preinstall_sync"
  | "install"
  | "postinstall_sync";

export type CatalogInstallFailureReason =
  | "invalid_link"
  | "package_unavailable"
  | "workspace_unavailable"
  | "invalid_code"
  | "expired_code"
  | "code_already_used"
  | "rate_limited"
  | "offline"
  | "timeout"
  | "network_error"
  | "unauthorized"
  | "conflict"
  | "storage_error"
  | "contract_error"
  | "server_error"
  | "cancelled";

type CatalogInstallJourneyEvent =
  | Readonly<{ eventName: "catalog_install_landed"; authState: "signed_in" | "signed_out" }>
  | Readonly<{ eventName: "catalog_install_signin_started" }>
  | Readonly<{ eventName: "catalog_install_preview_ready" }>
  | Readonly<{
    eventName: "catalog_install_failed";
    stage: CatalogInstallFailureStage;
    reason: CatalogInstallFailureReason;
  }>;

type CatalogInstallJourneyProperties = Readonly<Record<string, string>>;

const installJourneyParameterName = "install_journey_id";
const onceKeyPrefix = "catalog-install-analytics:";
const emittedOnceKeys = new Set<string>();

function readDeviceLocale(): string | null {
  const value = navigator.language.trim();
  if (value === "" || value.length > 64) {
    return null;
  }

  try {
    const normalizedLocale = new Intl.Locale(value).toString();
    return normalizedLocale.length <= 64 ? normalizedLocale : null;
  } catch {
    return null;
  }
}

function buildProperties(
  installJourneyId: string,
  packageVersionId: string,
  event: CatalogInstallJourneyEvent,
): CatalogInstallJourneyProperties {
  const sharedProperties = {
    install_journey_id: installJourneyId,
    package_version_id: packageVersionId,
  };

  switch (event.eventName) {
    case "catalog_install_landed":
      return { ...sharedProperties, auth_state: event.authState };
    case "catalog_install_signin_started":
    case "catalog_install_preview_ready":
      return sharedProperties;
    case "catalog_install_failed":
      return { ...sharedProperties, stage: event.stage, reason: event.reason };
  }
}

function readResponseMetadata(value: unknown): Readonly<{
  code: string | null;
  requestId: string | null;
}> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { code: null, requestId: null };
  }

  const objectValue = value as Readonly<Record<string, unknown>>;
  return {
    code: typeof objectValue.code === "string" ? objectValue.code : null,
    requestId: typeof objectValue.requestId === "string" ? objectValue.requestId : null,
  };
}

function warnCatalogInstallAnalyticsDelivery(
  event: CatalogInstallJourneyEvent,
  statusCode: number | null,
  code: string | null,
  requestId: string | null,
): void {
  console.warn("Catalog install analytics delivery failed", {
    eventName: event.eventName,
    stage: event.eventName === "catalog_install_failed" ? event.stage : null,
    reason: event.eventName === "catalog_install_failed" ? event.reason : null,
    statusCode,
    code,
    requestId,
  });
}

async function sendCatalogInstallJourneyEvent(
  installJourneyId: string,
  packageVersionId: string,
  event: CatalogInstallJourneyEvent,
): Promise<boolean> {
  if (isAnalyticsEnabledForCurrentRuntime() === false) {
    return true;
  }

  const clientOccurredAt = new Date().toISOString();
  try {
    const response = await fetch(`${getAppConfig().apiBaseUrl}/analytics/catalog-install-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      keepalive: true,
      body: JSON.stringify({
        eventId: createAnalyticsUuidV7(),
        eventName: event.eventName,
        clientOccurredAt,
        uiLocale: readAnalyticsUiLocale(),
        clientSentAt: new Date().toISOString(),
        deviceLocale: readDeviceLocale(),
        properties: buildProperties(installJourneyId, packageVersionId, event),
      }),
    });
    if (response.ok) {
      return true;
    }

    let metadata: ReturnType<typeof readResponseMetadata> = { code: null, requestId: null };
    try {
      metadata = readResponseMetadata(await response.json());
    } catch {
      // The status and response request ID still identify the bounded delivery failure.
    }
    warnCatalogInstallAnalyticsDelivery(
      event,
      response.status,
      metadata.code,
      response.headers.get("X-Request-Id") ?? metadata.requestId,
    );
    return false;
  } catch {
    warnCatalogInstallAnalyticsDelivery(event, null, null, null);
    return false;
  }
}

function readOnceKey(key: string): boolean {
  if (emittedOnceKeys.has(key)) {
    return true;
  }

  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeOnceKey(key: string): void {
  emittedOnceKeys.add(key);
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // The in-memory key still deduplicates this page lifetime.
  }
}

function removeOnceKey(key: string): void {
  emittedOnceKeys.delete(key);
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // The in-memory key has still been released for this page lifetime.
  }
}

function reportCatalogInstallJourneyEventOnce(
  installJourneyId: string | null,
  packageVersionId: string,
  event: CatalogInstallJourneyEvent,
): void {
  if (installJourneyId === null || isAnalyticsEnabledForCurrentRuntime() === false) {
    return;
  }

  const onceKey = `${onceKeyPrefix}${installJourneyId}:${packageVersionId}:${event.eventName}`;
  if (readOnceKey(onceKey)) {
    return;
  }

  writeOnceKey(onceKey);
  void sendCatalogInstallJourneyEvent(installJourneyId, packageVersionId, event).then((wasAccepted) => {
    if (wasAccepted === false) {
      removeOnceKey(onceKey);
    }
  });
}

function reportCatalogInstallJourneyEvent(
  installJourneyId: string | null,
  packageVersionId: string,
  event: CatalogInstallJourneyEvent,
): void {
  if (installJourneyId === null || isAnalyticsEnabledForCurrentRuntime() === false) {
    return;
  }

  void sendCatalogInstallJourneyEvent(installJourneyId, packageVersionId, event);
}

export function readOrCreateCatalogInstallJourneyId(): string | null {
  try {
    const currentUrl = new URL(window.location.href);
    if (isAnalyticsEnabledForCurrentRuntime() === false) {
      if (currentUrl.searchParams.has(installJourneyParameterName)) {
        currentUrl.searchParams.delete(installJourneyParameterName);
        window.history.replaceState(window.history.state, "", currentUrl.toString());
      }
      return null;
    }

    const suppliedValue = currentUrl.searchParams.get(installJourneyParameterName)?.trim().toLowerCase() ?? "";
    const installJourneyId = analyticsUuidPattern.test(suppliedValue)
      ? suppliedValue
      : crypto.randomUUID().toLowerCase();

    currentUrl.searchParams.set(installJourneyParameterName, installJourneyId);
    window.history.replaceState(window.history.state, "", currentUrl.toString());
    return installJourneyId;
  } catch {
    console.warn("Catalog install analytics setup failed", {
      eventName: "catalog_install_landed",
      stage: "landing",
      reason: "contract_error",
      statusCode: null,
      code: null,
      requestId: null,
    });
    return null;
  }
}

export function buildCatalogInstallAuthReturnUrl(installJourneyId: string | null): string {
  const returnUrl = new URL(window.location.href);
  if (installJourneyId === null || isAnalyticsEnabledForCurrentRuntime() === false) {
    returnUrl.searchParams.delete(installJourneyParameterName);
  } else {
    returnUrl.searchParams.set(installJourneyParameterName, installJourneyId);
  }
  return returnUrl.toString();
}

export function reportCatalogInstallLanded(
  installJourneyId: string | null,
  packageVersionId: string,
  authState: "signed_in" | "signed_out",
): void {
  reportCatalogInstallJourneyEventOnce(
    installJourneyId,
    packageVersionId,
    { eventName: "catalog_install_landed", authState },
  );
}

export function reportCatalogInstallSigninStarted(
  installJourneyId: string | null,
  packageVersionId: string,
): void {
  reportCatalogInstallJourneyEvent(
    installJourneyId,
    packageVersionId,
    { eventName: "catalog_install_signin_started" },
  );
}

export function reportCatalogInstallPreviewReady(
  installJourneyId: string | null,
  packageVersionId: string,
): void {
  reportCatalogInstallJourneyEventOnce(
    installJourneyId,
    packageVersionId,
    { eventName: "catalog_install_preview_ready" },
  );
}

export function reportCatalogInstallFailure(
  installJourneyId: string | null,
  packageVersionId: string,
  stage: CatalogInstallFailureStage,
  reason: CatalogInstallFailureReason,
): void {
  reportCatalogInstallJourneyEvent(
    installJourneyId,
    packageVersionId,
    { eventName: "catalog_install_failed", stage, reason },
  );
}

function hasIndexedDbFailureMetadata(error: Error): boolean {
  return "indexedDbOperation" in error || "indexedDbErrorName" in error;
}

export function toCatalogInstallFailureReason(error: unknown): CatalogInstallFailureReason {
  if (error instanceof AuthRedirectError) {
    return "unauthorized";
  }

  if (error instanceof ApiContractError) {
    return "contract_error";
  }

  if (error instanceof ApiNetworkError) {
    if (navigator.onLine === false) {
      return "offline";
    }
    if (error.originalErrorName === "TimeoutError") {
      return "timeout";
    }
    if (error.originalErrorName === "AbortError") {
      return "cancelled";
    }
    return "network_error";
  }

  if (error instanceof ApiError) {
    if (error.code === "WORKSPACE_NOT_FOUND" || error.code === "WORKSPACE_SELECTION_REQUIRED") {
      return "workspace_unavailable";
    }
    if (error.statusCode === 401 || error.statusCode === 403) {
      return "unauthorized";
    }
    if (error.statusCode === 408) {
      return "timeout";
    }
    if (error.statusCode === 409) {
      return "conflict";
    }
    if (error.statusCode === 429) {
      return "rate_limited";
    }
    return error.statusCode >= 500 ? "server_error" : "contract_error";
  }

  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError") {
      return "storage_error";
    }
    if (error.name === "TimeoutError") {
      return "timeout";
    }
    if (error.name === "AbortError") {
      return "cancelled";
    }
  }

  if (error instanceof Error && hasIndexedDbFailureMetadata(error)) {
    return "storage_error";
  }

  return navigator.onLine === false ? "offline" : "server_error";
}

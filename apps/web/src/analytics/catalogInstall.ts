import { ApiContractError } from "../apiContracts/core";
import { ApiError, ApiNetworkError, AuthRedirectError } from "../api/transport/errors";
import { getAppConfig } from "../config";
import { isAnalyticsEnabledForCurrentRuntime } from "./client";
import { isAnalyticsIdentityConsented } from "./consent";
import { createAnalyticsUuidV7, readAnalyticsAnonymousId } from "./identity";
import { readAnalyticsDeviceLocale, readAnalyticsUiLocale } from "./wire";

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

type CatalogInstallEvent =
  | Readonly<{ eventName: "catalog_install_preview_ready" }>
  | Readonly<{
    eventName: "catalog_install_failed";
    stage: CatalogInstallFailureStage;
    reason: CatalogInstallFailureReason;
  }>;

type CatalogInstallProperties = Readonly<Record<string, string>>;

/**
 * What one mount of the import screen has already reported, so a milestone reported from a
 * re-entered code path is not counted twice. It is held in memory by its owner and dropped with it:
 * nothing is minted or stored for this funnel, so opening the same deck again — after the sign-in
 * round trip, or from anywhere else in the same tab — reports its own preview fact.
 */
export type CatalogInstallReportScope = Readonly<{ reportedOnceKeys: Set<string> }>;

export function createCatalogInstallReportScope(): CatalogInstallReportScope {
  return { reportedOnceKeys: new Set<string>() };
}

/**
 * These rows carry the shared browser visitor id, as every other fact this app reports does, so they
 * follow the same answer: a browser still waiting to be asked, or one that refused, reports none of
 * them.
 */
function isCatalogInstallAnalyticsAllowed(): boolean {
  return isAnalyticsEnabledForCurrentRuntime() && isAnalyticsIdentityConsented();
}

function buildProperties(
  packageVersionId: string,
  event: CatalogInstallEvent,
): CatalogInstallProperties {
  const sharedProperties = { package_version_id: packageVersionId };

  switch (event.eventName) {
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
  event: CatalogInstallEvent,
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

async function sendCatalogInstallEvent(
  packageVersionId: string,
  event: CatalogInstallEvent,
): Promise<boolean> {
  if (isCatalogInstallAnalyticsAllowed() === false) {
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
        deviceLocale: readAnalyticsDeviceLocale(),
        // Read at send time rather than when the event was created, for the reason
        // `toAnonymousAnalyticsWireEvent` states in ./wire.ts.
        anonymousId: readAnalyticsAnonymousId(),
        properties: buildProperties(packageVersionId, event),
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

function reportCatalogInstallEventOnce(
  reportScope: CatalogInstallReportScope,
  packageVersionId: string,
  event: CatalogInstallEvent,
): void {
  if (isCatalogInstallAnalyticsAllowed() === false) {
    return;
  }

  const onceKey = `${packageVersionId}:${event.eventName}`;
  if (reportScope.reportedOnceKeys.has(onceKey)) {
    return;
  }

  reportScope.reportedOnceKeys.add(onceKey);
  void sendCatalogInstallEvent(packageVersionId, event).then((wasAccepted) => {
    if (wasAccepted === false) {
      reportScope.reportedOnceKeys.delete(onceKey);
    }
  });
}

export function reportCatalogInstallPreviewReady(
  reportScope: CatalogInstallReportScope,
  packageVersionId: string,
): void {
  reportCatalogInstallEventOnce(
    reportScope,
    packageVersionId,
    { eventName: "catalog_install_preview_ready" },
  );
}

export function reportCatalogInstallFailure(
  packageVersionId: string,
  stage: CatalogInstallFailureStage,
  reason: CatalogInstallFailureReason,
): void {
  void sendCatalogInstallEvent(packageVersionId, { eventName: "catalog_install_failed", stage, reason });
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

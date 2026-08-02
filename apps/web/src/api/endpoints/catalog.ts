import {
  parseCatalogPackageInstallConfirmResponse,
  parseCatalogPackageInstallPreviewResponse,
  parseCatalogPublicSnapshotResponse,
} from "../../apiContracts/catalog";
import type {
  CatalogPackageInstallConfirmOptions,
  CatalogPackageInstallConfirmResponse,
  CatalogPackageInstallPreviewResponse,
  CatalogPublicSnapshot,
} from "../../types";
import { parseContractResponse } from "../transport/response";
import {
  allowAuthRecovery,
  requestJson,
  skipAuthRecoveryWithTransientNetworkRetry,
} from "../transport/transport";

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export async function loadPublicCatalog(): Promise<CatalogPublicSnapshot> {
  return parseContractResponse(
    await requestJson("/catalog", { method: "GET" }, skipAuthRecoveryWithTransientNetworkRetry),
    "GET /catalog",
    parseCatalogPublicSnapshotResponse,
  );
}

export async function previewCatalogPackageInstall(
  workspaceId: string,
  packageVersionId: string,
): Promise<CatalogPackageInstallPreviewResponse> {
  const encodedWorkspaceId = encodePathSegment(workspaceId);
  const encodedPackageVersionId = encodePathSegment(packageVersionId);
  const pathname = `/workspaces/${encodedWorkspaceId}/catalog/package-versions/${encodedPackageVersionId}/install/preview`;
  return parseContractResponse(
    await requestJson(pathname, { method: "POST" }, allowAuthRecovery),
    `POST ${pathname}`,
    parseCatalogPackageInstallPreviewResponse,
  );
}

export async function confirmCatalogPackageInstall(
  workspaceId: string,
  packageVersionId: string,
  options: CatalogPackageInstallConfirmOptions,
): Promise<CatalogPackageInstallConfirmResponse> {
  const encodedWorkspaceId = encodePathSegment(workspaceId);
  const encodedPackageVersionId = encodePathSegment(packageVersionId);
  const pathname = `/workspaces/${encodedWorkspaceId}/catalog/package-versions/${encodedPackageVersionId}/install`;
  return parseContractResponse(
    await requestJson(pathname, {
      method: "POST",
      body: JSON.stringify(options),
    }, allowAuthRecovery),
    `POST ${pathname}`,
    parseCatalogPackageInstallConfirmResponse,
  );
}

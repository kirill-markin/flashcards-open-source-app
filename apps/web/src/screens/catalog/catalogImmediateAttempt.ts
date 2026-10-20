import {
  parseObject,
  parseRequiredField,
  parseString,
} from "../../apiContracts/core";
import type { CatalogPackageInstallConfirmOptions } from "../../types";

export type CatalogImmediateAttempt = Readonly<{
  userId: string;
  packageVersionId: string;
  workspaceId: string;
  installationId: string;
  options: CatalogPackageInstallConfirmOptions;
}>;

function attemptStorageKey(userId: string, packageVersionId: string): string {
  return `catalog-immediate-install:${userId}:${packageVersionId}`;
}

function launchStorageKey(userId: string, workspaceId: string): string {
  return `catalog-immediate-study:${userId}:${workspaceId}`;
}

export function readCatalogImmediateAttempt(userId: string, packageVersionId: string): CatalogImmediateAttempt | null {
  const saved = window.localStorage.getItem(attemptStorageKey(userId, packageVersionId));
  if (saved === null) return null;
  const endpoint = "catalog immediate install storage";
  const value = parseObject(JSON.parse(saved), endpoint, "");
  const options = parseObject(value.options, endpoint, "options");
  if (value.userId !== userId || value.packageVersionId !== packageVersionId
    || options.immediateOnboarding !== true || options.addImportTag !== false
    || options.importTag !== "" || !Array.isArray(options.removeTags) || options.removeTags.length !== 0) {
    throw new Error("Saved catalog onboarding request is invalid. Preserve site data before retrying.");
  }
  return {
    userId,
    packageVersionId,
    workspaceId: parseRequiredField(value, "workspaceId", endpoint, "", parseString),
    installationId: parseRequiredField(value, "installationId", endpoint, "", parseString),
    options: {
      immediateOnboarding: true,
      addImportTag: false,
      importTag: "",
      removeTags: [],
      installId: parseRequiredField(options, "installId", endpoint, "options", parseString),
      installedAt: parseRequiredField(options, "installedAt", endpoint, "options", parseString),
      clientUpdatedAt: parseRequiredField(options, "clientUpdatedAt", endpoint, "options", parseString),
      lastModifiedByReplicaId: parseRequiredField(options, "lastModifiedByReplicaId", endpoint, "options", parseString),
      operationIdPrefix: parseRequiredField(options, "operationIdPrefix", endpoint, "options", parseString),
    },
  };
}

export function storeCatalogImmediateAttempt(attempt: CatalogImmediateAttempt): void {
  window.localStorage.setItem(attemptStorageKey(attempt.userId, attempt.packageVersionId), JSON.stringify(attempt));
}

export function discardRejectedCatalogImmediateAttempt(attempt: CatalogImmediateAttempt): void {
  const saved = readCatalogImmediateAttempt(attempt.userId, attempt.packageVersionId);
  if (saved?.options.installId === attempt.options.installId) {
    window.localStorage.removeItem(attemptStorageKey(attempt.userId, attempt.packageVersionId));
  }
}

export function storeCatalogImmediateStudyLaunch(attempt: CatalogImmediateAttempt, cardId: string): void {
  window.localStorage.setItem(launchStorageKey(attempt.userId, attempt.workspaceId), JSON.stringify({
    packageVersionId: attempt.packageVersionId,
    installId: attempt.options.installId,
    cardId,
  }));
}

// Keep the replay request until the destination provider has loaded the actual imported card.
export function completeCatalogImmediateStudy(userId: string, workspaceId: string, cardId: string): void {
  const key = launchStorageKey(userId, workspaceId);
  const saved = window.localStorage.getItem(key);
  if (saved === null) return;
  const endpoint = "catalog immediate study storage";
  const launch = parseObject(JSON.parse(saved), endpoint, "");
  if (launch.cardId !== cardId) return;
  const packageVersionId = parseRequiredField(launch, "packageVersionId", endpoint, "", parseString);
  const attempt = readCatalogImmediateAttempt(userId, packageVersionId);
  if (attempt !== null && attempt.workspaceId === workspaceId && attempt.options.installId === launch.installId) {
    window.localStorage.removeItem(attemptStorageKey(userId, packageVersionId));
  }
  window.localStorage.removeItem(key);
}

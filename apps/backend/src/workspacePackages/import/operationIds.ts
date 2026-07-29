import {
  isValidMediaAssetLastOperationId,
  isValidMediaAssetLastOperationIdPrefix,
  maximumMediaAssetLastOperationIdLength,
} from "../../mediaAssets/lastOperationId";
import { HttpError } from "../../shared/errors";
import {
  workspacePackageImportZipDefaultMaxCards,
  workspacePackageImportZipDefaultMaxMediaFiles,
} from "./importZip";

const workspacePackageImportMediaLastOperationIdMaximumSuffix =
  `:media:${workspacePackageImportZipDefaultMaxMediaFiles - 1}`;
const workspacePackageImportCardLastOperationIdMaximumSuffix =
  `:card:${workspacePackageImportZipDefaultMaxCards - 1}`;
const workspacePackageImportLastOperationIdMaximumSuffixLength = Math.max(
  workspacePackageImportMediaLastOperationIdMaximumSuffix.length,
  workspacePackageImportCardLastOperationIdMaximumSuffix.length,
);

export const workspacePackageImportOperationIdPrefixMaximumLength =
  maximumMediaAssetLastOperationIdLength
  - workspacePackageImportLastOperationIdMaximumSuffixLength;

function createWorkspacePackageImportOperationIdError(message: string): HttpError {
  return new HttpError(
    400,
    message,
    "WORKSPACE_PACKAGE_IMPORT_INPUT_INVALID",
  );
}

export function isValidWorkspacePackageImportOperationIdPrefix(
  value: string,
): boolean {
  return isValidMediaAssetLastOperationIdPrefix(
    value,
    workspacePackageImportOperationIdPrefixMaximumLength,
  );
}

export function assertValidWorkspacePackageImportOperationIdPrefix(
  value: string,
): void {
  if (isValidWorkspacePackageImportOperationIdPrefix(value)) {
    return;
  }

  throw createWorkspacePackageImportOperationIdError(
    [
      "operationIdPrefix must be",
      `1 to ${workspacePackageImportOperationIdPrefixMaximumLength}`,
      "printable ASCII characters without leading or trailing spaces.",
    ].join(" "),
  );
}

function assertWorkspacePackageImportOperationIndex(
  index: number,
  maximumCount: number,
  entityName: string,
): void {
  if (Number.isInteger(index) && index >= 0 && index < maximumCount) {
    return;
  }

  throw createWorkspacePackageImportOperationIdError(
    `${entityName} operation index is outside the supported package limit. index=${index} maximumCount=${maximumCount}`,
  );
}

function assertWorkspacePackageImportLastOperationId(
  value: string,
): string {
  if (isValidMediaAssetLastOperationId(value)) {
    return value;
  }

  throw createWorkspacePackageImportOperationIdError(
    "Derived workspace package lastOperationId is invalid.",
  );
}

export function buildWorkspacePackageImportMediaLastOperationId(
  operationIdPrefix: string,
  mediaFileIndex: number,
): string {
  assertWorkspacePackageImportOperationIndex(
    mediaFileIndex,
    workspacePackageImportZipDefaultMaxMediaFiles,
    "Media file",
  );
  return assertWorkspacePackageImportLastOperationId(
    `${operationIdPrefix}:media:${mediaFileIndex}`,
  );
}

export function buildWorkspacePackageImportCardLastOperationId(
  operationIdPrefix: string,
  cardIndex: number,
): string {
  assertWorkspacePackageImportOperationIndex(
    cardIndex,
    workspacePackageImportZipDefaultMaxCards,
    "Card",
  );
  return assertWorkspacePackageImportLastOperationId(
    `${operationIdPrefix}:card:${cardIndex}`,
  );
}

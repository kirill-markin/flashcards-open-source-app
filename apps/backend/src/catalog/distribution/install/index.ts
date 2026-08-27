import {
  transactionWithWorkspaceScope,
  transactionWithWorkspaceScopeReadOnly,
  type DatabaseExecutor,
} from "../../../database";
import {
  isValidMediaAssetLastOperationIdPrefix,
  maximumMediaAssetLastOperationIdLength,
} from "../../../mediaAssets/lastOperationId";
import {
  captureBackendWarning,
  createBackendObservationScope,
  getBackendErrorLogDetails,
} from "../../../observability/sentry";
import {
  deriveServerDerivedProductAnalyticsEventId,
  emitServerDerivedProductAnalyticsEvent,
} from "../../../productAnalytics/serverEvents";
import { HttpError } from "../../../shared/errors";
import { normalizeCardImportTagOptions } from "../../../shared/cardImportTags";
import { normalizeIsoTimestamp } from "../../../sync/conflicts/lww";
import { lockWorkspaceSyncMetadataForHotChangesInExecutor } from "../../../sync/replication/changes";
import {
  isLowercaseWorkspaceId,
  normalizeWorkspaceId,
} from "../../../workspaces/identity";
import { normalizeNonEmptyString } from "../../common";
import type {
  CatalogPackageInstallActor,
  CatalogPackageInstallConfirmInput,
  CatalogPackageInstallPreview,
  CatalogPackageInstallPreviewInput,
  CatalogPackageInstallResult,
} from "../../types";
import {
  createCatalogPackageInstallTagPlan,
  loadCatalogPackageInstallPreviewInExecutor,
  loadCatalogPackageInstallVersionForInstallInExecutor,
  loadCatalogPackageSlugInExecutor,
  loadCatalogPackageVersionCardsInExecutor,
  loadCatalogPackageVersionMediaAssetsInExecutor,
  mapCatalogPackageInstallPackageVersion,
} from "./preview";
import {
  createCatalogPackageInstallRequestIdentity,
  insertCatalogPackageInstallIdempotencyResultInExecutor,
  loadCatalogPackageInstallReplayInExecutor,
  type NormalizedCatalogPackageInstallConfirmInput,
} from "./replay";
import {
  assertCatalogInstallReplicaBelongsToWorkspaceInExecutor,
  assertInstallIdUnusedInExecutor,
  assertInstallOperationIdsUnusedInExecutor,
  buildCatalogInstallOperationIds,
  buildInstalledMediaAssetIdsByPackageMediaKey,
  installCatalogPackageCardsInExecutor,
  installCatalogPackageMediaAssetsInExecutor,
} from "./persistence";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const maximumJavaScriptArrayIndex = 4_294_967_294;
const catalogPackageInstallMediaLastOperationIdMaximumSuffix =
  `:media:${maximumJavaScriptArrayIndex}`;
const catalogPackageInstallCardLastOperationIdMaximumSuffix =
  `:card:${maximumJavaScriptArrayIndex}`;
const catalogPackageInstallLastOperationIdMaximumSuffixLength = Math.max(
  catalogPackageInstallMediaLastOperationIdMaximumSuffix.length,
  catalogPackageInstallCardLastOperationIdMaximumSuffix.length,
);

export const catalogPackageInstallOperationIdPrefixMaximumLength =
  maximumMediaAssetLastOperationIdLength
  - catalogPackageInstallLastOperationIdMaximumSuffixLength;

function normalizeUuidString(value: string, fieldName: string): string {
  const normalizedValue = normalizeNonEmptyString(value, fieldName).toLowerCase();
  if (uuidPattern.test(normalizedValue) === false) {
    throw new HttpError(400, `${fieldName} must be a UUID`, "CATALOG_PACKAGE_INSTALL_INVALID_INPUT");
  }

  return normalizedValue;
}

function normalizeCatalogWorkspaceId(value: string): string {
  const normalizedValue = normalizeWorkspaceId(
    normalizeNonEmptyString(value, "workspaceId"),
  ).toLowerCase();
  if (isLowercaseWorkspaceId(normalizedValue) === false) {
    throw new HttpError(
      400,
      "workspaceId must be a UUID",
      "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
    );
  }

  return normalizedValue;
}

function normalizeBoundedNonEmptyString(value: string, fieldName: string, maximumLength: number): string {
  const normalizedValue = normalizeNonEmptyString(value, fieldName);
  if (normalizedValue.length > maximumLength) {
    throw new HttpError(
      400,
      `${fieldName} must contain at most ${maximumLength} characters`,
      "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
    );
  }

  return normalizedValue;
}

export function isValidCatalogPackageInstallOperationIdPrefix(
  value: string,
): boolean {
  return isValidMediaAssetLastOperationIdPrefix(
    value,
    catalogPackageInstallOperationIdPrefixMaximumLength,
  );
}

function normalizeCatalogPackageInstallOperationIdPrefix(value: string): string {
  if (isValidCatalogPackageInstallOperationIdPrefix(value)) {
    return value;
  }

  throw new HttpError(
    400,
    [
      "operationIdPrefix must be",
      `1 to ${catalogPackageInstallOperationIdPrefixMaximumLength}`,
      "printable ASCII characters without leading or trailing spaces.",
    ].join(" "),
    "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
  );
}

function normalizeCatalogInstallIsoTimestamp(value: string, fieldName: string): string {
  try {
    return normalizeIsoTimestamp(value, fieldName);
  } catch {
    throw new HttpError(
      400,
      `${fieldName} must be a valid ISO timestamp`,
      "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
    );
  }
}

function normalizeCatalogPackageInstallConfirmInput(
  input: CatalogPackageInstallConfirmInput,
): NormalizedCatalogPackageInstallConfirmInput {
  let normalizedTagOptions: ReturnType<typeof normalizeCardImportTagOptions>;
  try {
    normalizedTagOptions = normalizeCardImportTagOptions({
      addImportTag: input.addImportTag === undefined ? false : input.addImportTag,
      importTag: input.importTag === undefined ? "" : input.importTag,
      removeTags: input.removeTags === undefined ? [] : input.removeTags,
    });
  } catch (error) {
    throw new HttpError(
      400,
      `Catalog package install tag options are invalid. reason=${error instanceof Error ? error.message : String(error)}`,
      "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
    );
  }

  return {
    installId: normalizeBoundedNonEmptyString(input.installId, "installId", 128),
    installedAt: normalizeCatalogInstallIsoTimestamp(input.installedAt, "installedAt"),
    clientUpdatedAt: normalizeCatalogInstallIsoTimestamp(input.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByReplicaId: normalizeUuidString(input.lastModifiedByReplicaId, "lastModifiedByReplicaId"),
    operationIdPrefix: normalizeCatalogPackageInstallOperationIdPrefix(input.operationIdPrefix),
    addImportTag: normalizedTagOptions.addImportTag,
    importTag: normalizedTagOptions.importTag,
    removeTags: normalizedTagOptions.removeTags,
  };
}

export async function previewCatalogPackageInstallInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
  input: CatalogPackageInstallPreviewInput,
): Promise<CatalogPackageInstallPreview> {
  const normalizedPackageVersionId = normalizeUuidString(packageVersionId, "packageVersionId");
  return loadCatalogPackageInstallPreviewInExecutor(
    executor,
    normalizedPackageVersionId,
    input,
  );
}

export async function installCatalogPackageVersionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  packageVersionId: string,
  input: CatalogPackageInstallConfirmInput,
): Promise<CatalogPackageInstallResult> {
  const normalizedWorkspaceId = normalizeCatalogWorkspaceId(workspaceId);
  const normalizedPackageVersionId = normalizeUuidString(packageVersionId, "packageVersionId");
  const normalizedInput = normalizeCatalogPackageInstallConfirmInput(input);
  const requestIdentity = createCatalogPackageInstallRequestIdentity(
    normalizedPackageVersionId,
    normalizedInput,
  );
  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(
    executor,
    normalizedWorkspaceId,
  );
  const replayResult = await loadCatalogPackageInstallReplayInExecutor(
    executor,
    normalizedWorkspaceId,
    normalizedInput.installId,
    requestIdentity,
  );
  if (replayResult !== null) {
    return replayResult;
  }

  const versionRow = await loadCatalogPackageInstallVersionForInstallInExecutor(
    executor,
    normalizedPackageVersionId,
  );
  const packageMediaAssets = await loadCatalogPackageVersionMediaAssetsInExecutor(
    executor,
    normalizedPackageVersionId,
  );
  const packageCards = await loadCatalogPackageVersionCardsInExecutor(executor, normalizedPackageVersionId);

  if (packageCards.length === 0) {
    throw new HttpError(
      409,
      `Catalog package version has no cards to install. packageVersionId=${normalizedPackageVersionId}`,
      "CATALOG_PACKAGE_VERSION_EMPTY",
    );
  }
  const tagPlan = createCatalogPackageInstallTagPlan(packageCards, normalizedInput);

  await assertCatalogInstallReplicaBelongsToWorkspaceInExecutor(
    executor,
    normalizedWorkspaceId,
    normalizedInput.lastModifiedByReplicaId,
  );
  await assertInstallIdUnusedInExecutor(executor, normalizedWorkspaceId, normalizedInput.installId);
  await assertInstallOperationIdsUnusedInExecutor(
    executor,
    normalizedWorkspaceId,
    buildCatalogInstallOperationIds(normalizedInput, packageMediaAssets, packageCards),
  );

  const installedMediaAssets = await installCatalogPackageMediaAssetsInExecutor(
    executor,
    normalizedWorkspaceId,
    hotChangeWriteLock,
    packageMediaAssets,
    normalizedInput,
  );
  const installedMediaAssetIdsByPackageMediaKey = buildInstalledMediaAssetIdsByPackageMediaKey(
    installedMediaAssets,
  );
  const installedCards = await installCatalogPackageCardsInExecutor(
    executor,
    normalizedWorkspaceId,
    hotChangeWriteLock,
    versionRow,
    packageCards,
    tagPlan,
    normalizedInput,
    installedMediaAssetIdsByPackageMediaKey,
  );

  const result: CatalogPackageInstallResult = {
    packageVersion: mapCatalogPackageInstallPackageVersion(versionRow),
    installedCards,
    installedMediaAssets,
    summary: {
      cardCount: installedCards.length,
      mediaAssetCount: installedMediaAssets.length,
      installId: normalizedInput.installId,
      installedAt: normalizedInput.installedAt,
      keptTagCount: tagPlan.keptTags.length,
      removedTagCount: tagPlan.removedTags.length,
      importTag: tagPlan.importTag,
    },
  };
  await insertCatalogPackageInstallIdempotencyResultInExecutor(
    executor,
    normalizedWorkspaceId,
    normalizedInput.installId,
    requestIdentity,
    result,
  );
  return result;
}

export async function previewCatalogPackageInstall(
  userId: string,
  workspaceId: string,
  packageVersionId: string,
  input: CatalogPackageInstallPreviewInput,
): Promise<CatalogPackageInstallPreview> {
  return transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => (
    previewCatalogPackageInstallInExecutor(executor, packageVersionId, input)
  ));
}

// Resolution of the one property catalog_deck_installed cannot state without a second read. It is
// kept out of CatalogPackageInstallResult on purpose: a replay returns the result JSON stored in
// sync.catalog_package_install_idempotency, and rows written before this change carry no package
// slug, so a slug taken from the result would be undefined on those replays and the emission would
// die inside its own non-fatal wrapper without ever saying why.
type CatalogDeckInstalledPackageSlug =
  | Readonly<{ resolved: true; packageSlug: string }>
  | Readonly<{
    resolved: false;
    reason: "catalog_package_row_missing" | "catalog_package_slug_read_failed";
    errorClass: string | null;
    errorMessage: string | null;
  }>;

/**
 * Reads catalog.packages.slug for an install that already committed.
 *
 * Deliberately outside the install transaction: this read exists only for analytics, and analytics
 * must never turn a committed install, or a healthy idempotent replay of one, into a failed request.
 * Every way it can come back without a slug is reported by the caller instead of thrown.
 */
async function loadCatalogDeckInstalledPackageSlug(
  userId: string,
  workspaceId: string,
  packageId: string,
): Promise<CatalogDeckInstalledPackageSlug> {
  let packageSlug: string | null;
  try {
    packageSlug = await transactionWithWorkspaceScopeReadOnly(
      { userId, workspaceId },
      async (executor) => loadCatalogPackageSlugInExecutor(executor, packageId),
    );
  } catch (error) {
    const errorDetails = getBackendErrorLogDetails(error);
    return {
      resolved: false,
      reason: "catalog_package_slug_read_failed",
      errorClass: errorDetails.errorClass,
      errorMessage: errorDetails.errorMessage,
    };
  }

  if (packageSlug === null) {
    return {
      resolved: false,
      reason: "catalog_package_row_missing",
      errorClass: null,
      errorMessage: null,
    };
  }

  return { resolved: true, packageSlug };
}

export async function installCatalogPackageVersion(
  userId: string,
  workspaceId: string,
  packageVersionId: string,
  input: CatalogPackageInstallConfirmInput,
  actor: CatalogPackageInstallActor,
): Promise<CatalogPackageInstallResult> {
  const result = await transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => (
    installCatalogPackageVersionInExecutor(executor, workspaceId, packageVersionId, input)
  ));
  // The same normalization already succeeded inside the transaction, so it cannot throw here.
  const normalizedWorkspaceId = normalizeCatalogWorkspaceId(workspaceId);
  // package_slug means catalog.packages.slug across this repository, and the client's
  // catalog_deck_install_started carries that same value, so the pair only joins into a funnel when
  // this event carries it too. result.packageVersion.slug is the package version's frozen copy of
  // it, which the authoring path leaves behind on the next deck rename.
  const packageSlug = await loadCatalogDeckInstalledPackageSlug(
    userId,
    workspaceId,
    result.packageVersion.packageId,
  );
  if (packageSlug.resolved === false) {
    // A named skip rather than a swallowed write. The event is dropped instead of emitted with the
    // version's stale slug, because a wrong slug joins to the wrong deck forever on an append-only
    // table while a missing row only undercounts. catalog_package_row_missing is only reachable on a
    // replay of an install whose package was deleted afterwards, and that replay's row would have
    // conflicted on event_id with the original emission anyway.
    captureBackendWarning({
      action: "catalog_deck_installed_analytics_skipped",
      scope: createBackendObservationScope(
        "backend-api",
        null,
        null,
        null,
        userId,
        normalizedWorkspaceId,
        null,
        null,
        actor.guestSessionId,
        null,
        null,
      ),
      details: {
        packageId: result.packageVersion.packageId,
        installId: result.summary.installId,
        reason: packageSlug.reason,
        errorClass: packageSlug.errorClass,
        errorMessage: packageSlug.errorMessage,
      },
    });
    return result;
  }

  // Emitted after the transaction committed, so the analytics row only ever reports an install the
  // workspace actually kept.
  await emitServerDerivedProductAnalyticsEvent({
    // The install is idempotent, so a client retry replays the stored result and reaches this
    // emission again. The install id is the same across those retries, so the derived id makes the
    // replay conflict on event_id and keeps exactly one installed event per install.
    eventId: deriveServerDerivedProductAnalyticsEventId(
      "catalog_deck_installed",
      [normalizedWorkspaceId, result.summary.installId],
    ),
    eventName: "catalog_deck_installed",
    occurredAt: new Date(),
    userId,
    // The identity the install acted as, which for a guest install is the guest user id that the
    // guest upgrade later links to the account. Together with guestSessionId this is what keeps a
    // guest install distinguishable from an account install on an append-only table.
    subjectUserId: actor.subjectUserId,
    guestSessionId: actor.guestSessionId,
    workspaceId: normalizedWorkspaceId,
    properties: {
      package_slug: packageSlug.packageSlug,
      card_count: result.summary.cardCount,
    },
  });
  return result;
}


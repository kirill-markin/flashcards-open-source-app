import { z } from "zod";
import type { DatabaseExecutor } from "../../../database";
import { HttpError } from "../../../shared/errors";
import { toIsoString } from "../../common";
import type {
  CatalogPackageInstallResult,
  TimestampValue,
} from "../../types";

type CatalogPackageInstallIdempotencyRow = Readonly<{
  package_version_id: string;
  installed_at: TimestampValue;
  client_updated_at: TimestampValue;
  last_modified_by_replica_id: string;
  operation_id_prefix: string;
  add_import_tag: boolean;
  import_tag: string | null;
  remove_tags: ReadonlyArray<string>;
  install_result: unknown;
}>;

export type NormalizedCatalogPackageInstallConfirmInput = Readonly<{
  installId: string;
  installedAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  operationIdPrefix: string;
  addImportTag: boolean;
  importTag: string;
  removeTags: ReadonlyArray<string>;
}>;

export type CatalogPackageInstallRequestIdentity = Readonly<{
  packageVersionId: string;
  installedAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  operationIdPrefix: string;
  addImportTag: boolean;
  importTag: string | null;
  removeTags: ReadonlyArray<string>;
}>;

const catalogPackageInstallUuidSchema = z.string().uuid();
const catalogPackageInstallDateTimeSchema = z.string().datetime({ offset: true });

const catalogPackageInstallAuthorSchema = z.object({
  authorId: catalogPackageInstallUuidSchema,
  slug: z.string(),
  displayName: z.string(),
}).strict();

const catalogPackageInstallPackageVersionSchema = z.object({
  packageVersionId: catalogPackageInstallUuidSchema,
  packageId: catalogPackageInstallUuidSchema,
  versionNumber: z.number().int().positive(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  description: z.string(),
  languageTags: z.array(z.string()),
  license: z.string(),
  contentWarning: z.string().nullable(),
  coverPackageMediaKey: z.string().nullable(),
  cardCount: z.number().int().nonnegative(),
  createdAt: catalogPackageInstallDateTimeSchema,
  publishedAt: catalogPackageInstallDateTimeSchema.nullable(),
  author: catalogPackageInstallAuthorSchema,
}).strict();

const catalogPackageInstallResultSchema = z.object({
  packageVersion: catalogPackageInstallPackageVersionSchema,
  installedCards: z.array(z.object({
    packageCardId: catalogPackageInstallUuidSchema,
    stableCardKey: z.string(),
    ordinal: z.number().int().positive(),
    cardId: catalogPackageInstallUuidSchema,
  }).strict()),
  installedMediaAssets: z.array(z.object({
    packageMediaAssetId: catalogPackageInstallUuidSchema,
    packageMediaKey: z.string(),
    mediaAssetId: catalogPackageInstallUuidSchema,
  }).strict()),
  summary: z.object({
    cardCount: z.number().int().nonnegative(),
    mediaAssetCount: z.number().int().nonnegative(),
    installId: z.string(),
    installedAt: catalogPackageInstallDateTimeSchema,
    keptTagCount: z.number().int().nonnegative(),
    removedTagCount: z.number().int().nonnegative(),
    importTag: z.string().nullable(),
  }).strict(),
}).strict();

export function createCatalogPackageInstallRequestIdentity(
  packageVersionId: string,
  input: NormalizedCatalogPackageInstallConfirmInput,
): CatalogPackageInstallRequestIdentity {
  return {
    packageVersionId,
    installedAt: input.installedAt,
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    operationIdPrefix: input.operationIdPrefix,
    addImportTag: input.addImportTag,
    importTag: input.addImportTag ? input.importTag : null,
    removeTags: [...input.removeTags].sort(),
  };
}

function parseCatalogPackageInstallStoredResult(
  value: unknown,
  workspaceId: string,
  installId: string,
): CatalogPackageInstallResult {
  const parsedResult = catalogPackageInstallResultSchema.safeParse(value);
  if (parsedResult.success === false) {
    throw new HttpError(
      500,
      [
        "Stored catalog package install result cannot be replayed safely.",
        `workspaceId=${workspaceId}`,
        `installId=${installId}`,
        `reason=${parsedResult.error.message}`,
        "Repair the catalog install idempotency record before retrying.",
      ].join(" "),
      "CATALOG_PACKAGE_INSTALL_STORED_RESULT_INVALID",
    );
  }

  return parsedResult.data;
}

function catalogPackageInstallStoredResultMismatchFields(
  row: CatalogPackageInstallIdempotencyRow,
  identity: CatalogPackageInstallRequestIdentity,
  result: CatalogPackageInstallResult,
  installId: string,
): ReadonlyArray<string> {
  const mismatchFields: Array<string> = [];
  if (result.summary.installId !== installId) mismatchFields.push("summary.installId");
  if (
    result.packageVersion.packageVersionId !== row.package_version_id
    || result.packageVersion.packageVersionId !== identity.packageVersionId
  ) {
    mismatchFields.push("packageVersion.packageVersionId");
  }
  if (
    result.summary.installedAt !== toIsoString(row.installed_at)
    || result.summary.installedAt !== identity.installedAt
  ) {
    mismatchFields.push("summary.installedAt");
  }
  if (result.summary.importTag !== row.import_tag || result.summary.importTag !== identity.importTag) {
    mismatchFields.push("summary.importTag");
  }
  if (result.summary.cardCount !== result.installedCards.length) mismatchFields.push("summary.cardCount");
  if (result.packageVersion.cardCount !== result.installedCards.length) {
    mismatchFields.push("packageVersion.cardCount");
  }
  if (result.summary.mediaAssetCount !== result.installedMediaAssets.length) {
    mismatchFields.push("summary.mediaAssetCount");
  }
  if (result.summary.removedTagCount !== row.remove_tags.length) {
    mismatchFields.push("summary.removedTagCount");
  }
  return mismatchFields;
}

function assertCatalogPackageInstallStoredResultMatchesIdentity(
  row: CatalogPackageInstallIdempotencyRow,
  identity: CatalogPackageInstallRequestIdentity,
  result: CatalogPackageInstallResult,
  workspaceId: string,
  installId: string,
): void {
  const mismatchFields = catalogPackageInstallStoredResultMismatchFields(
    row,
    identity,
    result,
    installId,
  );
  if (mismatchFields.length === 0) {
    return;
  }

  throw new HttpError(
    500,
    [
      "Stored catalog package install result does not match its durable request identity.",
      `workspaceId=${workspaceId}`,
      `installId=${installId}`,
      `mismatchedFields=${mismatchFields.join(",")}`,
      "Repair the catalog install idempotency record before retrying.",
    ].join(" "),
    "CATALOG_PACKAGE_INSTALL_STORED_RESULT_INVALID",
  );
}

function catalogPackageInstallRequestIdentityMismatchFields(
  row: CatalogPackageInstallIdempotencyRow,
  identity: CatalogPackageInstallRequestIdentity,
): ReadonlyArray<string> {
  const mismatchFields: Array<string> = [];
  if (row.package_version_id !== identity.packageVersionId) mismatchFields.push("packageVersionId");
  if (toIsoString(row.installed_at) !== identity.installedAt) mismatchFields.push("installedAt");
  if (toIsoString(row.client_updated_at) !== identity.clientUpdatedAt) mismatchFields.push("clientUpdatedAt");
  if (row.last_modified_by_replica_id !== identity.lastModifiedByReplicaId) {
    mismatchFields.push("lastModifiedByReplicaId");
  }
  if (row.operation_id_prefix !== identity.operationIdPrefix) mismatchFields.push("operationIdPrefix");
  if (row.add_import_tag !== identity.addImportTag) mismatchFields.push("addImportTag");
  if (row.import_tag !== identity.importTag) mismatchFields.push("importTag");
  if (JSON.stringify(row.remove_tags) !== JSON.stringify(identity.removeTags)) mismatchFields.push("removeTags");
  return mismatchFields;
}

export async function loadCatalogPackageInstallReplayInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  installId: string,
  identity: CatalogPackageInstallRequestIdentity,
): Promise<CatalogPackageInstallResult | null> {
  const result = await executor.query<CatalogPackageInstallIdempotencyRow>(
    [
      "SELECT package_version_id::text, installed_at, client_updated_at,",
      "last_modified_by_replica_id::text, operation_id_prefix, add_import_tag,",
      "import_tag, remove_tags, install_result",
      "FROM sync.catalog_package_install_idempotency",
      "WHERE workspace_id = $1 AND install_id = $2",
    ].join(" "),
    [workspaceId, installId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }

  const mismatchFields = catalogPackageInstallRequestIdentityMismatchFields(row, identity);
  if (mismatchFields.length !== 0) {
    throw new HttpError(
      409,
      [
        "Catalog package install idempotency key was already used with a different normalized request.",
        `workspaceId=${workspaceId}`,
        `installId=${installId}`,
        `mismatchedFields=${mismatchFields.join(",")}`,
        "Use a new installId for an explicit repeat import.",
      ].join(" "),
      "CATALOG_PACKAGE_INSTALL_IDEMPOTENCY_CONFLICT",
    );
  }

  const storedResult = parseCatalogPackageInstallStoredResult(row.install_result, workspaceId, installId);
  assertCatalogPackageInstallStoredResultMatchesIdentity(
    row,
    identity,
    storedResult,
    workspaceId,
    installId,
  );

  return storedResult;
}

export async function insertCatalogPackageInstallIdempotencyResultInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  installId: string,
  identity: CatalogPackageInstallRequestIdentity,
  result: CatalogPackageInstallResult,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO sync.catalog_package_install_idempotency",
      "(workspace_id, install_id, package_version_id, installed_at, client_updated_at,",
      "last_modified_by_replica_id, operation_id_prefix, add_import_tag, import_tag, remove_tags, install_result)",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)",
    ].join(" "),
    [
      workspaceId,
      installId,
      identity.packageVersionId,
      identity.installedAt,
      identity.clientUpdatedAt,
      identity.lastModifiedByReplicaId,
      identity.operationIdPrefix,
      identity.addImportTag,
      identity.importTag,
      identity.removeTags,
      JSON.stringify(result),
    ],
  );
}

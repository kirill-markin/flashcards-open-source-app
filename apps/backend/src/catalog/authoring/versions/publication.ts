import type { DatabaseExecutor } from "../../../database";
import { HttpError } from "../../../shared/errors";
import { normalizeAdminEmail, normalizeNullableString } from "../../common";
import { rethrowCatalogPersistenceError } from "../../errors";
import {
  maximumPublicCatalogMediaDownloadBytes,
  publicCatalogMediaDownloadMimeTypes,
} from "../../publicMediaDelivery";
import {
  getPublicCatalogVersionEligibilityIssue,
  type PublicCatalogAuthorEligibilityInput,
  type PublicCatalogPackageEligibilityInput,
  type PublicCatalogVersionEligibilityIssue,
  type PublicCatalogVersionMediaAssetInput,
} from "../../publicSafety";
import {
  catalogPackageVersionColumns,
  lockCatalogPackageInExecutor,
  mapCatalogPackageVersionRow,
} from "../../rows";
import type {
  CatalogPackageStatus,
  CatalogPackageVersion,
  CatalogPackageVersionRow,
  UpdateCatalogPackageVersionStatusInput,
} from "../../types";
import { insertPackageVersionStatusEventInExecutor } from "./creation";

const reviewStatusRouteTargets: ReadonlySet<CatalogPackageStatus> = new Set([
  "draft",
  "submitted",
  "needs_changes",
  "approved",
  "rejected",
]);

type CatalogPackageVersionPublicMediaRow = Readonly<{
  package_media_key: string;
  alt_text: string | null;
  credit: string | null;
  license: string | null;
  mime_type: string;
  size_bytes: string | number;
}>;

type CatalogPackageVersionPublicAuthorRow = Readonly<{
  author_slug: string;
  display_name: string;
  bio: string | null;
  website_url: string | null;
}>;

type CatalogPackageVersionPublicCardRow = Readonly<{
  package_card_id: string;
  front_text: string;
  back_text: string;
  card_type: string;
  tags: ReadonlyArray<string>;
  media_asset_keys: ReadonlyArray<string>;
}>;

export function isCatalogPackageVersionStatusTransitionAllowed(
  fromStatus: CatalogPackageStatus,
  toStatus: CatalogPackageStatus,
): boolean {
  if (fromStatus === toStatus) {
    return true;
  }

  switch (fromStatus) {
    case "draft":
      return toStatus === "submitted" || toStatus === "rejected";
    case "submitted":
      return toStatus === "needs_changes" || toStatus === "approved" || toStatus === "rejected";
    case "needs_changes":
      return toStatus === "submitted" || toStatus === "rejected";
    case "approved":
      return toStatus === "published" || toStatus === "rejected";
    case "published":
      return toStatus === "delisted";
    case "rejected":
    case "delisted":
      return false;
  }
}

export function assertCatalogPackageVersionStatusTransitionAllowed(
  fromStatus: CatalogPackageStatus,
  toStatus: CatalogPackageStatus,
): void {
  if (isCatalogPackageVersionStatusTransitionAllowed(fromStatus, toStatus)) {
    return;
  }

  throw new HttpError(
    409,
    `Invalid catalog package version status transition. fromStatus=${fromStatus} toStatus=${toStatus}`,
    "CATALOG_PACKAGE_VERSION_STATUS_TRANSITION_INVALID",
  );
}

async function loadPackageVersionForUpdateInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<CatalogPackageVersionRow> {
  const result = await executor.query<CatalogPackageVersionRow>(
    [
      "SELECT",
      catalogPackageVersionColumns,
      "FROM catalog.package_versions",
      "WHERE package_version_id = $1",
      "FOR UPDATE",
    ].join(" "),
    [packageVersionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(
      404,
      `Catalog package version not found. packageVersionId=${packageVersionId}`,
      "CATALOG_PACKAGE_VERSION_NOT_FOUND",
    );
  }

  return row;
}

async function loadCatalogPackageVersionPublicMediaInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<ReadonlyArray<PublicCatalogVersionMediaAssetInput>> {
  const result = await executor.query<CatalogPackageVersionPublicMediaRow>(
    [
      "SELECT",
      "media_assets.package_media_key AS package_media_key,",
      "media_assets.alt_text AS alt_text,",
      "media_assets.credit AS credit,",
      "media_assets.license AS license,",
      "media_blobs.mime_type AS mime_type,",
      "media_blobs.size_bytes AS size_bytes",
      "FROM catalog.package_media_assets AS media_assets",
      "INNER JOIN content.media_blobs AS media_blobs",
      "ON media_blobs.media_blob_id = media_assets.media_blob_id",
      "WHERE media_assets.package_version_id = $1",
      "ORDER BY media_assets.package_media_key ASC",
      "FOR UPDATE OF media_assets",
    ].join(" "),
    [packageVersionId],
  );

  return result.rows.map((row) => ({
    packageMediaKey: row.package_media_key,
    altText: row.alt_text,
    credit: row.credit,
    license: row.license,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
  }));
}

async function loadCatalogPackageVersionPublicRelationsInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
): Promise<Readonly<{
  package: PublicCatalogPackageEligibilityInput;
  author: PublicCatalogAuthorEligibilityInput;
}>> {
  const packageRow = await lockCatalogPackageInExecutor(executor, packageId);
  const result = await executor.query<CatalogPackageVersionPublicAuthorRow>(
    [
      "SELECT slug AS author_slug, display_name, bio, website_url",
      "FROM catalog.authors",
      "WHERE author_id = $1",
      "FOR UPDATE",
    ].join(" "),
    [packageRow.author_id],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(
      `Catalog package author relationship is missing. packageId=${packageId}`,
    );
  }

  return {
    package: { slug: packageRow.slug },
    author: {
      slug: row.author_slug,
      displayName: row.display_name,
      bio: row.bio,
      websiteUrl: row.website_url,
    },
  };
}

function throwCatalogPackageVersionPublicEligibilityIssue(
  packageVersionId: string,
  issue: PublicCatalogVersionEligibilityIssue,
): never {
  if (issue.reason === "unresolved_media_reference") {
    throw new HttpError(
      409,
      [
        "Catalog package version contains an unresolved required media reference.",
        `packageVersionId=${packageVersionId}`,
        `packageMediaKey=${issue.packageMediaKey}`,
        `referenceSource=${issue.referenceSource}`,
      ].join(" "),
      "CATALOG_PACKAGE_VERSION_MEDIA_REFERENCE_NOT_FOUND",
    );
  }

  if (
    issue.reason === "unsafe_media_key"
    || issue.reason === "media_too_large"
    || issue.reason === "unsupported_media_type"
    || issue.reason === "invalid_media_size"
  ) {
    const details = issue.reason === "unsafe_media_key"
      ? [`packageMediaKey=${issue.packageMediaKey}`, "reason=package media key is not public"]
      : issue.reason === "invalid_media_size"
        ? [
          `packageMediaKey=${issue.packageMediaKey}`,
          `sizeBytes=${issue.sizeBytes}`,
          "reason=asset size is outside the supported integer range",
        ]
      : [
        `packageMediaKey=${issue.packageMediaKey}`,
        `mimeType=${issue.mimeType}`,
        `sizeBytes=${issue.sizeBytes}`,
        issue.reason === "media_too_large"
          ? `reason=asset exceeds maximum size of ${maximumPublicCatalogMediaDownloadBytes} bytes`
          : `reason=MIME type is unsupported; supportedMimeTypes=${publicCatalogMediaDownloadMimeTypes.join(",")}`,
      ];
    throw new HttpError(
      409,
      [
        "Catalog package version media asset is not publicly deliverable.",
        `packageVersionId=${packageVersionId}`,
        ...details,
      ].join(" "),
      "CATALOG_PACKAGE_VERSION_MEDIA_NOT_PUBLICLY_DELIVERABLE",
    );
  }

  const source = issue.reason === "unsafe_package_field"
    ? `packageField=${issue.field}`
    : issue.reason === "unsafe_author_field"
      ? `authorField=${issue.field}`
      : issue.reason === "invalid_author_website_url"
        ? "authorField=websiteUrl reason=website URL must be a valid absolute HTTP or HTTPS URI without credentials"
        : issue.reason === "unsafe_version_field"
          ? `versionField=${issue.field}`
          : issue.reason === "unsafe_card_field" || issue.reason === "card_markdown_too_complex"
            ? `cardField=${issue.field} packageCardId=${issue.packageCardId}`
            : `mediaField=${issue.field} packageMediaKey=${issue.packageMediaKey}`;
  const remediation = issue.reason === "invalid_author_website_url"
    ? "Set the author website to an absolute HTTP or HTTPS URL without credentials before publishing."
    : issue.reason === "card_markdown_too_complex"
      ? "Simplify nested Markdown labels before publishing."
    : "Remove direct managed-storage or private media references before publishing.";
  throw new HttpError(
    409,
    [
      "Catalog package version contains data that is unsafe for the public catalog.",
      `packageVersionId=${packageVersionId}`,
      source,
      remediation,
    ].join(" "),
    "CATALOG_PACKAGE_VERSION_NOT_PUBLICLY_ELIGIBLE",
  );
}

async function assertCatalogPackageVersionPubliclyEligibleInExecutor(
  executor: DatabaseExecutor,
  versionRow: CatalogPackageVersionRow,
): Promise<void> {
  const publicRelations = await loadCatalogPackageVersionPublicRelationsInExecutor(
    executor,
    versionRow.package_id,
  );
  const mediaAssets = await loadCatalogPackageVersionPublicMediaInExecutor(
    executor,
    versionRow.package_version_id,
  );
  const cardsResult = await executor.query<CatalogPackageVersionPublicCardRow>(
    [
      "SELECT package_card_id, front_text, back_text, card_type, tags, media_asset_keys",
      "FROM catalog.package_cards",
      "WHERE package_version_id = $1",
      "ORDER BY ordinal ASC, package_card_id ASC",
      "FOR UPDATE",
    ].join(" "),
    [versionRow.package_version_id],
  );

  const issue = getPublicCatalogVersionEligibilityIssue({
    package: publicRelations.package,
    author: publicRelations.author,
    version: {
      slug: versionRow.slug,
      title: versionRow.title,
      summary: versionRow.summary,
      description: versionRow.description,
      languageTags: versionRow.language_tags,
      topicTags: versionRow.topic_tags,
      license: versionRow.license,
      contentWarning: versionRow.content_warning,
      coverPackageMediaKey: versionRow.cover_package_media_key,
    },
    mediaAssets,
    cards: cardsResult.rows.map((card) => ({
      packageCardId: card.package_card_id,
      frontText: card.front_text,
      backText: card.back_text,
      cardType: card.card_type,
      tags: card.tags,
      mediaAssetKeys: card.media_asset_keys,
    })),
  });
  if (issue !== null) {
    throwCatalogPackageVersionPublicEligibilityIssue(versionRow.package_version_id, issue);
  }
}

export async function updateCatalogPackageVersionReviewStatusInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
  input: UpdateCatalogPackageVersionStatusInput,
  adminEmail: string,
): Promise<CatalogPackageVersion> {
  if (reviewStatusRouteTargets.has(input.status) === false) {
    throw new HttpError(
      400,
      `Use the publish or delist catalog endpoint for terminal public statuses. status=${input.status}`,
      "CATALOG_PACKAGE_VERSION_STATUS_INVALID",
    );
  }

  const normalizedAdminEmail = normalizeAdminEmail(adminEmail);
  const versionRow = await loadPackageVersionForUpdateInExecutor(executor, packageVersionId);
  if (versionRow.status === input.status) {
    throw new HttpError(
      409,
      `Catalog package version already has the requested status. packageVersionId=${packageVersionId} status=${input.status}`,
      "CATALOG_PACKAGE_VERSION_STATUS_UNCHANGED",
    );
  }
  assertCatalogPackageVersionStatusTransitionAllowed(versionRow.status, input.status);

  try {
    const result = await executor.query<CatalogPackageVersionRow>(
      [
        "UPDATE catalog.package_versions",
        "SET status = $2::catalog.package_status,",
        "submitted_at = CASE WHEN $2::catalog.package_status = 'submitted' THEN now() ELSE submitted_at END,",
        "reviewed_at = CASE WHEN $2::catalog.package_status IN ('needs_changes', 'approved', 'rejected') THEN now() ELSE reviewed_at END,",
        "reviewed_by_admin_email = CASE WHEN $2::catalog.package_status IN ('needs_changes', 'approved', 'rejected') THEN $3 ELSE reviewed_by_admin_email END",
        "WHERE package_version_id = $1",
        "RETURNING",
        catalogPackageVersionColumns,
      ].join(" "),
      [packageVersionId, input.status, normalizedAdminEmail],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Expected catalog package version status update to return a row");
    }

    await insertPackageVersionStatusEventInExecutor(executor, {
      packageId: row.package_id,
      packageVersionId,
      fromStatus: versionRow.status,
      toStatus: row.status,
      adminEmail: normalizedAdminEmail,
      note: normalizeNullableString(input.note, "note"),
    });

    return mapCatalogPackageVersionRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function publishCatalogPackageVersionInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
  adminEmail: string,
  note: string | null,
): Promise<CatalogPackageVersion> {
  const normalizedAdminEmail = normalizeAdminEmail(adminEmail);
  const normalizedNote = normalizeNullableString(note, "note");
  const versionRow = await loadPackageVersionForUpdateInExecutor(executor, packageVersionId);
  if (versionRow.status !== "approved") {
    throw new HttpError(
      409,
      `Catalog package version must be approved before publishing. packageVersionId=${packageVersionId} status=${versionRow.status}`,
      "CATALOG_PACKAGE_VERSION_NOT_APPROVED",
    );
  }

  try {
    await assertCatalogPackageVersionPubliclyEligibleInExecutor(
      executor,
      versionRow,
    );
    const result = await executor.query<CatalogPackageVersionRow>(
      [
        "UPDATE catalog.package_versions",
        "SET status = 'published', published_at = now()",
        "WHERE package_version_id = $1",
        "RETURNING",
        catalogPackageVersionColumns,
      ].join(" "),
      [packageVersionId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Expected catalog package version publish to return a row");
    }

    await executor.query(
      [
        "UPDATE catalog.packages",
        "SET status = 'published', published_at = COALESCE(published_at, now()), delisted_at = NULL",
        "WHERE package_id = $1",
      ].join(" "),
      [row.package_id],
    );
    await insertPackageVersionStatusEventInExecutor(executor, {
      packageId: row.package_id,
      packageVersionId,
      fromStatus: versionRow.status,
      toStatus: "published",
      adminEmail: normalizedAdminEmail,
      note: normalizedNote,
    });

    return mapCatalogPackageVersionRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function delistCatalogPackageVersionInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
  adminEmail: string,
  note: string | null,
): Promise<CatalogPackageVersion> {
  const normalizedAdminEmail = normalizeAdminEmail(adminEmail);
  const normalizedNote = normalizeNullableString(note, "note");
  const versionRow = await loadPackageVersionForUpdateInExecutor(executor, packageVersionId);
  if (versionRow.status !== "published") {
    throw new HttpError(
      409,
      `Only published catalog package versions can be delisted. packageVersionId=${packageVersionId} status=${versionRow.status}`,
      "CATALOG_PACKAGE_VERSION_NOT_PUBLISHED",
    );
  }

  try {
    const result = await executor.query<CatalogPackageVersionRow>(
      [
        "UPDATE catalog.package_versions",
        "SET status = 'delisted', delisted_at = now()",
        "WHERE package_version_id = $1",
        "RETURNING",
        catalogPackageVersionColumns,
      ].join(" "),
      [packageVersionId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Expected catalog package version delist to return a row");
    }

    await executor.query(
      [
        "UPDATE catalog.packages",
        "SET status = CASE",
        "WHEN EXISTS (",
        "SELECT 1 FROM catalog.package_versions",
        "WHERE package_id = $1",
        "AND status = 'published'",
        ") THEN 'published'::catalog.package_status",
        "ELSE 'delisted'::catalog.package_status",
        "END,",
        "delisted_at = CASE",
        "WHEN EXISTS (",
        "SELECT 1 FROM catalog.package_versions",
        "WHERE package_id = $1",
        "AND status = 'published'",
        ") THEN delisted_at",
        "ELSE now()",
        "END",
        "WHERE package_id = $1",
      ].join(" "),
      [row.package_id],
    );
    await insertPackageVersionStatusEventInExecutor(executor, {
      packageId: row.package_id,
      packageVersionId,
      fromStatus: versionRow.status,
      toStatus: "delisted",
      adminEmail: normalizedAdminEmail,
      note: normalizedNote,
    });

    return mapCatalogPackageVersionRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

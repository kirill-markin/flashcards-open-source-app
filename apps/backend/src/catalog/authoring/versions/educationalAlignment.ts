import type { DatabaseExecutor } from "../../../database";
import { HttpError } from "../../../shared/errors";
import { rethrowCatalogPersistenceError } from "../../errors";
import { getPublicCatalogEducationalAlignmentIssue } from "../../publicSafety";
import {
  catalogPackageColumns,
  catalogPackageVersionColumns,
  lockCatalogPackageInExecutor,
  mapCatalogPackageRow,
  mapCatalogPackageVersionRow,
} from "../../rows";
import type {
  CatalogPackageEducationalAlignmentCorrection,
  CatalogPackageRow,
  CatalogPackageVersionRow,
  CorrectCatalogPackageEducationalAlignmentInput,
} from "../../types";

/**
 * Runs the public-safety screen over the submitted values before anything is written.
 *
 * The publication gate is one-shot: `isCatalogPackageVersionStatusTransitionAllowed` permits
 * `published -> delisted` only, so a published row never re-enters
 * `publishCatalogPackageVersionInExecutor` and nothing revalidates a value written after
 * publication except the read-time assertions in the public catalog projections. A correction that
 * wrote without checking would put an unsafe value straight into the public API and the artifact.
 */
function assertCatalogPackageEducationalAlignmentPubliclyEligible(
  packageId: string,
  input: CorrectCatalogPackageEducationalAlignmentInput,
): void {
  const issue = getPublicCatalogEducationalAlignmentIssue(input);
  if (issue === null) {
    return;
  }

  throw new HttpError(
    400,
    [
      "Catalog educational alignment is not eligible for public presentation.",
      `packageId=${packageId}`,
      `field=${issue.field}`,
      issue.reason === "unsafe_alignment_field"
        ? "reason=contains a private or managed-storage media reference"
        : "reason=is empty, whitespace-padded, or carries a control, line separator, zero-width or bidi format character",
    ].join(" "),
    "CATALOG_PACKAGE_EDUCATIONAL_ALIGNMENT_NOT_PUBLICLY_ELIGIBLE",
  );
}

/**
 * Corrects the educational classification of one package and of every version row of it, in a
 * single transaction.
 *
 * This is deliberately separate from `updateCatalogPackageDraftInExecutor`. `PUT /draft` replaces
 * the whole draft and reads an omitted alignment field as `null`, so propagating its values onto
 * published versions would let a routine re-trigger silently rewrite the classification of every
 * published version of a deck. Correcting a published deck has to be asked for by name.
 *
 * Every version row is rewritten, not only the published ones. A version freezes its copy of the
 * three columns when it is created and nothing re-copies them afterwards, because
 * `publishCatalogPackageVersionInExecutor` only flips `status` and `published_at`. Leaving an
 * in-flight draft, submitted or approved row on the old classification would therefore silently
 * revert this correction the moment that version is published.
 * `catalog.prevent_published_package_version_update()` enumerates the columns a published or
 * delisted version may not change and the three alignment columns sit outside that list precisely
 * so this write does not have to become a version nobody asked for;
 * `package_versions_status_transition` is `BEFORE UPDATE OF status` and never fires, because
 * neither statement below mentions that column.
 */
export async function correctCatalogPackageEducationalAlignmentInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  input: CorrectCatalogPackageEducationalAlignmentInput,
): Promise<CatalogPackageEducationalAlignmentCorrection> {
  assertCatalogPackageEducationalAlignmentPubliclyEligible(packageId, input);
  try {
    // Version rows are locked before the package row, in version_number order, and every row of the
    // package is taken whatever its status. That yields the one total order the catalog authoring
    // layer keeps - version rows, then the package row, then the author row - so no path here can
    // deadlock: publication takes the version row (publication.ts) before the package and author
    // rows, delisting takes the version row before the package row, and version creation takes the
    // package row and no version row at all. Restricting this SELECT to published rows would also
    // leave a concurrent publish free to commit between it and the UPDATE below, landing the
    // freshly published row on the old classification while its siblings carry the new one.
    await executor.query(
      [
        "SELECT package_version_id",
        "FROM catalog.package_versions",
        "WHERE package_id = $1",
        "ORDER BY version_number ASC",
        "FOR UPDATE",
      ].join(" "),
      [packageId],
    );
    const lockedPackageRow = await lockCatalogPackageInExecutor(executor, packageId);

    // Both statements are guarded, so replaying an identical correction - which the publishing
    // skill instructs operators to do after an ambiguous 5xx - writes no row, leaves every
    // updated_at where it was, and so keeps each version's updatedAt in the public artifact stable.
    const packageResult = await executor.query<CatalogPackageRow>(
      [
        "UPDATE catalog.packages",
        "SET educational_subject = $2, educational_framework = $3, educational_level = $4",
        "WHERE package_id = $1",
        "AND (educational_subject, educational_framework, educational_level)",
        "IS DISTINCT FROM ($2::text, $3::text, $4::text)",
        "RETURNING",
        catalogPackageColumns,
      ].join(" "),
      [packageId, input.educationalSubject, input.educationalFramework, input.educationalLevel],
    );
    const versionResult = await executor.query<CatalogPackageVersionRow>(
      [
        "UPDATE catalog.package_versions",
        "SET educational_subject = $2, educational_framework = $3, educational_level = $4",
        "WHERE package_id = $1",
        "AND (educational_subject, educational_framework, educational_level)",
        "IS DISTINCT FROM ($2::text, $3::text, $4::text)",
        "RETURNING",
        catalogPackageVersionColumns,
      ].join(" "),
      [packageId, input.educationalSubject, input.educationalFramework, input.educationalLevel],
    );

    return {
      // The guarded UPDATE returns nothing when the package row already held the submitted values,
      // so the row locked above - read in this transaction and unchanged since - answers instead.
      catalogPackage: mapCatalogPackageRow(packageResult.rows[0] ?? lockedPackageRow),
      packageVersions: versionResult.rows
        .map((row) => mapCatalogPackageVersionRow(row))
        .sort((first, second) => first.versionNumber - second.versionNumber),
    };
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

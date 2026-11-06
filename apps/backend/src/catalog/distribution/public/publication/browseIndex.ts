import {
  catalogBrowseIndexSchemaVersion,
  type CatalogBrowseIndex,
  type CatalogBrowseIndexDeck,
  type CatalogPublicSnapshot,
  type CatalogPublicSnapshotCard,
} from "../../../types";

function indexLowestOrdinalCardByPackageVersionId(
  cards: ReadonlyArray<CatalogPublicSnapshotCard>,
): ReadonlyMap<string, CatalogPublicSnapshotCard> {
  const cardsByPackageVersionId = new Map<string, CatalogPublicSnapshotCard>();
  for (const card of cards) {
    const current = cardsByPackageVersionId.get(card.packageVersionId);
    if (current === undefined || card.ordinal < current.ordinal) {
      cardsByPackageVersionId.set(card.packageVersionId, card);
    }
  }

  return cardsByPackageVersionId;
}

function requireSnapshotEntry<Entry>(
  entriesById: ReadonlyMap<string, Entry>,
  id: string,
  description: string,
): Entry {
  const entry = entriesById.get(id);
  if (entry === undefined) {
    throw new Error(`Public catalog snapshot is missing ${description}.`);
  }

  return entry;
}

/**
 * Projects the snapshot onto one entry per published package, taken from its
 * latest version. `reviewTag` is the deck's root tag, the first tag of its
 * lowest-ordinal card.
 */
export function buildCatalogBrowseIndex(snapshot: CatalogPublicSnapshot): CatalogBrowseIndex {
  const authorsById = new Map(snapshot.authors.map((author) => [author.authorId, author]));
  const packageVersionsById = new Map(
    snapshot.packageVersions.map((packageVersion) => [packageVersion.packageVersionId, packageVersion]),
  );
  const mediaAssetsById = new Map(
    snapshot.mediaAssets.map((mediaAsset) => [mediaAsset.packageMediaAssetId, mediaAsset]),
  );
  const firstCardsByPackageVersionId = indexLowestOrdinalCardByPackageVersionId(snapshot.cards);

  const decks = snapshot.packages.map((catalogPackage): CatalogBrowseIndexDeck => {
    const packageVersionId = catalogPackage.latestPackageVersionId;
    const packageVersion = requireSnapshotEntry(
      packageVersionsById,
      packageVersionId,
      `latest package version ${packageVersionId} of package ${catalogPackage.packageId}`,
    );
    const author = requireSnapshotEntry(
      authorsById,
      catalogPackage.authorId,
      `author ${catalogPackage.authorId} of package ${catalogPackage.packageId}`,
    );
    const firstCard = requireSnapshotEntry(
      firstCardsByPackageVersionId,
      packageVersionId,
      `cards of package version ${packageVersionId}`,
    );
    const reviewTag = firstCard.tags[0];
    if (reviewTag === undefined) {
      throw new Error(
        `Public catalog package version ${packageVersionId} (${packageVersion.slug}) has no root tag: its lowest-ordinal card ${firstCard.packageCardId} has no tags.`,
      );
    }

    const coverImageUrl = packageVersion.coverMediaAssetId === null
      ? null
      : requireSnapshotEntry(
        mediaAssetsById,
        packageVersion.coverMediaAssetId,
        `cover media asset ${packageVersion.coverMediaAssetId} of package version ${packageVersionId}`,
      ).downloadUrl;

    return {
      packageId: catalogPackage.packageId,
      packageVersionId,
      slug: catalogPackage.slug,
      title: packageVersion.title,
      summary: packageVersion.summary,
      languageTags: packageVersion.languageTags,
      educationalSubject: packageVersion.educationalSubject,
      cardCount: packageVersion.cardCount,
      publishedAt: packageVersion.publishedAt,
      authorDisplayName: author.displayName,
      coverImageUrl,
      reviewTag,
    };
  });

  return {
    schemaVersion: catalogBrowseIndexSchemaVersion,
    generatedAt: snapshot.generatedAt,
    decks,
  };
}

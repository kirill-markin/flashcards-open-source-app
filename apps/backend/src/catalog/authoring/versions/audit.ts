import type { CardMetadata } from "../../../cards/types";
import type { DatabaseExecutor } from "../../../database";
import { unsafeRepeatableReadReadOnlyTransaction } from "../../../database/core";
import { HttpError } from "../../../shared/errors";
import { toSafeNumber } from "../../common";
import type {
  CatalogPackageStatus,
  CatalogPackageVersionAudit,
  CatalogPackageVersionAuditCard,
} from "../../types";

type CatalogPackageVersionAuditRow = Readonly<{
  package_version_id: string;
  version_number: string | number;
  status: CatalogPackageStatus;
}>;

type CatalogPackageVersionAuditCardRow = Readonly<{
  package_version_id: string;
  package_card_id: string;
  stable_card_key: string;
  ordinal: string | number;
  front_text: string;
  back_text: string;
  card_type: string;
  metadata: CardMetadata;
  tags: ReadonlyArray<string>;
  media_asset_keys: ReadonlyArray<string>;
}>;

async function assertCatalogPackageExistsInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
): Promise<void> {
  const result = await executor.query<Readonly<{ package_id: string }>>(
    "SELECT package_id FROM catalog.packages WHERE package_id = $1",
    [packageId],
  );
  if (result.rows[0] !== undefined) {
    return;
  }

  throw new HttpError(
    404,
    `Catalog package not found. packageId=${packageId}`,
    "CATALOG_PACKAGE_NOT_FOUND",
  );
}

function mapCatalogPackageVersionAuditCard(
  row: CatalogPackageVersionAuditCardRow,
): CatalogPackageVersionAuditCard {
  return {
    packageCardId: row.package_card_id,
    stableCardKey: row.stable_card_key,
    ordinal: toSafeNumber(row.ordinal, "ordinal"),
    frontText: row.front_text,
    backText: row.back_text,
    cardType: row.card_type,
    metadata: row.metadata,
    tags: [...row.tags],
    mediaAssetKeys: [...row.media_asset_keys],
  };
}

function groupCatalogPackageVersionAuditCards(
  rows: ReadonlyArray<CatalogPackageVersionAuditCardRow>,
): ReadonlyMap<string, ReadonlyArray<CatalogPackageVersionAuditCard>> {
  const cardsByVersionId = new Map<string, Array<CatalogPackageVersionAuditCard>>();
  for (const row of rows) {
    const card = mapCatalogPackageVersionAuditCard(row);
    const cards = cardsByVersionId.get(row.package_version_id);
    if (cards === undefined) {
      cardsByVersionId.set(row.package_version_id, [card]);
    } else {
      cards.push(card);
    }
  }

  return cardsByVersionId;
}

export async function listCatalogPackageVersionsForAuditInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
): Promise<ReadonlyArray<CatalogPackageVersionAudit>> {
  await assertCatalogPackageExistsInExecutor(executor, packageId);
  const versionsResult = await executor.query<CatalogPackageVersionAuditRow>(
    [
      "SELECT package_version_id, version_number, status",
      "FROM catalog.package_versions",
      "WHERE package_id = $1",
      "ORDER BY version_number ASC, package_version_id ASC",
    ].join(" "),
    [packageId],
  );
  if (versionsResult.rows.length === 0) {
    return [];
  }

  const cardsResult = await executor.query<CatalogPackageVersionAuditCardRow>(
    [
      "SELECT cards.package_version_id, cards.package_card_id, cards.stable_card_key, cards.ordinal,",
      "cards.front_text, cards.back_text, cards.card_type, cards.metadata, cards.tags, cards.media_asset_keys",
      "FROM catalog.package_cards AS cards",
      "INNER JOIN catalog.package_versions AS versions",
      "ON versions.package_version_id = cards.package_version_id",
      "WHERE versions.package_id = $1",
      "ORDER BY versions.version_number ASC, cards.ordinal ASC, cards.package_card_id ASC",
    ].join(" "),
    [packageId],
  );
  const cardsByVersionId = groupCatalogPackageVersionAuditCards(cardsResult.rows);

  return versionsResult.rows.map((version): CatalogPackageVersionAudit => ({
    packageVersionId: version.package_version_id,
    versionNumber: toSafeNumber(version.version_number, "version_number"),
    status: version.status,
    cards: cardsByVersionId.get(version.package_version_id) ?? [],
  }));
}

export async function listCatalogPackageVersionsForAudit(
  packageId: string,
): Promise<ReadonlyArray<CatalogPackageVersionAudit>> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => (
    listCatalogPackageVersionsForAuditInExecutor(executor, packageId)
  ));
}

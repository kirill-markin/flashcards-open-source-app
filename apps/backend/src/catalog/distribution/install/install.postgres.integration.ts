import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { HttpError } from "../../../shared/errors";
import type { CatalogPackageInstallConfirmInput } from "../../types";
import { installCatalogPackageVersion } from "./install";

type InstallEffectCounts = Readonly<{
  card_count: string;
  media_asset_count: string;
  hot_change_count: string;
  idempotency_count: string;
}>;

function requireTestDatabaseAdminUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("TEST_DATABASE_ADMIN_URL is required for the catalog install idempotency integration test.");
  }

  return databaseUrl;
}

function buildMediaBlobStorageKey(sha256: string): string {
  return `media/blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

test("catalog install atomically replays one request and rejects key or operation collisions", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireTestDatabaseAdminUrl(),
    application_name: "catalog-install-idempotency-integration-owner",
  });
  const suffix = randomUUID().replaceAll("-", "");
  const userId = `catalog-install-idempotency-${suffix}`;
  const workspaceId = randomUUID();
  const replicaId = randomUUID();
  const authorId = randomUUID();
  const packageId = randomUUID();
  const packageVersionId = randomUUID();
  const packageCardId = randomUUID();
  const packageMediaAssetId = randomUUID();
  const mediaBlobId = randomUUID();
  const sha256 = createHash("sha256").update(suffix).digest("hex");
  const installId = randomUUID();
  const operationIdPrefix = `catalog-install-idempotency-${suffix}`;
  const installedAt = "2026-08-02T10:00:00.000Z";
  const installInput: CatalogPackageInstallConfirmInput = {
    installId,
    installedAt,
    clientUpdatedAt: installedAt,
    lastModifiedByReplicaId: replicaId,
    operationIdPrefix,
    addImportTag: true,
    importTag: " imported ",
    removeTags: ["temporary"],
  };

  try {
    const setupClient = await ownerPool.connect();
    try {
      await setupClient.query("BEGIN");
      await setupClient.query("INSERT INTO org.user_settings (user_id) VALUES ($1)", [userId]);
      await setupClient.query(
        [
          "INSERT INTO org.workspaces",
          "(workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id)",
          "VALUES ($1, $2, $3, $4, $5)",
        ].join(" "),
        [workspaceId, "Catalog install idempotency", installedAt, replicaId, `workspace-${suffix}`],
      );
      await setupClient.query(
        "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
        [workspaceId, userId],
      );
      await setupClient.query(
        [
          "INSERT INTO sync.workspace_replicas",
          "(replica_id, workspace_id, user_id, actor_kind, actor_key, platform, app_version)",
          "VALUES ($1, $2, $3, 'ai_chat', $4, 'system', 'postgres-integration')",
        ].join(" "),
        [replicaId, workspaceId, userId, `catalog-install-${suffix}`],
      );
      await setupClient.query(
        [
          "INSERT INTO content.media_blobs",
          "(media_blob_id, sha256, mime_type, size_bytes, storage_key, normalization_version)",
          "VALUES ($1, $2, 'image/png', 1, $3, 'passthrough-v1')",
        ].join(" "),
        [mediaBlobId, sha256, buildMediaBlobStorageKey(sha256)],
      );
      await setupClient.query(
        "INSERT INTO catalog.authors (author_id, slug, display_name) VALUES ($1, $2, $3)",
        [authorId, `idempotency-author-${suffix}`, "Idempotency Author"],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.packages",
          "(package_id, author_id, slug, title, summary, description, language_tags, topic_tags, license, status, published_at)",
          "VALUES ($1, $2, $3, 'Idempotency package', 'Summary', 'Description', ARRAY['en'], ARRAY['test'], 'CC0-1.0', 'published', $4)",
        ].join(" "),
        [packageId, authorId, `idempotency-package-${suffix}`, installedAt],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.package_versions",
          "(package_version_id, package_id, version_number, status, slug, title, summary, description,",
          "language_tags, topic_tags, license, card_count, created_by_admin_email)",
          "VALUES ($1, $2, 1, 'draft', $3, 'Idempotency package', 'Summary', 'Description',",
          "ARRAY['en'], ARRAY['test'], 'CC0-1.0', 1, $4)",
        ].join(" "),
        [packageVersionId, packageId, `idempotency-package-${suffix}-v1`, "catalog@example.test"],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.package_media_assets",
          "(package_media_asset_id, package_id, package_version_id, package_media_key, media_blob_id)",
          "VALUES ($1, $2, $3, 'diagram', $4)",
        ].join(" "),
        [packageMediaAssetId, packageId, packageVersionId, mediaBlobId],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.package_cards",
          "(package_card_id, package_version_id, stable_card_key, ordinal, front_text, back_text, card_type, metadata, tags, media_asset_keys)",
          "VALUES ($1, $2, 'card-1', 1, 'Prompt ![diagram](fcasset:diagram)', 'Answer', 'basic',",
          "'{\"version\":1,\"source\":null}'::jsonb, ARRAY['keep', 'temporary'], ARRAY['diagram'])",
        ].join(" "),
        [packageCardId, packageVersionId],
      );
      await setupClient.query(
        "UPDATE catalog.package_versions SET status = 'submitted', submitted_at = $2 WHERE package_version_id = $1",
        [packageVersionId, installedAt],
      );
      await setupClient.query(
        [
          "UPDATE catalog.package_versions",
          "SET status = 'approved', reviewed_by_admin_email = $2, reviewed_at = $3",
          "WHERE package_version_id = $1",
        ].join(" "),
        [packageVersionId, "catalog@example.test", installedAt],
      );
      await setupClient.query(
        "UPDATE catalog.package_versions SET status = 'published', published_at = $2 WHERE package_version_id = $1",
        [packageVersionId, installedAt],
      );
      await setupClient.query("COMMIT");
    } catch (error) {
      await setupClient.query("ROLLBACK");
      throw error;
    } finally {
      setupClient.release();
    }

    const firstResult = await installCatalogPackageVersion(
      userId,
      workspaceId,
      packageVersionId,
      installInput,
    );
    const replayResult = await installCatalogPackageVersion(
      userId,
      workspaceId,
      packageVersionId,
      installInput,
    );
    assert.deepEqual(replayResult, firstResult);
    assert.equal(firstResult.installedCards.length, 1);
    assert.equal(firstResult.installedMediaAssets.length, 1);
    assert.equal(firstResult.summary.importTag, "imported");

    const loadEffectCounts = async (): Promise<InstallEffectCounts> => {
      const result = await ownerPool.query<InstallEffectCounts>(
        [
          "SELECT",
          "(SELECT COUNT(*) FROM content.cards WHERE workspace_id = $1 AND metadata->'source'->>'importId' = $2) AS card_count,",
          "(SELECT COUNT(*) FROM content.media_assets WHERE workspace_id = $1 AND last_operation_id LIKE $3) AS media_asset_count,",
          "(SELECT COUNT(*) FROM sync.hot_changes WHERE workspace_id = $1 AND operation_id LIKE $3) AS hot_change_count,",
          "(SELECT COUNT(*) FROM sync.catalog_package_install_idempotency WHERE workspace_id = $1) AS idempotency_count",
        ].join(" "),
        [workspaceId, installId, `${operationIdPrefix}:%`],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("Catalog install effect count query returned no rows.");
      }
      return row;
    };

    assert.deepEqual(await loadEffectCounts(), {
      card_count: "1",
      media_asset_count: "1",
      hot_change_count: "2",
      idempotency_count: "1",
    });

    await assert.rejects(
      installCatalogPackageVersion(
        userId,
        workspaceId,
        packageVersionId,
        { ...installInput, importTag: "different" },
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "CATALOG_PACKAGE_INSTALL_IDEMPOTENCY_CONFLICT");
        assert.match(error.message, /mismatchedFields=importTag/);
        assert.match(error.message, /Use a new installId/);
        return true;
      },
    );

    await assert.rejects(
      installCatalogPackageVersion(
        userId,
        workspaceId,
        packageVersionId,
        {
          ...installInput,
          installId: randomUUID(),
          installedAt: "2026-08-02T10:00:01.000Z",
          clientUpdatedAt: "2026-08-02T10:00:01.000Z",
        },
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "CATALOG_PACKAGE_INSTALL_OPERATION_ALREADY_EXISTS");
        return true;
      },
    );

    assert.deepEqual(await loadEffectCounts(), {
      card_count: "1",
      media_asset_count: "1",
      hot_change_count: "2",
      idempotency_count: "1",
    });
  } finally {
    await ownerPool.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [workspaceId]);
    await ownerPool.query("DELETE FROM catalog.packages WHERE package_id = $1", [packageId]);
    await ownerPool.query("DELETE FROM catalog.authors WHERE author_id = $1", [authorId]);
    await ownerPool.query("DELETE FROM content.media_blobs WHERE media_blob_id = $1", [mediaBlobId]);
    await ownerPool.query("DELETE FROM org.user_settings WHERE user_id = $1", [userId]);
    await ownerPool.end();
  }
});

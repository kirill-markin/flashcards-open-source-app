import assert from "node:assert/strict";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import {
  createQueryResult,
  testAuthorId,
  testMediaBlobId,
  testPackageId,
  testPackageMediaAssetId,
  testPackageMediaKey,
  testPackageVersionId,
  testTimestamp,
  testWorkspaceCardId,
  testWorkspaceId,
  testWorkspaceMediaAssetId,
} from "../../testSupport";
import type {
  CatalogPackageInstallConfirmInput,
  CatalogPackageInstallResult,
  CatalogPackageStatus,
} from "../../types";

export {
  testAuthorId,
  testMediaBlobId,
  testPackageId,
  testPackageMediaAssetId,
  testPackageMediaKey,
  testPackageVersionId,
  testTimestamp,
  testWorkspaceCardId,
  testWorkspaceId,
  testWorkspaceMediaAssetId,
};

export const testWorkspaceReplicaId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const testInstallTimestamp = "2026-04-19T10:30:00.000Z";

export function createPackageInstallVersionRow(status: CatalogPackageStatus): Readonly<Record<string, unknown>> {
  return {
    package_version_id: testPackageVersionId,
    package_id: testPackageId,
    version_number: 1,
    status,
    slug: "spanish-basics",
    title: "Spanish Basics",
    summary: "Core Spanish prompts.",
    description: "Core Spanish flashcards for beginners.",
    language_tags: ["en", "es"],
    license: "CC-BY-4.0",
    content_warning: null,
    cover_package_media_key: null,
    card_count: 1,
    created_at: testTimestamp,
    published_at: testTimestamp,
    author_id: testAuthorId,
    author_slug: "open-cards",
    author_display_name: "Open Cards",
  };
}

export function createStoredCatalogPackageInstallResult(installId: string): CatalogPackageInstallResult {
  return {
    packageVersion: {
      packageVersionId: testPackageVersionId,
      packageId: testPackageId,
      versionNumber: 1,
      slug: "spanish-basics",
      title: "Spanish Basics",
      summary: "Core Spanish prompts.",
      description: "Core Spanish flashcards for beginners.",
      languageTags: ["en", "es"],
      license: "CC-BY-4.0",
      contentWarning: null,
      coverPackageMediaKey: null,
      cardCount: 1,
      createdAt: testTimestamp,
      publishedAt: testTimestamp,
      author: {
        authorId: testAuthorId,
        slug: "open-cards",
        displayName: "Open Cards",
      },
    },
    installedCards: [{
      packageCardId: testWorkspaceCardId,
      stableCardKey: "hola-card",
      ordinal: 1,
      cardId: testWorkspaceCardId,
    }],
    installedMediaAssets: [{
      packageMediaAssetId: testPackageMediaAssetId,
      packageMediaKey: testPackageMediaKey,
      mediaAssetId: testWorkspaceMediaAssetId,
    }],
    summary: {
      cardCount: 1,
      mediaAssetCount: 1,
      installId,
      installedAt: testInstallTimestamp,
      keptTagCount: 1,
      removedTagCount: 0,
      importTag: null,
    },
  };
}

export function createCatalogPackageInstallReplayExecutor(
  input: CatalogPackageInstallConfirmInput,
  installResult: unknown,
): DatabaseExecutor {
  return {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
        assert.deepEqual(params, [testWorkspaceId]);
        return createQueryResult([]);
      }
      if (text.includes("FROM sync.workspace_sync_metadata") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, [testWorkspaceId]);
        return createQueryResult([{ workspace_id: testWorkspaceId } as unknown as Row]);
      }
      if (text.includes("FROM sync.catalog_package_install_idempotency")) {
        assert.deepEqual(params, [testWorkspaceId, input.installId]);
        return createQueryResult([{
          package_version_id: testPackageVersionId,
          installed_at: testInstallTimestamp,
          client_updated_at: testInstallTimestamp,
          last_modified_by_replica_id: testWorkspaceReplicaId,
          operation_id_prefix: input.operationIdPrefix,
          add_import_tag: false,
          import_tag: null,
          remove_tags: [],
          install_result: installResult,
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

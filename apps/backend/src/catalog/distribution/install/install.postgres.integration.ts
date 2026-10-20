import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { HttpError } from "../../../shared/errors";
import type {
  CatalogPackageInstallActor,
  CatalogPackageInstallConfirmInput,
} from "../../types";
import { installCatalogPackageVersion, loadCatalogPackageInstallContext } from "./install";

type InstallEffectCounts = Readonly<{
  card_count: string;
  media_asset_count: string;
  hot_change_count: string;
  idempotency_count: string;
  analytics_event_count: string;
  analytics_package_slug: string | null;
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
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const extraWorkspaceIds: Array<string> = [];
  const replicaId = randomUUID();
  const authorId = randomUUID();
  const packageId = randomUUID();
  // The package slug and the version's own copy of it are deliberately different here: only
  // catalog.packages.slug is what catalog_deck_installed.package_slug has to report.
  const packageSlug = `idempotency-package-${suffix}`;
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
  const installActor: CatalogPackageInstallActor = {
    subjectUserId: userId,
    guestSessionId: null,
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
          "(package_id, author_id, slug, title, summary, description, language_tags, license, status, published_at, educational_subject)",
          "VALUES ($1, $2, $3, 'Idempotency package', 'Summary', 'Description', ARRAY['en'], 'CC0-1.0', 'published', $4, 'Test')",
        ].join(" "),
        [packageId, authorId, packageSlug, installedAt],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.package_versions",
          "(package_version_id, package_id, version_number, status, slug, title, summary, description,",
          "language_tags, license, card_count, created_by_admin_email, educational_subject)",
          "VALUES ($1, $2, 1, 'draft', $3, 'Idempotency package', 'Summary', 'Description',",
          "ARRAY['en'], 'CC0-1.0', 1, $4, 'Test')",
        ].join(" "),
        [packageVersionId, packageId, `${packageSlug}-v1`, "catalog@example.test"],
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
      installActor,
    );
    const replayResult = await installCatalogPackageVersion(
      userId,
      workspaceId,
      packageVersionId,
      installInput,
      installActor,
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
          "(SELECT COUNT(*) FROM sync.catalog_package_install_idempotency WHERE workspace_id = $1) AS idempotency_count,",
          // One row across both installs, because the install emission derives its event_id from the
          // install id and the replay therefore conflicts on it instead of counting a second install.
          "(SELECT COUNT(*) FROM analytics.product_events",
          "WHERE workspace_id = $1 AND event_name = 'catalog_deck_installed') AS analytics_event_count,",
          // The package's slug, never the version's `-v1` copy of it: the client's
          // catalog_deck_install_started carries the package slug, so only that value joins the pair
          // into a funnel, and the two stop agreeing as soon as a published deck is renamed.
          "(SELECT event_properties->>'package_slug' FROM analytics.product_events",
          "WHERE workspace_id = $1 AND event_name = 'catalog_deck_installed') AS analytics_package_slug",
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
      analytics_event_count: "1",
      analytics_package_slug: packageSlug,
    });

    await assert.rejects(
      installCatalogPackageVersion(
        userId,
        workspaceId,
        packageVersionId,
        { ...installInput, importTag: "different" },
        installActor,
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
        installActor,
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
      analytics_event_count: "1",
      analytics_package_slug: packageSlug,
    });
    const context = await loadCatalogPackageInstallContext(userId, workspaceId, packageVersionId);
    assert.equal(context.workspaces.length, 1);
    assert.deepEqual(context.workspaces[0]?.previousInstall, {
      installId, packageVersionId, title: "Idempotency package", retainedCardCount: 1,
    });
    assert.equal(context.workspaces[0]?.onboardingEligibility, "ineligible");
    assert.equal(context.workspaces[0]?.lastReviewedAt, null);

    const createOnboardingWorkspace = async (kind: "empty" | "demo" | "edited" | "real" | "invalid" | "deleted") => {
      const id = randomUUID();
      const replica = randomUUID();
      const cardId = randomUUID();
      extraWorkspaceIds.push(id);
      const client = await ownerPool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO org.workspaces (workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id) VALUES ($1, $2, $3, $4, $5)",
          [id, kind, installedAt, replica, "workspace-" + id],
        );
        await client.query(
          "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
          [id, userId],
        );
        await client.query(
          "INSERT INTO sync.workspace_replicas (replica_id, workspace_id, user_id, actor_kind, actor_key, platform) VALUES ($1, $2, $3, 'ai_chat', $4, 'system')",
          [replica, id, userId, id],
        );
        if (kind !== "empty") {
          await client.query(
            [
              "INSERT INTO content.cards (card_id, workspace_id, front_text, back_text, card_type, metadata, tags, effort_level, created_at,",
              "client_updated_at, last_modified_by_replica_id, last_operation_id, deleted_at)",
              "VALUES ($1, $2, 'Demo question', 'Demo answer', 'basic', $3::jsonb, ARRAY['demo'], 'fast', $4, $4, $5, $6, $7)",
            ].join(" "),
            [cardId, id, JSON.stringify({
              version: 1, source: null,
              ...(kind === "real" ? {} : {
                onboardingDemo: {
                  version: kind === "invalid" ? 99 : 1,
                  frontText: "Demo question", backText: "Demo answer", cardType: "basic", tags: ["demo"],
                  wasEdited: kind === "edited",
                },
              }),
            }), installedAt, replica, "seed-" + id, kind === "deleted" ? installedAt : null],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return { workspaceId: id, replicaId: replica, cardId };
    };
    const empty = await createOnboardingWorkspace("empty");
    const demo = await createOnboardingWorkspace("demo");
    const preserved = await Promise.all([
      createOnboardingWorkspace("edited"), createOnboardingWorkspace("real"),
      createOnboardingWorkspace("invalid"), createOnboardingWorkspace("deleted"),
    ]);
    const reviewedAt = "2026-07-31T10:00:00.000Z";
    const demoClientUpdatedAt = "2026-08-03T10:00:00.000500Z";
    await ownerPool.query(
      "UPDATE content.cards SET client_updated_at = $1 WHERE card_id = $2",
      [demoClientUpdatedAt, demo.cardId],
    );
    await ownerPool.query(
      [
        "INSERT INTO content.review_events (review_event_id, workspace_id, card_id, replica_id, client_event_id, rating, reviewed_at_client, reviewed_at_server)",
        "VALUES ($1, $2, $3, $4, $5, 1, $6, now())",
      ].join(" "),
      [randomUUID(), demo.workspaceId, demo.cardId, demo.replicaId, randomUUID(), reviewedAt],
    );
    const entry = await loadCatalogPackageInstallContext(userId, workspaceId, packageVersionId);
    assert.equal(entry.workspaces[0]?.workspaceId, demo.workspaceId);
    assert.equal(entry.workspaces[0]?.lastReviewedAt, reviewedAt);
    assert.equal(entry.workspaces.find((row) => row.workspaceId === workspaceId)?.isSelected, true);
    assert.equal(entry.workspaces.find((row) => row.workspaceId === empty.workspaceId)?.onboardingEligibility, "empty");
    assert.equal(entry.workspaces.find((row) => row.workspaceId === demo.workspaceId)?.onboardingEligibility, "demo_only");
    assert.deepEqual((await loadCatalogPackageInstallContext(randomUUID(), null, packageVersionId)).workspaces, []);
    const immediateInput = (replica: string): CatalogPackageInstallConfirmInput => ({
      installId: randomUUID(), installedAt, clientUpdatedAt: installedAt,
      lastModifiedByReplicaId: replica, operationIdPrefix: "immediate-" + randomUUID(), immediateOnboarding: true,
    });
    for (const workspace of preserved) {
      assert.equal(entry.workspaces.find((row) => row.workspaceId === workspace.workspaceId)?.onboardingEligibility, "ineligible");
      await assert.rejects(
        installCatalogPackageVersion(userId, workspace.workspaceId, packageVersionId, immediateInput(workspace.replicaId), installActor),
        (error: unknown) => error instanceof HttpError && error.code === "CATALOG_PACKAGE_INSTALL_ONBOARDING_NOT_ELIGIBLE",
      );
      const remaining = await ownerPool.query("SELECT card_id FROM content.cards WHERE workspace_id = $1", [workspace.workspaceId]);
      assert.deepEqual(remaining.rows, [{ card_id: workspace.cardId }]);
    }
    const changed = await createOnboardingWorkspace("demo");
    assert.equal((await loadCatalogPackageInstallContext(userId, workspaceId, packageVersionId)).workspaces.find(
      (row) => row.workspaceId === changed.workspaceId,
    )?.onboardingEligibility, "demo_only");
    await ownerPool.query("UPDATE content.cards SET back_text = 'Authored answer' WHERE card_id = $1", [changed.cardId]);
    await assert.rejects(
      installCatalogPackageVersion(userId, changed.workspaceId, packageVersionId, immediateInput(changed.replicaId), installActor),
      (error: unknown) => error instanceof HttpError && error.code === "CATALOG_PACKAGE_INSTALL_ONBOARDING_NOT_ELIGIBLE",
    );
    const authored = await ownerPool.query("SELECT back_text, deleted_at FROM content.cards WHERE card_id = $1", [changed.cardId]);
    assert.deepEqual(authored.rows, [{ back_text: "Authored answer", deleted_at: null }]);
    const emptyInput = immediateInput(empty.replicaId);
    const emptyResult = await installCatalogPackageVersion(userId, empty.workspaceId, packageVersionId, emptyInput, installActor);
    assert.deepEqual(emptyResult.onboarding, { removedDemoCardId: null });
    assert.equal(emptyResult.summary.importTag, null);
    assert.deepEqual(await installCatalogPackageVersion(userId, empty.workspaceId, packageVersionId, emptyInput, installActor), emptyResult);

    // The second version proves package identity across versions and fails after its media insert.
    const brokenVersionId = randomUUID();
    await ownerPool.query(
      [
        "INSERT INTO catalog.package_versions (package_version_id, package_id, version_number, slug, title, summary, description,",
        "language_tags, license, card_count, created_by_admin_email, educational_subject)",
        "SELECT $1, package_id, 2, slug, title, summary, description, language_tags, license, 1, created_by_admin_email, educational_subject",
        "FROM catalog.package_versions WHERE package_version_id = $2",
      ].join(" "), [brokenVersionId, packageVersionId],
    );
    await ownerPool.query(
      [
        "INSERT INTO catalog.package_cards (package_card_id, package_version_id, stable_card_key, ordinal, front_text, back_text, card_type, metadata, tags, media_asset_keys)",
        "SELECT $1, $2, stable_card_key, ordinal, front_text, back_text, card_type, metadata, tags, ARRAY['missing']",
        "FROM catalog.package_cards WHERE package_card_id = $3",
      ].join(" "), [randomUUID(), brokenVersionId, packageCardId],
    );
    await ownerPool.query(
      "INSERT INTO catalog.package_media_assets (package_media_asset_id, package_id, package_version_id, package_media_key, media_blob_id) VALUES ($1, $2, $3, 'diagram', $4)",
      [randomUUID(), packageId, brokenVersionId, mediaBlobId],
    );
    for (const status of ["submitted", "approved", "published"]) {
      await ownerPool.query("UPDATE catalog.package_versions SET status = $2 WHERE package_version_id = $1", [brokenVersionId, status]);
    }
    const previousVersion = await loadCatalogPackageInstallContext(userId, workspaceId, brokenVersionId);
    assert.equal(previousVersion.workspaces.find((row) => row.workspaceId === workspaceId)?.previousInstall?.packageVersionId, packageVersionId);
    await assert.rejects(
      installCatalogPackageVersion(userId, demo.workspaceId, brokenVersionId, immediateInput(demo.replicaId), installActor),
      (error: unknown) => error instanceof HttpError && error.code === "CATALOG_PACKAGE_INSTALL_MEDIA_ASSET_NOT_FOUND",
    );
    const failedEffects = await ownerPool.query(
      [
        "SELECT (SELECT COUNT(*) FROM content.cards WHERE workspace_id = $1 AND deleted_at IS NULL) AS cards,",
        "(SELECT COUNT(*) FROM content.media_assets WHERE workspace_id = $1) AS media,",
        "(SELECT COUNT(*) FROM sync.catalog_package_install_idempotency WHERE workspace_id = $1) AS installs",
      ].join(" "), [demo.workspaceId],
    );
    assert.deepEqual(failedEffects.rows, [{ cards: "1", media: "0", installs: "0" }]);
    const demoInput = immediateInput(demo.replicaId);
    const demoResult = await installCatalogPackageVersion(userId, demo.workspaceId, packageVersionId, demoInput, installActor);
    assert.deepEqual(demoResult.onboarding, { removedDemoCardId: demo.cardId });
    assert.deepEqual(await installCatalogPackageVersion(userId, demo.workspaceId, packageVersionId, demoInput, installActor), demoResult);
    await assert.rejects(
      installCatalogPackageVersion(userId, demo.workspaceId, packageVersionId, { ...demoInput, immediateOnboarding: false }, installActor),
      (error: unknown) => error instanceof HttpError && error.code === "CATALOG_PACKAGE_INSTALL_IDEMPOTENCY_CONFLICT",
    );
    const disposal = await ownerPool.query(
      [
        "SELECT deleted_at = cards.client_updated_at AS deleted,",
        "cards.client_updated_at > $4::timestamptz AND cards.client_updated_at >= $5::timestamptz AS outranks_demo,",
        "cards.client_updated_at = $6::timestamptz AS canonical_timestamp,",
        "EXISTS (SELECT 1 FROM sync.hot_changes WHERE workspace_id = $1 AND entity_id = $2::text AND operation_id = $3",
        "AND client_updated_at = cards.client_updated_at) AS published,",
        "(SELECT COUNT(*) FROM content.review_events WHERE workspace_id = $1 AND card_id = $2::uuid) AS reviews",
        "FROM content.cards AS cards WHERE workspace_id = $1 AND card_id = $2::uuid",
      ].join(" "), [
        demo.workspaceId, demo.cardId, demoInput.operationIdPrefix + ":onboarding-demo",
        demoClientUpdatedAt, demoInput.clientUpdatedAt, "2026-08-03T10:00:00.001Z",
      ],
    );
    assert.deepEqual(disposal.rows, [{
      deleted: true, outranks_demo: true, canonical_timestamp: true, published: true, reviews: "1",
    }]);
    const retained = await ownerPool.query("SELECT tags FROM content.cards WHERE workspace_id = $1 AND deleted_at IS NULL", [demo.workspaceId]);
    assert.deepEqual(retained.rows, [{ tags: ["keep", "temporary"] }]);
    await ownerPool.query("UPDATE content.cards SET deleted_at = now() WHERE workspace_id = $1", [workspaceId]);
    assert.equal((await loadCatalogPackageInstallContext(userId, workspaceId, packageVersionId)).workspaces.find(
      (row) => row.workspaceId === workspaceId,
    )?.previousInstall, null);
  } finally {
    await ownerPool.query("DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])", [[workspaceId, ...extraWorkspaceIds]]);
    await ownerPool.query("DELETE FROM catalog.packages WHERE package_id = $1", [packageId]);
    await ownerPool.query("DELETE FROM catalog.authors WHERE author_id = $1", [authorId]);
    await ownerPool.query("DELETE FROM content.media_blobs WHERE media_blob_id = $1", [mediaBlobId]);
    await ownerPool.query("DELETE FROM org.user_settings WHERE user_id = $1", [userId]);
    // The install emits its analytics row on the writer's own pool, outside the install
    // transaction, so it is removed here like every other row this test created.
    await ownerPool.query("DELETE FROM analytics.product_events WHERE workspace_id = ANY($1::uuid[])", [[workspaceId, ...extraWorkspaceIds]]);
    await ownerPool.end();
  }
});

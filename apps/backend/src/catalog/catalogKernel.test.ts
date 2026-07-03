import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { isCatalogPackageVersionStatusTransitionAllowed } from "./authoring/versions";

test("catalog migration defines blob-backed media and published-version immutability", () => {
  const migrationPath = resolve(process.cwd(), "../../db/migrations/0083_catalog_kernel.sql");
  const migrationSql = readFileSync(migrationPath, "utf8");
  const mediaAssetTableSql = migrationSql.slice(
    migrationSql.indexOf("CREATE TABLE IF NOT EXISTS catalog.package_media_assets"),
    migrationSql.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS idx_package_media_assets_draft_key_unique"),
  );

  assert.match(migrationSql, /CREATE SCHEMA IF NOT EXISTS catalog;/);
  assert.match(migrationSql, /'draft'/);
  assert.match(migrationSql, /'needs_changes'/);
  assert.match(migrationSql, /'published'/);
  assert.match(migrationSql, /REFERENCES content\.media_blobs\(media_blob_id\)/);
  assert.doesNotMatch(mediaAssetTableSql, /\bstorage_key\b/);
  assert.doesNotMatch(mediaAssetTableSql, /\bsha256\b/);
  assert.match(migrationSql, /prevent_published_package_version_update/);
  assert.match(migrationSql, /package_cards_published_immutable/);
  assert.match(migrationSql, /package_media_assets_published_immutable/);
  assert.match(migrationSql, /IF TG_OP = 'INSERT' THEN/);
  assert.match(migrationSql, /IF TG_OP = 'UPDATE' THEN/);
  assert.match(migrationSql, /IF TG_OP = 'DELETE' THEN/);
  assert.doesNotMatch(migrationSql, /TG_OP IN \('UPDATE', 'DELETE'\) AND OLD/);
  assert.doesNotMatch(migrationSql, /TG_OP IN \('INSERT', 'UPDATE'\) AND NEW/);
  assert.match(
    migrationSql,
    /OLD\.status IN \('published', 'delisted'\)\s+OR NEW\.status IN \('published', 'delisted'\)/,
  );
  assert.match(
    migrationSql,
    /OLD\.status IN \('published', 'delisted'\)\s+AND NEW\.published_at IS DISTINCT FROM OLD\.published_at/,
  );
});

test("catalog package version status transitions are explicit", () => {
  assert.equal(isCatalogPackageVersionStatusTransitionAllowed("draft", "submitted"), true);
  assert.equal(isCatalogPackageVersionStatusTransitionAllowed("submitted", "approved"), true);
  assert.equal(isCatalogPackageVersionStatusTransitionAllowed("approved", "published"), true);
  assert.equal(isCatalogPackageVersionStatusTransitionAllowed("published", "delisted"), true);
  assert.equal(isCatalogPackageVersionStatusTransitionAllowed("draft", "published"), false);
  assert.equal(isCatalogPackageVersionStatusTransitionAllowed("delisted", "published"), false);
});

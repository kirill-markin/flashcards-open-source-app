import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { HttpError } from "../../shared/errors";
import { maximumPublicCatalogMediaDownloadBytes } from "../publicMediaDelivery";
import { createCatalogAuthorInExecutor, updateCatalogAuthorInExecutor } from "./authors";
import { attachCatalogPackageDraftMediaAssetInExecutor } from "./draftMedia";
import { createCatalogPackageDraftInExecutor, updateCatalogPackageDraftInExecutor } from "./drafts";
import {
  createCatalogPackageVersionFromCardsInExecutor,
  createCatalogPackageVersionFromWorkspaceSelectionInExecutor,
  publishCatalogPackageVersionInExecutor,
  updateCatalogPackageVersionReviewStatusInExecutor,
} from "./versions";
import {
  assertPublicPayloadDoesNotContainUnsafeMediaReferences,
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
} from "../testSupport";
import type {
  CatalogAuthorRow,
  CatalogPackageMediaAssetRow,
  CatalogPackageRow,
  CatalogPackageStatus,
  CatalogPackageVersionRow,
  CreateCatalogPackageDraftInput,
  UpdateCatalogPackageDraftInput,
} from "../types";

const testSecondWorkspaceMediaAssetId = "99999999-9999-4999-8999-999999999999";
const testSecondMediaBlobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const testCollisionSafePackageMediaKey = `${testPackageMediaKey}.1`;
const testSecondPackageMediaKey = "media-2";
const unsafePublicCatalogStorageReference = `media/blobs/sha256/${"a".repeat(64)}`;

function createPackageRow(): CatalogPackageRow {
  return {
    package_id: testPackageId,
    author_id: testAuthorId,
    slug: "spanish-basics",
    title: "Spanish Basics",
    summary: "Core Spanish prompts.",
    description: "Core Spanish flashcards for beginners.",
    language_tags: ["en", "es"],
    topic_tags: ["language"],
    license: "CC-BY-4.0",
    content_warning: null,
    cover_package_media_key: null,
    status: "draft",
    created_at: testTimestamp,
    updated_at: testTimestamp,
    published_at: null,
    delisted_at: null,
  };
}

function createPackageVersionRow(status: CatalogPackageStatus): CatalogPackageVersionRow {
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
    topic_tags: ["language"],
    license: "CC-BY-4.0",
    content_warning: null,
    cover_package_media_key: null,
    source_workspace_id: null,
    card_count: 1,
    created_by_admin_email: "admin@example.com",
    reviewed_by_admin_email: null,
    created_at: testTimestamp,
    updated_at: testTimestamp,
    submitted_at: null,
    reviewed_at: null,
    published_at: null,
    delisted_at: null,
  };
}

function createAuthorRow(websiteUrl: string | null): CatalogAuthorRow {
  return {
    author_id: testAuthorId,
    slug: "open-authors",
    display_name: "Open Authors",
    bio: "Community-maintained study material.",
    website_url: websiteUrl,
    created_at: testTimestamp,
    updated_at: testTimestamp,
  };
}

const ineligibleAuthorWriteFixtures: ReadonlyArray<Readonly<{
  label: string;
  operation: "create" | "update";
  patch: Readonly<Partial<{
    displayName: string;
    bio: string | null;
    websiteUrl: string | null;
  }>>;
}>> = [
  {
    label: "private display name content",
    operation: "create",
    patch: { displayName: unsafePublicCatalogStorageReference },
  },
  {
    label: "private bio content",
    operation: "update",
    patch: { bio: unsafePublicCatalogStorageReference },
  },
  {
    label: "private website content",
    operation: "create",
    patch: { websiteUrl: `https://example.test/${unsafePublicCatalogStorageReference}` },
  },
  {
    label: "relative website URL",
    operation: "update",
    patch: { websiteUrl: "example.test/authors" },
  },
  {
    label: "non-HTTP website URL",
    operation: "create",
    patch: { websiteUrl: "ftp://example.test/authors" },
  },
  {
    label: "website URL with invalid URI characters",
    operation: "create",
    patch: { websiteUrl: "https://example.test/author profile" },
  },
  {
    label: "website URL with a malformed percent escape",
    operation: "update",
    patch: { websiteUrl: "https://example.test/authors/%zz" },
  },
  {
    label: "website URL with raw path brackets",
    operation: "create",
    patch: { websiteUrl: "https://example.test/authors/[primary]" },
  },
  {
    label: "website URL with raw query brackets",
    operation: "update",
    patch: { websiteUrl: "https://example.test/authors?label=[primary]" },
  },
  {
    label: "website URL with empty username syntax",
    operation: "create",
    patch: { websiteUrl: "https://@example.test/authors" },
  },
  {
    label: "website URL with empty username and password syntax",
    operation: "update",
    patch: { websiteUrl: "https://:@example.test/authors" },
  },
  {
    label: "website URL with leading whitespace",
    operation: "create",
    patch: { websiteUrl: " https://example.test/authors" },
  },
  {
    label: "website URL with trailing whitespace",
    operation: "update",
    patch: { websiteUrl: "https://example.test/authors " },
  },
  {
    label: "website URL with an empty port",
    operation: "create",
    patch: { websiteUrl: "https://example.test:/authors" },
  },
  {
    label: "website URL without a raw authority",
    operation: "update",
    patch: { websiteUrl: "https:///example.test/authors" },
  },
];

for (const fixture of ineligibleAuthorWriteFixtures) {
  test(`catalog author ${fixture.operation} rejects ${fixture.label} before persistence`, async () => {
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(): Promise<pg.QueryResult<Row>> {
        throw new Error("Ineligible catalog author must be rejected before persistence");
      },
    };
    const input = {
      authorId: testAuthorId,
      slug: "open-authors",
      displayName: "Open Authors",
      bio: "Community-maintained study material.",
      websiteUrl: "https://authors.example.test/profile",
      ...fixture.patch,
    };
    const operation = fixture.operation === "create"
      ? createCatalogAuthorInExecutor
      : updateCatalogAuthorInExecutor;

    await assert.rejects(
      operation(executor, input),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 400);
        assert.equal((error as HttpError).code, "CATALOG_AUTHOR_NOT_PUBLICLY_ELIGIBLE");
        return true;
      },
    );
  });
}

test("catalog author create accepts an absolute website and update accepts null", async () => {
  const queries: Array<Readonly<{ text: string; params: ReadonlyArray<SqlValue> }>> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push({ text, params });
      const websiteUrl = params[4] as string | null;
      return createQueryResult([createAuthorRow(websiteUrl) as unknown as Row]);
    },
  };
  const baseInput = {
    authorId: testAuthorId,
    slug: "open-authors",
    displayName: "Open Authors",
    bio: "Community-maintained study material.",
  };

  const createdAuthor = await createCatalogAuthorInExecutor(executor, {
    ...baseInput,
    websiteUrl: "HtTpS://[2001:db8::1]/profile?source=catalog",
  });
  const updatedAuthor = await updateCatalogAuthorInExecutor(executor, {
    ...baseInput,
    websiteUrl: null,
  });

  assert.equal(createdAuthor.websiteUrl, "HtTpS://[2001:db8::1]/profile?source=catalog");
  assert.equal(updatedAuthor.websiteUrl, null);
  assert.match(queries[0]?.text ?? "", /INSERT INTO catalog\.authors/);
  assert.match(queries[1]?.text ?? "", /UPDATE catalog\.authors/);
});

type CatalogPublicationBoundaryHarness = Readonly<{
  executor: DatabaseExecutor;
  removeVersionMediaKey: (packageMediaKey: string) => void;
  getVersionStatus: () => CatalogPackageStatus | null;
}>;

type CatalogPublicationBoundaryHarnessInput = Readonly<{
  coverPackageMediaKey: string | null;
  draftMediaKeys: ReadonlyArray<string>;
  packageSlug: string;
  authorPatch: Readonly<Partial<{
    slug: string;
    display_name: string;
    bio: string | null;
    website_url: string | null;
  }>>;
  versionPatch: Readonly<Partial<Pick<
    CatalogPackageVersionRow,
    "slug" | "title" | "summary" | "description" | "language_tags" | "topic_tags" | "license"
      | "content_warning"
  >>>;
  mediaPatch: Readonly<Partial<{
    alt_text: string | null;
    credit: string | null;
    license: string | null;
    mime_type: string;
    size_bytes: number;
  }>>;
}>;

function createCatalogPublicationBoundaryHarness(
  input: CatalogPublicationBoundaryHarnessInput,
): CatalogPublicationBoundaryHarness {
  let versionRow: CatalogPackageVersionRow | null = null;
  let versionMediaKeys: Array<string> = [];
  const versionCards: Array<Readonly<{
    package_card_id: string;
    front_text: string;
    back_text: string;
    card_type: string;
    tags: ReadonlyArray<string>;
    media_asset_keys: ReadonlyArray<string>;
  }>> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("FROM catalog.authors") && text.includes("FOR UPDATE")) {
        return createQueryResult([{
          author_slug: "open-authors",
          display_name: "Open Authors",
          bio: "Community-maintained study material.",
          website_url: "https://authors.example.test/profile",
          ...input.authorPatch,
        } as unknown as Row]);
      }

      if (text.includes("FROM catalog.packages") && text.includes("FOR UPDATE")) {
        return createQueryResult([{
          ...createPackageRow(),
          slug: input.packageSlug,
          cover_package_media_key: input.coverPackageMediaKey,
        } as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_versions") && text.includes("status IN")) {
        return createQueryResult([]);
      }

      if (text.includes("SELECT package_media_key") && text.includes("package_version_id IS NULL")) {
        const requestedKeys = params[1] as ReadonlyArray<string> | undefined;
        const returnedKeys = requestedKeys === undefined
          ? input.draftMediaKeys
          : input.draftMediaKeys.filter((packageMediaKey) => requestedKeys.includes(packageMediaKey));
        return createQueryResult(returnedKeys.map((packageMediaKey) => ({
          package_media_key: packageMediaKey,
        } as unknown as Row)));
      }

      if (text.includes("FROM catalog.package_versions") && text.includes("ORDER BY version_number DESC")) {
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_versions")) {
        versionRow = {
          ...createPackageVersionRow("draft"),
          cover_package_media_key: input.coverPackageMediaKey,
          card_count: 1,
          ...input.versionPatch,
        };
        return createQueryResult([versionRow as unknown as Row]);
      }

      if (text.includes("INSERT INTO catalog.package_media_assets") && text.includes("SELECT gen_random_uuid()")) {
        versionMediaKeys = [...input.draftMediaKeys];
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_cards")) {
        versionCards.push({
          package_card_id: String(params[0]),
          front_text: String(params[4]),
          back_text: String(params[5]),
          card_type: String(params[6]),
          tags: params[8] as ReadonlyArray<string>,
          media_asset_keys: params[9] as ReadonlyArray<string>,
        });
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_review_events")) {
        return createQueryResult([]);
      }

      if (text.includes("FROM catalog.package_versions") && text.includes("FOR UPDATE")) {
        return createQueryResult(versionRow === null ? [] : [versionRow as unknown as Row]);
      }

      if (text.includes("UPDATE catalog.package_versions") && text.includes("SET status = $2")) {
        if (versionRow === null) {
          throw new Error("Expected a created catalog package version before review transition");
        }
        versionRow = {
          ...versionRow,
          status: String(params[1]) as CatalogPackageStatus,
        };
        return createQueryResult([versionRow as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_media_assets AS media_assets")) {
        return createQueryResult(versionMediaKeys.map((packageMediaKey) => ({
          package_media_key: packageMediaKey,
          alt_text: null,
          credit: null,
          license: null,
          mime_type: "image/jpeg",
          size_bytes: 1_234,
          ...input.mediaPatch,
        } as unknown as Row)));
      }

      if (text.includes("FROM catalog.package_cards")) {
        return createQueryResult(versionCards as unknown as ReadonlyArray<Row>);
      }

      if (text.includes("UPDATE catalog.package_versions") && text.includes("SET status = 'published'")) {
        if (versionRow === null) {
          throw new Error("Expected a created catalog package version before publication");
        }
        versionRow = {
          ...versionRow,
          status: "published",
          published_at: testTimestamp,
        };
        return createQueryResult([versionRow as unknown as Row]);
      }

      if (text.includes("UPDATE catalog.packages")) {
        return createQueryResult([]);
      }

      throw new Error(`Unexpected publication boundary query: ${text}`);
    },
  };

  return {
    executor,
    removeVersionMediaKey(packageMediaKey: string): void {
      versionMediaKeys = versionMediaKeys.filter((candidate) => candidate !== packageMediaKey);
    },
    getVersionStatus(): CatalogPackageStatus | null {
      return versionRow?.status ?? null;
    },
  };
}

type CatalogPublicationBoundaryCardInput = Readonly<{
  frontText: string;
  backText: string;
  cardType: string;
  tags: ReadonlyArray<string>;
  mediaAssetKeys: ReadonlyArray<string>;
}>;

async function createAndApproveCatalogPackageVersion(
  harness: CatalogPublicationBoundaryHarness,
  card: CatalogPublicationBoundaryCardInput,
): Promise<void> {
  await createCatalogPackageVersionFromCardsInExecutor(
    harness.executor,
    testPackageId,
    {
      packageVersionId: testPackageVersionId,
      cards: [{
        packageCardId: testWorkspaceCardId,
        stableCardKey: "card-1",
        ordinal: 1,
        frontText: card.frontText,
        backText: card.backText,
        cardType: card.cardType,
        metadata: { version: 1, source: null },
        tags: card.tags,
        mediaAssetKeys: card.mediaAssetKeys,
      }],
    },
    "admin@example.com",
  );
  await updateCatalogPackageVersionReviewStatusInExecutor(
    harness.executor,
    testPackageVersionId,
    { status: "submitted", note: null },
    "admin@example.com",
  );
  await updateCatalogPackageVersionReviewStatusInExecutor(
    harness.executor,
    testPackageVersionId,
    { status: "approved", note: null },
    "admin@example.com",
  );
}

function createPackageDraftInput(): CreateCatalogPackageDraftInput {
  return {
    packageId: testPackageId,
    authorId: testAuthorId,
    slug: "spanish-basics",
    title: "Spanish Basics",
    summary: "Core Spanish prompts.",
    description: "Core Spanish flashcards for beginners.",
    languageTags: ["en", "es"],
    topicTags: ["language"],
    license: "CC-BY-4.0",
    contentWarning: null,
  };
}

function createPackageDraftUpdateInput(coverPackageMediaKey: string | null): UpdateCatalogPackageDraftInput {
  return {
    ...createPackageDraftInput(),
    coverPackageMediaKey,
  };
}

for (const operation of ["create", "update"] as const) {
  test(`catalog package draft ${operation} rejects a publicly unsafe slug before persistence`, async () => {
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(): Promise<pg.QueryResult<Row>> {
        throw new Error("Ineligible catalog package must be rejected before persistence");
      },
    };
    const input = {
      ...createPackageDraftUpdateInput(null),
      slug: "a".repeat(64),
    };
    const write = operation === "create"
      ? createCatalogPackageDraftInExecutor
      : updateCatalogPackageDraftInExecutor;

    await assert.rejects(
      write(executor, input),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 400);
        assert.equal((error as HttpError).code, "CATALOG_PACKAGE_NOT_PUBLICLY_ELIGIBLE");
        return true;
      },
    );
  });
}

test("catalog package draft creation maps slug uniqueness to a conflict", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("FROM catalog.authors")) {
        assert.deepEqual(params, [testAuthorId]);
        return createQueryResult([createAuthorRow(null) as unknown as Row]);
      }

      assert.match(text, /INSERT INTO catalog\.packages/);
      const error = new Error("duplicate key value violates unique constraint") as Error & Readonly<{
        code: string;
        constraint: string;
      }>;
      Object.assign(error, {
        code: "23505",
        constraint: "packages_slug_unique",
      });
      throw error;
    },
  };

  await assert.rejects(
    createCatalogPackageDraftInExecutor(executor, createPackageDraftInput()),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 409);
      assert.equal((error as HttpError).code, "CATALOG_PACKAGE_SLUG_ALREADY_EXISTS");
      return true;
    },
  );
});

test("catalog package draft creation starts coverless", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("FROM catalog.authors")) {
        assert.deepEqual(params, [testAuthorId]);
        return createQueryResult([createAuthorRow(null) as unknown as Row]);
      }

      assert.match(text, /INSERT INTO catalog\.packages/);
      assert.doesNotMatch(text.slice(0, text.indexOf("RETURNING")), /cover_package_media_key/);
      assert.deepEqual(params, [
        testPackageId,
        testAuthorId,
        "spanish-basics",
        "Spanish Basics",
        "Core Spanish prompts.",
        "Core Spanish flashcards for beginners.",
        ["en", "es"],
        ["language"],
        "CC-BY-4.0",
        null,
      ]);
      return createQueryResult([createPackageRow() as unknown as Row]);
    },
  };

  const catalogPackage = await createCatalogPackageDraftInExecutor(executor, createPackageDraftInput());

  assert.equal(catalogPackage.coverPackageMediaKey, null);
});

test("catalog package draft update validates cover media after attach", async () => {
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);

      if (text.includes("FROM catalog.packages") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([createPackageRow() as unknown as Row]);
      }

      if (text.includes("FROM catalog.authors")) {
        assert.deepEqual(params, [testAuthorId]);
        return createQueryResult([createAuthorRow(null) as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_media_assets")) {
        assert.deepEqual(params, [testPackageId, ["cover"]]);
        return createQueryResult([{ package_media_key: "cover" } as unknown as Row]);
      }

      if (text.includes("UPDATE catalog.packages")) {
        assert.deepEqual(params, [
          testPackageId,
          testAuthorId,
          "spanish-basics",
          "Spanish Basics",
          "Core Spanish prompts.",
          "Core Spanish flashcards for beginners.",
          ["en", "es"],
          ["language"],
          "CC-BY-4.0",
          null,
          "cover",
        ]);
        return createQueryResult([{
          ...createPackageRow(),
          cover_package_media_key: "cover",
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const catalogPackage = await updateCatalogPackageDraftInExecutor(
    executor,
    createPackageDraftUpdateInput("cover"),
  );

  assert.equal(catalogPackage.coverPackageMediaKey, "cover");
  assert.equal(queries.length, 4);
});

test("published catalog package reassignment rejects an unsafe legacy author before mutation", async () => {
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);
      if (text.includes("FROM catalog.packages")) {
        assert.deepEqual(params, [testPackageId]);
        assert.match(text, /FOR UPDATE/);
        return createQueryResult([{
          ...createPackageRow(),
          status: "published",
          published_at: testTimestamp,
        } as unknown as Row]);
      }

      assert.deepEqual(params, [testAuthorId]);
      assert.match(text, /FROM catalog\.authors/);
      assert.match(text, /FOR UPDATE/);
      return createQueryResult([{
        ...createAuthorRow(null),
        bio: unsafePublicCatalogStorageReference,
      } as unknown as Row]);
    },
  };

  await assert.rejects(
    updateCatalogPackageDraftInExecutor(executor, createPackageDraftUpdateInput(null)),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 409);
      assert.equal((error as HttpError).code, "CATALOG_PACKAGE_AUTHOR_NOT_PUBLICLY_ELIGIBLE");
      return true;
    },
  );
  assert.equal(queries.length, 2);
});

test("catalog package media assets attach through content.media_blobs", async () => {
  const queries: Array<Readonly<{ text: string; params: ReadonlyArray<SqlValue> }>> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push({ text, params });

      if (text.includes("FROM catalog.packages") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([createPackageRow() as unknown as Row]);
      }

      if (text.includes("INSERT INTO catalog.package_media_assets")) {
        assert.match(text, /FROM content\.media_blobs AS media_blobs/);
        assert.doesNotMatch(text, /\bstorage_key\b/);
        assert.deepEqual(params, [
          testPackageMediaAssetId,
          testPackageId,
          "cover",
          testMediaBlobId,
          "Cover image",
          null,
          "CC-BY-4.0",
        ]);
        return createQueryResult([{
          package_media_asset_id: testPackageMediaAssetId,
          package_id: testPackageId,
          package_version_id: null,
          package_media_key: "cover",
          media_blob_id: testMediaBlobId,
          alt_text: "Cover image",
          credit: null,
          license: "CC-BY-4.0",
          created_at: testTimestamp,
          updated_at: testTimestamp,
        } as CatalogPackageMediaAssetRow as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const mediaAsset = await attachCatalogPackageDraftMediaAssetInExecutor(
    executor,
    testPackageId,
    {
      packageMediaAssetId: testPackageMediaAssetId,
      packageMediaKey: "cover",
      mediaBlobId: testMediaBlobId,
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
    },
  );

  assert.equal(mediaAsset.mediaBlobId, testMediaBlobId);
  assert.equal(mediaAsset.packageMediaKey, "cover");
  assert.equal(queries.length, 2);
});

test("publish helper rejects unapproved package versions before mutating", async () => {
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);
      assert.deepEqual(params, [testPackageVersionId]);
      if (text.includes("FROM catalog.package_versions") && text.includes("FOR UPDATE")) {
        return createQueryResult([createPackageVersionRow("draft") as unknown as Row]);
      }

      throw new Error(`Unexpected mutation query: ${text}`);
    },
  };

  await assert.rejects(
    publishCatalogPackageVersionInExecutor(
      executor,
      testPackageVersionId,
      "admin@example.com",
      null,
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 409);
      assert.equal((error as HttpError).code, "CATALOG_PACKAGE_VERSION_NOT_APPROVED");
      return true;
    },
  );
  assert.equal(queries.length, 1);
});

const ineligiblePublishMediaFixtures: ReadonlyArray<readonly [
  string,
  Readonly<{ mime_type: string; size_bytes: number }>,
]> = [
  ["unsupported MIME type", { mime_type: "text/plain", size_bytes: 1_234 }],
  [
    "oversized content",
    { mime_type: "image/jpeg", size_bytes: maximumPublicCatalogMediaDownloadBytes + 1 },
  ],
];

for (const [fixtureName, mediaPatch] of ineligiblePublishMediaFixtures) {
  test(`publish helper rejects package versions with ${fixtureName} before mutating`, async () => {
    const queries: Array<string> = [];
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        queries.push(text);
        if (text.includes("FROM catalog.authors") && text.includes("FOR UPDATE")) {
          assert.deepEqual(params, [testAuthorId]);
          return createQueryResult([{
            author_slug: "open-authors",
            display_name: "Open Authors",
            bio: null,
            website_url: null,
          } as unknown as Row]);
        }

        if (text.includes("FROM catalog.packages") && text.includes("FOR UPDATE")) {
          assert.deepEqual(params, [testPackageId]);
          return createQueryResult([createPackageRow() as unknown as Row]);
        }

        assert.deepEqual(params, [testPackageVersionId]);
        if (text.includes("FROM catalog.package_versions") && text.includes("FOR UPDATE")) {
          return createQueryResult([createPackageVersionRow("approved") as unknown as Row]);
        }

        if (text.includes("FROM catalog.package_media_assets AS media_assets")) {
          return createQueryResult([{
            package_media_key: "cover",
            alt_text: null,
            credit: null,
            license: null,
            ...mediaPatch,
          } as unknown as Row]);
        }

        if (text.includes("FROM catalog.package_cards")) {
          return createQueryResult([]);
        }

        throw new Error(`Unexpected mutation query: ${text}`);
      },
    };

    await assert.rejects(
      publishCatalogPackageVersionInExecutor(
        executor,
        testPackageVersionId,
        "admin@example.com",
        null,
      ),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal(
          (error as HttpError).code,
          "CATALOG_PACKAGE_VERSION_MEDIA_NOT_PUBLICLY_DELIVERABLE",
        );
        assert.match((error as HttpError).message, /packageMediaKey=cover/);
        assert.match((error as HttpError).message, /reason=/);
        return true;
      },
    );
    assert.equal(queries.length, 5);
  });
}

const unresolvedPublicationMediaFixtures: ReadonlyArray<Readonly<{
  label: string;
  coverPackageMediaKey: string | null;
  draftMediaKeys: ReadonlyArray<string>;
  frontText: string;
  mediaAssetKeys: ReadonlyArray<string>;
  removedVersionMediaKey: string | null;
  missingPackageMediaKey: string;
  referenceSource: string;
}>> = [
  {
    label: "Markdown-only media",
    coverPackageMediaKey: null,
    draftMediaKeys: [],
    frontText: "Prompt ![diagram](fcasset:missing-markdown)",
    mediaAssetKeys: [],
    removedVersionMediaKey: null,
    missingPackageMediaKey: "missing-markdown",
    referenceSource: `card:${testWorkspaceCardId}`,
  },
  {
    label: "explicit card media",
    coverPackageMediaKey: null,
    draftMediaKeys: ["explicit-media"],
    frontText: "Prompt",
    mediaAssetKeys: ["explicit-media"],
    removedVersionMediaKey: "explicit-media",
    missingPackageMediaKey: "explicit-media",
    referenceSource: `card:${testWorkspaceCardId}`,
  },
  {
    label: "cover media",
    coverPackageMediaKey: "cover",
    draftMediaKeys: ["cover"],
    frontText: "Prompt",
    mediaAssetKeys: [],
    removedVersionMediaKey: "cover",
    missingPackageMediaKey: "cover",
    referenceSource: "cover",
  },
];

for (const fixture of unresolvedPublicationMediaFixtures) {
  test(`create, approve, and publish rejects unresolved ${fixture.label}`, async () => {
    const harness = createCatalogPublicationBoundaryHarness({
      coverPackageMediaKey: fixture.coverPackageMediaKey,
      draftMediaKeys: fixture.draftMediaKeys,
      packageSlug: "spanish-basics",
      authorPatch: {},
      versionPatch: {},
      mediaPatch: {},
    });
    await createAndApproveCatalogPackageVersion(
      harness,
      {
        frontText: fixture.frontText,
        backText: "Answer",
        cardType: "basic",
        tags: [],
        mediaAssetKeys: fixture.mediaAssetKeys,
      },
    );
    if (fixture.removedVersionMediaKey !== null) {
      harness.removeVersionMediaKey(fixture.removedVersionMediaKey);
    }

    await assert.rejects(
      publishCatalogPackageVersionInExecutor(
        harness.executor,
        testPackageVersionId,
        "admin@example.com",
        null,
      ),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal(
          (error as HttpError).code,
          "CATALOG_PACKAGE_VERSION_MEDIA_REFERENCE_NOT_FOUND",
        );
        assert.match(
          (error as HttpError).message,
          new RegExp(`packageMediaKey=${fixture.missingPackageMediaKey}`),
        );
        assert.match(
          (error as HttpError).message,
          new RegExp(`referenceSource=${fixture.referenceSource}`),
        );
        return true;
      },
    );
    assert.equal(harness.getVersionStatus(), "approved");
  });
}

const unsafePublicationFixtures: ReadonlyArray<Readonly<{
  label: string;
  draftMediaKeys: ReadonlyArray<string>;
  versionPatch: CatalogPublicationBoundaryHarnessInput["versionPatch"];
  mediaPatch: CatalogPublicationBoundaryHarnessInput["mediaPatch"];
  card: CatalogPublicationBoundaryCardInput;
  expectedSource: RegExp;
}>> = [
  {
    label: "direct managed-storage Markdown",
    draftMediaKeys: [],
    versionPatch: {},
    mediaPatch: {},
    card: {
      frontText: `Prompt ![private](${unsafePublicCatalogStorageReference})`,
      backText: "Answer",
      cardType: "basic",
      tags: [],
      mediaAssetKeys: [],
    },
    expectedSource: /cardField=frontText/,
  },
  {
    label: "unsafe version metadata",
    draftMediaKeys: [],
    versionPatch: { title: unsafePublicCatalogStorageReference },
    mediaPatch: {},
    card: {
      frontText: "Prompt",
      backText: "Answer",
      cardType: "basic",
      tags: [],
      mediaAssetKeys: [],
    },
    expectedSource: /versionField=title/,
  },
  {
    label: "unsafe card metadata",
    draftMediaKeys: [],
    versionPatch: {},
    mediaPatch: {},
    card: {
      frontText: "Prompt",
      backText: "Answer",
      cardType: "basic",
      tags: [unsafePublicCatalogStorageReference],
      mediaAssetKeys: [],
    },
    expectedSource: /cardField=tags/,
  },
  {
    label: "unsafe media metadata",
    draftMediaKeys: ["illustration"],
    versionPatch: {},
    mediaPatch: { alt_text: unsafePublicCatalogStorageReference },
    card: {
      frontText: "Prompt",
      backText: "Answer",
      cardType: "basic",
      tags: [],
      mediaAssetKeys: ["illustration"],
    },
    expectedSource: /mediaField=altText packageMediaKey=illustration/,
  },
];

for (const fixture of unsafePublicationFixtures) {
  test(`create, approve, and publish rejects ${fixture.label} without mutating`, async () => {
    const harness = createCatalogPublicationBoundaryHarness({
      coverPackageMediaKey: null,
      draftMediaKeys: fixture.draftMediaKeys,
      packageSlug: "spanish-basics",
      authorPatch: {},
      versionPatch: fixture.versionPatch,
      mediaPatch: fixture.mediaPatch,
    });
    await createAndApproveCatalogPackageVersion(harness, fixture.card);

    await assert.rejects(
      publishCatalogPackageVersionInExecutor(
        harness.executor,
        testPackageVersionId,
        "admin@example.com",
        null,
      ),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal(
          (error as HttpError).code,
          "CATALOG_PACKAGE_VERSION_NOT_PUBLICLY_ELIGIBLE",
        );
        assert.match((error as HttpError).message, fixture.expectedSource);
        return true;
      },
    );
    assert.equal(harness.getVersionStatus(), "approved");
  });
}

const ineligiblePublicationAuthorFixtures: ReadonlyArray<Readonly<{
  label: string;
  authorPatch: CatalogPublicationBoundaryHarnessInput["authorPatch"];
  expectedSource: RegExp;
}>> = [
  {
    label: "private author display name",
    authorPatch: { display_name: unsafePublicCatalogStorageReference },
    expectedSource: /authorField=displayName/,
  },
  {
    label: "private author bio",
    authorPatch: { bio: unsafePublicCatalogStorageReference },
    expectedSource: /authorField=bio/,
  },
  {
    label: "private author website",
    authorPatch: {
      website_url: `https://authors.example.test/${unsafePublicCatalogStorageReference}`,
    },
    expectedSource: /authorField=websiteUrl/,
  },
  {
    label: "invalid author website URL",
    authorPatch: { website_url: "authors.example.test/profile" },
    expectedSource: /authorField=websiteUrl reason=website URL must be a valid absolute HTTP or HTTPS/,
  },
  {
    label: "author website with malformed URI escaping",
    authorPatch: { website_url: "https://authors.example.test/%zz" },
    expectedSource: /authorField=websiteUrl reason=website URL must be a valid absolute HTTP or HTTPS URI/,
  },
  {
    label: "author website with empty userinfo syntax",
    authorPatch: { website_url: "https://@authors.example.test/profile" },
    expectedSource: /authorField=websiteUrl reason=website URL must be a valid absolute HTTP or HTTPS/,
  },
  {
    label: "author website with an empty port",
    authorPatch: { website_url: "https://authors.example.test:/profile" },
    expectedSource: /authorField=websiteUrl reason=website URL must be a valid absolute HTTP or HTTPS/,
  },
  {
    label: "author website with surrounding whitespace",
    authorPatch: { website_url: " https://authors.example.test/profile" },
    expectedSource: /authorField=websiteUrl reason=website URL must be a valid absolute HTTP or HTTPS/,
  },
];

for (const fixture of ineligiblePublicationAuthorFixtures) {
  test(`create, approve, and publish rejects ${fixture.label} without mutating`, async () => {
    const harness = createCatalogPublicationBoundaryHarness({
      coverPackageMediaKey: null,
      draftMediaKeys: [],
      packageSlug: "spanish-basics",
      authorPatch: fixture.authorPatch,
      versionPatch: {},
      mediaPatch: {},
    });
    await createAndApproveCatalogPackageVersion(harness, {
      frontText: "Prompt",
      backText: "Answer",
      cardType: "basic",
      tags: [],
      mediaAssetKeys: [],
    });

    await assert.rejects(
      publishCatalogPackageVersionInExecutor(
        harness.executor,
        testPackageVersionId,
        "admin@example.com",
        null,
      ),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal(
          (error as HttpError).code,
          "CATALOG_PACKAGE_VERSION_NOT_PUBLICLY_ELIGIBLE",
        );
        assert.match((error as HttpError).message, fixture.expectedSource);
        return true;
      },
    );
    assert.equal(harness.getVersionStatus(), "approved");
  });
}

test("create, approve, and publish rejects an unsafe current package slug without mutating", async () => {
  const harness = createCatalogPublicationBoundaryHarness({
    coverPackageMediaKey: null,
    draftMediaKeys: [],
    packageSlug: "a".repeat(64),
    authorPatch: {},
    versionPatch: {},
    mediaPatch: {},
  });
  await createAndApproveCatalogPackageVersion(harness, {
    frontText: "Prompt",
    backText: "Answer",
    cardType: "basic",
    tags: [],
    mediaAssetKeys: [],
  });

  await assert.rejects(
    publishCatalogPackageVersionInExecutor(
      harness.executor,
      testPackageVersionId,
      "admin@example.com",
      null,
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 409);
      assert.equal((error as HttpError).code, "CATALOG_PACKAGE_VERSION_NOT_PUBLICLY_ELIGIBLE");
      assert.match((error as HttpError).message, /packageField=slug/);
      return true;
    },
  );
  assert.equal(harness.getVersionStatus(), "approved");
});

test("create, approve, and publish accepts fully resolved supported media", async () => {
  const harness = createCatalogPublicationBoundaryHarness({
    coverPackageMediaKey: "cover",
    draftMediaKeys: ["cover"],
    packageSlug: "spanish-basics",
    authorPatch: {},
    versionPatch: {},
    mediaPatch: {},
  });
  await createAndApproveCatalogPackageVersion(
    harness,
    {
      frontText: "Prompt ![cover](fcasset:cover)",
      backText: "Answer",
      cardType: "basic",
      tags: [],
      mediaAssetKeys: ["cover"],
    },
  );

  const publishedVersion = await publishCatalogPackageVersionInExecutor(
    harness.executor,
    testPackageVersionId,
    "admin@example.com",
    null,
  );

  assert.equal(publishedVersion.status, "published");
  assert.equal(harness.getVersionStatus(), "published");
});

test("workspace-selected catalog versions generate fresh package card ids", async () => {
  let insertedPackageCardId: string | null = null;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["admin-user-id", testWorkspaceId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM content.cards")) {
        assert.deepEqual(params, [testWorkspaceId, [testWorkspaceCardId]]);
        return createQueryResult([{
          card_id: testWorkspaceCardId,
          front_text: "Hola",
          back_text: "Hello",
          card_type: "basic",
          metadata: { version: 1, source: null },
          tags: ["language"],
        } as unknown as Row]);
      }

      if (text.includes("FROM catalog.packages") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([createPackageRow() as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_versions") && text.includes("status IN")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM catalog.package_versions") && text.includes("ORDER BY version_number DESC")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_versions")) {
        assert.equal(params[0], testPackageVersionId);
        assert.equal(params[12], testWorkspaceId);
        return createQueryResult([{
          ...createPackageVersionRow("draft"),
          source_workspace_id: testWorkspaceId,
        } as unknown as Row]);
      }

      if (text.includes("INSERT INTO catalog.package_media_assets")) {
        assert.deepEqual(params, [testPackageId, testPackageVersionId]);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_cards")) {
        insertedPackageCardId = String(params[0]);
        assert.notEqual(insertedPackageCardId, testWorkspaceCardId);
        assert.match(insertedPackageCardId, /^[0-9a-f-]{36}$/);
        assert.deepEqual(params.slice(1), [
          testPackageVersionId,
          testWorkspaceCardId,
          1,
          "Hola",
          "Hello",
          "basic",
          JSON.stringify({ version: 1, source: null }),
          ["language"],
          [],
        ]);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_review_events")) {
        assert.deepEqual(params, [
          testPackageId,
          testPackageVersionId,
          null,
          "draft",
          "admin@example.com",
          null,
        ]);
        return createQueryResult([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const packageVersion = await createCatalogPackageVersionFromWorkspaceSelectionInExecutor(
    executor,
    testPackageId,
    {
      packageVersionId: testPackageVersionId,
      workspaceId: testWorkspaceId,
      cardIds: [testWorkspaceCardId],
    },
    "admin-user-id",
    "admin@example.com",
  );

  assert.equal(packageVersion.packageVersionId, testPackageVersionId);
  assert.equal(packageVersion.sourceWorkspaceId, testWorkspaceId);
  assert.notEqual(insertedPackageCardId, null);
});

test("workspace-selected catalog versions preserve managed media as package media", async () => {
  const versionMediaInsertParams: Array<ReadonlyArray<SqlValue>> = [];
  let insertedPackageCardId: string | null = null;
  let insertedPackageCardParams: ReadonlyArray<SqlValue> | null = null;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["admin-user-id", testWorkspaceId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM content.cards")) {
        assert.deepEqual(params, [testWorkspaceId, [testWorkspaceCardId]]);
        return createQueryResult([{
          card_id: testWorkspaceCardId,
          front_text: `Prompt ![diagram](fcasset:${testWorkspaceMediaAssetId})`,
          back_text: `Answer [audio](fcasset:${testSecondWorkspaceMediaAssetId}) and again ![same](fcasset:${testWorkspaceMediaAssetId})`,
          card_type: "basic",
          metadata: { version: 1, source: null },
          tags: ["media"],
        } as unknown as Row]);
      }

      if (text.includes("FROM content.media_assets AS media_assets")) {
        assert.match(text, /INNER JOIN content\.media_blobs AS media_blobs/);
        assert.doesNotMatch(text, /\bstorage_key\b/);
        assert.doesNotMatch(text, /\bsha256\b/);
        assert.doesNotMatch(text, /\bsource_url\b/);
        assert.deepEqual(params, [testWorkspaceId, [
          testWorkspaceMediaAssetId,
          testSecondWorkspaceMediaAssetId,
        ]]);
        return createQueryResult([
          {
            media_asset_id: testWorkspaceMediaAssetId,
            media_blob_id: testMediaBlobId,
          } as unknown as Row,
          {
            media_asset_id: testSecondWorkspaceMediaAssetId,
            media_blob_id: testSecondMediaBlobId,
          } as unknown as Row,
        ]);
      }

      if (text.includes("FROM catalog.packages") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([createPackageRow() as unknown as Row]);
      }

      if (text.includes("SELECT package_media_key")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([{
          package_media_key: testPackageMediaKey,
        } as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_versions") && text.includes("status IN")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM catalog.package_versions") && text.includes("ORDER BY version_number DESC")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_versions")) {
        assert.equal(params[0], testPackageVersionId);
        assert.equal(params[12], testWorkspaceId);
        return createQueryResult([{
          ...createPackageVersionRow("draft"),
          source_workspace_id: testWorkspaceId,
        } as unknown as Row]);
      }

      if (text.includes("INSERT INTO catalog.package_media_assets")) {
        assert.doesNotMatch(text, /\bstorage_key\b/);
        assert.doesNotMatch(text, /\bsha256\b/);
        assert.doesNotMatch(text, /\bsource_url\b/);

        if (text.includes("SELECT gen_random_uuid(), package_id")) {
          assert.deepEqual(params, [testPackageId, testPackageVersionId]);
          return createQueryResult([]);
        }

        versionMediaInsertParams.push(params);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_cards")) {
        insertedPackageCardId = String(params[0]);
        insertedPackageCardParams = params;
        assert.notEqual(insertedPackageCardId, testWorkspaceCardId);
        assert.match(insertedPackageCardId, /^[0-9a-f-]{36}$/);
        assert.deepEqual(params.slice(1), [
          testPackageVersionId,
          testWorkspaceCardId,
          1,
          `Prompt ![diagram](fcasset:${testCollisionSafePackageMediaKey})`,
          `Answer [audio](fcasset:${testSecondPackageMediaKey}) and again ![same](fcasset:${testCollisionSafePackageMediaKey})`,
          "basic",
          JSON.stringify({ version: 1, source: null }),
          ["media"],
          [testCollisionSafePackageMediaKey, testSecondPackageMediaKey],
        ]);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_review_events")) {
        assert.deepEqual(params, [
          testPackageId,
          testPackageVersionId,
          null,
          "draft",
          "admin@example.com",
          null,
        ]);
        return createQueryResult([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const packageVersion = await createCatalogPackageVersionFromWorkspaceSelectionInExecutor(
    executor,
    testPackageId,
    {
      packageVersionId: testPackageVersionId,
      workspaceId: testWorkspaceId,
      cardIds: [testWorkspaceCardId],
    },
    "admin-user-id",
    "admin@example.com",
  );

  assert.equal(packageVersion.packageVersionId, testPackageVersionId);
  assert.equal(packageVersion.sourceWorkspaceId, testWorkspaceId);
  assert.notEqual(insertedPackageCardId, null);
  assert.notEqual(insertedPackageCardParams, null);
  assert.deepEqual(versionMediaInsertParams, [
    [testPackageId, testPackageVersionId, testCollisionSafePackageMediaKey, testMediaBlobId],
    [testPackageId, testPackageVersionId, testSecondPackageMediaKey, testSecondMediaBlobId],
  ]);
  assertPublicPayloadDoesNotContainUnsafeMediaReferences({
    insertedPackageCardParams,
    versionMediaInsertParams,
  });
});

test("workspace-selected catalog versions fail when referenced media is missing", async () => {
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);
      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["admin-user-id", testWorkspaceId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM content.cards")) {
        assert.deepEqual(params, [testWorkspaceId, [testWorkspaceCardId]]);
        return createQueryResult([{
          card_id: testWorkspaceCardId,
          front_text: `Prompt ![diagram](fcasset:${testWorkspaceMediaAssetId})`,
          back_text: "Answer",
          card_type: "basic",
          metadata: { version: 1, source: null },
          tags: [],
        } as unknown as Row]);
      }

      if (text.includes("FROM content.media_assets AS media_assets")) {
        assert.deepEqual(params, [testWorkspaceId, [testWorkspaceMediaAssetId]]);
        return createQueryResult([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await assert.rejects(
    createCatalogPackageVersionFromWorkspaceSelectionInExecutor(
      executor,
      testPackageId,
      {
        packageVersionId: testPackageVersionId,
        workspaceId: testWorkspaceId,
        cardIds: [testWorkspaceCardId],
      },
      "admin-user-id",
      "admin@example.com",
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 400);
      assert.equal((error as HttpError).code, "CATALOG_WORKSPACE_MEDIA_ASSET_NOT_FOUND");
      assert.match((error as HttpError).message, new RegExp(`workspaceId=${testWorkspaceId}`));
      assert.match((error as HttpError).message, new RegExp(`missingMediaAssetIds=${testWorkspaceMediaAssetId}`));
      return true;
    },
  );
  assert.equal(queries.length, 3);
});

test("workspace-selected catalog versions reject invalid managed media references", async () => {
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);
      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["admin-user-id", testWorkspaceId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM content.cards")) {
        assert.deepEqual(params, [testWorkspaceId, [testWorkspaceCardId]]);
        return createQueryResult([{
          card_id: testWorkspaceCardId,
          front_text: "Prompt ![diagram](fcasset:not-a-uuid)",
          back_text: "Answer",
          card_type: "basic",
          metadata: { version: 1, source: null },
          tags: [],
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await assert.rejects(
    createCatalogPackageVersionFromWorkspaceSelectionInExecutor(
      executor,
      testPackageId,
      {
        packageVersionId: testPackageVersionId,
        workspaceId: testWorkspaceId,
        cardIds: [testWorkspaceCardId],
      },
      "admin-user-id",
      "admin@example.com",
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 400);
      assert.equal((error as HttpError).code, "CATALOG_WORKSPACE_MEDIA_ASSET_ID_INVALID");
      assert.match((error as HttpError).message, /mediaAssetIds=not-a-uuid/);
      return true;
    },
  );
  assert.equal(queries.length, 2);
});

test("workspace-selected catalog versions reject non-ready managed media references", async () => {
  const pendingUrl = `fcasset:${testWorkspaceMediaAssetId}?state=pending`;
  const unsupportedUrl = `FcAsSeT:${testWorkspaceMediaAssetId}?state=pending`;
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);
      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["admin-user-id", testWorkspaceId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM content.cards")) {
        assert.deepEqual(params, [testWorkspaceId, [testWorkspaceCardId]]);
        return createQueryResult([{
          card_id: testWorkspaceCardId,
          front_text: `Prompt ![diagram](${pendingUrl}) ![unsupported](${unsupportedUrl})`,
          back_text: "Answer",
          card_type: "basic",
          metadata: { version: 1, source: null },
          tags: [],
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await assert.rejects(
    createCatalogPackageVersionFromWorkspaceSelectionInExecutor(
      executor,
      testPackageId,
      {
        packageVersionId: testPackageVersionId,
        workspaceId: testWorkspaceId,
        cardIds: [testWorkspaceCardId],
      },
      "admin-user-id",
      "admin@example.com",
    ),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 409
      && error.code === "CATALOG_WORKSPACE_MANAGED_MEDIA_NOT_READY"
      && error.message.includes(pendingUrl)
      && error.message.includes(unsupportedUrl)
      && error.message.includes("retry after promotion and attachment settle")
      && error.message.includes("Unsupported managed media lifecycle URLs"),
  );
  assert.equal(queries.length, 2);
});

test("direct catalog card snapshots reject non-ready managed media references", async () => {
  const failedUrl = `fcasset:${testPackageMediaKey}?state=failed`;
  const unsupportedUrl = `fcasset:${testPackageMediaKey}?state=ready`;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      _params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      throw new Error(`Catalog normalization unexpectedly queried PostgreSQL: ${text}`);
    },
  };

  await assert.rejects(
    createCatalogPackageVersionFromCardsInExecutor(
      executor,
      testPackageId,
      {
        packageVersionId: testPackageVersionId,
        cards: [{
          packageCardId: testWorkspaceCardId,
          stableCardKey: "card-1",
          ordinal: 1,
          frontText: `Prompt ![failed](${failedUrl}) ![unsupported](${unsupportedUrl})`,
          backText: "Answer",
          cardType: "basic",
          metadata: { version: 1, source: null },
          tags: [],
          mediaAssetKeys: [],
        }],
      },
      "admin@example.com",
    ),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 409
      && error.code === "CATALOG_MANAGED_MEDIA_NOT_READY"
      && error.message.includes(failedUrl)
      && error.message.includes(unsupportedUrl)
      && error.message.includes("Failed managed media is terminal")
      && error.message.includes("remove the reference or regenerate and reattach the image")
      && error.message.includes("Unsupported managed media lifecycle URLs"),
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { HttpError } from "../../shared/errors";
import { maximumPublicCatalogMediaDownloadBytes } from "../publicMediaDelivery";
import {
  createQueryResult,
  testAuthorId,
  testPackageId,
  testPackageVersionId,
  testTimestamp,
  testWorkspaceCardId,
} from "../testSupport";
import type { CatalogPackageStatus, CatalogPackageVersionRow } from "../types";
import {
  createPackageRow,
  createPackageVersionRow,
  unsafePublicCatalogStorageReference,
} from "./authoringTestSupport";
import {
  createCatalogPackageVersionFromCardsInExecutor,
  publishCatalogPackageVersionInExecutor,
  updateCatalogPackageVersionReviewStatusInExecutor,
} from "./versions";

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

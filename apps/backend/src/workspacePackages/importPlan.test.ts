import assert from "node:assert/strict";
import test from "node:test";
import {
  planWorkspacePackageImport,
  type PortableWorkspacePackageCardV1,
  type WorkspacePackageCardSourceMetadataV1,
  type WorkspacePackageCardsJsonV1,
  type WorkspacePackageImportPlanOptions,
} from "./index";

const importedAt = "2026-06-30T12:00:00.000Z";
const importId = "import-session-1";

function createImportOptions(
  addImportTag: boolean,
  importTag: string,
  removeTags: ReadonlyArray<string>,
): WorkspacePackageImportPlanOptions {
  return {
    addImportTag,
    importTag,
    removeTags,
    importedAt,
    importId,
  };
}

function createTestCard(
  frontText: string,
  backText: string,
  tags: ReadonlyArray<string>,
  cardType: string,
  source: WorkspacePackageCardSourceMetadataV1 | null,
): PortableWorkspacePackageCardV1 {
  return {
    frontText,
    backText,
    tags,
    cardType,
    metadata: {
      version: 1,
      source,
    },
  };
}

function createCardsJson(
  cards: ReadonlyArray<PortableWorkspacePackageCardV1>,
): WorkspacePackageCardsJsonV1 {
  return {
    formatVersion: 1,
    cards,
  };
}

test("workspace package import plan applies the import tag when enabled", () => {
  const plan = planWorkspacePackageImport({
    cardsJson: createCardsJson([
      createTestCard("Prompt", "Answer", ["biology"], "basic", null),
    ]),
    options: createImportOptions(true, "import:2026-06-30-0", []),
    mediaAssetIdsByPortablePath: new Map(),
  });

  assert.deepEqual(plan.cards[0]?.tags, ["biology", "import:2026-06-30-0"]);
  assert.deepEqual(plan.summary, {
    cardCount: 1,
    keptTagCount: 1,
    removedTagCount: 0,
    importTag: "import:2026-06-30-0",
    referencedMediaCount: 0,
  });
});

test("workspace package import plan removes exact tags without partial matches", () => {
  const plan = planWorkspacePackageImport({
    cardsJson: createCardsJson([
      createTestCard("Prompt", "Answer", ["math", "mathematics", "history"], "basic", null),
    ]),
    options: createImportOptions(false, "import:unused", ["math"]),
    mediaAssetIdsByPortablePath: new Map(),
  });

  assert.deepEqual(plan.cards[0]?.tags, ["mathematics", "history"]);
  assert.deepEqual(plan.summary, {
    cardCount: 1,
    keptTagCount: 2,
    removedTagCount: 1,
    importTag: null,
    referencedMediaCount: 0,
  });
});

test("workspace package import plan uses package source when card source is null", () => {
  const plan = planWorkspacePackageImport({
    cardsJson: {
      formatVersion: 1,
      label: "Package label",
      author: "Package author",
      comment: "Package comment",
      createdAt: "2026-06-01T00:00:00.000Z",
      sourceUrl: "https://example.com/package",
      cards: [
        createTestCard("Prompt", "Answer", ["tag"], "basic", null),
      ],
    },
    options: createImportOptions(false, "import:unused", []),
    mediaAssetIdsByPortablePath: new Map(),
  });

  assert.deepEqual(plan.cards[0]?.metadata, {
    version: 1,
    source: {
      label: "Package label",
      author: "Package author",
      comment: "Package comment",
      createdAt: "2026-06-01T00:00:00.000Z",
      importedAt,
      importId,
    },
  });
});

test("workspace package import plan lets card source override package source", () => {
  const cardSource: WorkspacePackageCardSourceMetadataV1 = {
    label: "Card label",
    author: "Card author",
    comment: null,
    createdAt: "2026-06-15T00:00:00.000Z",
    importedAt: "2026-01-01T00:00:00.000Z",
    importId: "old-import",
  };

  const plan = planWorkspacePackageImport({
    cardsJson: {
      formatVersion: 1,
      label: "Package label",
      author: "Package author",
      comment: "Package comment",
      createdAt: "2026-06-01T00:00:00.000Z",
      cards: [
        createTestCard("Prompt", "Answer", ["tag"], "custom", cardSource),
      ],
    },
    options: createImportOptions(false, "import:unused", []),
    mediaAssetIdsByPortablePath: new Map(),
  });

  assert.deepEqual(plan.cards[0]?.metadata.source, {
    label: "Card label",
    author: "Card author",
    comment: "Package comment",
    createdAt: "2026-06-15T00:00:00.000Z",
    importedAt,
    importId,
  });
});

test("workspace package import plan rewrites portable Markdown media links", () => {
  const plan = planWorkspacePackageImport({
    cardsJson: createCardsJson([
      createTestCard(
        "Diagram: ![cell](media/images/cell.png)",
        "Notes: [pdf](media/docs/notes.pdf) [remote](https://example.com/media/remote.png)",
        ["biology"],
        "basic",
        null,
      ),
    ]),
    options: createImportOptions(false, "import:unused", []),
    mediaAssetIdsByPortablePath: new Map([
      ["media/images/cell.png", "image-asset"],
      ["media/docs/notes.pdf", "notes-asset"],
    ]),
  });

  assert.equal(plan.cards[0]?.frontText, "Diagram: ![cell](fcasset:image-asset)");
  assert.equal(
    plan.cards[0]?.backText,
    "Notes: [pdf](fcasset:notes-asset) [remote](https://example.com/media/remote.png)",
  );
  assert.equal(plan.summary.referencedMediaCount, 2);
});

test("workspace package import plan rejects missing media asset mappings", () => {
  assert.throws(
    () => planWorkspacePackageImport({
      cardsJson: createCardsJson([
        createTestCard("Image: ![cell](media/images/cell.png)", "Answer", ["biology"], "basic", null),
      ]),
      options: createImportOptions(false, "import:unused", []),
      mediaAssetIdsByPortablePath: new Map(),
    }),
    /cards\[0\]\.frontText.*Missing mediaAssetId mapping.*media\/images\/cell\.png/,
  );
});

test("workspace package import plan preserves unknown cardType values", () => {
  const plan = planWorkspacePackageImport({
    cardsJson: createCardsJson([
      createTestCard("Prompt", "Answer", ["tag"], "custom-cloze", null),
    ]),
    options: createImportOptions(false, "import:unused", []),
    mediaAssetIdsByPortablePath: new Map(),
  });

  assert.equal(plan.cards[0]?.cardType, "custom-cloze");
});

test("workspace package import plan normalizes duplicate final tags", () => {
  const plan = planWorkspacePackageImport({
    cardsJson: createCardsJson([
      createTestCard("Prompt", "Answer", ["shared", "shared", "science"], "basic", null),
    ]),
    options: createImportOptions(true, "shared", []),
    mediaAssetIdsByPortablePath: new Map(),
  });

  assert.deepEqual(plan.cards[0]?.tags, ["shared", "science"]);
  assert.deepEqual(plan.summary, {
    cardCount: 1,
    keptTagCount: 2,
    removedTagCount: 0,
    importTag: "shared",
    referencedMediaCount: 0,
  });
});

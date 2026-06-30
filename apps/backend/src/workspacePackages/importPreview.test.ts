import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { HttpError } from "../shared/errors";
import {
  buildSuggestedWorkspacePackageImportTag,
  createDefaultWorkspacePackageImportTagPolicy,
  normalizeWorkspacePackageImportTagPolicy,
  parseWorkspacePackageCardsJsonV1,
  previewWorkspacePackageZipImport,
  type PortableWorkspacePackageCardV1,
  type WorkspacePackageCardMetadataV1,
  type WorkspacePackageCardsJsonV1,
  type WorkspacePackageImportPreviewInput,
} from "./index";
import {
  createCardsJsonBuffer,
  createDeflatedZipEntry,
  createPackageZip,
  createStoredZip,
} from "./testZipHelpers";

const generatedAt = "2026-06-30T12:00:00.000Z";

const testMetadata: WorkspacePackageCardMetadataV1 = {
  version: 1,
  source: null,
};

function createTestCard(
  frontText: string,
  backText: string,
  tags: ReadonlyArray<string>,
  cardType: string,
): PortableWorkspacePackageCardV1 {
  return {
    frontText,
    backText,
    tags,
    cardType,
    metadata: testMetadata,
  };
}

function createPreviewInput(
  packageBytes: Buffer,
  existingWorkspaceTags: ReadonlyArray<string>,
): WorkspacePackageImportPreviewInput {
  return {
    packageBytes,
    generatedAt,
    existingWorkspaceTags,
  };
}

async function assertImportPreviewRejects(
  packageBytes: Buffer,
  messagePattern: RegExp,
): Promise<void> {
  await assert.rejects(
    () => previewWorkspacePackageZipImport(createPreviewInput(packageBytes, [])),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.match(error.message, messagePattern);
      return true;
    },
  );
}

test("ZIP import preview accepts a valid cards.json-only package", async () => {
  const packageBytes = createPackageZip({
    formatVersion: 1,
    label: "Starter deck",
    author: "Kirill",
    comment: "Intro cards",
    createdAt: "2026-06-01T00:00:00.000Z",
    sourceUrl: "https://example.com/deck",
    cards: [
      createTestCard("Capital of France?", "Paris", ["geography"], "basic"),
    ],
  }, []);

  const preview = await previewWorkspacePackageZipImport(createPreviewInput(packageBytes, [
    "import:2026-06-30-0",
  ]));

  assert.deepEqual(preview, {
    sourceKind: "zip",
    packageMetadata: {
      label: "Starter deck",
      author: "Kirill",
      comment: "Intro cards",
      createdAt: "2026-06-01T00:00:00.000Z",
      sourceUrl: "https://example.com/deck",
    },
    cardCount: 1,
    tagCounts: [
      { tag: "geography", cardsCount: 1 },
    ],
    referencedMediaCount: 0,
    packageMediaFileCount: 0,
    warnings: [],
    defaultOptions: {
      addImportTag: true,
      suggestedImportTag: "import:2026-06-30-1",
      keptTags: ["geography"],
      removedTags: [],
    },
  });
});

test("ZIP import preview validates package media references and media entries", async () => {
  const compressedImageBytes = Buffer.from("png bytes", "utf8");
  const packageBytes = createPackageZip({
    formatVersion: 1,
    cards: [
      createTestCard(
        "Diagram: ![cell](media/images/cell.png)",
        "Reference: [notes](media/docs/notes.pdf)",
        ["biology"],
        "basic",
      ),
    ],
  }, [
    createDeflatedZipEntry("media/images/cell.png", compressedImageBytes, compressedImageBytes.byteLength),
    { path: "media/docs/notes.pdf", bytes: Buffer.from("pdf bytes", "utf8") },
    { path: "media/unused/extra.png", bytes: Buffer.from("unused bytes", "utf8") },
  ]);

  const preview = await previewWorkspacePackageZipImport(createPreviewInput(packageBytes, []));

  assert.equal(preview.referencedMediaCount, 2);
  assert.equal(preview.packageMediaFileCount, 3);
  assert.deepEqual(preview.warnings, [
    {
      code: "WORKSPACE_PACKAGE_IMPORT_MEDIA_TYPE_UNSUPPORTED",
      message: "Referenced package media may not be supported by the import confirmation flow.",
      mediaPath: "media/docs/notes.pdf",
    },
  ]);
});

test("ZIP import preview drains compressed media entries before accepting size metadata", async () => {
  await assertImportPreviewRejects(
    createPackageZip({
      formatVersion: 1,
      cards: [
        createTestCard("Prompt", "![media](media/bomb.bin)", ["tag"], "basic"),
      ],
    }, [
      createDeflatedZipEntry("media/bomb.bin", Buffer.alloc(128, 1), 1),
    ]),
    /media entry cannot be read/,
  );
});

test("ZIP import preview keeps external media URLs external", async () => {
  const packageBytes = createPackageZip({
    formatVersion: 1,
    cards: [
      createTestCard(
        "Remote image: ![remote](https://example.com/image.png)",
        "Remote link: [file](https://example.com/media/file.png)",
        ["external"],
        "basic",
      ),
    ],
  }, []);

  const preview = await previewWorkspacePackageZipImport(createPreviewInput(packageBytes, []));

  assert.equal(preview.referencedMediaCount, 0);
  assert.equal(preview.packageMediaFileCount, 0);
  assert.deepEqual(preview.warnings, []);
});

test("ZIP import preview rejects missing cards.json", async () => {
  await assertImportPreviewRejects(
    createStoredZip([
      { path: "media/image.png", bytes: Buffer.from("image", "utf8") },
    ]),
    /exactly one cards\.json/,
  );
});

test("ZIP import preview rejects malformed cards.json", async () => {
  await assertImportPreviewRejects(
    createStoredZip([
      { path: "cards.json", bytes: Buffer.from("{", "utf8") },
    ]),
    /malformed JSON/,
  );
});

test("ZIP import preview rejects unsafe media paths", async () => {
  for (const unsafeMediaPath of [
    "media/../image.png",
    "/media/image.png",
    "media\\image.png",
    "media//image.png",
  ]) {
    await assertImportPreviewRejects(
      createPackageZip({
        formatVersion: 1,
        cards: [
          createTestCard("Prompt", "Answer", ["tag"], "basic"),
        ],
      }, [
        { path: unsafeMediaPath, bytes: Buffer.from("image", "utf8") },
      ]),
      /unsafe|invalid|absolute|unsupported/,
    );
  }
});

test("ZIP import preview rejects unsafe markdown media references as package input errors", async () => {
  for (const unsafeMarkdownMediaReference of [
    "media/../image.png",
    "/media/image.png",
    "media\\image.png",
    "./media/image.png",
    "../media/image.png",
    "../../media/image.png",
  ]) {
    await assertImportPreviewRejects(
      createPackageZip({
        formatVersion: 1,
        cards: [
          createTestCard("Prompt", `![image](${unsafeMarkdownMediaReference})`, ["tag"], "basic"),
        ],
      }, [
        { path: "media/image.png", bytes: Buffer.from("image", "utf8") },
      ]),
      /unsafe media references/,
    );
  }
});

test("ZIP import preview rejects duplicate media paths case-insensitively", async () => {
  await assertImportPreviewRejects(
    createPackageZip({
      formatVersion: 1,
      cards: [
        createTestCard("Prompt", "![image](media/Image.png)", ["tag"], "basic"),
      ],
    }, [
      { path: "media/Image.png", bytes: Buffer.from("image a", "utf8") },
      { path: "media/image.png", bytes: Buffer.from("image b", "utf8") },
    ]),
    /duplicated/,
  );
});

test("ZIP import preview rejects missing referenced media files", async () => {
  await assertImportPreviewRejects(
    createPackageZip({
      formatVersion: 1,
      cards: [
        createTestCard("Prompt", "![image](media/image.png)", ["tag"], "basic"),
      ],
    }, []),
    /missing from ZIP/,
  );
});

test("ZIP import preview suggests the first available import tag suffix", () => {
  assert.equal(
    buildSuggestedWorkspacePackageImportTag(generatedAt, [
      "import:2026-06-30-0",
      "import:2026-06-30-1",
      "import:2026-06-30-3",
    ]),
    "import:2026-06-30-2",
  );
});

test("ZIP import preview returns tag counts and default keep-all options", async () => {
  const packageBytes = createPackageZip({
    formatVersion: 1,
    cards: [
      createTestCard("A", "A answer", ["shared", "science"], "basic"),
      createTestCard("B", "B answer", ["shared", "draft"], "basic"),
    ],
  }, []);

  const preview = await previewWorkspacePackageZipImport(createPreviewInput(packageBytes, []));

  assert.deepEqual(preview.tagCounts, [
    { tag: "shared", cardsCount: 2 },
    { tag: "draft", cardsCount: 1 },
    { tag: "science", cardsCount: 1 },
  ]);
  assert.deepEqual(preview.defaultOptions, {
    addImportTag: true,
    suggestedImportTag: "import:2026-06-30-0",
    keptTags: ["shared", "draft", "science"],
    removedTags: [],
  });
  assert.deepEqual(createDefaultWorkspacePackageImportTagPolicy(["shared", "draft"]), {
    keptTags: ["shared", "draft"],
    removedTags: [],
  });
  assert.deepEqual(
    normalizeWorkspacePackageImportTagPolicy({ removedTags: ["draft"] }, ["shared", "draft"]),
    {
      keptTags: ["shared"],
      removedTags: ["draft"],
    },
  );
  assert.throws(
    () => normalizeWorkspacePackageImportTagPolicy({ removedTags: ["missing"] }, ["shared"]),
    /exact package tag values/,
  );
});

test("ZIP import preview accepts unknown cardType through the existing parser", async () => {
  const cardsJson: WorkspacePackageCardsJsonV1 = {
    formatVersion: 1,
    cards: [
      createTestCard("Prompt", "Answer", ["tag"], "custom-cloze"),
    ],
  };
  const parsedCardsJson = parseWorkspacePackageCardsJsonV1(JSON.parse(createCardsJsonBuffer(cardsJson).toString("utf8")));
  assert.equal(parsedCardsJson.cards[0]?.cardType, "custom-cloze");

  const preview = await previewWorkspacePackageZipImport(createPreviewInput(
    createPackageZip(cardsJson, []),
    [],
  ));

  assert.equal(preview.cardCount, 1);
});

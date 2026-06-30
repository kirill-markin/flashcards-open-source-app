import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
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

type TestZipEntry = Readonly<{
  path: string;
  bytes: Buffer;
  compressionMethod?: number;
  uncompressedSize?: number;
}>;

type TestCentralDirectoryEntry = Readonly<{
  pathBytes: Buffer;
  entry: TestZipEntry;
  localHeaderOffset: number;
}>;

const generatedAt = "2026-06-30T12:00:00.000Z";
const zipLocalFileHeaderSignature = 0x04034b50;
const zipCentralDirectoryHeaderSignature = 0x02014b50;
const zipEndOfCentralDirectorySignature = 0x06054b50;
const zipVersionNeededToExtract = 20;
const zipStoredCompressionMethod = 0;
const zipDeflatedCompressionMethod = 8;
const zipDosTimeMidnight = 0;
const zipDosDateJanuaryFirst1980 = 33;

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

function createCardsJsonBuffer(cardsJson: WorkspacePackageCardsJsonV1): Buffer {
  return Buffer.from(JSON.stringify(cardsJson), "utf8");
}

function getTestZipEntryCompressionMethod(entry: TestZipEntry): number {
  return entry.compressionMethod ?? zipStoredCompressionMethod;
}

function getTestZipEntryUncompressedSize(entry: TestZipEntry): number {
  return entry.uncompressedSize ?? entry.bytes.byteLength;
}

function createDeflatedZipEntry(
  path: string,
  uncompressedBytes: Buffer,
  declaredUncompressedSize: number,
): TestZipEntry {
  return {
    path,
    bytes: deflateRawSync(uncompressedBytes),
    compressionMethod: zipDeflatedCompressionMethod,
    uncompressedSize: declaredUncompressedSize,
  };
}

function createLocalFileHeader(pathBytes: Buffer, entry: TestZipEntry): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(zipLocalFileHeaderSignature, 0);
  header.writeUInt16LE(zipVersionNeededToExtract, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(getTestZipEntryCompressionMethod(entry), 8);
  header.writeUInt16LE(zipDosTimeMidnight, 10);
  header.writeUInt16LE(zipDosDateJanuaryFirst1980, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(entry.bytes.byteLength, 18);
  header.writeUInt32LE(getTestZipEntryUncompressedSize(entry), 22);
  header.writeUInt16LE(pathBytes.byteLength, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, pathBytes]);
}

function createCentralDirectoryHeader(entry: TestCentralDirectoryEntry): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(zipCentralDirectoryHeaderSignature, 0);
  header.writeUInt16LE(zipVersionNeededToExtract, 4);
  header.writeUInt16LE(zipVersionNeededToExtract, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(getTestZipEntryCompressionMethod(entry.entry), 10);
  header.writeUInt16LE(zipDosTimeMidnight, 12);
  header.writeUInt16LE(zipDosDateJanuaryFirst1980, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(entry.entry.bytes.byteLength, 20);
  header.writeUInt32LE(getTestZipEntryUncompressedSize(entry.entry), 24);
  header.writeUInt16LE(entry.pathBytes.byteLength, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.localHeaderOffset, 42);

  return Buffer.concat([header, entry.pathBytes]);
}

function createEndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(zipEndOfCentralDirectorySignature, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entryCount, 8);
  header.writeUInt16LE(entryCount, 10);
  header.writeUInt32LE(centralDirectorySize, 12);
  header.writeUInt32LE(centralDirectoryOffset, 16);
  header.writeUInt16LE(0, 20);

  return header;
}

function createStoredZip(entries: ReadonlyArray<TestZipEntry>): Buffer {
  const localFileParts: Array<Buffer> = [];
  const centralDirectoryEntries: Array<TestCentralDirectoryEntry> = [];
  let localHeaderOffset = 0;

  for (const entry of entries) {
    const pathBytes = Buffer.from(entry.path, "utf8");
    const localFileHeader = createLocalFileHeader(pathBytes, entry);
    localFileParts.push(localFileHeader, entry.bytes);
    centralDirectoryEntries.push({
      pathBytes,
      entry,
      localHeaderOffset,
    });
    localHeaderOffset += localFileHeader.byteLength + entry.bytes.byteLength;
  }

  const centralDirectoryOffset = localHeaderOffset;
  const centralDirectoryParts = centralDirectoryEntries.map(createCentralDirectoryHeader);
  const centralDirectorySize = centralDirectoryParts.reduce((totalSize, part) => totalSize + part.byteLength, 0);

  return Buffer.concat([
    ...localFileParts,
    ...centralDirectoryParts,
    createEndOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset),
  ]);
}

function createPackageZip(
  cardsJson: WorkspacePackageCardsJsonV1,
  mediaEntries: ReadonlyArray<TestZipEntry>,
): Buffer {
  return createStoredZip([
    {
      path: "cards.json",
      bytes: createCardsJsonBuffer(cardsJson),
    },
    ...mediaEntries,
  ]);
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

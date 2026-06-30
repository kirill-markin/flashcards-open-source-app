import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { HttpError } from "../shared/errors";
import {
  loadWorkspacePackageImportReferencedMedia,
  loadWorkspacePackageImportReferencedMediaWithLimits,
  type PortableWorkspacePackageCardV1,
  type WorkspacePackageCardMetadataV1,
  type WorkspacePackageCardsJsonV1,
  type WorkspacePackageImportReferencedMediaInput,
  type WorkspacePackageImportReferencedMediaLimits,
} from "./index";
import {
  createPackageZip,
  createStoredZip,
} from "./testZipHelpers";

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

function createLoadInput(packageBytes: Buffer): WorkspacePackageImportReferencedMediaInput {
  return {
    packageBytes,
  };
}

function createImportMediaLimits(
  maxSingleMediaBytes: number,
  maxTotalMediaBytes: number,
): WorkspacePackageImportReferencedMediaLimits {
  return {
    maxZipBytes: 1024 * 1024,
    maxEntries: 100,
    maxCards: 100,
    maxMediaFiles: 100,
    maxSingleMediaBytes,
    maxTotalMediaBytes,
  };
}

async function assertDefaultLoadRejects(
  packageBytes: Buffer,
  messagePattern: RegExp,
): Promise<void> {
  await assert.rejects(
    () => loadWorkspacePackageImportReferencedMedia(createLoadInput(packageBytes)),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.match(error.message, messagePattern);
      return true;
    },
  );
}

async function assertLimitedLoadRejects(
  packageBytes: Buffer,
  limits: WorkspacePackageImportReferencedMediaLimits,
  messagePattern: RegExp,
): Promise<void> {
  await assert.rejects(
    () => loadWorkspacePackageImportReferencedMediaWithLimits(createLoadInput(packageBytes), limits),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.match(error.message, messagePattern);
      return true;
    },
  );
}

test("ZIP import media loader returns parsed cards and no media for text-only packages", async () => {
  const cardsJson: WorkspacePackageCardsJsonV1 = {
    formatVersion: 1,
    label: "Text deck",
    cards: [
      createTestCard("Capital of France?", "Paris", ["geography"], "basic"),
    ],
  };

  const result = await loadWorkspacePackageImportReferencedMedia(createLoadInput(createPackageZip(cardsJson, [])));

  assert.deepEqual(result.cardsJson, cardsJson);
  assert.deepEqual(result.referencedMediaFiles, []);
  assert.equal(result.referencedMediaFilesByPath.size, 0);
});

test("ZIP import media loader returns referenced media bytes by portable path", async () => {
  const imageBytes = Buffer.from("png bytes", "utf8");
  const cardsJson: WorkspacePackageCardsJsonV1 = {
    formatVersion: 1,
    cards: [
      createTestCard(
        "Diagram: ![cell](media/images/cell.png)",
        "Answer",
        ["biology"],
        "basic",
      ),
    ],
  };

  const result = await loadWorkspacePackageImportReferencedMedia(createLoadInput(createPackageZip(cardsJson, [
    { path: "media/images/cell.png", bytes: imageBytes },
  ])));
  const mediaFile = result.referencedMediaFilesByPath.get("media/images/cell.png");

  assert.deepEqual(result.referencedMediaFiles.map((file) => file.portablePath), ["media/images/cell.png"]);
  assert.ok(mediaFile !== undefined);
  assert.equal(mediaFile.portablePath, "media/images/cell.png");
  assert.equal(mediaFile.sizeBytes, imageBytes.byteLength);
  assert.deepEqual(mediaFile.bytes, imageBytes);
});

test("ZIP import media loader returns one byte record for duplicate references to the same media path", async () => {
  const mediaBytes = Buffer.from("shared bytes", "utf8");
  const cardsJson: WorkspacePackageCardsJsonV1 = {
    formatVersion: 1,
    cards: [
      createTestCard(
        "Prompt image: ![front](media/shared/image.png)",
        "Answer image: ![back](media/shared/image.png)",
        ["shared"],
        "basic",
      ),
      createTestCard(
        "Prompt link: [again](media/shared/image.png)",
        "Answer",
        ["shared"],
        "basic",
      ),
    ],
  };

  const result = await loadWorkspacePackageImportReferencedMedia(createLoadInput(createPackageZip(cardsJson, [
    { path: "media/shared/image.png", bytes: mediaBytes },
  ])));

  assert.equal(result.referencedMediaFiles.length, 1);
  assert.equal(result.referencedMediaFilesByPath.size, 1);
  assert.deepEqual(result.referencedMediaFiles[0]?.bytes, mediaBytes);
});

test("ZIP import media loader validates but does not return unreferenced media files", async () => {
  const referencedBytes = Buffer.from("referenced bytes", "utf8");
  const cardsJson: WorkspacePackageCardsJsonV1 = {
    formatVersion: 1,
    cards: [
      createTestCard(
        "Prompt",
        "See ![image](media/referenced/image.png)",
        ["tag"],
        "basic",
      ),
    ],
  };

  const result = await loadWorkspacePackageImportReferencedMedia(createLoadInput(createPackageZip(cardsJson, [
    { path: "media/referenced/image.png", bytes: referencedBytes },
    { path: "media/unreferenced/extra.png", bytes: Buffer.from("unused bytes", "utf8") },
  ])));

  assert.deepEqual(result.referencedMediaFiles.map((file) => file.portablePath), ["media/referenced/image.png"]);
  assert.equal(result.referencedMediaFilesByPath.has("media/unreferenced/extra.png"), false);
});

test("ZIP import media loader rejects missing referenced media files", async () => {
  await assertDefaultLoadRejects(
    createPackageZip({
      formatVersion: 1,
      cards: [
        createTestCard("Prompt", "![missing](media/missing.png)", ["tag"], "basic"),
      ],
    }, []),
    /references media files missing from ZIP.*media\/missing\.png/,
  );
});

test("ZIP import media loader rejects unsafe media entry traversal through shared ZIP validation", async () => {
  await assertDefaultLoadRejects(
    createPackageZip({
      formatVersion: 1,
      cards: [
        createTestCard("Prompt", "Answer", ["tag"], "basic"),
      ],
    }, [
      { path: "media/%2e%2e/image.png", bytes: Buffer.from("image", "utf8") },
    ]),
    /unsafe media path.*traversal/,
  );
});

test("ZIP import media loader enforces per-file decompressed media limits", async () => {
  await assertLimitedLoadRejects(
    createPackageZip({
      formatVersion: 1,
      cards: [
        createTestCard("Prompt", "![large](media/large.bin)", ["tag"], "basic"),
      ],
    }, [
      { path: "media/large.bin", bytes: Buffer.from("large", "utf8") },
    ]),
    createImportMediaLimits(4, 100),
    /media entry is too large.*maxSingleMediaBytes=4/,
  );
});

test("ZIP import media loader enforces total decompressed media limits", async () => {
  await assertLimitedLoadRejects(
    createPackageZip({
      formatVersion: 1,
      cards: [
        createTestCard(
          "Prompt ![first](media/first.bin)",
          "Answer ![second](media/second.bin)",
          ["tag"],
          "basic",
        ),
      ],
    }, [
      { path: "media/first.bin", bytes: Buffer.from("123", "utf8") },
      { path: "media/second.bin", bytes: Buffer.from("456", "utf8") },
    ]),
    createImportMediaLimits(10, 5),
    /media total is too large.*maxTotalMediaBytes=5/,
  );
});

test("ZIP import media loader keeps cards.json parsing and validation errors explicit", async () => {
  await assertDefaultLoadRejects(
    createStoredZip([
      { path: "cards.json", bytes: Buffer.from("{", "utf8") },
    ]),
    /cards\.json is malformed JSON/,
  );

  await assertDefaultLoadRejects(
    createStoredZip([
      {
        path: "cards.json",
        bytes: Buffer.from(JSON.stringify({
          formatVersion: 1,
          cards: [
            {
              frontText: " ",
              backText: "Answer",
              tags: ["tag"],
              cardType: "basic",
              metadata: {
                version: 1,
                source: null,
              },
            },
          ],
        }), "utf8"),
      },
    ]),
    /cards\.json is invalid/,
  );
});

import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  FlashcardsPackageError,
  generateNextFlashcardsPackageImportTag,
  prepareFlashcardsPackageImportWithTag,
  readFlashcardsPackageZip,
  validateFlashcardsPackage,
  writeFlashcardsPackageZip,
  type FlashcardsPackageV1,
} from "../../../workspacePackage";

function createPackageData(): FlashcardsPackageV1 {
  return {
    formatVersion: 1,
    cards: [
      {
        frontText: "Capital of Spain?",
        backText: "Madrid",
        tags: ["geography"],
        cardType: "basic",
        metadata: {
          version: 1,
          source: {
            label: "Cities",
            author: "Author",
            comment: "Imported from notes",
            createdAt: "2026-05-01T09:00:00.000Z",
            importedAt: "2026-05-02T09:00:00.000Z",
            importId: "old-import-id",
          },
        },
      },
    ],
  };
}

describe("workspace package", () => {
  it("writes and reads flashcards.zip with only cards.json", () => {
    const packageData = createPackageData();

    const zipBytes = writeFlashcardsPackageZip(packageData);

    expect(readFlashcardsPackageZip(zipBytes)).toEqual(packageData);
  });

  it("rejects unsupported package shapes and asset references", () => {
    expect(() => validateFlashcardsPackage({
      formatVersion: 2,
      cards: [],
    })).toThrow(new FlashcardsPackageError("$.formatVersion must be 1"));

    expect(() => validateFlashcardsPackage({
      formatVersion: 1,
      cards: [
        {
          frontText: "![image](fcasset:image-1)",
          backText: "answer",
          tags: [],
          cardType: "basic",
          metadata: { version: 1, source: null },
        },
      ],
    })).toThrow(FlashcardsPackageError);
  });

  it("rejects zips with files beyond cards.json", () => {
    const zipBytes = zipSync({
      "cards.json": strToU8(JSON.stringify(createPackageData())),
      "media/image.png": new Uint8Array([1, 2, 3]),
    });

    expect(() => readFlashcardsPackageZip(zipBytes)).toThrow(FlashcardsPackageError);
  });

  it("generates the next import tag and refreshes import metadata", () => {
    const packageData = createPackageData();
    const now = new Date("2026-06-28T12:00:00.000Z");

    expect(generateNextFlashcardsPackageImportTag([
      "import:2026-06-28-0",
      "other",
      "import:2026-06-28-2",
      "import:2026-06-27-9",
    ], now)).toBe("import:2026-06-28-3");

    const preparedImport = prepareFlashcardsPackageImportWithTag({
      packageData,
      existingTags: ["import:2026-06-28-0"],
      now,
      importId: "new-import-id",
      importedAt: "2026-06-28T12:00:00.000Z",
    });

    expect(preparedImport.importTag).toBe("import:2026-06-28-1");
    expect(preparedImport.cards[0]?.tags).toEqual(["geography", "import:2026-06-28-1"]);
    expect(preparedImport.cards[0]?.metadata.source).toEqual({
      label: "Cities",
      author: "Author",
      comment: "Imported from notes",
      createdAt: "2026-05-01T09:00:00.000Z",
      importedAt: "2026-06-28T12:00:00.000Z",
      importId: "new-import-id",
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  createTextImportPackageFile,
  parseTextImport,
} from "./textImport";

describe("text import", () => {
  it("parses tab-separated cards, ignores blank records, and keeps later field separators in the back", () => {
    const result = parseTextImport(
      "Canada\tOttawa\n\nUnited States\tWashington\tD.C.\n",
      { fieldSeparator: "\t", cardSeparator: "\n" },
    );

    expect(result).toEqual([
      {
        id: "source-row-1",
        frontText: "Canada",
        backText: "Ottawa",
        isValid: true,
      },
      {
        id: "source-row-3",
        frontText: "United States",
        backText: "Washington\tD.C.",
        isValid: true,
      },
    ]);
  });

  it("keeps malformed records editable and marks empty card sides invalid", () => {
    const result = parseTextImport(
      "Missing answer\n\tBack only\nFront only\t",
      { fieldSeparator: "\t", cardSeparator: "\n" },
    );

    expect(result).toEqual([
      {
        id: "source-row-1",
        frontText: "Missing answer",
        backText: "",
        isValid: false,
      },
      {
        id: "source-row-2",
        frontText: "",
        backText: "Back only",
        isValid: false,
      },
      {
        id: "source-row-3",
        frontText: "Front only",
        backText: "",
        isValid: false,
      },
    ]);
  });

  it("supports literal custom separators", () => {
    const result = parseTextImport(
      "bonjour => hello || merci => thank you",
      { fieldSeparator: " => ", cardSeparator: " || " },
    );

    expect(result.map(({ frontText, backText }) => ({ frontText, backText }))).toEqual([
      { frontText: "bonjour", backText: "hello" },
      { frontText: "merci", backText: "thank you" },
    ]);
  });

  it("rejects empty separators instead of producing ambiguous cards", () => {
    expect(() => parseTextImport("front\tback", {
      fieldSeparator: "",
      cardSeparator: "\n",
    })).toThrow("fieldSeparator must not be empty");

    expect(() => parseTextImport("front\tback", {
      fieldSeparator: "\t",
      cardSeparator: "",
    })).toThrow("cardSeparator must not be empty");
  });

  it("builds a canonical cards.json inside a one-file ZIP", async () => {
    const file = createTextImportPackageFile([
      {
        id: "edited-1",
        frontText: "Canada",
        backText: "Ottawa",
        isValid: true,
      },
    ], ["geography", "exam"]);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fileNameLength = view.getUint16(26, true);
    const extraFieldLength = view.getUint16(28, true);
    const contentLength = view.getUint32(18, true);
    const fileNameStart = 30;
    const contentStart = fileNameStart + fileNameLength + extraFieldLength;
    const content = bytes.slice(contentStart, contentStart + contentLength);

    expect(file.name).toBe("pasted-cards.zip");
    expect(file.type).toBe("application/zip");
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(new TextDecoder().decode(bytes.slice(fileNameStart, contentStart))).toBe("cards.json");
    expect(JSON.parse(new TextDecoder().decode(content))).toEqual({
      formatVersion: 1,
      cards: [
        {
          frontText: "Canada",
          backText: "Ottawa",
          tags: ["geography", "exam"],
          cardType: "basic",
          metadata: {
            version: 1,
            source: null,
          },
        },
      ],
    });
    expect(view.getUint32(bytes.byteLength - 22, true)).toBe(0x06054b50);
  });
});

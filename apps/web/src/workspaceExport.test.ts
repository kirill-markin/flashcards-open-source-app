// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCard, workspaceId } from "./localDb/testSupport";
import {
  exportWorkspaceCardsCsv,
  makeWorkspaceExportFilename,
  serializeWorkspaceCardsCsv,
} from "./workspaceExport";

const { loadAllActiveCardsForSqlMock } = vi.hoisted(() => ({
  loadAllActiveCardsForSqlMock: vi.fn(),
}));

vi.mock("./localDb/cards", () => ({
  loadAllActiveCardsForSql: loadAllActiveCardsForSqlMock,
}));

describe("serializeWorkspaceCardsCsv", () => {
  it("serializes plain text fields with the fixed header row", () => {
    const csv = serializeWorkspaceCardsCsv([
      makeCard({
        cardId: "card-1",
        frontText: "Front",
        backText: "Back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2026-03-10T10:00:00.000Z",
      }),
    ]);

    expect(csv).toBe("frontText,backText,tags\r\nFront,Back,grammar\r\n");
  });

  it("quotes commas, quotes, and multiline content using RFC 4180-style escaping", () => {
    const csv = serializeWorkspaceCardsCsv([
      makeCard({
        cardId: "card-1",
        frontText: "Hello, world",
        backText: "Line 1\n\"Line 2\"",
        tags: ["grammar", "verbs"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2026-03-10T10:00:00.000Z",
      }),
    ]);

    expect(csv).toBe(
      "frontText,backText,tags\r\n\"Hello, world\",\"Line 1\n\"\"Line 2\"\"\",\"grammar, verbs\"\r\n",
    );
  });

  it("leaves the tags cell empty when the card has no tags", () => {
    const csv = serializeWorkspaceCardsCsv([
      makeCard({
        cardId: "card-1",
        frontText: "Front",
        backText: "Back",
        tags: [],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2026-03-10T10:00:00.000Z",
      }),
    ]);

    expect(csv).toBe("frontText,backText,tags\r\nFront,Back,\r\n");
  });
});

describe("makeWorkspaceExportFilename", () => {
  it("builds the expected slugged CSV filename", () => {
    expect(
      makeWorkspaceExportFilename("Spanish Basics", new Date("2026-03-16T12:00:00.000Z")),
    ).toBe("spanish-basics-cards-export-2026-03-16.csv");
  });
});

describe("exportWorkspaceCardsCsv", () => {
  afterEach(() => {
    loadAllActiveCardsForSqlMock.mockReset();
    vi.restoreAllMocks();
  });

  it("loads active cards and triggers a CSV download with the expected filename and mime type", async () => {
    let capturedMimeType: string | null = null;
    let capturedTextPromise: Promise<string> | null = null;
    let clickedDownloadName = "";
    loadAllActiveCardsForSqlMock.mockResolvedValue([
      makeCard({
        cardId: "card-1",
        frontText: "Front",
        backText: "Back",
        tags: ["grammar", "verbs"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2026-03-10T10:00:00.000Z",
      }),
    ]);

    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function clickAnchor(this: HTMLAnchorElement): void {
      clickedDownloadName = this.download;
    });

    await exportWorkspaceCardsCsv({
      workspaceId,
      workspaceName: "Spanish Basics",
      now: new Date("2026-03-16T12:00:00.000Z"),
      document,
      urlApi: {
        createObjectURL(object: Blob): string {
          capturedMimeType = object.type;
          capturedTextPromise = object.text();
          return "blob:download";
        },
        revokeObjectURL: vi.fn(),
      },
    });

    expect(loadAllActiveCardsForSqlMock).toHaveBeenCalledWith(workspaceId);
    expect(clickedDownloadName).toBe("spanish-basics-cards-export-2026-03-16.csv");
    expect(capturedMimeType).toBe("text/csv;charset=utf-8");
    if (capturedTextPromise === null) {
      throw new Error("Expected CSV export to create Blob text content");
    }
    expect(await capturedTextPromise).toBe("frontText,backText,tags\r\nFront,Back,\"grammar, verbs\"\r\n");
  });
});

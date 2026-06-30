import { describe, expect, it } from "vitest";
import type { WorkspacePackageExportPreviewResponse } from "../types";
import {
  parseWorkspacePackageExportDownloadMetadata,
  parseWorkspacePackageExportPreviewResponse,
} from "./workspacePackageExport";

const previewFixture: WorkspacePackageExportPreviewResponse = {
  selectedCardCount: 2,
  availableTagCounts: [
    { tag: "english", cardsCount: 2 },
    { tag: "import:starter", cardsCount: 1 },
  ],
  tagsSelectedForRemoval: [
    { tag: "import:starter", cardsCount: 1 },
  ],
  referencedMediaCount: 1,
  approximateReferencedMediaBytes: 350,
  defaultPackageMetadata: {
    label: "Starter deck",
    author: "Author",
    comment: "Shared package",
    createdAt: "2026-04-10T09:00:00.000Z",
    sourceUrl: "https://example.com/package",
  },
};

describe("workspace package export API contracts", () => {
  it("parses ZIP export preview responses", () => {
    expect(parseWorkspacePackageExportPreviewResponse(
      previewFixture,
      "POST /workspaces/workspace-1/packages/export/preview",
    )).toEqual(previewFixture);
  });

  it("rejects malformed required preview count fields", () => {
    expect(() => parseWorkspacePackageExportPreviewResponse({
      ...previewFixture,
      referencedMediaCount: -1,
    }, "POST /workspaces/workspace-1/packages/export/preview")).toThrow(
      "Invalid API response for POST /workspaces/workspace-1/packages/export/preview: referencedMediaCount must be non-negative integer",
    );
  });

  it("derives ZIP download metadata with safe fallbacks", () => {
    expect(parseWorkspacePackageExportDownloadMetadata(new Headers({
      "Content-Disposition": "attachment; filename=\"flashcards.zip\"",
      "Content-Type": "application/zip",
    }))).toEqual({
      filename: "flashcards.zip",
      contentType: "application/zip",
    });

    expect(parseWorkspacePackageExportDownloadMetadata(new Headers())).toEqual({
      filename: "flashcards.zip",
      contentType: "application/octet-stream",
    });
  });
});

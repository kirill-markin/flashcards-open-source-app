import { describe, expect, it } from "vitest";
import type {
  Card,
  MediaAsset,
  WorkspacePackageImportConfirmResponse,
  WorkspacePackageImportPreviewResponse,
} from "../types";
import {
  parseWorkspacePackageImportConfirmResponse,
  parseWorkspacePackageImportPreviewResponse,
} from "./workspacePackageImport";

const cardFixture: Card = {
  cardId: "card-1",
  frontText: "Question",
  backText: "Answer",
  cardType: "basic",
  metadata: {
    version: 1,
    source: {
      label: "Shared deck",
      author: "Author",
      comment: null,
      createdAt: "2026-04-01T09:00:00.000Z",
      importedAt: "2026-04-10T09:00:00.000Z",
      importId: "import-1",
    },
  },
  tags: ["shared"],
  dueAt: null,
  createdAt: "2026-04-01T09:00:00.000Z",
  reps: 0,
  lapses: 0,
  fsrsCardState: "new",
  fsrsStepIndex: null,
  fsrsStability: null,
  fsrsDifficulty: null,
  fsrsLastReviewedAt: null,
  fsrsScheduledDays: null,
  clientUpdatedAt: "2026-04-10T09:00:00.000Z",
  lastModifiedByReplicaId: "replica-1",
  lastOperationId: "import-1:card:0",
  updatedAt: "2026-04-10T09:00:00.000Z",
  deletedAt: null,
};

const mediaAssetFixture: MediaAsset = {
  mediaAssetId: "media-asset-1",
  workspaceId: "workspace-1",
  mimeType: "image/png",
  sizeBytes: 128,
  sha256: "sha256-1",
  sourceUrl: null,
  createdAt: "2026-04-10T09:00:00.000Z",
  clientUpdatedAt: "2026-04-10T09:00:00.000Z",
  lastModifiedByReplicaId: "replica-1",
  lastOperationId: "import-1:media:0",
  updatedAt: "2026-04-10T09:00:00.000Z",
  deletedAt: null,
};

const previewFixture: WorkspacePackageImportPreviewResponse = {
  sourceKind: "zip",
  packageMetadata: {
    label: "Shared deck",
    author: "Author",
    comment: null,
    createdAt: "2026-04-01T09:00:00.000Z",
    sourceUrl: null,
  },
  cardCount: 1,
  tagCounts: [
    { tag: "shared", cardsCount: 1 },
  ],
  referencedMediaCount: 1,
  packageMediaFileCount: 1,
  warnings: [
    {
      code: "UNUSED_MEDIA_FILE",
      message: "Package media file is not referenced by imported cards.",
      mediaPath: "media/unused.png",
    },
  ],
  defaultOptions: {
    addImportTag: true,
    suggestedImportTag: "imported-2026-04-10",
    keptTags: ["shared"],
    removedTags: [],
  },
};

const confirmFixture: WorkspacePackageImportConfirmResponse = {
  cards: [cardFixture],
  importedMediaAssets: [
    {
      portablePath: "media/example.png",
      mediaAsset: mediaAssetFixture,
      applied: true,
    },
  ],
  summary: {
    cardCount: 1,
    cardBatchCount: 1,
    referencedMediaCount: 1,
    importedMediaAssetCount: 1,
    appliedMediaAssetCount: 1,
    keptTagCount: 1,
    removedTagCount: 0,
    importTag: "imported-2026-04-10",
  },
};

describe("workspace package import API contracts", () => {
  it("parses ZIP import preview responses", () => {
    expect(parseWorkspacePackageImportPreviewResponse(
      previewFixture,
      "POST /workspaces/workspace-1/packages/import/preview",
    )).toEqual(previewFixture);
  });

  it("parses ZIP import confirm responses with cards and media assets", () => {
    expect(parseWorkspacePackageImportConfirmResponse(
      confirmFixture,
      "POST /workspaces/workspace-1/packages/import",
    )).toEqual(confirmFixture);
  });

  it("rejects malformed required preview count fields", () => {
    expect(() => parseWorkspacePackageImportPreviewResponse({
      ...previewFixture,
      cardCount: -1,
    }, "POST /workspaces/workspace-1/packages/import/preview")).toThrow(
      "Invalid API response for POST /workspaces/workspace-1/packages/import/preview: cardCount must be non-negative integer",
    );
  });
});

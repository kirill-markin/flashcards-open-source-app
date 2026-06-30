// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import "./endpointsTestSupport";
import type {
  Card,
  MediaAsset,
  WorkspacePackageImportConfirmOptions,
  WorkspacePackageImportConfirmResponse,
  WorkspacePackageImportPreviewResponse,
} from "../../types";
import { createJsonResponse } from "../ApiTestSupport";
import { primeSessionCsrfToken } from "../transport/transport";
import {
  confirmWorkspacePackageImport,
  previewWorkspacePackageImport,
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

const previewResponse: WorkspacePackageImportPreviewResponse = {
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
  warnings: [],
  defaultOptions: {
    addImportTag: true,
    suggestedImportTag: "imported-2026-04-10",
    keptTags: ["shared"],
    removedTags: [],
  },
};

const confirmOptions: WorkspacePackageImportConfirmOptions = {
  addImportTag: true,
  importTag: "imported-2026-04-10",
  removeTags: [],
  importedAt: "2026-04-10T09:00:00.000Z",
  importId: "import-1",
  clientUpdatedAt: "2026-04-10T09:00:00.000Z",
  lastModifiedByReplicaId: "replica-1",
  operationIdPrefix: "import-1",
};

const confirmResponse: WorkspacePackageImportConfirmResponse = {
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

describe("workspace package import API endpoints", () => {
  it("sends raw ZIP bytes for import preview and parses preview JSON", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const zipBlob = new Blob([new Uint8Array([80, 75, 3, 4])], { type: "application/zip" });
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse(previewResponse));
    vi.stubGlobal("fetch", fetchMock);

    await expect(previewWorkspacePackageImport("workspace-1", zipBlob)).resolves.toEqual(previewResponse);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/workspaces/workspace-1/packages/import/preview");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe(zipBlob);
    expect(requestInit?.headers).toBeInstanceOf(Headers);
    if (!(requestInit?.headers instanceof Headers)) {
      throw new Error("Expected request headers");
    }

    expect(requestInit.headers.get("Content-Type")).toBe("application/zip");
  });

  it("sends ZIP file and JSON options as multipart form data for import confirm", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const zipFile = new File([new Uint8Array([80, 75, 3, 4])], "workspace-package.zip", { type: "application/zip" });
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse(confirmResponse));
    vi.stubGlobal("fetch", fetchMock);

    await expect(confirmWorkspacePackageImport("workspace-1", zipFile, confirmOptions)).resolves.toEqual(confirmResponse);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/workspaces/workspace-1/packages/import");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBeInstanceOf(FormData);
    expect(requestInit?.headers).toBeInstanceOf(Headers);
    if (!(requestInit?.body instanceof FormData)) {
      throw new Error("Expected FormData request body");
    }
    if (!(requestInit.headers instanceof Headers)) {
      throw new Error("Expected request headers");
    }

    expect(requestInit.body.get("file")).toBe(zipFile);
    expect(requestInit.body.get("options")).toBe(JSON.stringify(confirmOptions));
    expect(requestInit.headers.get("Content-Type")).toBeNull();
  });
});

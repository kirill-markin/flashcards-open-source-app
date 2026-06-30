// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import "./endpointsTestSupport";
import type {
  WorkspacePackageExportPreviewResponse,
  WorkspacePackageExportRequest,
} from "../../types";
import { createJsonResponse } from "../ApiTestSupport";
import { primeSessionCsrfToken } from "../transport/transport";
import {
  downloadWorkspacePackageExport,
  previewWorkspacePackageExport,
} from "./workspacePackageExport";

const exportRequest: WorkspacePackageExportRequest = {
  selection: {
    kind: "explicitCardIds",
    cardIds: ["99782554-9362-416c-93c7-0eb1d8079948"],
  },
  tagPolicy: {
    additionalRemovedTags: ["draft"],
  },
  packageMetadata: {
    label: "Starter deck",
    author: null,
    comment: null,
    createdAt: null,
    sourceUrl: null,
  },
};

const previewResponse: WorkspacePackageExportPreviewResponse = {
  selectedCardCount: 1,
  availableTagCounts: [
    { tag: "draft", cardsCount: 1 },
  ],
  tagsSelectedForRemoval: [
    { tag: "draft", cardsCount: 1 },
  ],
  referencedMediaCount: 1,
  approximateReferencedMediaBytes: 512,
  defaultPackageMetadata: {
    label: "Starter deck",
    createdAt: "2026-04-10T09:00:00.000Z",
  },
};

describe("workspace package export API endpoints", () => {
  it("sends JSON for export preview and parses preview JSON", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse(previewResponse));
    vi.stubGlobal("fetch", fetchMock);

    await expect(previewWorkspacePackageExport("workspace-1", exportRequest)).resolves.toEqual(previewResponse);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/workspaces/workspace-1/packages/export/preview");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe(JSON.stringify(exportRequest));
    expect(requestInit?.headers).toBeInstanceOf(Headers);
    if (!(requestInit?.headers instanceof Headers)) {
      throw new Error("Expected request headers");
    }

    expect(requestInit.headers.get("Content-Type")).toBe("application/json");
  });

  it("sends JSON for export download and returns ZIP blob metadata", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const zipBytes = new Uint8Array([80, 75, 3, 4]);
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(zipBytes, {
        status: 200,
        headers: {
          "Content-Disposition": "attachment; filename=\"flashcards.zip\"",
          "Content-Type": "application/zip",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadWorkspacePackageExport("workspace-1", exportRequest);

    expect(result.filename).toBe("flashcards.zip");
    expect(result.contentType).toBe("application/zip");
    expect(result.blob).toBeInstanceOf(Blob);
    expect([...new Uint8Array(await result.blob.arrayBuffer())]).toEqual([...zipBytes]);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/workspaces/workspace-1/packages/export");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe(JSON.stringify(exportRequest));
    expect(requestInit?.headers).toBeInstanceOf(Headers);
    if (!(requestInit?.headers instanceof Headers)) {
      throw new Error("Expected request headers");
    }

    expect(requestInit.headers.get("Accept")).toBe("application/zip");
    expect(requestInit.headers.get("Content-Type")).toBe("application/json");
  });
});

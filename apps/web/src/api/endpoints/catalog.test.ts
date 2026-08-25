// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import "./endpointsTestSupport";
import { createJsonResponse } from "../ApiTestSupport";
import type {
  CatalogPackageInstallConfirmOptions,
  CatalogPackageInstallPackageVersion,
} from "../../types";
import { primeSessionCsrfToken } from "../transport/transport";
import {
  confirmCatalogPackageInstall,
  loadPublicCatalogPackageVersion,
  previewCatalogPackageInstall,
} from "./catalog";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const packageVersionId = "22222222-2222-4222-8222-222222222222";
const packageId = "33333333-3333-4333-8333-333333333333";
const authorId = "44444444-4444-4444-8444-444444444444";

function createPackageVersion(): CatalogPackageInstallPackageVersion {
  return {
    packageVersionId,
    packageId,
    versionNumber: 1,
    slug: "test-package",
    title: "тест",
    summary: "Test package",
    description: "Test package",
    languageTags: ["ru"],
    license: "CC0-1.0",
    contentWarning: null,
    coverPackageMediaKey: null,
    cardCount: 2,
    createdAt: "2026-08-01T10:00:00.000Z",
    publishedAt: "2026-08-01T10:00:00.000Z",
    author: {
      authorId,
      slug: "test-author",
      displayName: "Test Author",
    },
  };
}

describe("catalog API endpoints", () => {
  it("validates the public package version lookup and exact-version preview and confirm responses", async () => {
    const catalogPackageVersion = {
      packageVersionId,
      packageId,
      versionNumber: 1,
      slug: "test-package",
      title: "тест",
      summary: "Test package",
      languageTags: ["ru"],
      cardCount: 2,
      publishedAt: "2026-08-01T10:00:00.000Z",
      author: {
        authorId,
        slug: "test-author",
        displayName: "Test Author",
      },
    };
    const previewResponse = {
      packageVersion: createPackageVersion(),
      summary: { cardCount: 2, mediaAssetCount: 0 },
      tagCounts: [{ tag: "test", cardsCount: 2 }],
      defaultOptions: {
        addImportTag: true,
        suggestedImportTag: "import:2026-08-02",
        keptTags: ["test"],
        removedTags: [],
      },
    };
    const confirmResponse = {
      packageVersion: createPackageVersion(),
      installedCards: [{
        packageCardId: "55555555-5555-4555-8555-555555555555",
        stableCardKey: "card-1",
        ordinal: 1,
        cardId: "66666666-6666-4666-8666-666666666666",
      }],
      installedMediaAssets: [],
      summary: {
        cardCount: 1,
        mediaAssetCount: 0,
        installId: "77777777-7777-4777-8777-777777777777",
        installedAt: "2026-08-02T10:00:00.000Z",
        keptTagCount: 1,
        removedTagCount: 0,
        importTag: "import:2026-08-02",
      },
    };
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ catalogPackageVersion }), {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "http://localhost:3000",
          "Content-Type": "application/json",
          "X-Request-Id": "catalog-request-id",
        },
      }))
      .mockResolvedValueOnce(createJsonResponse(previewResponse))
      .mockResolvedValueOnce(createJsonResponse(confirmResponse));
    vi.stubGlobal("fetch", fetchMock);
    primeSessionCsrfToken("csrf-token-1");

    const options: CatalogPackageInstallConfirmOptions = {
      addImportTag: true,
      importTag: "import:2026-08-02",
      removeTags: [],
      installId: "77777777-7777-4777-8777-777777777777",
      installedAt: "2026-08-02T10:00:00.000Z",
      clientUpdatedAt: "2026-08-02T10:00:00.000Z",
      lastModifiedByReplicaId: "88888888-8888-4888-8888-888888888888",
      operationIdPrefix: "77777777-7777-4777-8777-777777777777",
    };

    await expect(loadPublicCatalogPackageVersion(packageVersionId)).resolves.toEqual(catalogPackageVersion);
    await expect(previewCatalogPackageInstall(workspaceId, packageVersionId)).resolves.toEqual(previewResponse);
    await expect(confirmCatalogPackageInstall(workspaceId, packageVersionId, options)).resolves.toEqual(confirmResponse);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `http://localhost:8080/v1/catalog/package-versions/${packageVersionId}`,
      expect.objectContaining({
        credentials: "omit",
        method: "GET",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `http://localhost:8080/v1/workspaces/${workspaceId}/catalog/package-versions/${packageVersionId}/install/preview`,
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `http://localhost:8080/v1/workspaces/${workspaceId}/catalog/package-versions/${packageVersionId}/install`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(options),
        credentials: "include",
      }),
    );
  });

  it("preserves public catalog errors and request IDs without auth recovery", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Catalog request is invalid.",
        code: "INVALID_CATALOG_REQUEST",
        requestId: "body-request-id",
      }), {
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": "http://localhost:3000",
          "Content-Type": "application/json",
          "X-Request-Id": "header-request-id",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadPublicCatalogPackageVersion(packageVersionId)).rejects.toMatchObject({
      code: "INVALID_CATALOG_REQUEST",
      endpoint: `GET /catalog/package-versions/${packageVersionId}`,
      message: "Catalog request is invalid.",
      requestId: "header-request-id",
      responseBodyKind: "json",
      statusCode: 400,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:8080/v1/catalog/package-versions/${packageVersionId}`,
      expect.objectContaining({
        credentials: "omit",
        method: "GET",
      }),
    );
  });
});

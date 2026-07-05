// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { createStorageMock } from "../../../api/ApiTestSupport";
import type { MediaBlobCacheRecord } from "../../../localDb/mediaTransfers";
import type { MediaAsset } from "../../../types";
import { ReviewCardSide } from "./ReviewCardSide";

const mediaMocks = vi.hoisted(() => ({
  loadMediaAssetDownloadUrlMock: vi.fn(),
  loadMediaAssetRecordMock: vi.fn(),
  loadMediaBlobCacheRecordMock: vi.fn(),
  writeMediaBlobCacheRecordMock: vi.fn(),
}));

vi.mock("../../../api", () => ({
  loadMediaAssetDownloadUrl: mediaMocks.loadMediaAssetDownloadUrlMock,
}));

vi.mock("../../../localDb/mediaAssets", () => ({
  loadMediaAssetRecord: mediaMocks.loadMediaAssetRecordMock,
}));

vi.mock("../../../localDb/mediaTransfers", () => ({
  loadMediaBlobCacheRecord: mediaMocks.loadMediaBlobCacheRecordMock,
  writeMediaBlobCacheRecord: mediaMocks.writeMediaBlobCacheRecordMock,
}));

const imageSha256 = "11".repeat(32);
const audioSha256 = "22".repeat(32);
const videoSha256 = "33".repeat(32);
const fileSha256 = "44".repeat(32);
const coldSha256 = "55".repeat(32);
const refreshedSha256 = "66".repeat(32);
const badSha256 = "77".repeat(32);
const largeSha256 = "88".repeat(32);
const testDownloadRangeSizeBytes = 4 * 1024 * 1024;

function hexToArrayBuffer(hex: string): ArrayBuffer {
  if (hex.length % 2 !== 0) {
    throw new Error(`Invalid hex length: ${hex.length}`);
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes.buffer;
}

function installDigestMock(sha256: string): void {
  vi.stubGlobal("crypto", {
    subtle: {
      digest: vi.fn(async (_algorithm: AlgorithmIdentifier, _data: BufferSource): Promise<ArrayBuffer> => (
        hexToArrayBuffer(sha256)
      )),
    },
  });
}

function makeMediaAsset(
  mediaAssetId: string,
  mimeType: string,
  sha256: string,
  sizeBytes: number,
): MediaAsset {
  return {
    mediaAssetId,
    workspaceId: "workspace-1",
    mimeType,
    sizeBytes,
    sha256,
    sourceUrl: null,
    createdAt: "2026-03-10T09:00:00.000Z",
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByReplicaId: "device-1",
    lastOperationId: `operation-${mediaAssetId}`,
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
  };
}

function makeCacheRecord(mediaAsset: MediaAsset, blob: Blob): MediaBlobCacheRecord {
  return {
    sha256: mediaAsset.sha256,
    mimeType: mediaAsset.mimeType,
    sizeBytes: mediaAsset.sizeBytes,
    blob,
    createdAt: "2026-03-10T09:00:00.000Z",
    lastAccessedAt: "2026-03-10T09:00:00.000Z",
    sourceMediaAssetId: mediaAsset.mediaAssetId,
  };
}

function createDeferred<Result>(): Readonly<{
  promise: Promise<Result>;
  resolve: (value: Result) => void;
  reject: (error: Error) => void;
}> {
  let resolveDeferred: ((value: Result) => void) | null = null;
  let rejectDeferred: ((error: Error) => void) | null = null;
  const promise = new Promise<Result>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  if (resolveDeferred === null || rejectDeferred === null) {
    throw new Error("Failed to create deferred promise");
  }

  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred,
  };
}

function renderReviewCardSide(container: HTMLDivElement, text: string): ReactDOM.Root {
  const root = ReactDOM.createRoot(container);
  act(() => {
    root.render(
      <I18nProvider>
        <ReviewCardSide
          aiButtonAriaLabel={null}
          contentClassName="review-front"
          isSpeaking={false}
          label="Front"
          localReadVersion={0}
          onOpenAi={null}
          onToggleSpeech={() => undefined}
          showAiButton={false}
          showSpeechButton={false}
          speechButtonAriaLabel={null}
          speechButtonDisabled={false}
          text={text}
          workspaceId="workspace-1"
        />
      </I18nProvider>,
    );
  });
  return root;
}

describe("ReviewCardSide managed media rendering", () => {
  let container: HTMLDivElement;
  let createObjectURLMock: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn<(url: string) => void>>;
  let root: ReactDOM.Root | null;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    let objectUrlIndex = 0;
    createObjectURLMock = vi.fn((_: Blob): string => {
      objectUrlIndex += 1;
      return `blob:review-media-${objectUrlIndex}`;
    });
    revokeObjectURLMock = vi.fn((_url: string): void => undefined);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURLMock,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = null;
    mediaMocks.loadMediaAssetDownloadUrlMock.mockReset();
    mediaMocks.loadMediaAssetRecordMock.mockReset();
    mediaMocks.loadMediaBlobCacheRecordMock.mockReset();
    mediaMocks.writeMediaBlobCacheRecordMock.mockReset();
    mediaMocks.writeMediaBlobCacheRecordMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (root !== null) {
      act(() => {
        root?.unmount();
      });
    }
    container.remove();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders managed image, audio, video, and generic attachments from warm blob cache", async () => {
    const imageBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const audioBlob = new Blob([new Uint8Array([4, 5, 6, 7])], { type: "audio/mpeg" });
    const videoBlob = new Blob([new Uint8Array([8, 9, 10, 11, 12])], { type: "video/mp4" });
    const fileBlob = new Blob([new Uint8Array([13, 14])], { type: "application/pdf" });
    const mediaAssets = new Map<string, MediaAsset>([
      ["image-asset", makeMediaAsset("image-asset", "image/png", imageSha256, imageBlob.size)],
      ["audio-asset", makeMediaAsset("audio-asset", "audio/mpeg", audioSha256, audioBlob.size)],
      ["video-asset", makeMediaAsset("video-asset", "video/mp4", videoSha256, videoBlob.size)],
      ["file-asset", makeMediaAsset("file-asset", "application/pdf", fileSha256, fileBlob.size)],
    ]);
    const cacheRecords = new Map<string, MediaBlobCacheRecord>([
      [imageSha256, makeCacheRecord(mediaAssets.get("image-asset") as MediaAsset, imageBlob)],
      [audioSha256, makeCacheRecord(mediaAssets.get("audio-asset") as MediaAsset, audioBlob)],
      [videoSha256, makeCacheRecord(mediaAssets.get("video-asset") as MediaAsset, videoBlob)],
      [fileSha256, makeCacheRecord(mediaAssets.get("file-asset") as MediaAsset, fileBlob)],
    ]);
    mediaMocks.loadMediaAssetRecordMock.mockImplementation(async (_workspaceId: string, mediaAssetId: string): Promise<MediaAsset | null> => {
      return mediaAssets.get(mediaAssetId) ?? null;
    });
    mediaMocks.loadMediaBlobCacheRecordMock.mockImplementation(async (sha256: string): Promise<MediaBlobCacheRecord | null> => {
      return cacheRecords.get(sha256) ?? null;
    });

    root = renderReviewCardSide(container, [
      "![Diagram](fcasset:image-asset)",
      "[Audio clip](fcasset:audio-asset)",
      "[Video clip](fcasset:video-asset)",
      "[Worksheet](fcasset:file-asset)",
    ].join("\n\n"));

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-image")).not.toBeNull();
      expect(container.querySelector("audio.review-markdown-media-control")).not.toBeNull();
      expect(container.querySelector("video.review-markdown-media-control")).not.toBeNull();
      expect(container.querySelector("a.review-markdown-media-attachment")).not.toBeNull();
    });

    const image = container.querySelector(".review-markdown-media-image");
    if (!(image instanceof HTMLImageElement)) {
      throw new Error("Managed image was not rendered");
    }
    expect(image.alt).toBe("Diagram");
    expect(image.getAttribute("src")).toMatch(/^blob:review-media-/);
    expect(container.querySelector("audio.review-markdown-media-control")?.getAttribute("src")).toMatch(/^blob:review-media-/);
    expect(container.querySelector("video.review-markdown-media-control")?.getAttribute("src")).toMatch(/^blob:review-media-/);
    expect(container.querySelector("a.review-markdown-media-attachment")?.getAttribute("href")).toMatch(/^blob:review-media-/);
    expect(mediaMocks.loadMediaAssetDownloadUrlMock).not.toHaveBeenCalled();
    expect(mediaMocks.writeMediaBlobCacheRecordMock).toHaveBeenCalledTimes(4);
    expect(createObjectURLMock).toHaveBeenCalledTimes(4);

    act(() => {
      root?.unmount();
    });
    root = null;
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(4);
  });

  it("downloads, verifies, caches, and deduplicates cold managed media", async () => {
    const mediaBytes = new Uint8Array([21, 22, 23, 24]);
    installDigestMock(coldSha256);
    const firstMediaAsset = makeMediaAsset("image-asset", "image/png", coldSha256, mediaBytes.byteLength);
    const secondMediaAsset = makeMediaAsset("image-copy-asset", "image/png", coldSha256, mediaBytes.byteLength);
    const mediaAssets = new Map<string, MediaAsset>([
      [firstMediaAsset.mediaAssetId, firstMediaAsset],
      [secondMediaAsset.mediaAssetId, secondMediaAsset],
    ]);
    const downloadUrlDeferred = createDeferred<{
      mediaAsset: MediaAsset;
      download: Readonly<{ method: "GET"; url: string; expiresAt: string; rangeRequests: true }>;
    }>();
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValue(new Response(mediaBytes, { status: 206 }));
    vi.stubGlobal("fetch", fetchMock);
    mediaMocks.loadMediaAssetRecordMock.mockImplementation(async (_workspaceId: string, mediaAssetId: string): Promise<MediaAsset | null> => {
      return mediaAssets.get(mediaAssetId) ?? null;
    });
    mediaMocks.loadMediaBlobCacheRecordMock.mockResolvedValue(null);
    mediaMocks.loadMediaAssetDownloadUrlMock.mockImplementation(async () => downloadUrlDeferred.promise);

    root = renderReviewCardSide(container, [
      "![First](fcasset:image-asset)",
      "![Second](fcasset:image-copy-asset)",
    ].join("\n\n"));

    await vi.waitFor(() => {
      expect(mediaMocks.loadMediaBlobCacheRecordMock).toHaveBeenCalledTimes(2);
      expect(mediaMocks.loadMediaAssetDownloadUrlMock).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    downloadUrlDeferred.resolve({
      mediaAsset: firstMediaAsset,
      download: {
        method: "GET",
        url: "https://media.example.test/signed-download",
        expiresAt: "2026-03-10T10:00:00.000Z",
        rangeRequests: true,
      },
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll(".review-markdown-media-image")).toHaveLength(2);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://media.example.test/signed-download", {
      method: "GET",
      headers: {
        Range: "bytes=0-3",
      },
    });
    expect(mediaMocks.writeMediaBlobCacheRecordMock).toHaveBeenCalledTimes(1);
    expect(mediaMocks.writeMediaBlobCacheRecordMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      sha256: coldSha256,
      mimeType: "image/png",
      sizeBytes: mediaBytes.byteLength,
      sourceMediaAssetId: "image-asset",
    }));
  });

  it("downloads cold managed media in direct byte ranges", async () => {
    const mediaBytes = new Uint8Array(testDownloadRangeSizeBytes + 3);
    mediaBytes.set([61, 62, 63], testDownloadRangeSizeBytes);
    installDigestMock(largeSha256);
    const mediaAsset = makeMediaAsset("large-image-asset", "image/png", largeSha256, mediaBytes.byteLength);
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(mediaBytes.slice(0, testDownloadRangeSizeBytes), { status: 206 }))
      .mockResolvedValueOnce(new Response(mediaBytes.slice(testDownloadRangeSizeBytes), { status: 206 }));
    vi.stubGlobal("fetch", fetchMock);
    mediaMocks.loadMediaAssetRecordMock.mockResolvedValue(mediaAsset);
    mediaMocks.loadMediaBlobCacheRecordMock.mockResolvedValue(null);
    mediaMocks.loadMediaAssetDownloadUrlMock.mockResolvedValue({
      mediaAsset,
      download: {
        method: "GET" as const,
        url: "https://media.example.test/large-signed-download",
        expiresAt: "2026-03-10T10:00:00.000Z",
        rangeRequests: true,
      },
    });

    root = renderReviewCardSide(container, "![Large](fcasset:large-image-asset)");

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-image")).not.toBeNull();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://media.example.test/large-signed-download", {
      method: "GET",
      headers: {
        Range: "bytes=0-4194303",
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://media.example.test/large-signed-download", {
      method: "GET",
      headers: {
        Range: "bytes=4194304-4194306",
      },
    });
    expect(mediaMocks.writeMediaBlobCacheRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      sha256: largeSha256,
      sizeBytes: mediaBytes.byteLength,
    }));
    const cacheRecord = mediaMocks.writeMediaBlobCacheRecordMock.mock.calls[0]?.[0] as MediaBlobCacheRecord | undefined;
    expect(cacheRecord?.blob.size).toBe(mediaBytes.byteLength);
  });

  it("keeps external Markdown images on the normal image path", async () => {
    root = renderReviewCardSide(container, "![External](https://example.test/image.png)");

    await vi.waitFor(() => {
      expect(container.querySelector("img.review-markdown-img")).not.toBeNull();
    });

    expect(mediaMocks.loadMediaAssetRecordMock).not.toHaveBeenCalled();
    expect(mediaMocks.loadMediaAssetDownloadUrlMock).not.toHaveBeenCalled();
    expect(mediaMocks.loadMediaBlobCacheRecordMock).not.toHaveBeenCalled();
  });

  it("renders a stable fallback for missing managed media", async () => {
    mediaMocks.loadMediaAssetRecordMock.mockResolvedValue(null);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => undefined);

    root = renderReviewCardSide(container, "![Missing](fcasset:missing-asset)");

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-fallback")?.textContent).toBe("Media unavailable");
    });
    expect(mediaMocks.loadMediaAssetDownloadUrlMock).not.toHaveBeenCalled();
    expect(mediaMocks.loadMediaBlobCacheRecordMock).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("refreshes the signed download URL when the first signed URL fetch fails", async () => {
    const mediaBytes = new Uint8Array([31, 32, 33, 34, 35]);
    installDigestMock(refreshedSha256);
    const mediaAsset = makeMediaAsset("refresh-asset", "image/png", refreshedSha256, mediaBytes.byteLength);
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("expired", { status: 403, statusText: "Forbidden" }))
      .mockResolvedValueOnce(new Response(mediaBytes, { status: 206 }));
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => undefined);
    vi.stubGlobal("fetch", fetchMock);
    mediaMocks.loadMediaAssetRecordMock.mockResolvedValue(mediaAsset);
    mediaMocks.loadMediaBlobCacheRecordMock.mockResolvedValue(null);
    mediaMocks.loadMediaAssetDownloadUrlMock
      .mockResolvedValueOnce({
        mediaAsset,
        download: {
          method: "GET" as const,
          url: "https://media.example.test/stale-download",
          expiresAt: "2026-03-10T10:00:00.000Z",
          rangeRequests: true,
        },
      })
      .mockResolvedValueOnce({
        mediaAsset,
        download: {
          method: "GET" as const,
          url: "https://media.example.test/fresh-download",
          expiresAt: "2026-03-10T10:05:00.000Z",
          rangeRequests: true,
        },
      });

    root = renderReviewCardSide(container, "![Refresh](fcasset:refresh-asset)");

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-image")).not.toBeNull();
    });

    expect(mediaMocks.loadMediaAssetDownloadUrlMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://media.example.test/stale-download");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://media.example.test/fresh-download");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      method: "GET",
      headers: {
        Range: "bytes=0-4",
      },
    });
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      method: "GET",
      headers: {
        Range: "bytes=0-4",
      },
    });
    expect(mediaMocks.writeMediaBlobCacheRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      sha256: refreshedSha256,
      sizeBytes: mediaBytes.byteLength,
    }));
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Managed media signed URL download retrying",
      expect.objectContaining({
        mediaAssetId: "refresh-asset",
        sha256: refreshedSha256,
      }),
    );
  });

  it("renders unavailable media when downloaded bytes fail verification", async () => {
    const mediaBytes = new Uint8Array([41, 42, 43]);
    installDigestMock(badSha256);
    const mediaAsset = makeMediaAsset("corrupt-asset", "image/png", coldSha256, mediaBytes.byteLength);
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValue(new Response(mediaBytes, { status: 206 }));
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => undefined);
    vi.stubGlobal("fetch", fetchMock);
    mediaMocks.loadMediaAssetRecordMock.mockResolvedValue(mediaAsset);
    mediaMocks.loadMediaBlobCacheRecordMock.mockResolvedValue(null);
    mediaMocks.loadMediaAssetDownloadUrlMock.mockResolvedValue({
      mediaAsset,
      download: {
        method: "GET" as const,
        url: "https://media.example.test/corrupt-download",
        expiresAt: "2026-03-10T10:00:00.000Z",
        rangeRequests: true,
      },
    });

    root = renderReviewCardSide(container, "![Corrupt](fcasset:corrupt-asset)");

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-fallback")?.textContent).toBe("Media unavailable");
    });

    expect(mediaMocks.loadMediaAssetDownloadUrlMock).toHaveBeenCalledTimes(1);
    expect(mediaMocks.writeMediaBlobCacheRecordMock).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Managed media download unavailable",
      expect.objectContaining({
        mediaAssetId: "corrupt-asset",
        errorMessage: expect.stringContaining("sha256 mismatch"),
      }),
    );
  });
});

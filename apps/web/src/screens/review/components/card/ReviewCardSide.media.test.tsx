// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../../i18n";
import { createStorageMock } from "../../../../api/ApiTestSupport";
import type { MediaBlobCacheRecord } from "../../../../localDb/mediaTransfers";
import type { MediaAsset } from "../../../../types";
import { ReviewCardSide } from "./ReviewCardSide";

const mediaMocks = vi.hoisted(() => ({
  loadMediaAssetDownloadUrlMock: vi.fn(),
  loadMediaAssetRecordMock: vi.fn(),
  loadMediaBlobCacheRecordMock: vi.fn(),
  writeMediaBlobCacheRecordMock: vi.fn(),
}));

vi.mock("../../../../api", () => ({
  loadMediaAssetDownloadUrl: mediaMocks.loadMediaAssetDownloadUrlMock,
}));

vi.mock("../../../../localDb/mediaAssets", () => ({
  loadMediaAssetRecord: mediaMocks.loadMediaAssetRecordMock,
}));

vi.mock("../../../../localDb/mediaTransfers", () => ({
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

function renderReviewCardSide(
  root: ReactDOM.Root,
  text: string,
  localReadVersion: number,
): void {
  act(() => {
    root.render(
      <I18nProvider>
        <ReviewCardSide
          aiButtonAriaLabel={null}
          contentClassName="review-front"
          isSpeaking={false}
          label="Front"
          localReadVersion={localReadVersion}
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
}

function createReviewCardSideRoot(
  container: HTMLDivElement,
  text: string,
  localReadVersion: number,
): ReactDOM.Root {
  const root = ReactDOM.createRoot(container);
  renderReviewCardSide(root, text, localReadVersion);
  return root;
}

describe("ReviewCardSide managed media rendering", () => {
  let container: HTMLDivElement;
  let createObjectURLMock: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
  let imageDecodeMock: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let imageNaturalHeight: number;
  let imageNaturalWidth: number;
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
    imageNaturalHeight = 600;
    imageNaturalWidth = 800;
    imageDecodeMock = vi.fn(async (): Promise<void> => undefined);
    class ManagedMediaTestImage {
      complete = false;
      naturalHeight = imageNaturalHeight;
      naturalWidth = imageNaturalWidth;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      src = "";

      decode(): Promise<void> {
        return imageDecodeMock();
      }
    }
    vi.stubGlobal("Image", ManagedMediaTestImage);
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

  it("renders an image-shaped placeholder until a managed image has decoded", async () => {
    const imageDecodeDeferred = createDeferred<void>();
    imageDecodeMock.mockImplementation(async (): Promise<void> => imageDecodeDeferred.promise);
    const imageBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const mediaAsset = makeMediaAsset("image-asset", "image/png", imageSha256, imageBlob.size);
    const cacheRecord = makeCacheRecord(mediaAsset, imageBlob);
    mediaMocks.loadMediaAssetRecordMock.mockResolvedValue(mediaAsset);
    mediaMocks.loadMediaBlobCacheRecordMock.mockResolvedValue(cacheRecord);

    root = createReviewCardSideRoot(container, "![Diagram](fcasset:image-asset)", 0);

    await vi.waitFor(() => {
      expect(imageDecodeMock).toHaveBeenCalledTimes(1);
    });

    const placeholder = container.querySelector(".review-markdown-media-image-loading");
    if (!(placeholder instanceof HTMLElement)) {
      throw new Error("Managed image loading placeholder was not rendered");
    }
    expect(placeholder.getAttribute("data-fcasset-id")).toBe("image-asset");
    expect(placeholder.getAttribute("aria-busy")).toBe("true");
    expect(placeholder.getAttribute("aria-label")).toBeTruthy();
    expect(container.querySelector(".review-markdown-media-loading")).toBeNull();
    expect(container.querySelector(".review-markdown-media-image")).toBeNull();

    await act(async () => {
      imageDecodeDeferred.resolve(undefined);
      await imageDecodeDeferred.promise;
    });

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-image")).not.toBeNull();
    });

    const image = container.querySelector(".review-markdown-media-image");
    if (!(image instanceof HTMLImageElement)) {
      throw new Error("Managed image was not rendered after decode");
    }
    expect(image.alt).toBe("Diagram");
    expect(image.getAttribute("src")).toBe("blob:review-media-1");
    expect(image.style.aspectRatio).toBe("800 / 600");
    expect(container.querySelector(".review-markdown-media-image-loading")).toBeNull();
  });

  it("keeps managed Markdown links on the compact loading and fallback path", async () => {
    const mediaAssetDeferred = createDeferred<MediaAsset | null>();
    mediaMocks.loadMediaAssetRecordMock.mockImplementation(async (): Promise<MediaAsset | null> => mediaAssetDeferred.promise);

    root = createReviewCardSideRoot(container, "[Diagram](fcasset:image-asset)", 0);

    const loading = container.querySelector(".review-markdown-media-loading");
    if (!(loading instanceof HTMLElement)) {
      throw new Error("Managed link loading placeholder was not rendered");
    }
    expect(loading.getAttribute("data-fcasset-id")).toBe("image-asset");
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".review-markdown-media-image-loading")).toBeNull();
    expect(imageDecodeMock).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(mediaMocks.loadMediaAssetRecordMock).toHaveBeenCalledWith("workspace-1", "image-asset");
    });
    await act(async () => {
      mediaAssetDeferred.resolve(null);
      await mediaAssetDeferred.promise;
    });

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-fallback")?.textContent).toBe("Media unavailable");
    });
    expect(container.querySelector(".review-markdown-media-image-loading")).toBeNull();
  });

  it("renders unavailable media and releases the object URL when managed image decode fails", async () => {
    const imageBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const mediaAsset = makeMediaAsset("image-asset", "image/png", imageSha256, imageBlob.size);
    const cacheRecord = makeCacheRecord(mediaAsset, imageBlob);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => undefined);
    imageDecodeMock.mockRejectedValue(new Error("decode failed"));
    mediaMocks.loadMediaAssetRecordMock.mockResolvedValue(mediaAsset);
    mediaMocks.loadMediaBlobCacheRecordMock.mockResolvedValue(cacheRecord);

    root = createReviewCardSideRoot(container, "![Diagram](fcasset:image-asset)", 0);

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-fallback")?.textContent).toBe("Media unavailable");
    });

    expect(container.querySelector(".review-markdown-media-image")).toBeNull();
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:review-media-1");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Managed media download unavailable",
      expect.objectContaining({
        mediaAssetId: "image-asset",
        errorMessage: expect.stringContaining("decode failed"),
      }),
    );
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

    root = createReviewCardSideRoot(container, [
      "![Diagram](fcasset:image-asset)",
      "[Audio clip](fcasset:audio-asset)",
      "[Video clip](fcasset:video-asset)",
      "[Worksheet](fcasset:file-asset)",
    ].join("\n\n"), 0);

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

  it("keeps a ready managed image rendered while local data refreshes the same media identity", async () => {
    const imageBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const mediaAsset = makeMediaAsset("image-asset", "image/png", imageSha256, imageBlob.size);
    const cacheRecord = makeCacheRecord(mediaAsset, imageBlob);
    const refreshMediaAsset = createDeferred<MediaAsset | null>();
    mediaMocks.loadMediaAssetRecordMock
      .mockResolvedValueOnce(mediaAsset)
      .mockImplementation(async (_workspaceId: string, _mediaAssetId: string): Promise<MediaAsset | null> => {
        return refreshMediaAsset.promise;
      });
    mediaMocks.loadMediaBlobCacheRecordMock.mockResolvedValue(cacheRecord);

    root = createReviewCardSideRoot(container, "![Diagram](fcasset:image-asset)", 0);

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-image")).not.toBeNull();
    });

    const initialImage = container.querySelector(".review-markdown-media-image");
    if (!(initialImage instanceof HTMLImageElement)) {
      throw new Error("Managed image was not rendered");
    }
    const initialSrc = initialImage.getAttribute("src");
    expect(initialSrc).toBe("blob:review-media-1");
    expect(mediaMocks.writeMediaBlobCacheRecordMock).toHaveBeenCalledTimes(1);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);

    renderReviewCardSide(root, "![Diagram](fcasset:image-asset)", 1);

    await vi.waitFor(() => {
      expect(mediaMocks.loadMediaAssetRecordMock).toHaveBeenCalledTimes(2);
    });
    const refreshingImage = container.querySelector(".review-markdown-media-image");
    if (!(refreshingImage instanceof HTMLImageElement)) {
      throw new Error("Managed image was not rendered during refresh");
    }
    expect(refreshingImage.getAttribute("src")).toBe(initialSrc);
    expect(container.querySelector(".review-markdown-media-loading")).toBeNull();
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      refreshMediaAsset.resolve(mediaAsset);
      await refreshMediaAsset.promise;
    });

    await vi.waitFor(() => {
      expect(mediaMocks.writeMediaBlobCacheRecordMock).toHaveBeenCalledTimes(2);
    });
    const refreshedImage = container.querySelector(".review-markdown-media-image");
    if (!(refreshedImage instanceof HTMLImageElement)) {
      throw new Error("Managed image was not rendered after refresh");
    }
    expect(refreshedImage.getAttribute("src")).toBe(initialSrc);
    expect(container.querySelector(".review-markdown-media-loading")).toBeNull();
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it("releases a newly acquired managed image URL when unmounted before ready state commits", async () => {
    const imageBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const mediaAsset = makeMediaAsset("image-asset", "image/png", imageSha256, imageBlob.size);
    const cacheRecord = makeCacheRecord(mediaAsset, imageBlob);
    mediaMocks.loadMediaAssetRecordMock.mockResolvedValue(mediaAsset);
    mediaMocks.loadMediaBlobCacheRecordMock.mockResolvedValue(cacheRecord);
    createObjectURLMock.mockImplementation((_: Blob): string => {
      const objectUrl = "blob:review-media-uncommitted";
      act(() => {
        root?.unmount();
        root = null;
      });
      return objectUrl;
    });

    root = createReviewCardSideRoot(container, "![Diagram](fcasset:image-asset)", 0);

    await vi.waitFor(() => {
      expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:review-media-uncommitted");
    });
    expect(container.querySelector(".review-markdown-media-image")).toBeNull();
  });

  it("does not render a previous managed image when the markdown reference changes at the same position", async () => {
    const firstImageBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const secondImageBlob = new Blob([new Uint8Array([4, 5, 6, 7])], { type: "image/png" });
    const firstMediaAsset = makeMediaAsset("first-image-asset", "image/png", imageSha256, firstImageBlob.size);
    const secondMediaAsset = makeMediaAsset("second-image-asset", "image/png", refreshedSha256, secondImageBlob.size);
    const secondMediaAssetDeferred = createDeferred<MediaAsset | null>();
    const cacheRecords = new Map<string, MediaBlobCacheRecord>([
      [firstMediaAsset.sha256, makeCacheRecord(firstMediaAsset, firstImageBlob)],
      [secondMediaAsset.sha256, makeCacheRecord(secondMediaAsset, secondImageBlob)],
    ]);
    mediaMocks.loadMediaAssetRecordMock.mockImplementation(async (_workspaceId: string, mediaAssetId: string): Promise<MediaAsset | null> => {
      if (mediaAssetId === firstMediaAsset.mediaAssetId) {
        return firstMediaAsset;
      }

      if (mediaAssetId === secondMediaAsset.mediaAssetId) {
        return secondMediaAssetDeferred.promise;
      }

      return null;
    });
    mediaMocks.loadMediaBlobCacheRecordMock.mockImplementation(async (sha256: string): Promise<MediaBlobCacheRecord | null> => {
      return cacheRecords.get(sha256) ?? null;
    });

    root = createReviewCardSideRoot(container, "![First](fcasset:first-image-asset)", 0);

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-image")).not.toBeNull();
    });

    const initialImage = container.querySelector(".review-markdown-media-image");
    if (!(initialImage instanceof HTMLImageElement)) {
      throw new Error("Managed image was not rendered");
    }
    const initialSrc = initialImage.getAttribute("src");
    expect(initialSrc).toBe("blob:review-media-1");
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);

    renderReviewCardSide(root, "![Second](fcasset:second-image-asset)", 0);

    expect(container.querySelector(".review-markdown-media-image")).toBeNull();
    expect(container.querySelector(".review-markdown-media-image-loading")?.getAttribute("data-fcasset-id")).toBe("second-image-asset");
    expect(revokeObjectURLMock).toHaveBeenCalledWith(initialSrc);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => {
      expect(mediaMocks.loadMediaAssetRecordMock).toHaveBeenCalledWith("workspace-1", "second-image-asset");
    });
    await act(async () => {
      secondMediaAssetDeferred.resolve(secondMediaAsset);
      await secondMediaAssetDeferred.promise;
    });

    await vi.waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalledTimes(2);
    });
    const refreshedImage = container.querySelector(".review-markdown-media-image");
    if (!(refreshedImage instanceof HTMLImageElement)) {
      throw new Error("Updated managed image was not rendered");
    }
    expect(refreshedImage.getAttribute("src")).toBe("blob:review-media-2");
  });

  it("creates a new managed image object URL when refreshed media identity changes", async () => {
    const imageBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const refreshedImageBlob = new Blob([new Uint8Array([4, 5, 6, 7])], { type: "image/png" });
    const mediaAsset = makeMediaAsset("image-asset", "image/png", imageSha256, imageBlob.size);
    const refreshedMediaAsset = makeMediaAsset("image-asset", "image/png", refreshedSha256, refreshedImageBlob.size);
    const cacheRecords = new Map<string, MediaBlobCacheRecord>([
      [mediaAsset.sha256, makeCacheRecord(mediaAsset, imageBlob)],
      [refreshedMediaAsset.sha256, makeCacheRecord(refreshedMediaAsset, refreshedImageBlob)],
    ]);
    const refreshMediaAsset = createDeferred<MediaAsset | null>();
    mediaMocks.loadMediaAssetRecordMock
      .mockResolvedValueOnce(mediaAsset)
      .mockImplementation(async (_workspaceId: string, _mediaAssetId: string): Promise<MediaAsset | null> => {
        return refreshMediaAsset.promise;
      });
    mediaMocks.loadMediaBlobCacheRecordMock.mockImplementation(async (sha256: string): Promise<MediaBlobCacheRecord | null> => {
      return cacheRecords.get(sha256) ?? null;
    });

    root = createReviewCardSideRoot(container, "![Diagram](fcasset:image-asset)", 0);

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-image")).not.toBeNull();
    });

    const initialImage = container.querySelector(".review-markdown-media-image");
    if (!(initialImage instanceof HTMLImageElement)) {
      throw new Error("Managed image was not rendered");
    }
    const initialSrc = initialImage.getAttribute("src");
    expect(initialSrc).toBe("blob:review-media-1");
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);

    let releasedAfterNewImageCommit = false;
    revokeObjectURLMock.mockImplementation((url: string): void => {
      if (url !== initialSrc) {
        return;
      }

      const imageAtRelease = container.querySelector(".review-markdown-media-image");
      if (!(imageAtRelease instanceof HTMLImageElement)) {
        throw new Error("Managed image was not rendered when the previous URL was released");
      }
      expect(imageAtRelease.getAttribute("src")).toBe("blob:review-media-2");
      releasedAfterNewImageCommit = true;
    });

    renderReviewCardSide(root, "![Diagram](fcasset:image-asset)", 1);

    await vi.waitFor(() => {
      expect(mediaMocks.loadMediaAssetRecordMock).toHaveBeenCalledTimes(2);
    });
    const refreshingImage = container.querySelector(".review-markdown-media-image");
    if (!(refreshingImage instanceof HTMLImageElement)) {
      throw new Error("Managed image was not rendered during refresh");
    }
    expect(refreshingImage.getAttribute("src")).toBe(initialSrc);
    expect(container.querySelector(".review-markdown-media-loading")).toBeNull();

    await act(async () => {
      refreshMediaAsset.resolve(refreshedMediaAsset);
      await refreshMediaAsset.promise;
    });

    await vi.waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalledTimes(2);
    });
    const refreshedImage = container.querySelector(".review-markdown-media-image");
    if (!(refreshedImage instanceof HTMLImageElement)) {
      throw new Error("Managed image was not rendered after refreshed identity loaded");
    }
    expect(refreshedImage.getAttribute("src")).toBe("blob:review-media-2");
    expect(revokeObjectURLMock).toHaveBeenCalledWith(initialSrc);
    expect(releasedAfterNewImageCommit).toBe(true);
  });

  it("releases a previous managed image URL only after unavailable fallback renders", async () => {
    const imageBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const mediaAsset = makeMediaAsset("image-asset", "image/png", imageSha256, imageBlob.size);
    const cacheRecord = makeCacheRecord(mediaAsset, imageBlob);
    const refreshMediaAsset = createDeferred<MediaAsset | null>();
    mediaMocks.loadMediaAssetRecordMock
      .mockResolvedValueOnce(mediaAsset)
      .mockImplementation(async (_workspaceId: string, _mediaAssetId: string): Promise<MediaAsset | null> => {
        return refreshMediaAsset.promise;
      });
    mediaMocks.loadMediaBlobCacheRecordMock.mockResolvedValue(cacheRecord);

    root = createReviewCardSideRoot(container, "![Diagram](fcasset:image-asset)", 0);

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-image")).not.toBeNull();
    });

    const initialImage = container.querySelector(".review-markdown-media-image");
    if (!(initialImage instanceof HTMLImageElement)) {
      throw new Error("Managed image was not rendered");
    }
    const initialSrc = initialImage.getAttribute("src");
    expect(initialSrc).toBe("blob:review-media-1");
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);

    let releasedAfterFallbackCommit = false;
    revokeObjectURLMock.mockImplementation((url: string): void => {
      if (url !== initialSrc) {
        return;
      }

      expect(container.querySelector(".review-markdown-media-image")).toBeNull();
      expect(container.querySelector(".review-markdown-media-fallback")?.textContent).toBe("Media unavailable");
      releasedAfterFallbackCommit = true;
    });

    renderReviewCardSide(root, "![Diagram](fcasset:image-asset)", 1);

    await vi.waitFor(() => {
      expect(mediaMocks.loadMediaAssetRecordMock).toHaveBeenCalledTimes(2);
    });
    const refreshingImage = container.querySelector(".review-markdown-media-image");
    if (!(refreshingImage instanceof HTMLImageElement)) {
      throw new Error("Managed image was not rendered during refresh");
    }
    expect(refreshingImage.getAttribute("src")).toBe(initialSrc);
    expect(revokeObjectURLMock).not.toHaveBeenCalled();

    await act(async () => {
      refreshMediaAsset.resolve(null);
      await refreshMediaAsset.promise;
    });

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-fallback")?.textContent).toBe("Media unavailable");
    });
    expect(revokeObjectURLMock).toHaveBeenCalledWith(initialSrc);
    expect(releasedAfterFallbackCommit).toBe(true);
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

    root = createReviewCardSideRoot(container, [
      "![First](fcasset:image-asset)",
      "![Second](fcasset:image-copy-asset)",
    ].join("\n\n"), 0);

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

    root = createReviewCardSideRoot(container, "![Large](fcasset:large-image-asset)", 0);

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
    root = createReviewCardSideRoot(container, "![External](https://example.test/image.png)", 0);

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

    root = createReviewCardSideRoot(container, "![Missing](fcasset:missing-asset)", 0);

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

    root = createReviewCardSideRoot(container, "![Refresh](fcasset:refresh-asset)", 0);

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

    root = createReviewCardSideRoot(container, "![Corrupt](fcasset:corrupt-asset)", 0);

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

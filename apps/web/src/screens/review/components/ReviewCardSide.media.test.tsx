// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { createStorageMock } from "../../../api/ApiTestSupport";
import type { MediaAsset } from "../../../types";
import { ReviewCardSide } from "./ReviewCardSide";

const mediaMocks = vi.hoisted(() => ({
  loadMediaAssetDownloadUrlMock: vi.fn(),
  loadMediaAssetRecordMock: vi.fn(),
}));

vi.mock("../../../api", () => ({
  loadMediaAssetDownloadUrl: mediaMocks.loadMediaAssetDownloadUrlMock,
}));

vi.mock("../../../localDb/mediaAssets", () => ({
  loadMediaAssetRecord: mediaMocks.loadMediaAssetRecordMock,
}));

function makeMediaAsset(mediaAssetId: string, mimeType: string): MediaAsset {
  return {
    mediaAssetId,
    workspaceId: "workspace-1",
    mimeType,
    sizeBytes: 128,
    sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
    storageKey: `media-assets/workspaces/workspace-1/assets/${mediaAssetId}/5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8`,
    sourceUrl: null,
    createdAt: "2026-03-10T09:00:00.000Z",
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByReplicaId: "device-1",
    lastOperationId: `operation-${mediaAssetId}`,
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
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
  let root: ReactDOM.Root | null;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = null;
    mediaMocks.loadMediaAssetDownloadUrlMock.mockReset();
    mediaMocks.loadMediaAssetRecordMock.mockReset();
  });

  afterEach(() => {
    if (root !== null) {
      act(() => {
        root?.unmount();
      });
    }
    container.remove();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders managed image, audio, video, and generic attachments from fcasset Markdown", async () => {
    const mediaAssets = new Map<string, MediaAsset>([
      ["image-asset", makeMediaAsset("image-asset", "image/png")],
      ["audio-asset", makeMediaAsset("audio-asset", "audio/mpeg")],
      ["video-asset", makeMediaAsset("video-asset", "video/mp4")],
      ["file-asset", makeMediaAsset("file-asset", "application/pdf")],
    ]);
    mediaMocks.loadMediaAssetRecordMock.mockImplementation(async (_workspaceId: string, mediaAssetId: string): Promise<MediaAsset | null> => {
      return mediaAssets.get(mediaAssetId) ?? null;
    });
    mediaMocks.loadMediaAssetDownloadUrlMock.mockImplementation(async (_workspaceId: string, mediaAssetId: string) => {
      const mediaAsset = mediaAssets.get(mediaAssetId);
      if (mediaAsset === undefined) {
        throw new Error(`Missing test media asset: ${mediaAssetId}`);
      }

      return {
        mediaAsset,
        download: {
          method: "GET" as const,
          url: `https://media.example.test/${mediaAssetId}`,
          expiresAt: "2026-03-10T10:00:00.000Z",
        },
      };
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
    expect(image.src).toBe("https://media.example.test/image-asset");
    expect(container.querySelector("audio.review-markdown-media-control")?.getAttribute("src")).toBe("https://media.example.test/audio-asset");
    expect(container.querySelector("video.review-markdown-media-control")?.getAttribute("src")).toBe("https://media.example.test/video-asset");
    expect(container.querySelector("a.review-markdown-media-attachment")?.getAttribute("href")).toBe("https://media.example.test/file-asset");
  });

  it("keeps external Markdown images on the normal image path", async () => {
    root = renderReviewCardSide(container, "![External](https://example.test/image.png)");

    await vi.waitFor(() => {
      expect(container.querySelector("img.review-markdown-img")).not.toBeNull();
    });

    expect(mediaMocks.loadMediaAssetRecordMock).not.toHaveBeenCalled();
    expect(mediaMocks.loadMediaAssetDownloadUrlMock).not.toHaveBeenCalled();
  });

  it("renders a stable fallback for missing managed media", async () => {
    mediaMocks.loadMediaAssetRecordMock.mockResolvedValue(null);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => undefined);

    root = renderReviewCardSide(container, "![Missing](fcasset:missing-asset)");

    await vi.waitFor(() => {
      expect(container.querySelector(".review-markdown-media-fallback")?.textContent).toBe("Media unavailable");
    });
    expect(mediaMocks.loadMediaAssetDownloadUrlMock).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

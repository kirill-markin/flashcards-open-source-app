import {
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { defaultUrlTransform } from "react-markdown";
import { loadMediaAssetDownloadUrl } from "../../../api";
import { useI18n } from "../../../i18n";
import { loadMediaAssetRecord } from "../../../localDb/mediaAssets";
import type { MediaAsset } from "../../../types";

const FCASSET_URL_PREFIX = "fcasset:";

type ManagedMediaKind = "image" | "audio" | "video" | "attachment";
type ManagedMediaLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable"; mediaAsset: MediaAsset | null }>
  | Readonly<{ status: "ready"; mediaAsset: MediaAsset; url: string }>;

export function parseManagedMediaAssetId(url: string | null | undefined): string | null {
  if (url === null || url === undefined) {
    return null;
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.toLowerCase().startsWith(FCASSET_URL_PREFIX) === false) {
    return null;
  }

  const rawReference = trimmedUrl.slice(FCASSET_URL_PREFIX.length).replace(/^\/+/, "");
  const mediaAssetId = rawReference.split(/[?#]/, 1)[0]?.trim() ?? "";
  return mediaAssetId === "" ? null : mediaAssetId;
}

export function reviewMarkdownUrlTransform(url: string): string {
  return parseManagedMediaAssetId(url) === null ? defaultUrlTransform(url) : url;
}

function readErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim() !== "") {
    return error.name;
  }

  return typeof error;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return String(error);
}

function warnManagedMediaUnavailable(workspaceId: string, mediaAssetId: string, error: unknown): void {
  console.warn("Managed media download unavailable", {
    workspaceId,
    mediaAssetId,
    errorName: readErrorName(error),
    errorMessage: readErrorMessage(error),
  });
}

function classifyManagedMediaKind(mimeType: string): ManagedMediaKind {
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.startsWith("image/")) {
    return "image";
  }

  if (normalizedMimeType.startsWith("audio/")) {
    return "audio";
  }

  if (normalizedMimeType.startsWith("video/")) {
    return "video";
  }

  return "attachment";
}

function resolveManagedMediaLabel(
  mediaAsset: MediaAsset,
  explicitLabel: string,
  fallbackLabel: string,
): string {
  const trimmedExplicitLabel = explicitLabel.trim();
  if (trimmedExplicitLabel !== "") {
    return trimmedExplicitLabel;
  }

  if (mediaAsset.sourceUrl !== null) {
    try {
      const sourceUrl = new URL(mediaAsset.sourceUrl);
      const fileName = sourceUrl.pathname.split("/").filter((part) => part !== "").at(-1) ?? "";
      if (fileName !== "") {
        return decodeURIComponent(fileName);
      }
    } catch {
      return fallbackLabel;
    }
  }

  return fallbackLabel;
}

function readTextFromReactNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(readTextFromReactNode).join("");
  }

  return "";
}

function ManagedMediaFallback(props: Readonly<{
  mediaAssetId: string;
  message: string;
}>): ReactElement {
  const { mediaAssetId, message } = props;

  return (
    <span
      className="review-markdown-managed-media review-markdown-media-fallback"
      data-fcasset-id={mediaAssetId}
      role="note"
    >
      {message}
    </span>
  );
}

export function ManagedMediaReference(props: Readonly<{
  altText: string;
  children: ReactNode;
  localReadVersion: number;
  mediaAssetId: string;
  workspaceId: string | null;
}>): ReactElement {
  const {
    altText,
    children,
    localReadVersion,
    mediaAssetId,
    workspaceId,
  } = props;
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<ManagedMediaLoadState>({ status: "loading" });

  useEffect(() => {
    let isCancelled = false;

    async function loadManagedMedia(): Promise<void> {
      if (workspaceId === null) {
        setLoadState({ status: "unavailable", mediaAsset: null });
        return;
      }

      setLoadState({ status: "loading" });
      let mediaAsset: MediaAsset | null;
      try {
        mediaAsset = await loadMediaAssetRecord(workspaceId, mediaAssetId);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        warnManagedMediaUnavailable(workspaceId, mediaAssetId, error);
        setLoadState({ status: "unavailable", mediaAsset: null });
        return;
      }

      if (isCancelled) {
        return;
      }

      if (mediaAsset === null || mediaAsset.deletedAt !== null) {
        setLoadState({ status: "unavailable", mediaAsset });
        return;
      }

      try {
        const downloadResult = await loadMediaAssetDownloadUrl(workspaceId, mediaAssetId);
        if (isCancelled) {
          return;
        }

        setLoadState({
          status: "ready",
          mediaAsset: downloadResult.mediaAsset,
          url: downloadResult.download.url,
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        warnManagedMediaUnavailable(workspaceId, mediaAssetId, error);
        setLoadState({ status: "unavailable", mediaAsset });
      }
    }

    void loadManagedMedia();

    return () => {
      isCancelled = true;
    };
  }, [localReadVersion, mediaAssetId, workspaceId]);

  if (loadState.status === "loading") {
    return (
      <span
        className="review-markdown-managed-media review-markdown-media-loading"
        data-fcasset-id={mediaAssetId}
        aria-busy="true"
      >
        {t("reviewScreen.media.loading")}
      </span>
    );
  }

  if (loadState.status === "unavailable") {
    return (
      <ManagedMediaFallback
        mediaAssetId={mediaAssetId}
        message={t("reviewScreen.media.unavailable")}
      />
    );
  }

  const mediaKind = classifyManagedMediaKind(loadState.mediaAsset.mimeType);
  const childrenText = readTextFromReactNode(children);
  const fallbackLabel = mediaKind === "audio"
    ? t("reviewScreen.media.audioLabel")
    : mediaKind === "video"
      ? t("reviewScreen.media.videoLabel")
      : mediaKind === "image"
        ? t("reviewScreen.media.imageAlt")
        : t("reviewScreen.media.attachmentLabel");
  const label = resolveManagedMediaLabel(loadState.mediaAsset, childrenText, fallbackLabel);

  if (mediaKind === "image") {
    return (
      <img
        className="review-markdown-media-image"
        src={loadState.url}
        alt={altText.trim() === "" ? t("reviewScreen.media.imageAlt") : altText}
        loading="lazy"
        decoding="async"
      />
    );
  }

  if (mediaKind === "audio") {
    return (
      <span className="review-markdown-managed-media review-markdown-media-audio" data-fcasset-id={mediaAssetId}>
        <span className="review-markdown-media-label">{label}</span>
        <audio className="review-markdown-media-control" src={loadState.url} controls preload="metadata" aria-label={label} />
      </span>
    );
  }

  if (mediaKind === "video") {
    return (
      <span className="review-markdown-managed-media review-markdown-media-video" data-fcasset-id={mediaAssetId}>
        <span className="review-markdown-media-label">{label}</span>
        <video className="review-markdown-media-control" src={loadState.url} controls preload="metadata" aria-label={label} />
      </span>
    );
  }

  return (
    <a
      className="review-markdown-managed-media review-markdown-media-attachment"
      href={loadState.url}
      target="_blank"
      rel="noreferrer"
      data-fcasset-id={mediaAssetId}
    >
      {label}
    </a>
  );
}

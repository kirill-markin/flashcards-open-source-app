import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../../../../appError/AppErrorContext";
import { useI18n } from "../../../../../i18n";
import type { MediaBlobCacheRecord } from "../../../../../localDb/mediaTransfers";
import type { ManagedMediaReferenceState } from "../../../../../media/managedMediaMarkdown";
import type { MediaAsset } from "../../../../../types";
import {
  acquireManagedMediaObjectUrl,
  createManagedMediaObjectUrlKey,
  releaseManagedMediaObjectUrl,
  type ManagedMediaObjectUrlLease,
} from "./objectUrlLease";
import {
  decodeLoadedManagedImage,
  getPreparedReviewImage,
  loadManagedImageObjectUrl,
  readManagedImageDimensions,
  type ManagedMediaImageDimensions,
  type PreparedReviewImage,
} from "./reviewPreparedImages";
import {
  loadManagedMediaBlob,
  readErrorMessage,
  readErrorName,
  waitForRecoveryGuardedManagedMediaPhase,
  type ManagedMediaBlobLoadResult,
} from "./verifiedBlobLoader";

type ManagedMediaKind = "image" | "audio" | "video" | "attachment";
type ManagedMediaReferencePresentation = "image" | "link";
type ManagedMediaLoadState =
  // Dimensions come from the local file once it is read, so the placeholder matches the image before decode.
  | Readonly<{ status: "loading"; imageDimensions: ManagedMediaImageDimensions | null }>
  | Readonly<{ status: "unavailable"; mediaAsset: MediaAsset | null }>
  | Readonly<{
    imageDimensions: ManagedMediaImageDimensions | null;
    status: "ready";
    mediaAsset: MediaAsset;
    objectUrlLease: ManagedMediaObjectUrlLease;
    url: string;
  }>;
type ManagedMediaObjectUrlRetention = Readonly<{
  isAcquiredLease: boolean;
  objectUrlLease: ManagedMediaObjectUrlLease;
}>;

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

function createManagedImageStyle(imageDimensions: ManagedMediaImageDimensions | null): CSSProperties | undefined {
  if (imageDimensions === null) {
    return undefined;
  }

  return {
    aspectRatio: `${imageDimensions.width} / ${imageDimensions.height}`,
  };
}

function createPreparedManagedMediaLoadState(preparedImage: PreparedReviewImage): ManagedMediaLoadState {
  return {
    imageDimensions: preparedImage.imageDimensions,
    status: "ready",
    mediaAsset: preparedImage.mediaAsset,
    objectUrlLease: preparedImage.objectUrlLease,
    url: preparedImage.objectUrlLease.url,
  };
}

function isReadyManagedMediaReference(
  loadState: ManagedMediaLoadState,
  workspaceId: string,
  mediaAssetId: string,
): boolean {
  return loadState.status === "ready"
    && loadState.mediaAsset.workspaceId === workspaceId
    && loadState.mediaAsset.mediaAssetId === mediaAssetId;
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

function GeneratedImagePlaceholder(props: Readonly<{
  label: string;
  mediaAssetId: string;
  state: Exclude<ManagedMediaReferenceState, "ready">;
}>): ReactElement {
  const { label, mediaAssetId, state } = props;
  const { t } = useI18n();
  const isPending = state === "pending";

  return (
    <span
      className="review-markdown-managed-media review-markdown-media-image-placeholder"
      data-fcasset-id={mediaAssetId}
      data-state={state}
      aria-busy={isPending ? "true" : undefined}
      aria-label={t(
        isPending
          ? "reviewScreen.media.imagePendingAccessible"
          : "reviewScreen.media.imageFailedAccessible",
        { label },
      )}
      role={isPending ? "status" : "alert"}
    >
      {isPending ? null : (
        <svg
          className="review-markdown-media-image-placeholder-icon"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path d="M12 8V13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M12 16.5H12.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M10.2 4.9L3.5 16.5C2.8 17.7 3.7 19.2 5.1 19.2H18.9C20.3 19.2 21.2 17.7 20.5 16.5L13.8 4.9C13 3.7 11 3.7 10.2 4.9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      )}
      <span className="review-markdown-media-image-placeholder-copy">
        {t(isPending ? "reviewScreen.media.imagePending" : "reviewScreen.media.imageFailed")}
      </span>
    </span>
  );
}

export function ManagedMediaReference(props: Readonly<{
  altText: string;
  children: ReactNode;
  /** The ready image's alt when `altText` is blank; empty marks the image decorative. */
  emptyImageAltText: string;
  localReadVersion: number;
  mediaAssetId: string;
  referencePresentation: ManagedMediaReferencePresentation;
  referenceState: ManagedMediaReferenceState;
  workspaceId: string | null;
}>): ReactElement {
  const {
    altText,
    children,
    emptyImageAltText,
    localReadVersion,
    mediaAssetId,
    referencePresentation,
    referenceState,
    workspaceId,
  } = props;
  const { t } = useI18n();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  // An image prepared before this card side mounted renders ready on the first frame:
  // docs/fsrs-scheduling-logic.md#non-blocking-review
  const [initialPreparedImage] = useState<PreparedReviewImage | null>(() => (
    referenceState === "ready" && workspaceId !== null
      ? getPreparedReviewImage(workspaceId, mediaAssetId)
      : null
  ));
  const [loadState, setLoadState] = useState<ManagedMediaLoadState>(() => (
    initialPreparedImage === null
      ? { status: "loading", imageDimensions: null }
      : createPreparedManagedMediaLoadState(initialPreparedImage)
  ));
  const loadStateRef = useRef<ManagedMediaLoadState>(loadState);
  // Leases acquired by a loader run and published into loadState but not yet adopted by a committed render, oldest first.
  const unadoptedObjectUrlLeasesRef = useRef<ReadonlyArray<ManagedMediaObjectUrlLease>>([]);

  function updateLoadState(nextLoadState: ManagedMediaLoadState): void {
    loadStateRef.current = nextLoadState;
    setLoadState(nextLoadState);
  }

  function retainObjectUrlForReadyMedia(
    currentLoadState: ManagedMediaLoadState,
    mediaAsset: MediaAsset,
    cacheRecord: MediaBlobCacheRecord,
  ): ManagedMediaObjectUrlRetention {
    const nextKey = createManagedMediaObjectUrlKey(mediaAsset);
    if (currentLoadState.status === "ready" && currentLoadState.objectUrlLease.key === nextKey) {
      return {
        isAcquiredLease: false,
        objectUrlLease: currentLoadState.objectUrlLease,
      };
    }

    return {
      isAcquiredLease: true,
      objectUrlLease: acquireManagedMediaObjectUrl(mediaAsset, cacheRecord.blob),
    };
  }

  const committedObjectUrlLease = referenceState === "ready" && loadState.status === "ready"
    ? loadState.objectUrlLease
    : null;

  // The prepared lease is borrowed from reviewPreparedImages. A layout effect takes this component's own
  // reference before the review data layer's passive effects can release the prepared one.
  useLayoutEffect(() => {
    if (initialPreparedImage === null) {
      return undefined;
    }

    const ownObjectUrlLease = acquireManagedMediaObjectUrl(initialPreparedImage.mediaAsset, initialPreparedImage.blob);
    if (ownObjectUrlLease.url !== initialPreparedImage.objectUrlLease.url) {
      // The prepared URL was revoked between render and commit; load through the normal path instead.
      updateLoadState({ status: "loading", imageDimensions: null });
    }

    return () => {
      releaseManagedMediaObjectUrl(ownObjectUrlLease);
    };
  }, [initialPreparedImage]);

  useEffect(() => {
    if (committedObjectUrlLease === null || committedObjectUrlLease === initialPreparedImage?.objectUrlLease) {
      return undefined;
    }

    const unadoptedLeases = unadoptedObjectUrlLeasesRef.current;
    const adoptedIndex = unadoptedLeases.indexOf(committedObjectUrlLease);
    if (adoptedIndex === -1) {
      throw new Error(`Managed media object URL adoption failed: committed lease was not published for key=${committedObjectUrlLease.key}`);
    }

    // Leases published before the committed one were superseded before any render committed them.
    unadoptedObjectUrlLeasesRef.current = unadoptedLeases.slice(adoptedIndex + 1);
    unadoptedLeases.slice(0, adoptedIndex).forEach(releaseManagedMediaObjectUrl);

    return () => {
      releaseManagedMediaObjectUrl(committedObjectUrlLease);
    };
  }, [committedObjectUrlLease, initialPreparedImage]);

  useEffect(() => {
    return () => {
      unadoptedObjectUrlLeasesRef.current.forEach(releaseManagedMediaObjectUrl);
      unadoptedObjectUrlLeasesRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (referenceState !== "ready") {
      return undefined;
    }

    let isCancelled = false;
    let provisionalObjectUrlLease: ManagedMediaObjectUrlLease | null = null;

    function releaseProvisionalObjectUrlLease(): void {
      if (provisionalObjectUrlLease === null) {
        return;
      }

      releaseManagedMediaObjectUrl(provisionalObjectUrlLease);
      provisionalObjectUrlLease = null;
    }

    async function loadManagedMedia(): Promise<void> {
      try {
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error);
        return;
      }

      if (workspaceId === null) {
        updateLoadState({ status: "unavailable", mediaAsset: null });
        return;
      }

      if (isReadyManagedMediaReference(loadStateRef.current, workspaceId, mediaAssetId) === false) {
        updateLoadState({ status: "loading", imageDimensions: null });
      }

      let loadResult: ManagedMediaBlobLoadResult | null;
      try {
        loadResult = await waitForRecoveryGuardedManagedMediaPhase(
          () => loadManagedMediaBlob(
            workspaceId,
            mediaAssetId,
            indexedDbOpenRecoveryState,
          ),
          indexedDbOpenRecoveryState,
        );
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }
        if (isCancelled) {
          return;
        }

        warnManagedMediaUnavailable(workspaceId, mediaAssetId, error);
        updateLoadState({ status: "unavailable", mediaAsset: null });
        return;
      }

      if (isCancelled) {
        return;
      }

      if (loadResult === null) {
        updateLoadState({ status: "unavailable", mediaAsset: null });
        return;
      }

      let objectUrlRetention: ManagedMediaObjectUrlRetention;
      let imageDimensions: ManagedMediaImageDimensions | null = null;
      try {
        indexedDbOpenRecoveryState.throwIfFailed();
        const currentLoadState = loadStateRef.current;
        objectUrlRetention = retainObjectUrlForReadyMedia(currentLoadState, loadResult.mediaAsset, loadResult.cacheRecord);
        if (objectUrlRetention.isAcquiredLease) {
          provisionalObjectUrlLease = objectUrlRetention.objectUrlLease;
        }

        if (classifyManagedMediaKind(loadResult.mediaAsset.mimeType) === "image") {
          if (objectUrlRetention.isAcquiredLease) {
            const image = await waitForRecoveryGuardedManagedMediaPhase(
              () => loadManagedImageObjectUrl(
                objectUrlRetention.objectUrlLease.url,
                indexedDbOpenRecoveryState,
              ),
              indexedDbOpenRecoveryState,
            );
            indexedDbOpenRecoveryState.throwIfFailed();
            imageDimensions = readManagedImageDimensions(image);
            // Size the placeholder from the local file while it decodes: docs/fsrs-scheduling-logic.md#non-blocking-review
            if (isCancelled === false && loadStateRef.current.status === "loading") {
              updateLoadState({ status: "loading", imageDimensions });
            }
            await waitForRecoveryGuardedManagedMediaPhase(
              () => decodeLoadedManagedImage(image, indexedDbOpenRecoveryState),
              indexedDbOpenRecoveryState,
            );
            indexedDbOpenRecoveryState.throwIfFailed();
          } else {
            imageDimensions = currentLoadState.status === "ready"
              ? currentLoadState.imageDimensions
              : null;
          }
        }
        indexedDbOpenRecoveryState.throwIfFailed();
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          releaseProvisionalObjectUrlLease();
          return;
        }
        if (isCancelled) {
          releaseProvisionalObjectUrlLease();
          return;
        }

        releaseProvisionalObjectUrlLease();
        warnManagedMediaUnavailable(workspaceId, mediaAssetId, error);
        updateLoadState({ status: "unavailable", mediaAsset: loadResult.mediaAsset });
        return;
      }

      if (isCancelled) {
        releaseProvisionalObjectUrlLease();
        return;
      }
      if (provisionalObjectUrlLease !== null) {
        unadoptedObjectUrlLeasesRef.current = [...unadoptedObjectUrlLeasesRef.current, provisionalObjectUrlLease];
        provisionalObjectUrlLease = null;
      }
      updateLoadState({
        imageDimensions,
        status: "ready",
        mediaAsset: loadResult.mediaAsset,
        objectUrlLease: objectUrlRetention.objectUrlLease,
        url: objectUrlRetention.objectUrlLease.url,
      });
    }

    void loadManagedMedia();

    return () => {
      isCancelled = true;
      releaseProvisionalObjectUrlLease();
    };
  }, [indexedDbOpenRecoveryState, localReadVersion, mediaAssetId, referenceState, workspaceId]);

  const childrenText = readTextFromReactNode(children);
  if (referenceState !== "ready") {
    const trimmedAltText = altText.trim();
    const trimmedChildrenText = childrenText.trim();
    const label = trimmedAltText !== ""
      ? trimmedAltText
      : trimmedChildrenText !== ""
        ? trimmedChildrenText
        : t("reviewScreen.media.imageAlt");
    return (
      <GeneratedImagePlaceholder
        label={label}
        mediaAssetId={mediaAssetId}
        state={referenceState}
      />
    );
  }

  if (loadState.status === "loading") {
    if (referencePresentation === "image") {
      return (
        <span
          className="review-markdown-managed-media review-markdown-media-image-loading"
          data-fcasset-id={mediaAssetId}
          aria-busy="true"
          aria-label={t("reviewScreen.media.loading")}
          role="status"
          style={createManagedImageStyle(loadState.imageDimensions)}
        />
      );
    }

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
  const fallbackLabel = mediaKind === "audio"
    ? t("reviewScreen.media.audioLabel")
    : mediaKind === "video"
      ? t("reviewScreen.media.videoLabel")
      : mediaKind === "image"
        ? t("reviewScreen.media.imageAlt")
        : t("reviewScreen.media.attachmentLabel");
  const label = resolveManagedMediaLabel(loadState.mediaAsset, childrenText, fallbackLabel);

  if (mediaKind === "image") {
    // Ready images are already decoded, so a synchronous paint shows them on the first frame.
    return (
      <img
        className="review-markdown-media-image"
        src={loadState.url}
        alt={altText.trim() === "" ? emptyImageAltText : altText}
        loading="eager"
        decoding="sync"
        style={createManagedImageStyle(loadState.imageDimensions)}
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


import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { copiedFeedbackDurationMs } from "../../../../access/browserAccess";
import { useAppErrorDialog } from "../../../../appError/AppErrorContext";
import { useI18n } from "../../../../i18n";
import { reviewCopyShortcutKey } from "../../input/reviewShortcutKeys";
import { ReviewShortcutHint } from "../ReviewShortcutHint";
import { reviewSideMarkdownForClipboard } from "./reviewClipboardMarkdown";

export type ReviewCardCopyButtonHandle = Readonly<{
  copy: () => Promise<void>;
}>;

type ReviewCardCopyButtonProps = Readonly<{
  side: "front" | "back";
  sideLabel: string;
  sourceText: string;
  /** Set only on the side the copy shortcut acts on; it exposes `copy` and shows the shortcut hint. */
  shortcutHandleRef: RefObject<ReviewCardCopyButtonHandle | null> | null;
}>;

type CopyStatus = "idle" | "copying" | "copied" | "failed" | "unavailable";

export function ReviewCardCopyButton(props: ReviewCardCopyButtonProps): ReactElement {
  const { side, sideLabel, sourceText, shortcutHandleRef } = props;
  const { t } = useI18n();
  const { showCapturedTechnicalError } = useAppErrorDialog();
  const [status, setStatus] = useState<CopyStatus>("idle");
  const isMountedRef = useRef(false);
  const isCopyingRef = useRef(false);
  const ariaLabel = t("reviewScreen.copyAriaLabel", { side: sideLabel });
  const statusMessage = status === "copying"
    ? t("reviewScreen.copying")
    : status === "copied"
      ? t("reviewScreen.copied")
      : status === "unavailable"
        ? t("reviewScreen.copyUnavailable")
        : status === "failed" ? t("reviewScreen.copyFailed") : "";
  const hasFailed = status === "failed" || status === "unavailable";

  useLayoutEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (status !== "copied") {
      return;
    }
    const timeoutId = window.setTimeout(() => setStatus("idle"), copiedFeedbackDurationMs);
    return () => window.clearTimeout(timeoutId);
  }, [status]);

  async function copySide(): Promise<void> {
    if (isCopyingRef.current) {
      return;
    }
    isCopyingRef.current = true;
    setStatus("copying");
    try {
      if (typeof navigator.clipboard?.writeText !== "function") {
        setStatus("unavailable");
        return;
      }
      const text = reviewSideMarkdownForClipboard(sourceText, {
        image: t("reviewScreen.media.privateImage"),
        attachment: t("reviewScreen.media.privateAttachment"),
      });
      await navigator.clipboard.writeText(text);
      if (isMountedRef.current) {
        setStatus("copied");
      }
    } catch (error) {
      if (isMountedRef.current) {
        setStatus("failed");
        showCapturedTechnicalError(error);
      }
    } finally {
      isCopyingRef.current = false;
    }
  }

  useImperativeHandle(shortcutHandleRef, () => ({ copy: copySide }));

  return (
    <div className="review-card-copy">
      <button
        type="button"
        className="review-card-copy-btn"
        aria-label={ariaLabel}
        aria-keyshortcuts={shortcutHandleRef === null ? undefined : reviewCopyShortcutKey}
        aria-disabled={status === "copying"}
        aria-busy={status === "copying"}
        title={statusMessage === "" ? ariaLabel : `${ariaLabel}: ${statusMessage}`}
        onClick={(event) => {
          event.stopPropagation();
          event.currentTarget.focus();
          void copySide();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        data-testid={`review-copy-${side}`}
        data-copy-status={status}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {status === "copied" ? (
            <path d="M5 12L10 17L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <>
              <path d="M8 8V5C8 3.9 8.9 3 10 3H19C20.1 3 21 3.9 21 5V14C21 15.1 20.1 16 19 16H16" stroke="currentColor" strokeWidth="1.7" />
              <rect x="3" y="8" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" />
            </>
          )}
        </svg>
        {shortcutHandleRef === null ? null : <ReviewShortcutHint keyLabel={reviewCopyShortcutKey} />}
      </button>
      <span
        className={hasFailed ? "review-card-copy-error" : "review-metadata-chip-accessible-label"}
        role={hasFailed ? "alert" : "status"}
        aria-atomic="true"
        data-testid={`review-copy-${side}-status`}
      >
        {statusMessage}
      </span>
    </div>
  );
}

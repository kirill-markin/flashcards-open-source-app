import { useEffect, useRef, type MouseEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import type { AppErrorAction, AppErrorPresentation } from "./appErrorPresentation";

export type AppErrorDialogProps = Readonly<{
  presentation: AppErrorPresentation | null;
  onAction: (action: AppErrorAction) => void;
  onDismiss: () => void;
}>;

const appErrorDialogFocusableSelector: string = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(dialog: HTMLElement): ReadonlyArray<HTMLElement> {
  return Array.from(dialog.querySelectorAll<HTMLElement>(appErrorDialogFocusableSelector))
    .filter((element) => element.tabIndex >= 0 && element.getAttribute("aria-hidden") !== "true");
}

function trapFocusInsideDialog(event: KeyboardEvent, dialog: HTMLElement): void {
  const focusableElements = getFocusableElements(dialog);
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (firstElement === undefined || lastElement === undefined) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement) || dialog.contains(activeElement) === false) {
    event.preventDefault();
    (event.shiftKey ? lastElement : firstElement).focus();
    return;
  }

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
    return;
  }

  if (event.shiftKey === false && activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

export function AppErrorDialog(props: AppErrorDialogProps): ReactElement | null {
  const { presentation, onAction, onDismiss } = props;
  const { t } = useI18n();
  const initialFocusButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (presentation === null) {
      return undefined;
    }

    const isRecoveryPresentation = presentation.kind === "indexeddb-reload-recovery";
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    initialFocusButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isRecoveryPresentation) {
        event.stopImmediatePropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          return;
        }
        if (event.key === "Tab" && dialogRef.current !== null) {
          trapFocusInsideDialog(event, dialogRef.current);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onDismiss();
        return;
      }

      if (event.key === "Tab") {
        event.stopImmediatePropagation();
        if (dialogRef.current !== null) {
          trapFocusInsideDialog(event, dialogRef.current);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return (): void => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (isRecoveryPresentation === false) {
        previousFocusRef.current?.focus();
      }
      previousFocusRef.current = null;
    };
  }, [onDismiss, presentation]);

  function dismissFromBackdrop(event: MouseEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (presentation?.kind === "indexeddb-reload-recovery") {
      event.preventDefault();
      initialFocusButtonRef.current?.focus();
      return;
    }

    if (presentation !== null) {
      onDismiss();
    }
  }

  if (presentation === null || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="app-error-dialog-backdrop" onMouseDown={dismissFromBackdrop}>
      <section
        ref={dialogRef}
        className="panel app-error-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-error-dialog-title"
        aria-describedby={presentation.kind === "indexeddb-reload-recovery"
          ? "app-error-dialog-message app-error-dialog-guidance"
          : "app-error-dialog-message"}
        tabIndex={-1}
        data-testid="app-error-dialog"
      >
        <div className="cell-stack">
          <h2 id="app-error-dialog-title" className="panel-subtitle">{presentation.title}</h2>
          <p id="app-error-dialog-message" className="subtitle">{presentation.message}</p>
          {presentation.kind === "indexeddb-reload-recovery" ? (
            <p id="app-error-dialog-guidance" className="subtitle">{presentation.guidance}</p>
          ) : null}
        </div>

        <details className="app-error-dialog-details" data-testid="app-error-dialog-details">
          <summary>{t("appError.technicalError.detailsToggle")}</summary>
          <pre>{presentation.technicalDetails}</pre>
        </details>

        <div className="screen-actions">
          {presentation.kind === "indexeddb-reload-recovery" ? (
            <button
              ref={initialFocusButtonRef}
              type="button"
              className="primary-btn"
              onClick={() => onAction(presentation.action)}
              data-testid="app-error-dialog-reload"
            >
              {presentation.action.label}
            </button>
          ) : (
            <button
              ref={initialFocusButtonRef}
              type="button"
              className="primary-btn"
              onClick={() => onAction(presentation.action)}
              data-testid="app-error-dialog-close"
            >
              {presentation.action.label}
            </button>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

import { useEffect, useRef, type MouseEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import type { AppErrorPresentation } from "./appErrorPresentation";

export type AppErrorDialogProps = Readonly<{
  presentation: AppErrorPresentation | null;
  onDismiss: () => void;
}>;

export function AppErrorDialog(props: AppErrorDialogProps): ReactElement | null {
  const { presentation, onDismiss } = props;
  const { t } = useI18n();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (presentation === null) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return (): void => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [onDismiss, presentation]);

  function dismissFromBackdrop(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) {
      onDismiss();
    }
  }

  if (presentation === null || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="app-error-dialog-backdrop" onMouseDown={dismissFromBackdrop}>
      <section
        className="panel app-error-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-error-dialog-title"
        aria-describedby="app-error-dialog-message"
        data-testid="app-error-dialog"
      >
        <div className="cell-stack">
          <h2 id="app-error-dialog-title" className="panel-subtitle">{presentation.title}</h2>
          <p id="app-error-dialog-message" className="subtitle">{presentation.message}</p>
        </div>

        <details className="app-error-dialog-details" data-testid="app-error-dialog-details">
          <summary>{t("appError.technicalError.detailsToggle")}</summary>
          <pre>{presentation.technicalDetails}</pre>
        </details>

        <div className="screen-actions">
          <button
            ref={closeButtonRef}
            type="button"
            className="primary-btn"
            onClick={onDismiss}
            data-testid="app-error-dialog-close"
          >
            {t("appError.technicalError.close")}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

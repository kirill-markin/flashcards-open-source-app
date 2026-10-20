import type { ReactElement, ReactNode } from "react";

export function CatalogImportConfirmPanel(props: Readonly<{
  children: ReactNode;
  description: string;
  confirmActionLabel: string;
  confirmingActionLabel: string;
  loadingLabel: string;
  retryLabel: string;
  isLoading: boolean;
  canConfirm: boolean;
  isConfirming: boolean;
  errorMessage: string;
  existingCopy: Readonly<{
    notice: string;
    actionLabel: string;
    isLoading: boolean;
    isDisabled: boolean;
    onStudy: () => void;
  }> | null;
  onConfirm: () => void;
  onRetry: (() => void) | null;
}>): ReactElement {
  const {
    children, description, confirmActionLabel, confirmingActionLabel, loadingLabel, retryLabel,
    isLoading, canConfirm, isConfirming, errorMessage, existingCopy, onConfirm, onRetry,
  } = props;
  return (
    <section className="content-card invite-panel" data-testid="catalog-import-confirm">
      {children}
      <p className="subtitle" data-testid={existingCopy === null ? undefined : "catalog-import-existing-copy-notice"}>
        {existingCopy?.notice ?? description}
      </p>
      {isLoading ? <p className="subtitle" aria-live="polite" data-testid="catalog-import-preview-loading">{loadingLabel}</p> : null}
      <div className="catalog-import-actions">
        {existingCopy === null ? null : (
          <button
            className="primary-btn" type="button" disabled={existingCopy.isDisabled}
            aria-busy={existingCopy.isLoading} data-testid="catalog-import-study-existing" onClick={existingCopy.onStudy}
          >
            {existingCopy.isLoading ? loadingLabel : existingCopy.actionLabel}
          </button>
        )}
        <button
          className={existingCopy === null ? "primary-btn" : "ghost-btn"} type="button"
          disabled={!canConfirm} aria-busy={isConfirming} data-testid="workspace-package-import-confirm-button" onClick={onConfirm}
        >
          {isConfirming ? confirmingActionLabel : confirmActionLabel}
        </button>
      </div>
      {errorMessage === "" ? null : <p className="error-banner" role="alert" data-testid="workspace-import-error">{errorMessage}</p>}
      {onRetry === null ? null : (
        <button className="ghost-btn" type="button" data-testid="catalog-import-preview-retry" onClick={onRetry}>{retryLabel}</button>
      )}
    </section>
  );
}

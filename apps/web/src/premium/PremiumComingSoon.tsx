import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { buildPresentationMessages } from "../appError/AppErrorContext";
import { buildAppErrorPresentation, type AppErrorPresentation } from "../appError/appErrorPresentation";
import { formatAiLimitReachedMessageForHeldUsage } from "../chat/shared/chatAiLimitPolicy";
import { useI18n } from "../i18n";
import { OwnOpenAIKeyEditor } from "../screens/settings/OwnOpenAIKeySettingsScreen";
import type { EntitlementSnapshot } from "../types/entitlement";
import { hasPremiumAccess, type PremiumRequest } from "./PremiumProvider";

type PremiumComingSoonProps = Readonly<{
  request: PremiumRequest;
  entitlement: EntitlementSnapshot | null;
  onDismiss: () => void;
}>;

export function PremiumComingSoon(props: PremiumComingSoonProps): ReactElement {
  const { request, entitlement, onDismiss } = props;
  const { t, formatDate, direction } = useI18n();
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [technicalError, setTechnicalError] = useState<AppErrorPresentation | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const isAiLimit = request.reason === "ai-limit";
  const showOffer = request.reason === "offer" || (entitlement !== null && !hasPremiumAccess(entitlement, 20));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return (): void => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  function showEditorTechnicalError(error: unknown): void {
    setTechnicalError(buildAppErrorPresentation(error, buildPresentationMessages(t)));
  }

  function returnFromEditor(): void {
    setIsEditingKey(false);
    setTechnicalError(null);
    closeRef.current?.focus();
  }

  return (
    <dialog
      ref={dialogRef}
      className="panel premium-dialog"
      dir={direction}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="premium-dialog"
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}
    >
      <div className="premium-header">
        <h2 id={titleId} className="title">
          {isEditingKey ? t("ownOpenAIKeySettings.title") : isAiLimit ? t("premium.limitTitle") : t("premium.title")}
        </h2>
        <button
          ref={closeRef}
          type="button"
          className="ghost-btn premium-close"
          aria-label={t("premium.close")}
          data-testid="premium-close"
          onClick={onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {isEditingKey ? (
        <>
          <p id={bodyId} className="subtitle">{t("ownOpenAIKeySettings.subtitle")}</p>
          <OwnOpenAIKeyEditor onCapturedTechnicalError={showEditorTechnicalError} />
          {technicalError === null ? null : (
            <details className="app-error-dialog-details" data-testid="premium-key-error-details">
              <summary>{t("appError.technicalError.detailsToggle")}</summary>
              <pre>{technicalError.technicalDetails}</pre>
            </details>
          )}
          <p className="subtitle">{t("premium.retryManually")}</p>
          <button type="button" className="primary-btn" data-testid="premium-key-done" onClick={returnFromEditor}>
            {t("premium.back")}
          </button>
        </>
      ) : (
        <>
          <p id={bodyId} className="subtitle">
            {request.reason === "ai-limit"
              ? formatAiLimitReachedMessageForHeldUsage({ aiUsage: request.aiUsage, t, formatDate })
              : entitlement === null && request.reason === "feature" ? t("premium.unknown") : t("premium.unavailable")}
          </p>
          {isAiLimit && showOffer ? (
            <div className="content-card content-card-section">
              <h3 className="panel-subtitle">{t("premium.title")}</h3>
              <p className="subtitle">{t("premium.unavailable")}</p>
            </div>
          ) : null}
          {isAiLimit ? (
            <>
              <p className="subtitle">{t("premium.retryManually")}</p>
              <button type="button" className="primary-btn" data-testid="premium-own-key" onClick={() => setIsEditingKey(true)}>
                {t("ownOpenAIKeySettings.title")}
              </button>
            </>
          ) : null}
        </>
      )}
    </dialog>
  );
}

import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { buildPresentationMessages } from "../appError/AppErrorContext";
import { buildAppErrorPresentation, type AppErrorPresentation } from "../appError/appErrorPresentation";
import { formatAiLimitReachedMessageForHeldUsage } from "../chat/shared/chatAiLimitPolicy";
import { useI18n } from "../i18n";
import { OwnOpenAIKeyEditor } from "../screens/settings/OwnOpenAIKeySettingsScreen";
import type { EntitlementSnapshot } from "../types/entitlement";
import { hasPremiumAccess, type PremiumRequest } from "./PremiumProvider";
import { StripeOfferContent } from "./StripeOfferContent";
import type { PaywallPresentation } from "./stripeIntent";
import { useStripeBilling } from "./useStripeBilling";

type PremiumOfferProps = Readonly<{
  request: PremiumRequest;
  entitlement: EntitlementSnapshot | null;
  presentation: PaywallPresentation | null;
  onVisible: () => void;
  onDismiss: () => void;
  onContinueFree: () => void;
  onChoosePremium: () => void;
}>;

export function PremiumOffer(props: PremiumOfferProps): ReactElement {
  const { request, entitlement, onDismiss } = props;
  const { t, formatDate, direction } = useI18n();
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [technicalError, setTechnicalError] = useState<AppErrorPresentation | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const continueFreeRef = useRef<HTMLButtonElement | null>(null);
  const premiumPurchaseRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const billing = useStripeBilling();
  const isPreview = request.reason !== "feature" && request.isTestPreview === true;
  const isPurchasing = !isPreview && billing.busy && billing.status === "opening";
  const isAiLimit = request.reason === "ai-limit";
  const showOffer = isPreview || (entitlement !== null && !hasPremiumAccess(entitlement, 20));
  const [headingBefore, headingEmphasis, headingAfter] = t("paywall.heading").split(/<em>|<\/em>/);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    props.onVisible();
    document.body.style.overflow = "hidden";
    return (): void => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  // Deliberately keyed to the view only: an offer that loads later never moves focus.
  useEffect(() => {
    const premiumPurchase = premiumPurchaseRef.current;
    const focusTarget = isEditingKey || !showOffer ? closeRef.current
      : premiumPurchase !== null && !premiumPurchase.disabled ? premiumPurchase : continueFreeRef.current;
    focusTarget?.focus();
  }, [isEditingKey, showOffer]);

  function showEditorTechnicalError(error: unknown): void {
    setTechnicalError(buildAppErrorPresentation(error, buildPresentationMessages(t)));
  }

  function returnFromEditor(): void {
    setIsEditingKey(false);
    setTechnicalError(null);
  }

  return (
    <dialog
      ref={dialogRef}
      className="panel premium-dialog"
      dir={direction}
      aria-labelledby={titleId}
      aria-describedby={isEditingKey || isAiLimit || (!isPreview && entitlement === null) ? bodyId : undefined}
      data-testid="premium-dialog"
      onCancel={(event) => { event.preventDefault(); if (!isPurchasing) onDismiss(); }}
    >
      <div className="premium-header">
        <div className="premium-brand">
          <img src="/icon.svg" alt="" width="28" height="28" />
          <span>{t("app.title")}</span>
        </div>
        {isEditingKey || !showOffer ? <button
          ref={closeRef}
          type="button"
          className="ghost-btn premium-close"
          aria-label={t("premium.close")}
          data-testid="premium-close"
          disabled={isPurchasing}
          onClick={onDismiss}
        >
          <span aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" focusable="false">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </span>
        </button> : null}
      </div>
      <h2 id={titleId} className="title premium-heading">
        {isEditingKey ? t("ownOpenAIKeySettings.title") : showOffer
          ? <>{headingBefore}<em>{headingEmphasis}</em>{headingAfter}</>
          : isAiLimit ? t("premium.limitTitle") : t("stripe.offer.title")}
      </h2>
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
          <p id={bodyId} className="subtitle" hidden={!isAiLimit && (isPreview || entitlement !== null)}>
            {request.reason === "ai-limit"
              ? formatAiLimitReachedMessageForHeldUsage({ aiUsage: request.aiUsage, t, formatDate })
              : entitlement === null ? t("premium.unknown") : null}
          </p>
          {showOffer ? <StripeOfferContent continuation={request.reason === "ai-limit" ? null : request.continuation ?? null}
            presentation={props.presentation} isPreview={isPreview} onContinueFree={props.onContinueFree}
            onChoosePremium={props.onChoosePremium} continueFreeRef={continueFreeRef} premiumPurchaseRef={premiumPurchaseRef} /> : null}
          {isAiLimit ? (
            <div className="premium-key-context">
              <p className="subtitle">{t("stripe.ownKey.explanation")}</p>
              <button type="button" className="ghost-btn" data-testid="premium-own-key" disabled={isPreview || isPurchasing} onClick={() => setIsEditingKey(true)}>
                {t("stripe.ownKey.action")}
              </button>
              <p className="subtitle">{t("premium.retryManually")}</p>
            </div>
          ) : null}
        </>
      )}
    </dialog>
  );
}

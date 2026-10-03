import type { ReactElement } from "react";
import { ApiError } from "../api";
import { buildPresentationMessages } from "../appError/AppErrorContext";
import { buildAppErrorPresentation } from "../appError/appErrorPresentation";
import { useI18n } from "../i18n";
import { useStripeBilling } from "./useStripeBilling";

export function StripeBillingFeedback(): ReactElement {
  const { t } = useI18n();
  const billing = useStripeBilling();
  const presentation = billing.error === null ? null : buildAppErrorPresentation(billing.error, buildPresentationMessages(t));
  const accountChanged = billing.error instanceof ApiError && ["STRIPE_IDENTITY_MISMATCH", "STRIPE_ACCOUNT_RETIRED", "SESSION_ACCOUNT_CHANGED"].includes(billing.error.code ?? "");
  return <div aria-live="polite" aria-busy={billing.busy} data-testid="stripe-feedback">
    {billing.status === "idle" ? null : <p className="subtitle" role="status" data-testid="stripe-status">
      {billing.status === "loading" ? t("common.loading") : t(`stripe.checkout.${billing.status}`)}
    </p>}
    {presentation === null ? null : <>
      <p className="error-banner" role="alert" data-testid="stripe-error">
        {t(accountChanged ? "stripe.subscription.accountChanged" : "stripe.subscription.unknown")}
      </p>
      <details className="app-error-dialog-details" data-testid="stripe-error-details">
        <summary>{t("appError.technicalError.detailsToggle")}</summary>
        <pre>{presentation.technicalDetails}</pre>
      </details>
    </>}
  </div>;
}

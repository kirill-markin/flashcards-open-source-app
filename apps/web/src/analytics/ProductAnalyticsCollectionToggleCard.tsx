import { useState, useSyncExternalStore, type ReactElement } from "react";
import { useI18n } from "../i18n";
import { isAnalyticsEnabledForCurrentRuntime, setProductAnalyticsCollection } from "./client";
import {
  isProductAnalyticsCollectionEnabled,
  subscribeToProductAnalyticsCollection,
} from "./productAnalyticsCollection";

export type ProductAnalyticsCollectionToggleCardProps = Readonly<{
  /**
   * Carries the answer to the account. The browser's own decision is already recorded and already in
   * force before this runs, so this is the second half of the write and never the first, and a
   * surface with no signed-in account resolves without writing anything. Rejecting shows this card's
   * error line, so a surface that must not report an analytics failure swallows its own.
   */
  persistAccountCollection: (isCollectionEnabled: boolean) => Promise<void>;
}>;

/**
 * The product-analytics off switch: the only control that stops collection outright, on every
 * surface it is offered on. Shared between the settings screen and the public-route panel for the
 * same reason the cookie switch is — the two must be able to disagree about nothing.
 *
 * It is not the cookie switch beside it and never reads its answer. This one decides whether
 * anything is measured; that one decides only whether what is measured carries this browser's
 * shared identifier, so a person who refused the cookie arrives here reading "on", which is what
 * they were told would happen.
 *
 * On by default, because the basis is legitimate interest rather than consent, and offered in every
 * region for the same reason the withdrawal switch is.
 *
 * Under the operator kill switch there is nothing left to turn off, so the switch is replaced by the
 * sentence saying so rather than left to record an answer that changes nothing.
 */
export function ProductAnalyticsCollectionToggleCard(
  props: ProductAnalyticsCollectionToggleCardProps,
): ReactElement {
  const { persistAccountCollection } = props;
  const { t } = useI18n();
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isCollectionEnabled = useSyncExternalStore(
    subscribeToProductAnalyticsCollection,
    isProductAnalyticsCollectionEnabled,
  );
  const isRuntimeEnabled = isAnalyticsEnabledForCurrentRuntime();

  async function changeProductAnalyticsCollection(nextEnabled: boolean): Promise<void> {
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      // The browser's answer takes effect first and unconditionally: an off switch that waited for a
      // network round trip would keep collecting while it waited, and keep collecting for good if it
      // failed.
      setProductAnalyticsCollection(nextEnabled);
      await persistAccountCollection(nextEnabled);
    } catch {
      // The switch shows what this browser actually stores, so a failed account write is reported
      // here rather than rolled back: the next verified session syncs the two.
      setErrorMessage(t("analyticsSettings.error"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <article
        className="content-card settings-toggle-card"
        data-testid="product-analytics-collection-card"
      >
        <div className="settings-nav-card-copy">
          <strong className="panel-subtitle">{t("analyticsSettings.collectionToggleTitle")}</strong>
          <p className="subtitle">
            {isRuntimeEnabled
              ? t("analyticsSettings.collectionToggleDescription")
              : t("analyticsSettings.unavailable")}
          </p>
        </div>
        {isRuntimeEnabled === false ? null : (
          <button
            className="settings-toggle-control"
            type="button"
            role="switch"
            aria-label={t("analyticsSettings.collectionToggleTitle")}
            aria-checked={isCollectionEnabled}
            disabled={isSubmitting}
            data-state={isCollectionEnabled ? "on" : "off"}
            data-testid="product-analytics-collection-toggle"
            onClick={() => void changeProductAnalyticsCollection(isCollectionEnabled === false)}
          >
            <span className="settings-toggle-track" aria-hidden="true">
              <span className="settings-toggle-thumb" />
            </span>
            <span className="settings-toggle-value">
              {isCollectionEnabled ? t("common.on") : t("common.off")}
            </span>
          </button>
        )}
      </article>
      {errorMessage === "" ? null : <p className="error-banner" role="alert">{errorMessage}</p>}
    </>
  );
}

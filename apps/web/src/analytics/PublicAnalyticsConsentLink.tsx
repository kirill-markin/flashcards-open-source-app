import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { useLocation } from "react-router";
import { updateAccountPreferences } from "../api";
import { AnchoredFloatingOverlay, useAnchoredFloatingOutsidePointerDismiss } from "../floating";
import { useI18n } from "../i18n";
import { isAuthenticatedAppPath } from "../routes";
import type { AnalyticsConsentChoice } from "../types";
import { AnalyticsConsentToggleCard } from "./AnalyticsConsentToggleCard";
import { readAnalyticsSessionOwnerId } from "./client";
import { isAwaitingAnalyticsConsentDecision, subscribeToAnalyticsConsent } from "./consent";

/**
 * Published on `:root` while the link is up, and read as bottom padding by the viewport-sized public
 * pages. Deliberately not the banner's property: the two never share the screen, so one name would
 * read as a shared reserve that is in fact only ever half occupied.
 */
const withdrawalHeightCustomProperty: string = "--analytics-consent-withdrawal-height";

const withdrawalOverlayViewportPaddingPx: number = 12;
const withdrawalOverlayOffsetPx: number = 8;
const withdrawalOverlayMaxWidthPx: number = 420;
const withdrawalOverlayMaxHeightPx: number = 420;

/**
 * Carries the answer to the account when this browser has a verified one, exactly as the banner does
 * from this same position above the app data provider. The owner is read from the analytics runtime
 * rather than from React state because there is no app data provider here to read it from, and it is
 * module-level runtime state that outlives the session layer unmounting: a person who signed in and
 * then reached a public route still has one, and without this write their withdrawal would be undone
 * by the account's stored answer at the next verified session.
 *
 * The account write is not awaited and its failure is swallowed rather than reported: the browser's
 * own decision is already recorded, the next verified session reconciles the two, and a visitor who
 * has no account at all must never be shown an analytics error.
 */
async function persistAccountConsentInBackground(decision: AnalyticsConsentChoice): Promise<void> {
  if (readAnalyticsSessionOwnerId() === null) {
    return;
  }

  void updateAccountPreferences({ analyticsConsent: decision }).catch((): void => undefined);
}

/**
 * The withdrawal control for a visitor who answered the banner on a public route and has no account.
 * Without it the only way back for that person is clearing browser storage, while the published
 * privacy policy describes withdrawal with no sign-in qualifier.
 *
 * A link in the corner opening the shared switch, rather than a route: `/settings/analytics` is
 * served by `AuthenticatedApp` and adding a second public route for the same screen would take the
 * settings screen away from the signed-in person it already serves, because a route declared above
 * `AuthenticatedApp` wins for everyone. Rendering the switch in place needs no route at all, which
 * is also why the public route list this reads stays the one `routes.ts` already publishes.
 *
 * Shown only once this browser is no longer waiting to be asked — meaning it stored an answer, or
 * it is somewhere that asks nobody. That is exactly the set of states in which there is something to
 * withdraw, and it keeps the pre-decision silence intact twice over: the link cannot appear while
 * the strip is still asking, so the two never compete for the same corner, and it never offers a
 * switch reading "on" to a browser whose question is still open.
 */
export function PublicAnalyticsConsentLink(): ReactElement | null {
  const { t } = useI18n();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const isAwaitingDecision = useSyncExternalStore(
    subscribeToAnalyticsConsent,
    isAwaitingAnalyticsConsentDecision,
  );
  const isHidden: boolean = isAuthenticatedAppPath(location.pathname) || isAwaitingDecision;

  const closePanel = useCallback(function closePanel(): void {
    setIsOpen(false);
  }, []);

  const closePanelAndFocusLink = useCallback(function closePanelAndFocusLink(): void {
    closePanel();
    triggerRef.current?.focus();
  }, [closePanel]);

  useAnchoredFloatingOutsidePointerDismiss({
    triggerRef,
    overlayRef: panelRef,
    enabled: isOpen,
    onClose: closePanel,
  });

  useEffect(() => {
    if (isOpen === false) {
      return undefined;
    }

    function closePanelOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closePanelAndFocusLink();
      }
    }

    window.addEventListener("keydown", closePanelOnEscape);

    return () => {
      window.removeEventListener("keydown", closePanelOnEscape);
    };
  }, [closePanelAndFocusLink, isOpen]);

  /**
   * Publishes how much of the bottom-left corner the link occupies, the way the strip publishes its
   * own. It is fixed and has no background, so nothing in the layout would otherwise know it is
   * there, and what it covers on these routes is the primary action of the page — accepting an
   * invite, installing a deck. The whole padded box is measured rather than the text, because the
   * safe-area inset on a notched device is most of the height, and it is republished on every resize
   * because the label's length is per-locale and the inset is per-orientation.
   */
  useEffect(() => {
    const container: HTMLDivElement | null = containerRef.current;
    const rootStyle = document.documentElement.style;
    if (isHidden || container === null) {
      return undefined;
    }
    // A hoisted function declaration does not keep the null check above, so the container is
    // captured here as a non-null element for the measurement to read.
    const measuredContainer: HTMLDivElement = container;

    function publishWithdrawalHeight(): void {
      rootStyle.setProperty(withdrawalHeightCustomProperty, `${measuredContainer.offsetHeight}px`);
    }

    publishWithdrawalHeight();
    // Absent in jsdom and in a few older engines. The measurement above already covers the link as
    // it was rendered, and nothing on the consent path may throw at the person reading it.
    if (typeof ResizeObserver === "undefined") {
      return (): void => {
        rootStyle.removeProperty(withdrawalHeightCustomProperty);
      };
    }

    // The border box, not the default content box: almost all of this height is padding, so the
    // safe-area inset changing on an orientation change would otherwise resize nothing observable
    // and leave the stale reserve behind.
    const observer = new ResizeObserver(publishWithdrawalHeight);
    observer.observe(measuredContainer, { box: "border-box" });
    return (): void => {
      observer.disconnect();
      rootStyle.removeProperty(withdrawalHeightCustomProperty);
    };
  }, [isHidden]);

  if (isHidden) {
    return null;
  }

  return (
    <div ref={containerRef} className="analytics-consent-withdrawal">
      <button
        ref={triggerRef}
        className="analytics-consent-withdrawal-link"
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        data-testid="analytics-consent-withdrawal-link"
        onClick={() => setIsOpen(isOpen === false)}
      >
        {t("analyticsConsentWithdrawal.link")}
      </button>
      <AnchoredFloatingOverlay
        isOpen={isOpen}
        referenceRef={triggerRef}
        floatingRef={panelRef}
        placement="top-start"
        viewportPaddingPx={withdrawalOverlayViewportPaddingPx}
        offsetPx={withdrawalOverlayOffsetPx}
        minimumWidth={null}
        maxWidthPx={withdrawalOverlayMaxWidthPx}
        maxHeightPx={withdrawalOverlayMaxHeightPx}
        className="panel analytics-consent-withdrawal-panel"
        id={null}
        role="dialog"
        ariaLabel={t("analyticsSettings.title")}
        ariaLabelledBy={null}
        ariaDescribedBy={null}
        ariaModal={null}
      >
        <AnalyticsConsentToggleCard persistAccountConsent={persistAccountConsentInBackground} />
        <button
          className="analytics-consent-withdrawal-close"
          type="button"
          onClick={closePanel}
        >
          {t("analyticsConsentWithdrawal.close")}
        </button>
      </AnchoredFloatingOverlay>
    </div>
  );
}

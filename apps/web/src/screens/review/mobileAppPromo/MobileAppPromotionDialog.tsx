import { useEffect, useRef, type ReactElement } from "react";
import { useI18n } from "../../../i18n";
import {
  AppStoreBadge,
  GooglePlayBadge,
  type AppPlatformStoreLinks,
} from "../../share/AppPlatformLinks";
import { MobileAppQrCode } from "../../share/MobileAppQrCode";

export type MobileAppPromotionDialogProps = Readonly<{
  isOpen: boolean;
  onDismiss: () => void;
  storeLinks: AppPlatformStoreLinks;
}>;

export const webReviewMobilePromptStoreLinks: AppPlatformStoreLinks = {
  ios: "https://apps.apple.com/app/apple-store/id6760538964?pt=128797295&ct=web_review_mobile_prompt&mt=8",
  android: "https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&utm_source=flashcards_website&utm_medium=referral&utm_campaign=web_review_mobile_prompt",
};

const mobileAppPromotionFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(dialog: HTMLElement): ReadonlyArray<HTMLElement> {
  return Array.from(dialog.querySelectorAll<HTMLElement>(mobileAppPromotionFocusableSelector))
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
    if (event.shiftKey) {
      lastElement.focus();
      return;
    }

    firstElement.focus();
    return;
  }

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
    return;
  }

  if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

export function MobileAppPromotionDialog(props: MobileAppPromotionDialogProps): ReactElement | null {
  const { isOpen, onDismiss, storeLinks } = props;
  const { direction, t } = useI18n();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const onDismissRef = useRef(onDismiss);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (isOpen === false) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onDismissRef.current();
        return;
      }

      if (event.key === "Tab" && dialogRef.current !== null) {
        trapFocusInsideDialog(event, dialogRef.current);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return (): void => {
      window.removeEventListener("keydown", handleKeyDown);
      const previousFocus = previousFocusRef.current;
      if (previousFocus !== null && previousFocus.isConnected) {
        previousFocus.focus();
      }
      previousFocusRef.current = null;
    };
  }, [isOpen]);

  if (isOpen === false) {
    return null;
  }

  return (
    <div className="mobile-app-promo-overlay">
      <section
        ref={dialogRef}
        className="panel mobile-app-promo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-app-promo-title"
        aria-describedby="mobile-app-promo-body"
        tabIndex={-1}
        data-testid="mobile-app-promo-dialog"
      >
        <div className="mobile-app-promo-header">
          <div>
            <h2 id="mobile-app-promo-title" className="title">{t("mobileAppPromo.title")}</h2>
            <p id="mobile-app-promo-body" className="subtitle mobile-app-promo-body">
              {t("mobileAppPromo.body")}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="ghost-btn mobile-app-promo-close"
            aria-label={t("mobileAppPromo.close")}
            onClick={onDismiss}
            data-testid="mobile-app-promo-close"
          >
            {t("mobileAppPromo.close")}
          </button>
        </div>

        <div className="mobile-app-promo-platforms" dir="ltr" data-testid="mobile-app-promo-platforms">
          <section
            className="mobile-app-promo-platform"
            aria-labelledby="mobile-app-promo-ios-title"
            dir="ltr"
            data-testid="mobile-app-promo-platform-ios"
          >
            <div
              className="mobile-app-promo-platform-content"
              dir={direction}
              data-testid="mobile-app-promo-content-ios"
            >
              <h3 id="mobile-app-promo-ios-title" className="mobile-app-promo-platform-title">
                {t("mobileAppPromo.ios.title")}
              </h3>
              <a
                className="mobile-app-promo-badge-link"
                href={storeLinks.ios}
                rel="noreferrer"
                target="_blank"
                aria-label={t("mobileAppPromo.ios.storeLinkLabel")}
                data-testid="mobile-app-promo-badge-ios"
              >
                <AppStoreBadge />
              </a>
              <div className="mobile-app-promo-qr-frame">
                <MobileAppQrCode
                  title={t("mobileAppPromo.ios.qrLabel")}
                  value={storeLinks.ios}
                  testId="mobile-app-promo-qr-ios"
                />
              </div>
            </div>
          </section>

          <section
            className="mobile-app-promo-platform"
            aria-labelledby="mobile-app-promo-android-title"
            dir="ltr"
            data-testid="mobile-app-promo-platform-android"
          >
            <div
              className="mobile-app-promo-platform-content"
              dir={direction}
              data-testid="mobile-app-promo-content-android"
            >
              <h3 id="mobile-app-promo-android-title" className="mobile-app-promo-platform-title">
                {t("mobileAppPromo.android.title")}
              </h3>
              <a
                className="mobile-app-promo-badge-link"
                href={storeLinks.android}
                rel="noreferrer"
                target="_blank"
                aria-label={t("mobileAppPromo.android.storeLinkLabel")}
                data-testid="mobile-app-promo-badge-android"
              >
                <GooglePlayBadge />
              </a>
              <div className="mobile-app-promo-qr-frame">
                <MobileAppQrCode
                  title={t("mobileAppPromo.android.qrLabel")}
                  value={storeLinks.android}
                  testId="mobile-app-promo-qr-android"
                />
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

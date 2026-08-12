import { useEffect, useRef, type ReactElement } from "react";
import {
  AppPlatformLinksGrid,
  buildAppPlatformOptions,
  resolveClientPlatform,
  type AppPlatformStoreLinks,
} from "../../../appPlatformLinks";
import { useI18n } from "../../../i18n";

export type MobileAppPromotionDialogProps = Readonly<{
  isOpen: boolean;
  onDismiss: () => void;
  storeLinks: AppPlatformStoreLinks;
}>;

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
  const { t } = useI18n();
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

        {/* The store tiles keep a stable left-to-right order under right-to-left locales. */}
        <div dir="ltr">
          <AppPlatformLinksGrid
            options={buildAppPlatformOptions({
              platforms: ["ios", "android", "mcp"],
              storeLinks,
              webHref: null,
              labels: {
                ios: t("appPlatformLinks.ios"),
                android: t("appPlatformLinks.android"),
                web: t("appPlatformLinks.web"),
                mcp: t("appPlatformLinks.mcp.label"),
              },
              qrTitles: {
                ios: t("appPlatformLinks.qr.ios"),
                android: t("appPlatformLinks.qr.android"),
              },
              clientPlatform: resolveClientPlatform(navigator.userAgent),
            })}
            testIdPrefix="mobile-app-promo"
          />
        </div>
      </section>
    </div>
  );
}

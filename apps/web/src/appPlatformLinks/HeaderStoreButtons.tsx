import { useEffect, useRef, type FocusEvent, type PointerEvent, type ReactElement } from "react";
import { track } from "../analytics/client";
import { useI18n } from "../i18n";
import { toAnalyticsStore, type AppPlatformStoreKind } from "./appPlatformOptions";
import { AppPlatformQrCode } from "./AppPlatformQrCode";
import { AppleLogoIcon, GooglePlayIcon } from "./badges";
import { webAppHeaderStoreLinks } from "./storeLinks";

type HeaderStoreButtonProps = Readonly<{
  kind: AppPlatformStoreKind;
  label: string;
  qrTitle: string;
  qrCaption: string;
}>;

const qrShownDelayMs: number = 1000;
// Must match the media query that shows the popover on hover in app-platform-links.css.
const popoverHoverMediaQuery: string = "(hover: hover) and (pointer: fine)";
// A QR view is reported at most once per store per page load.
const reportedQrShownStores: Set<AppPlatformStoreKind> = new Set();

function HeaderStoreButton(props: HeaderStoreButtonProps): ReactElement {
  const { kind, label, qrTitle, qrCaption } = props;
  const href: string = webAppHeaderStoreLinks[kind];
  const isHoveredRef = useRef<boolean>(false);
  const isFocusVisibleRef = useRef<boolean>(false);
  const qrShownTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (qrShownTimerRef.current !== null) {
      window.clearTimeout(qrShownTimerRef.current);
    }
  }, []);

  // The popover is shown purely by CSS, so these handlers mirror its two show rules to time the view.
  function syncQrShownTimer(): void {
    const isPopoverShown: boolean = isHoveredRef.current || isFocusVisibleRef.current;

    if (isPopoverShown === false) {
      if (qrShownTimerRef.current !== null) {
        window.clearTimeout(qrShownTimerRef.current);
        qrShownTimerRef.current = null;
      }
      return;
    }

    if (qrShownTimerRef.current !== null || reportedQrShownStores.has(kind)) {
      return;
    }

    qrShownTimerRef.current = window.setTimeout(() => {
      qrShownTimerRef.current = null;
      // A hidden tab means the store opened in front of this page, so the QR was not on screen for the full delay.
      if (reportedQrShownStores.has(kind) || document.visibilityState !== "visible") {
        return;
      }
      reportedQrShownStores.add(kind);
      track({ name: "store_qr_shown", store: toAnalyticsStore(kind), placement: webAppHeaderStoreLinks.placement });
    }, qrShownDelayMs);
  }

  function handlePointerEnter(event: PointerEvent<HTMLAnchorElement>): void {
    isHoveredRef.current = event.pointerType === "mouse" && window.matchMedia(popoverHoverMediaQuery).matches;
    syncQrShownTimer();
  }

  function handlePointerLeave(): void {
    isHoveredRef.current = false;
    syncQrShownTimer();
  }

  function handleFocus(event: FocusEvent<HTMLAnchorElement>): void {
    isFocusVisibleRef.current = event.currentTarget.matches(":focus-visible");
    syncQrShownTimer();
  }

  function handleBlur(): void {
    isFocusVisibleRef.current = false;
    syncQrShownTimer();
  }

  function handleClick(): void {
    // A click opens the store in a new tab and leaves the pointer on the button, so pointerleave never ends the view.
    isHoveredRef.current = false;
    isFocusVisibleRef.current = false;
    syncQrShownTimer();
    track({ name: "store_link_clicked", store: toAnalyticsStore(kind), placement: webAppHeaderStoreLinks.placement });
  }

  return (
    <span className="header-store-button-anchor">
      <a
        className="header-store-button"
        href={href}
        rel="noreferrer"
        target="_blank"
        aria-label={label}
        data-testid={`topbar-store-link-${kind}`}
        onClick={handleClick}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        {kind === "ios" ? <AppleLogoIcon /> : <GooglePlayIcon />}
      </a>
      {/* The popover only repeats the link as a QR for another device, so assistive tech skips it. */}
      <span className="header-store-popover" aria-hidden="true">
        <span className="header-store-popover-qr-frame">
          <AppPlatformQrCode title={qrTitle} value={href} testId={`topbar-store-qr-${kind}`} />
        </span>
        <span className="header-store-popover-caption">{qrCaption}</span>
      </span>
    </span>
  );
}

export function HeaderStoreButtons(): ReactElement {
  const { t } = useI18n();
  const qrCaption: string = t("appPlatformLinks.qrCaption");

  return (
    <div className="header-store-buttons" data-testid="topbar-store-buttons">
      <HeaderStoreButton
        kind="ios"
        label={t("appPlatformLinks.ios")}
        qrTitle={t("appPlatformLinks.qr.ios")}
        qrCaption={qrCaption}
      />
      <HeaderStoreButton
        kind="android"
        label={t("appPlatformLinks.android")}
        qrTitle={t("appPlatformLinks.qr.android")}
        qrCaption={qrCaption}
      />
    </div>
  );
}

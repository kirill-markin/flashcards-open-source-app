import { useEffect, useRef, type FocusEvent, type PointerEvent, type ReactElement } from "react";
import { track } from "../analytics/client";
import type { AnalyticsStoreDevice } from "../analytics/events";
import { useI18n } from "../i18n";
import { toAnalyticsStore, type AppPlatformStoreKind } from "./appPlatformOptions";
import { AppPlatformQrCode } from "./AppPlatformQrCode";
import { DeviceIcon } from "./badges";
import { resolveClientDevice, type ClientDevice } from "./clientPlatform";
import { buildWebAppHeaderAppleDeviceLink, webAppHeaderStoreLinks } from "./storeLinks";

type HeaderDevice = Readonly<{
  device: AnalyticsStoreDevice;
  /** A brand name, never translated. */
  label: string;
  store: AppPlatformStoreKind;
  href: string;
}>;

type HeaderDeviceLinkProps = Readonly<{
  headerDevice: HeaderDevice;
  ariaLabel: string;
}>;

type HeaderQrDeviceLinkProps = Readonly<{
  headerDevice: HeaderDevice;
  ariaLabel: string;
  qrTitle: string;
  qrCaption: string;
}>;

/**
 * The same devices as the marketing site's home device row (`src/lib/humanPlatforms.ts` and
 * `src/components/HomeDeviceLinks.tsx` in the website repo), without Web. Not shared code:
 * the two lists are kept aligned by hand.
 */
const headerDevices: Readonly<Record<AnalyticsStoreDevice, HeaderDevice>> = {
  iphone: { device: "iphone", label: "iPhone", store: "ios", href: buildWebAppHeaderAppleDeviceLink("iphone") },
  ipad: { device: "ipad", label: "iPad", store: "ios", href: buildWebAppHeaderAppleDeviceLink("ipad") },
  mac: { device: "mac", label: "Mac", store: "ios", href: buildWebAppHeaderAppleDeviceLink("mac") },
  android: { device: "android", label: "Android", store: "android", href: webAppHeaderStoreLinks.android },
};

/** Every device always shows; only the order follows the visitor's own device. */
const headerDeviceOrders: Readonly<Record<ClientDevice, ReadonlyArray<AnalyticsStoreDevice>>> = {
  iphone: ["iphone", "ipad", "mac", "android"],
  ipad: ["ipad", "iphone", "mac", "android"],
  android: ["android", "iphone", "ipad", "mac"],
  desktop: ["mac", "iphone", "ipad", "android"],
};

const qrShownDelayMs: number = 1000;
// These two must match the media queries that show and hide the popover in app-platform-links.css.
const popoverHoverMediaQuery: string = "(hover: hover) and (pointer: fine)";
const popoverHiddenMediaQuery: string = "(max-width: 768px)";
// A QR view is reported at most once per device per page load.
const reportedQrShownDevices: Set<AnalyticsStoreDevice> = new Set();

function trackHeaderStoreLinkClicked(headerDevice: HeaderDevice): void {
  track({
    name: "store_link_clicked",
    store: toAnalyticsStore(headerDevice.store),
    placement: webAppHeaderStoreLinks.placement,
    url: headerDevice.href,
    device: headerDevice.device,
  });
}

function HeaderDeviceLinkContent({ headerDevice }: Readonly<{ headerDevice: HeaderDevice }>): ReactElement {
  return (
    <>
      <DeviceIcon device={headerDevice.device} />
      <span>{headerDevice.label}</span>
    </>
  );
}

/** A Mac cannot scan a QR to install, so this link has no popover and reports only its click. */
function HeaderPlainDeviceLink(props: HeaderDeviceLinkProps): ReactElement {
  const { headerDevice, ariaLabel } = props;

  return (
    <a
      className="header-store-button"
      href={headerDevice.href}
      rel="noreferrer"
      target="_blank"
      aria-label={ariaLabel}
      data-testid={`topbar-store-link-${headerDevice.device}`}
      onClick={() => trackHeaderStoreLinkClicked(headerDevice)}
    >
      <HeaderDeviceLinkContent headerDevice={headerDevice} />
    </a>
  );
}

function HeaderQrDeviceLink(props: HeaderQrDeviceLinkProps): ReactElement {
  const { headerDevice, ariaLabel, qrTitle, qrCaption } = props;
  const { device, store, href } = headerDevice;
  const isHoveredRef = useRef<boolean>(false);
  const isFocusVisibleRef = useRef<boolean>(false);
  const qrShownTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (qrShownTimerRef.current !== null) {
      window.clearTimeout(qrShownTimerRef.current);
    }
  }, []);

  // The popover is shown purely by CSS, so these handlers mirror its show and hide rules to time the view.
  function syncQrShownTimer(): void {
    const isPopoverShown: boolean = (isHoveredRef.current || isFocusVisibleRef.current)
      && window.matchMedia(popoverHiddenMediaQuery).matches === false;

    if (isPopoverShown === false) {
      if (qrShownTimerRef.current !== null) {
        window.clearTimeout(qrShownTimerRef.current);
        qrShownTimerRef.current = null;
      }
      return;
    }

    if (qrShownTimerRef.current !== null || reportedQrShownDevices.has(device)) {
      return;
    }

    qrShownTimerRef.current = window.setTimeout(() => {
      qrShownTimerRef.current = null;
      // A hidden tab means the store opened in front of this page, so the QR was not on screen for the full delay.
      if (reportedQrShownDevices.has(device) || document.visibilityState !== "visible") {
        return;
      }
      reportedQrShownDevices.add(device);
      track({
        name: "store_qr_shown",
        store: toAnalyticsStore(store),
        placement: webAppHeaderStoreLinks.placement,
        url: href,
        device,
      });
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
    trackHeaderStoreLinkClicked(headerDevice);
  }

  return (
    <span className="header-store-button-anchor">
      <a
        className="header-store-button"
        href={href}
        rel="noreferrer"
        target="_blank"
        aria-label={ariaLabel}
        data-testid={`topbar-store-link-${device}`}
        onClick={handleClick}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        <HeaderDeviceLinkContent headerDevice={headerDevice} />
      </a>
      {/* The popover only repeats the link as a QR for another device, so assistive tech skips it. */}
      <span className="header-store-popover" aria-hidden="true">
        <span className="header-store-popover-qr-frame">
          <AppPlatformQrCode title={qrTitle} value={href} testId={`topbar-store-qr-${device}`} />
        </span>
        <span className="header-store-popover-caption">{qrCaption}</span>
      </span>
    </span>
  );
}

export function HeaderStoreButtons(): ReactElement {
  const { t } = useI18n();
  const qrCaption: string = t("appPlatformLinks.qrCaption");
  const clientDevice: ClientDevice = resolveClientDevice(navigator.userAgent, navigator.maxTouchPoints);

  return (
    <div className="header-store-buttons" data-testid="topbar-store-buttons">
      {headerDeviceOrders[clientDevice].map((device) => {
        const headerDevice: HeaderDevice = headerDevices[device];
        // The visible brand name leads the accessible name, so voice control can target it.
        const ariaLabel: string = `${headerDevice.label}: ${t(`appPlatformLinks.${headerDevice.store}`)}`;

        if (device === "mac") {
          return <HeaderPlainDeviceLink key={device} headerDevice={headerDevice} ariaLabel={ariaLabel} />;
        }

        return (
          <HeaderQrDeviceLink
            key={device}
            headerDevice={headerDevice}
            ariaLabel={ariaLabel}
            qrTitle={t(`appPlatformLinks.qr.${headerDevice.store}`)}
            qrCaption={qrCaption}
          />
        );
      })}
    </div>
  );
}

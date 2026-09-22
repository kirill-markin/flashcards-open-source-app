import type { ReactElement } from "react";
import { useI18n } from "../i18n";
import type { AppPlatformStoreKind } from "./appPlatformOptions";
import { AppPlatformQrCode } from "./AppPlatformQrCode";
import { AppleLogoIcon, GooglePlayIcon } from "./badges";
import { webAppHeaderStoreLinks } from "./storeLinks";

type HeaderStoreButtonProps = Readonly<{
  kind: AppPlatformStoreKind;
  label: string;
  qrTitle: string;
  qrCaption: string;
}>;

function HeaderStoreButton(props: HeaderStoreButtonProps): ReactElement {
  const { kind, label, qrTitle, qrCaption } = props;
  const href: string = webAppHeaderStoreLinks[kind];

  return (
    <span className="header-store-button-anchor">
      <a
        className="header-store-button"
        href={href}
        rel="noreferrer"
        target="_blank"
        aria-label={label}
        data-testid={`topbar-store-link-${kind}`}
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

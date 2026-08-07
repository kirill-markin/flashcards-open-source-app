import type { ReactElement } from "react";
import { QRCodeSVG } from "qrcode.react";

type MobileAppQrCodeProps = Readonly<{
  title: string;
  testId: string;
  value: string;
}>;

function requireHttpsUrl(value: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch (error) {
    throw new TypeError(`Mobile app QR code value must be an absolute URL. Received: ${value}`, { cause: error });
  }

  if (parsedUrl.protocol !== "https:") {
    throw new TypeError(`Mobile app QR code value must use HTTPS. Received protocol: ${parsedUrl.protocol}`);
  }

  return parsedUrl.toString();
}

export function MobileAppQrCode(props: MobileAppQrCodeProps): ReactElement {
  const { title, testId, value } = props;
  const qrValue = requireHttpsUrl(value);

  return (
    <QRCodeSVG
      className="mobile-app-promo-qr-code"
      data-testid={testId}
      level="M"
      marginSize={2}
      size={164}
      title={title}
      value={qrValue}
    />
  );
}

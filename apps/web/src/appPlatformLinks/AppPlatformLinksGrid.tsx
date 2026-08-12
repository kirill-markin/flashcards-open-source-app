import type { ReactElement } from "react";
import type { AppPlatformOption } from "./appPlatformOptions";
import { AppPlatformMcpOption } from "./AppPlatformMcpOption";
import { AppPlatformQrCode } from "./AppPlatformQrCode";
import { AppStoreBadge, GooglePlayBadge, WebAppIcon } from "./badges";

type AppPlatformLinksGridProps = Readonly<{
  options: ReadonlyArray<AppPlatformOption>;
  testIdPrefix: string;
}>;

type AppPlatformLinkTileProps = Readonly<{
  option: AppPlatformOption;
  testIdPrefix: string;
}>;

function requireOptionHref(option: AppPlatformOption): string {
  if (option.href === null) {
    throw new Error(`App platform option "${option.kind}" is missing its href.`);
  }

  return option.href;
}

function AppPlatformOptionBadge({ option }: Readonly<{ option: AppPlatformOption }>): ReactElement {
  if (option.kind === "ios") {
    return <AppStoreBadge />;
  }

  if (option.kind === "android") {
    return <GooglePlayBadge />;
  }

  if (option.kind === "web") {
    return (
      <>
        <WebAppIcon />
        <span className="app-platform-links-option-label">{option.label}</span>
      </>
    );
  }

  throw new Error(`App platform option "${option.kind}" is not rendered as a link tile.`);
}

function AppPlatformLinkTile({ option, testIdPrefix }: AppPlatformLinkTileProps): ReactElement {
  const href = requireOptionHref(option);

  return (
    <a
      className={`app-platform-links-option app-platform-links-option-${option.kind}`}
      href={href}
      rel="noreferrer"
      target="_blank"
      aria-label={option.label}
      data-testid={`${testIdPrefix}-link-${option.kind}`}
    >
      <AppPlatformOptionBadge option={option} />
      {option.qrTitle === null ? null : (
        <span className="app-platform-links-qr-frame">
          <AppPlatformQrCode
            title={option.qrTitle}
            value={href}
            testId={`${testIdPrefix}-qr-${option.kind}`}
          />
        </span>
      )}
    </a>
  );
}

/**
 * Renders already-built platform options. Device resolution stays with the caller,
 * which passes its `clientPlatform` to `buildAppPlatformOptions`.
 */
export function AppPlatformLinksGrid(props: AppPlatformLinksGridProps): ReactElement {
  const { options, testIdPrefix } = props;

  return (
    <div className="app-platform-links-grid" data-testid={`${testIdPrefix}-grid`}>
      {options.map((option) => (option.kind === "mcp"
        ? (
          <AppPlatformMcpOption
            key={option.kind}
            label={option.label}
            testIdPrefix={testIdPrefix}
          />
        )
        : (
          <AppPlatformLinkTile
            key={option.kind}
            option={option}
            testIdPrefix={testIdPrefix}
          />
        )))}
    </div>
  );
}

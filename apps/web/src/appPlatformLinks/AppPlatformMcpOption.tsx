import { useState, type ReactElement } from "react";
import { useI18n } from "../i18n";

export const publicMcpServerUrl: string = "https://mcp.flashcards-open-source-app.com/mcp";

type AppPlatformMcpCopyStatus = "idle" | "copied" | "failed";

type AppPlatformMcpOptionProps = Readonly<{
  label: string;
  testIdPrefix: string;
}>;

export function AppPlatformMcpOption(props: AppPlatformMcpOptionProps): ReactElement {
  const { label, testIdPrefix } = props;
  const { direction, t } = useI18n();
  const [copyStatus, setCopyStatus] = useState<AppPlatformMcpCopyStatus>("idle");
  // Several grids can share one page, so the heading id is derived from the caller's prefix.
  const titleElementId: string = `${testIdPrefix}-mcp-title`;
  const copyButtonLabel: string = copyStatus === "copied"
    ? t("appPlatformLinks.mcp.copied")
    : copyStatus === "failed"
      ? t("appPlatformLinks.mcp.copyFailed")
      : t("appPlatformLinks.mcp.copy");
  const copyStatusMessage: string = copyStatus === "idle" ? "" : copyButtonLabel;

  async function copyMcpServerUrl(): Promise<void> {
    setCopyStatus("idle");

    if (typeof navigator.clipboard?.writeText !== "function") {
      setCopyStatus("failed");
      return;
    }

    try {
      await navigator.clipboard.writeText(publicMcpServerUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  // This block is all prose, so it carries the locale direction itself and stays
  // readable even when an ancestor pins the grid to left-to-right for tile placement.
  return (
    <section
      className="app-platform-links-mcp-option"
      dir={direction}
      data-testid={`${testIdPrefix}-mcp-option`}
      aria-labelledby={titleElementId}
    >
      <p className="app-platform-links-mcp-label">{label}</p>
      <div className="app-platform-links-mcp-header">
        <h2 id={titleElementId} className="app-platform-links-mcp-title">
          {t("appPlatformLinks.mcp.title")}
        </h2>
        <p className="app-platform-links-mcp-description">{t("appPlatformLinks.mcp.description")}</p>
      </div>
      <div className="app-platform-links-mcp-copy">
        <p className="app-platform-links-mcp-caption">{t("appPlatformLinks.mcp.caption")}</p>
        <div className="app-platform-links-mcp-copy-row">
          <code className="app-platform-links-mcp-url" data-testid={`${testIdPrefix}-mcp-url`}>
            {publicMcpServerUrl}
          </code>
          <button
            className="ghost-btn app-platform-links-mcp-copy-button"
            type="button"
            onClick={() => void copyMcpServerUrl()}
            data-testid={`${testIdPrefix}-mcp-copy-button`}
          >
            {copyButtonLabel}
          </button>
        </div>
        <p
          className="app-platform-links-mcp-status"
          aria-live="polite"
          data-testid={`${testIdPrefix}-mcp-copy-status`}
        >
          {copyStatusMessage}
        </p>
      </div>
    </section>
  );
}

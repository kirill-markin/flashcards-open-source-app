import { useState, type ReactElement } from "react";
import { useI18n } from "../../i18n";

export const publicMcpServerUrl: string = "https://mcp.flashcards-open-source-app.com/mcp";

type ShareMcpCopyStatus = "idle" | "copied" | "failed";

export function ShareMcpOption(): ReactElement {
  const { t } = useI18n();
  const [copyStatus, setCopyStatus] = useState<ShareMcpCopyStatus>("idle");
  const copyButtonLabel: string = copyStatus === "copied"
    ? t("shareApp.mcp.copied")
    : copyStatus === "failed"
      ? t("shareApp.mcp.copyFailed")
      : t("shareApp.mcp.copy");
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

  return (
    <section className="invite-mcp-option" data-testid="share-app-mcp-option" aria-labelledby="share-app-mcp-title">
      <p className="invite-mcp-label">{t("shareApp.mcp.label")}</p>
      <div className="invite-mcp-header">
        <h2 id="share-app-mcp-title" className="invite-mcp-title">{t("shareApp.mcp.title")}</h2>
        <p className="invite-mcp-description">{t("shareApp.mcp.description")}</p>
      </div>
      <div className="invite-mcp-copy">
        <p className="invite-mcp-caption">{t("shareApp.mcp.caption")}</p>
        <div className="invite-mcp-copy-row">
          <code className="invite-mcp-url" data-testid="share-app-mcp-url">{publicMcpServerUrl}</code>
          <button
            className="ghost-btn invite-mcp-copy-button"
            type="button"
            onClick={() => void copyMcpServerUrl()}
            data-testid="share-app-mcp-copy-button"
          >
            {copyButtonLabel}
          </button>
        </div>
        <p className="invite-mcp-status" aria-live="polite" data-testid="share-app-mcp-copy-status">
          {copyStatusMessage}
        </p>
      </div>
    </section>
  );
}

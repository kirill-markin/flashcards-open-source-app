import { useEffect, useState, type ReactElement } from "react";
import { listAgentApiKeys, revokeAgentApiKey } from "../../../api";
import { useAppData } from "../../../appData";
import { useI18n } from "../../../i18n";
import type { AgentApiKeyConnection } from "../../../types";
import { SettingsShell } from "../SettingsShared";

export function AgentConnectionsScreen(): ReactElement {
  const { isSessionVerified } = useAppData();
  const { t, formatDateTime } = useI18n();
  const [connections, setConnections] = useState<ReadonlyArray<AgentApiKeyConnection>>([]);
  const [instructions, setInstructions] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(isSessionVerified);

  useEffect(() => {
    if (isSessionVerified === false) {
      setIsLoading(false);
      return;
    }

    void loadConnections();
  }, [isSessionVerified]);

  async function loadConnections(): Promise<void> {
    setIsLoading(true);
    try {
      const result = await listAgentApiKeys();
      setConnections(result.connections);
      setInstructions(result.instructions);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRevoke(connectionId: string): Promise<void> {
    if (isSessionVerified === false) {
      return;
    }

    setBusyConnectionId(connectionId);
    try {
      const result = await revokeAgentApiKey(connectionId);
      setConnections((currentConnections) => currentConnections.map((connection) => (
        connection.connectionId === result.connection.connectionId ? result.connection : connection
      )));
      setInstructions(result.instructions);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyConnectionId(null);
    }
  }

  return (
    <SettingsShell
      title={t("agentConnections.title")}
      subtitle={t("agentConnections.subtitle")}
      activeTab="account"
    >
      {isSessionVerified === false ? <p className="subtitle">{t("agentConnections.restoringSession")}</p> : null}
      {errorMessage !== "" ? <p className="error-banner">{errorMessage}</p> : null}
      {instructions !== "" ? <p className="subtitle">{instructions}</p> : null}

      <div className="settings-connections-list">
        {isLoading ? <div className="content-card">{t("agentConnections.loading")}</div> : null}
        {!isLoading && connections.length === 0 ? (
          <div className="content-card">{t("agentConnections.empty")}</div>
        ) : null}
        {!isLoading ? connections.map((connection) => (
          <article key={connection.connectionId} className="content-card settings-connection-card">
            <div className="settings-connection-header">
              <div className="cell-stack">
                <strong className="cell-primary">{connection.label}</strong>
                <span className="txn-cell-mono">{connection.connectionId}</span>
              </div>
              <span className="badge">{connection.revokedAt === null ? t("common.active") : t("common.revoked")}</span>
            </div>
            <div className="settings-connection-meta">
              <div className="cell-stack">
                <span className="cell-secondary">{t("agentConnections.labels.created")}</span>
                <span className="txn-cell-mono">{formatDateTime(connection.createdAt)}</span>
              </div>
              <div className="cell-stack">
                <span className="cell-secondary">{t("agentConnections.labels.lastUsed")}</span>
                <span className="txn-cell-mono">{connection.lastUsedAt === null ? t("common.never") : formatDateTime(connection.lastUsedAt)}</span>
              </div>
              <div className="cell-stack">
                <span className="cell-secondary">{t("agentConnections.labels.revoked")}</span>
                <span className="txn-cell-mono">{connection.revokedAt === null ? t("common.notRevoked") : formatDateTime(connection.revokedAt)}</span>
              </div>
            </div>
            <div className="screen-actions">
              <button
                className="ghost-btn"
                type="button"
                onClick={() => void handleRevoke(connection.connectionId)}
                disabled={isSessionVerified === false || connection.revokedAt !== null || busyConnectionId === connection.connectionId}
              >
                {t("agentConnections.revoke")}
              </button>
            </div>
          </article>
        )) : null}
      </div>
    </SettingsShell>
  );
}

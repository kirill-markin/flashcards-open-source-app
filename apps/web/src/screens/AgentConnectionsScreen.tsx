import { useEffect, useState, type ReactElement } from "react";
import { listAgentApiKeys, revokeAgentApiKey } from "../api";
import { useAppData } from "../appData";
import type { AgentApiKeyConnection } from "../types";
import { SettingsShell } from "./SettingsShared";

export function AgentConnectionsScreen(): ReactElement {
  const { isSessionVerified } = useAppData();
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
      title="Agent Connections"
      subtitle="Review and revoke long-lived bot connections for this account."
      activeTab="account"
    >
      {isSessionVerified === false ? <p className="subtitle">Restoring session...</p> : null}
      {errorMessage !== "" ? <p className="error-banner">{errorMessage}</p> : null}
      {instructions !== "" ? <p className="subtitle">{instructions}</p> : null}

      <div className="settings-connections-list">
        {isLoading ? <div className="content-card">Loading connections…</div> : null}
        {!isLoading && connections.length === 0 ? (
          <div className="content-card">No bot connections have been created yet.</div>
        ) : null}
        {!isLoading ? connections.map((connection) => (
          <article key={connection.connectionId} className="content-card settings-connection-card">
            <div className="settings-connection-header">
              <div className="cell-stack">
                <strong className="cell-primary">{connection.label}</strong>
                <span className="txn-cell-mono">{connection.connectionId}</span>
              </div>
              <span className="badge">{connection.revokedAt === null ? "Active" : "Revoked"}</span>
            </div>
            <div className="settings-connection-meta">
              <div className="cell-stack">
                <span className="cell-secondary">Created</span>
                <span className="txn-cell-mono">{connection.createdAt}</span>
              </div>
              <div className="cell-stack">
                <span className="cell-secondary">Last used</span>
                <span className="txn-cell-mono">{connection.lastUsedAt ?? "Never"}</span>
              </div>
              <div className="cell-stack">
                <span className="cell-secondary">Revoked</span>
                <span className="txn-cell-mono">{connection.revokedAt ?? "Not revoked"}</span>
              </div>
            </div>
            <div className="screen-actions">
              <button
                className="ghost-btn"
                type="button"
                onClick={() => void handleRevoke(connection.connectionId)}
                disabled={isSessionVerified === false || connection.revokedAt !== null || busyConnectionId === connection.connectionId}
              >
                Revoke
              </button>
            </div>
          </article>
        )) : null}
      </div>
    </SettingsShell>
  );
}

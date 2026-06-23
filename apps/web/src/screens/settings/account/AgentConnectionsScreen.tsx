import { useEffect, useState, type ReactElement } from "react";
import { ApiContractError, createAgentApiKey, listAgentApiKeys, revokeAgentApiKey } from "../../../api";
import { useAppData } from "../../../appData";
import { useAppErrorDialog } from "../../../appError/AppErrorContext";
import { useI18n } from "../../../i18n";
import { captureApiContractError } from "../../../observability/apiContractObservation";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import type { AgentApiKeyConnection } from "../../../types";
import { SettingsShell } from "../SettingsShared";

export function AgentConnectionsScreen(): ReactElement {
  const { activeWorkspace, cloudSettings, isSessionVerified, session } = useAppData();
  const { showCapturedTechnicalError } = useAppErrorDialog();
  const { t, formatDateTime } = useI18n();
  const [connections, setConnections] = useState<ReadonlyArray<AgentApiKeyConnection>>([]);
  const [instructions, setInstructions] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(isSessionVerified);
  const [newKeyLabel, setNewKeyLabel] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const technicalErrorMessage = t("appError.technicalError.message");

  useEffect(() => {
    if (isSessionVerified === false) {
      setIsLoading(false);
      // Do not keep a one-time secret on screen across a session loss/redirect.
      setGeneratedApiKey(null);
      setIsCopied(false);
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
      const wasContractErrorCaptured = captureApiContractError(error, {
        feature: "settings",
        sourceAction: "agent_connections_load",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
      });
      let wasCaptured = wasContractErrorCaptured;
      if (error instanceof ApiContractError === false) {
        wasCaptured = captureAppOperationError(error, {
          feature: "settings",
          operation: "agent_connections_load",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: cloudSettings?.installationId ?? null,
          entityId: null,
        });
      }
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGenerate(): Promise<void> {
    if (isSessionVerified === false || isGenerating) {
      return;
    }

    setIsGenerating(true);
    try {
      const result = await createAgentApiKey(newKeyLabel.trim());
      setGeneratedApiKey(result.apiKey);
      setIsCopied(false);
      setNewKeyLabel("");
      setErrorMessage("");
      await loadConnections();
    } catch (error) {
      const wasContractErrorCaptured = captureApiContractError(error, {
        feature: "settings",
        sourceAction: "agent_connection_create",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
      });
      let wasCaptured = wasContractErrorCaptured;
      if (error instanceof ApiContractError === false) {
        wasCaptured = captureAppOperationError(error, {
          feature: "settings",
          operation: "agent_connection_create",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: cloudSettings?.installationId ?? null,
          entityId: null,
        });
      }
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : t("agentConnections.generateError"));
      }
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleCopyGeneratedKey(): Promise<void> {
    if (generatedApiKey === null || typeof navigator.clipboard?.writeText !== "function") {
      return;
    }

    try {
      await navigator.clipboard.writeText(generatedApiKey);
      setIsCopied(true);
    } catch (error) {
      const wasCaptured = captureAppOperationError(error, {
        feature: "settings",
        operation: "agent_connection_copy_key",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: null,
      });
      if (wasCaptured) {
        showCapturedTechnicalError(error);
      }
    }
  }

  function dismissGeneratedKey(): void {
    setGeneratedApiKey(null);
    setIsCopied(false);
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
      const wasContractErrorCaptured = captureApiContractError(error, {
        feature: "settings",
        sourceAction: "agent_connection_revoke",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
      });
      let wasCaptured = wasContractErrorCaptured;
      if (error instanceof ApiContractError === false) {
        wasCaptured = captureAppOperationError(error, {
          feature: "settings",
          operation: "agent_connection_revoke",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: cloudSettings?.installationId ?? null,
          entityId: connectionId,
        });
      }
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
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

      <section className="content-card settings-generate-card">
        <label className="cell-stack" htmlFor="agent-key-label">
          <span className="cell-secondary">{t("agentConnections.generateTitle")}</span>
          <input
            id="agent-key-label"
            data-testid="agent-key-label-input"
            className="settings-input"
            type="text"
            value={newKeyLabel}
            placeholder={t("agentConnections.labelPlaceholder")}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={isSessionVerified === false || isGenerating}
            onChange={(event) => {
              setNewKeyLabel(event.target.value);
            }}
          />
        </label>
        <div className="screen-actions">
          <button
            className="primary-btn"
            type="button"
            data-testid="agent-key-generate-button"
            onClick={() => void handleGenerate()}
            disabled={isSessionVerified === false || isGenerating || newKeyLabel.trim() === ""}
          >
            {t("agentConnections.generate")}
          </button>
        </div>
      </section>

      {generatedApiKey !== null ? (
        <section
          className="content-card settings-generated-key-card"
          data-testid="agent-key-generated-panel"
        >
          <div className="cell-stack">
            <h2 className="panel-subtitle">{t("agentConnections.keyShownOnceTitle")}</h2>
            <p className="error-banner settings-delete-warning">{t("agentConnections.keyShownOnceWarning")}</p>
            <code className="settings-key-value" data-testid="agent-key-generated-value">{generatedApiKey}</code>
          </div>
          <div className="screen-actions">
            <button
              className="primary-btn"
              type="button"
              data-testid="agent-key-copy-button"
              onClick={() => void handleCopyGeneratedKey()}
            >
              {isCopied ? t("agentConnections.copied") : t("agentConnections.copy")}
            </button>
            <button
              className="ghost-btn"
              type="button"
              data-testid="agent-key-dismiss-button"
              onClick={dismissGeneratedKey}
            >
              {t("agentConnections.done")}
            </button>
          </div>
        </section>
      ) : null}

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

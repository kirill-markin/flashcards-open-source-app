import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router";
import { loadWorkspaceChatInstructions, saveWorkspaceChatInstructions } from "../../../api";
import { getCachedSessionAccountId } from "../../../api/transport/transport";
import { useAppData } from "../../../appData";
import {
  beginWorkspaceChatInstructionsRequest,
  beginWorkspaceChatInstructionsSave,
  isCurrentWorkspaceChatInstructionsRequest,
  recordWorkspaceChatInstructions,
  useWorkspaceChatInstructions,
  useWorkspaceChatInstructionsSaving,
} from "../../../chat/customInstructions/workspaceChatInstructionsStore";
import { useI18n } from "../../../i18n";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import type { WebAppOperation } from "../../../observability/webObservability";
import { settingsCurrentWorkspaceRoute } from "../../../routes";
import { useWorkspacePath } from "../../../useWorkspacePath";
import { SettingsGroup, SettingsShell } from "../SettingsShared";

type LoadState = "loading" | "ready" | "failed";

/** The server counts Unicode code points, so the counter does too. */
function countCodePoints(text: string): number {
  return [...text.trim()].length;
}

type ChatInstructionsProps = Readonly<{ accountId: string }>;

/** Switching accounts or workspaces invalidates the previous editor's pending UI updates. */
export function ChatInstructionsScreen({ accountId }: ChatInstructionsProps): ReactElement {
  const { session, activeWorkspace } = useAppData();
  return <ChatInstructionsEditor key={`${accountId}:${session?.userId ?? ""}:${activeWorkspace?.workspaceId ?? ""}`} accountId={accountId} />;
}

function ChatInstructionsEditor({ accountId }: ChatInstructionsProps): ReactElement {
  const { session, activeWorkspace, cloudSettings } = useAppData();
  const { t, formatNumber } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const workspacePath = useWorkspacePath();
  const parentPath = (location.state as Readonly<{ parentPath?: string }> | null)?.parentPath ?? null;
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const userId = session?.userId ?? null;
  const stored = useWorkspaceChatInstructions(accountId, workspaceId);
  const [text, setText] = useState<string>(stored ?? "");
  const [loadedText, setLoadedText] = useState<string>("");
  const [canEdit, setCanEdit] = useState<boolean>(false);
  const [maxLength, setMaxLength] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const isSaving = useWorkspaceChatInstructionsSaving(accountId, workspaceId);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string>("");
  const isMountedRef = useRef<boolean>(true);
  const length = countCodePoints(text);
  const isTooLong = maxLength !== null && length > maxLength;
  const isSaveDisabled = loadState !== "ready" || !canEdit || isSaving || isTooLong || text.trim() === loadedText;

  function reportError(error: unknown, operation: WebAppOperation): void {
    captureAppOperationError(error, {
      feature: "chat",
      operation,
      userId,
      workspaceId,
      installationId: cloudSettings?.installationId ?? null,
      entityId: null,
    });
  }

  const reportLoadError = useEffectEvent((error: unknown): void => {
    reportError(error, "chat_custom_instructions_load");
  });

  useLayoutEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (loadState !== "loading" || isSaving || userId === null || workspaceId === null) {
      return;
    }

    const token = beginWorkspaceChatInstructionsRequest(accountId, workspaceId);
    if (token === null) {
      return;
    }
    const abortController = new AbortController();
    void loadWorkspaceChatInstructions(userId, accountId, workspaceId, abortController.signal).then((response) => {
      if (abortController.signal.aborted || !isCurrentWorkspaceChatInstructionsRequest(token)) {
        return;
      }
      if (getCachedSessionAccountId() !== accountId) {
        setText("");
        setCanEdit(false);
        setLoadState("failed");
        return;
      }
      recordWorkspaceChatInstructions(token, response.customInstructions, "read");
      setText(response.customInstructions ?? "");
      setLoadedText(response.customInstructions ?? "");
      setMaxLength(response.maxLength);
      setCanEdit(response.canEdit);
      setLoadState("ready");
    }, (error: unknown) => {
      if (abortController.signal.aborted || !isCurrentWorkspaceChatInstructionsRequest(token)) {
        return;
      }
      reportLoadError(error);
      setLoadState("failed");
    });

    return () => abortController.abort();
  }, [accountId, userId, workspaceId, isSaving, loadState]);

  function leave(): void {
    if (parentPath !== null) {
      void navigate(-1);
      return;
    }
    void navigate(workspacePath(settingsCurrentWorkspaceRoute), { replace: true });
  }

  async function save(customInstructions: string | null): Promise<void> {
    if (loadState !== "ready" || !canEdit || userId === null || workspaceId === null) {
      return;
    }
    const pendingSave = beginWorkspaceChatInstructionsSave(accountId, workspaceId);
    if (pendingSave === null) {
      return;
    }
    const { token, finish } = pendingSave;
    const isCurrentEditor = (): boolean => isMountedRef.current && isCurrentWorkspaceChatInstructionsRequest(token);

    setSaveErrorMessage("");
    try {
      const response = await saveWorkspaceChatInstructions(userId, accountId, workspaceId, customInstructions);
      if (getCachedSessionAccountId() !== accountId) {
        if (isCurrentEditor()) {
          setText("");
          setCanEdit(false);
          setLoadState("failed");
        }
        return;
      }
      recordWorkspaceChatInstructions(token, response.customInstructions, "write");
      if (isCurrentEditor()) {
        leave();
      }
    } catch (error) {
      reportError(error, "chat_custom_instructions_save");
      if (isCurrentEditor()) {
        setSaveErrorMessage(t("chatPanel.customInstructions.saveFailed"));
      }
    } finally {
      finish();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isSaveDisabled === false) {
      void save(text.trim() || null);
    }
  }

  return (
    <SettingsShell
      title={t("chatPanel.customInstructions.title")}
      subtitle={t("chatPanel.customInstructions.description")}
      activeTab="current-workspace"
      backLink={{
        label: t("deckDetail.actions.back"),
        to: parentPath ?? workspacePath(settingsCurrentWorkspaceRoute),
        testId: "chat-instructions-back",
      }}
    >
      <SettingsGroup>
        <form
          className="content-card settings-overview-card chat-instructions-form"
          onSubmit={handleSubmit}
          data-testid="chat-instructions-form"
          data-load-state={loadState}
        >
          <label className="form-label feedback-dialog-field">
            <textarea
              className="settings-input feedback-textarea"
              aria-label={t("chatPanel.customInstructions.title")}
              rows={8}
              value={text}
              placeholder={canEdit ? t("chatPanel.customInstructions.placeholder") : undefined}
              readOnly={!canEdit}
              disabled={loadState !== "ready" || isSaving}
              aria-invalid={isTooLong}
              onChange={(event) => {
                setText(event.currentTarget.value);
                setSaveErrorMessage("");
              }}
              data-testid="chat-instructions-input"
            />
          </label>
          <div className="chat-instructions-meta">
            {loadState === "loading" ? (
              <span className="chat-instructions-status" role="status">
                <span className="sign-out-link-spinner" aria-hidden="true" />
                {t("common.loading")}
              </span>
            ) : null}
            {loadState === "failed" ? (
              <span className="chat-instructions-status" role="alert">
                {t("chatPanel.customInstructions.loadFailed")}{" "}
                <button
                  type="button"
                  className="ghost-btn chat-instructions-retry"
                  onClick={() => setLoadState("loading")}
                  data-testid="chat-instructions-retry"
                >
                  {t("common.retry")}
                </button>
              </span>
            ) : null}
            {!canEdit || maxLength === null ? null : (
              <span
                className={`chat-instructions-count${isTooLong ? " chat-instructions-count-over" : ""}`}
                data-testid="chat-instructions-count"
              >
                {t("chatPanel.customInstructions.count", {
                  count: formatNumber(length),
                  max: formatNumber(maxLength),
                })}
              </span>
            )}
          </div>

          {saveErrorMessage === "" ? null : <p className="error-banner" role="alert">{saveErrorMessage}</p>}

          {canEdit ? (
            <div className="screen-actions">
              {loadedText === "" ? null : (
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={isSaving}
                  onClick={() => { void save(null); }}
                  data-testid="chat-instructions-clear"
                >
                  {t("common.delete")}
                </button>
              )}
              <button
                type="submit"
                className="primary-btn"
                disabled={isSaveDisabled}
                aria-busy={isSaving}
                data-testid="chat-instructions-save"
              >
                {isSaving ? <span className="sign-out-link-spinner chat-instructions-save-spinner" aria-hidden="true" /> : null}
                {t("common.save")}
              </button>
            </div>
          ) : null}
        </form>
      </SettingsGroup>
    </SettingsShell>
  );
}

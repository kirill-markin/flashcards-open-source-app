import { useEffect, useEffectEvent, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router";
import { loadWorkspaceChatInstructions, saveWorkspaceChatInstructions } from "../../../api";
import { useAppData } from "../../../appData";
import {
  beginWorkspaceChatInstructionsRequest,
  recordWorkspaceChatInstructions,
  useWorkspaceChatInstructions,
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

/**
 * Opened from the empty chat and from the current-workspace settings; returns to whichever opened it.
 * Keyed by account and workspace, so switching either starts a fresh editor and a save still in flight
 * cannot close or report into the new one.
 */
export function ChatInstructionsScreen(): ReactElement {
  const { session, activeWorkspace } = useAppData();
  return <ChatInstructionsEditor key={`${session?.userId ?? ""}:${activeWorkspace?.workspaceId ?? ""}`} />;
}

function ChatInstructionsEditor(): ReactElement {
  const { session, activeWorkspace, cloudSettings } = useAppData();
  const { t, formatNumber } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const workspacePath = useWorkspacePath();
  const parentPath = (location.state as Readonly<{ parentPath?: string }> | null)?.parentPath ?? null;
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const userId = session?.userId ?? null;
  const stored = useWorkspaceChatInstructions(userId, workspaceId);
  const [text, setText] = useState<string>(stored ?? "");
  const [loadedText, setLoadedText] = useState<string>("");
  const [maxLength, setMaxLength] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadAttempt, setLoadAttempt] = useState<number>(0);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string>("");
  const isMountedRef = useRef<boolean>(true);
  const length = countCodePoints(text);
  const isTooLong = maxLength !== null && length > maxLength;
  const isSaveDisabled = loadState !== "ready" || isSaving || isTooLong || text === loadedText;

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

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (workspaceId === null) {
      return;
    }

    const abortController = new AbortController();
    const token = beginWorkspaceChatInstructionsRequest(workspaceId);
    setLoadState("loading");
    void loadWorkspaceChatInstructions(workspaceId, abortController.signal).then((response) => {
      if (abortController.signal.aborted) {
        return;
      }
      recordWorkspaceChatInstructions(token, response.customInstructions, "read");
      setText(response.customInstructions ?? "");
      setLoadedText(response.customInstructions ?? "");
      setMaxLength(response.maxLength);
      setLoadState("ready");
    }, (error: unknown) => {
      if (abortController.signal.aborted) {
        return;
      }
      reportLoadError(error);
      setLoadState("failed");
    });

    return () => abortController.abort();
  }, [workspaceId, loadAttempt]);

  function leave(): void {
    if (parentPath !== null) {
      void navigate(-1);
      return;
    }
    void navigate(workspacePath(settingsCurrentWorkspaceRoute), { replace: true });
  }

  async function save(): Promise<void> {
    if (workspaceId === null) {
      return;
    }

    const token = beginWorkspaceChatInstructionsRequest(workspaceId);
    setIsSaving(true);
    setSaveErrorMessage("");
    try {
      const trimmed = text.trim();
      const response = await saveWorkspaceChatInstructions(workspaceId, trimmed === "" ? null : trimmed);
      recordWorkspaceChatInstructions(token, response.customInstructions, "write");
      // A save that finishes after the person left must not navigate from wherever they are now.
      if (isMountedRef.current) {
        leave();
      }
    } catch (error) {
      reportError(error, "chat_custom_instructions_save");
      if (isMountedRef.current === false) {
        return;
      }
      setSaveErrorMessage(t("chatPanel.customInstructions.saveFailed"));
      setIsSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isSaveDisabled === false) {
      void save();
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
              placeholder={t("chatPanel.customInstructions.placeholder")}
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
                  onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                  data-testid="chat-instructions-retry"
                >
                  {t("common.retry")}
                </button>
              </span>
            ) : null}
            {maxLength === null ? null : (
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

          <div className="screen-actions">
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
        </form>
      </SettingsGroup>
    </SettingsShell>
  );
}

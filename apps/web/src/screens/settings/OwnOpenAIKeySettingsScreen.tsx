import { useEffect, useId, useState, type ChangeEvent, type ReactElement } from "react";
import { isAuthRedirectError, loadAiUsage } from "../../api";
import { useAppData } from "../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import {
  isOwnOpenAIKeyUnsendable,
  useOwnOpenAIKeySetting,
} from "../../chat/preferences/ownOpenAIKeyStorage";
import { useI18n } from "../../i18n";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

type OwnOpenAIKeyEditorProps = Readonly<{
  onCapturedTechnicalError: (error: unknown) => void;
}>;

export function OwnOpenAIKeyEditor(props: OwnOpenAIKeyEditorProps): ReactElement {
  const { onCapturedTechnicalError } = props;
  const { activeWorkspace, cloudSettings, isSessionVerified, session } = useAppData();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const { t, formatCount, messages } = useI18n();
  const { isEnabled, apiKey, setIsEnabled, setApiKey } = useOwnOpenAIKeySetting();
  const [ownKeyMessages, setOwnKeyMessages] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const apiKeyFieldId = useId();
  const apiKeyErrorId = useId();
  const isApiKeyUnsendable = isOwnOpenAIKeyUnsendable(apiKey);
  const technicalErrorMessage = t("appError.technicalError.message");

  useEffect(() => {
    if (
      indexedDbOpenRecoveryState.hasFailed()
      || isEnabled === false
      || session === null
      || isSessionVerified === false
    ) {
      return;
    }

    let isCancelled = false;

    async function refreshOwnKeyMessagesOnOpen(): Promise<void> {
      try {
        const aiUsage = await loadAiUsage();
        indexedDbOpenRecoveryState.throwIfFailed();
        if (isCancelled === false) {
          setOwnKeyMessages(aiUsage.usage.ownKeyMessages);
          setErrorMessage("");
        }
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }
        if (isCancelled || isAuthRedirectError(error)) {
          return;
        }

        const wasCaptured = captureAppOperationError(error, {
          feature: "settings",
          operation: "ai_usage_load",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: cloudSettings?.installationId ?? null,
          entityId: null,
        });
        if (wasCaptured) {
          onCapturedTechnicalError(error);
          setErrorMessage(technicalErrorMessage);
        } else {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void refreshOwnKeyMessagesOnOpen();

    return () => {
      isCancelled = true;
    };
  }, [indexedDbOpenRecoveryState, isEnabled, isSessionVerified, session?.userId]);

  return (
    <SettingsGroup>
      <article className="content-card settings-toggle-card" data-testid="own-openai-key-settings-card">
        <div className="settings-nav-card-copy">
          <strong className="panel-subtitle">{t("ownOpenAIKeySettings.toggleTitle")}</strong>
          <p className="subtitle">{t("ownOpenAIKeySettings.toggleDescription")}</p>
        </div>
        <button
          className="settings-toggle-control"
          type="button"
          role="switch"
          aria-label={t("ownOpenAIKeySettings.toggleTitle")}
          aria-checked={isEnabled}
          data-state={isEnabled ? "on" : "off"}
          data-testid="own-openai-key-toggle"
          onClick={() => setIsEnabled(isEnabled === false)}
        >
          <span className="settings-toggle-track" aria-hidden="true">
            <span className="settings-toggle-thumb" />
          </span>
          <span className="settings-toggle-value">
            {isEnabled ? t("common.on") : t("common.off")}
          </span>
        </button>
      </article>

      {isEnabled ? (
        <>
          <label className="form-label content-card content-card-section" htmlFor={apiKeyFieldId}>
            <span>{t("ownOpenAIKeySettings.apiKeyLabel")}</span>
            {/*
              A masked text field rather than `type="password"`, so no password manager offers to
              save the key and sync it off this device.
            */}
            <input
              id={apiKeyFieldId}
              name="openaiApiKey"
              type="text"
              className="settings-input settings-input-masked"
              value={apiKey}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={isApiKeyUnsendable}
              aria-describedby={isApiKeyUnsendable ? apiKeyErrorId : undefined}
              data-1p-ignore="true"
              data-lpignore="true"
              data-bwignore="true"
              data-form-type="other"
              data-testid="own-openai-key-input"
              onChange={(event: ChangeEvent<HTMLInputElement>) => setApiKey(event.target.value)}
            />
          </label>
          {isApiKeyUnsendable ? (
            <p id={apiKeyErrorId} className="error-banner" role="alert" data-testid="own-openai-key-invalid">
              {t("ownOpenAIKeySettings.apiKeyInvalid")}
            </p>
          ) : null}
          {ownKeyMessages === null ? null : (
            <p className="subtitle" data-testid="own-openai-key-spend">
              {t("ownOpenAIKeySettings.ownSpend", {
                count: formatCount(ownKeyMessages, messages.ownOpenAIKeySettings.countLabels.message),
              })}
            </p>
          )}
          {errorMessage === "" ? null : (
            <p className="error-banner" role="alert">{errorMessage}</p>
          )}
        </>
      ) : null}
    </SettingsGroup>
  );
}

export function OwnOpenAIKeySettingsScreen(): ReactElement {
  const { t } = useI18n();
  const { showCapturedTechnicalError } = useAppErrorDialog();
  return (
    <SettingsShell
      title={t("ownOpenAIKeySettings.title")}
      subtitle={t("ownOpenAIKeySettings.subtitle")}
      activeTab="general"
    >
      <OwnOpenAIKeyEditor onCapturedTechnicalError={showCapturedTechnicalError} />
    </SettingsShell>
  );
}

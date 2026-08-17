import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  beginAccountDeletionRetryAttempt,
  clearAllLocalBrowserData,
  deleteAccountConfirmationText,
  hasAccountDeletionAttemptDispatched,
  isAccountDeletionPending,
  isAccountDeletionServerConfirmed,
  loadAccountDeletionAttemptId,
  loadAccountDeletionCsrfToken,
  markAccountDeletionAttemptDispatched,
  markAccountDeletionServerConfirmed,
  runWithAccountDeletionLock,
  setAccountDeletionPending,
  subscribeToAccountDeletionPending,
} from "./accountDeletion";
import { useAppData } from "./appData";
import { useAppErrorDialog } from "./appError/AppErrorContext";
import {
  ApiError,
  ApiContractError,
  buildLogoutLocalUrl,
  deleteMyAccount,
  primeSessionCsrfToken,
} from "./api";
import { useI18n } from "./i18n";
import { captureApiContractError } from "./observability/apiContractObservation";
import { captureAppOperationError } from "./observability/appOperationObservation";

type AccountDeletionRecoveryGateProps = Readonly<{
  children: ReactElement;
}>;

export function AccountDeletionRecoveryGate(props: AccountDeletionRecoveryGateProps): ReactElement {
  const { children } = props;
  const { t } = useI18n();
  const {
    sessionLoadState,
    isSessionVerified,
    sessionErrorMessage,
    sessionTechnicalError,
    session,
    activeWorkspace,
    initialize,
    cloudSettings,
  } = useAppData();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const [isAccountDeletionPendingState, setIsAccountDeletionPendingState] = useState<boolean>(isAccountDeletionPending);
  const [accountDeletionErrorMessage, setAccountDeletionErrorMessage] = useState<string>("");
  const [accountDeletionTechnicalError, setAccountDeletionTechnicalError] = useState<Error | null>(null);
  const [isAccountDeletionSubmitting, setIsAccountDeletionSubmitting] = useState<boolean>(false);
  const visibleTechnicalErrorMessage = t("appError.technicalError.message");
  const visibleSessionErrorMessage = sessionErrorMessage === ""
    ? ""
    : sessionTechnicalError === null
      ? sessionErrorMessage
      : visibleTechnicalErrorMessage;
  const visibleAccountDeletionErrorMessage = accountDeletionErrorMessage === ""
    ? ""
    : accountDeletionTechnicalError === null
      ? accountDeletionErrorMessage
      : visibleTechnicalErrorMessage;
  const visiblePendingAccountDeletionErrorMessage = visibleAccountDeletionErrorMessage === ""
    ? visibleSessionErrorMessage
    : visibleAccountDeletionErrorMessage;

  const reportAccountDeletionError = useCallback(function reportAccountDeletionError(error: unknown): void {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    let wasCaptured = false;
    if (normalizedError instanceof ApiContractError) {
      captureApiContractError(normalizedError, {
        feature: "auth",
        sourceAction: "account_deletion_submit",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
      });
      wasCaptured = true;
    } else {
      wasCaptured = captureAppOperationError(normalizedError, {
        feature: "auth",
        operation: "account_deletion_submit",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: null,
      });
    }

    setAccountDeletionErrorMessage(normalizedError.message);
    setAccountDeletionTechnicalError(wasCaptured ? normalizedError : null);
    if (wasCaptured) {
      showCapturedTechnicalError(normalizedError);
    }
  }, [activeWorkspace?.workspaceId, cloudSettings?.installationId, session?.userId, showCapturedTechnicalError]);

  const completeAccountDeletion = useCallback(async function completeAccountDeletion(): Promise<void> {
    let didStartSubmission = false;
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      if (isSessionVerified === false) {
        if (sessionLoadState !== "error") {
          return;
        }

        didStartSubmission = true;
        setIsAccountDeletionSubmitting(true);
        setAccountDeletionErrorMessage("");
        setAccountDeletionTechnicalError(null);
        await initialize();
        indexedDbOpenRecoveryState.throwIfFailed();
        return;
      }

      await runWithAccountDeletionLock(
        indexedDbOpenRecoveryState.signal,
        async (): Promise<void> => {
          indexedDbOpenRecoveryState.throwIfFailed();
          if (isAccountDeletionPending() === false) {
            return;
          }

          const isServerConfirmed = isAccountDeletionServerConfirmed();
          if (isServerConfirmed === false && hasAccountDeletionAttemptDispatched()) {
            return;
          }

          didStartSubmission = true;
          setIsAccountDeletionSubmitting(true);
          setAccountDeletionErrorMessage("");
          setAccountDeletionTechnicalError(null);

          if (isServerConfirmed === false) {
            const persistedCsrfToken = loadAccountDeletionCsrfToken();
            if (persistedCsrfToken !== null) {
              primeSessionCsrfToken(persistedCsrfToken);
            }

            markAccountDeletionAttemptDispatched();
            try {
              await deleteMyAccount(deleteAccountConfirmationText);
              markAccountDeletionServerConfirmed();
            } catch (error) {
              if ((error instanceof ApiError) === false || error.code !== "ACCOUNT_DELETED") {
                indexedDbOpenRecoveryState.throwIfFailed();
                throw error;
              }

              markAccountDeletionServerConfirmed();
            }
          }

          indexedDbOpenRecoveryState.throwIfFailed();
          await clearAllLocalBrowserData(
            "account_deletion_submit",
            indexedDbOpenRecoveryState.throwIfFailed,
          );
          indexedDbOpenRecoveryState.throwIfFailed();
          window.location.href = buildLogoutLocalUrl();
          setAccountDeletionPending(false);
        },
      );
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      indexedDbOpenRecoveryState.markFailed(error);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }
      reportAccountDeletionError(error);
    } finally {
      if (didStartSubmission && indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsAccountDeletionSubmitting(false);
      }
    }
  }, [indexedDbOpenRecoveryState, initialize, isSessionVerified, reportAccountDeletionError, sessionLoadState]);

  const retryAccountDeletion = useCallback(async function retryAccountDeletion(): Promise<void> {
    if (
      isAccountDeletionServerConfirmed()
      || (isSessionVerified === false && hasAccountDeletionAttemptDispatched() === false)
    ) {
      await completeAccountDeletion();
      return;
    }

    const expectedAttemptId = loadAccountDeletionAttemptId();
    if (expectedAttemptId === null) {
      return;
    }

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const didBeginRetryAttempt = await runWithAccountDeletionLock(
        indexedDbOpenRecoveryState.signal,
        async (): Promise<boolean> => {
          indexedDbOpenRecoveryState.throwIfFailed();
          return beginAccountDeletionRetryAttempt(expectedAttemptId);
        },
      );
      indexedDbOpenRecoveryState.throwIfFailed();
      if (didBeginRetryAttempt === false) {
        return;
      }

      await completeAccountDeletion();
    } catch (error) {
      indexedDbOpenRecoveryState.markFailed(error);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }
      reportAccountDeletionError(error);
    }
  }, [completeAccountDeletion, indexedDbOpenRecoveryState, isSessionVerified, reportAccountDeletionError]);

  useEffect(() => subscribeToAccountDeletionPending(() => {
    setIsAccountDeletionPendingState(isAccountDeletionPending());
  }), []);

  useEffect(() => {
    if (
      isSessionVerified
      && isAccountDeletionPendingState
      && !isAccountDeletionSubmitting
      && accountDeletionErrorMessage === ""
    ) {
      void completeAccountDeletion();
    }
  }, [accountDeletionErrorMessage, completeAccountDeletion, isAccountDeletionPendingState, isAccountDeletionSubmitting, isSessionVerified]);

  if (isAccountDeletionPendingState) {
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <h1 className="title">{t("app.deleteAccountTitle")}</h1>
          <p className="subtitle">
            {isSessionVerified
              ? t("app.deleteAccountInProgress")
              : t("app.deleteAccountRestoring")}
          </p>
          {visiblePendingAccountDeletionErrorMessage !== "" ? <p className="error-banner">{visiblePendingAccountDeletionErrorMessage}</p> : null}
          <button
            className="primary-btn"
            type="button"
            disabled={isAccountDeletionSubmitting || (isSessionVerified === false && sessionLoadState !== "error")}
            onClick={() => void retryAccountDeletion()}
          >
            {isAccountDeletionSubmitting ? t("app.deleting") : t("app.deleteAccountRetry")}
          </button>
        </section>
      </main>
    );
  }

  return children;
}

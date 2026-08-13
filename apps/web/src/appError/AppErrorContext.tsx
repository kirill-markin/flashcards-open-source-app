import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { type TranslationKey, type TranslationValues, useI18n } from "../i18n";
import { isIndexedDbOpenRecoveryError } from "../localDb/core/indexedDbOpenRecovery";
import { captureAppOperationError } from "../observability/appOperationObservation";
import type { WebAppOperation, WebObservationFeature } from "../observability/webObservability";
import { AppErrorDialog } from "./AppErrorDialog";
import {
  buildAppErrorPresentation,
  type AppErrorAction,
  type AppErrorPresentation,
  type AppErrorPresentationMessages,
} from "./appErrorPresentation";

type AppErrorTranslate = (key: TranslationKey, values?: TranslationValues) => string;

export type AppTechnicalErrorContext = Readonly<{
  feature: WebObservationFeature;
  operation: WebAppOperation;
  userId: string | null;
  workspaceId: string | null;
  installationId: string | null;
  entityId: string | null;
}>;

export type IndexedDbOpenRecoveryState = Readonly<{
  hasFailed: () => boolean;
  markFailed: (error: unknown) => IndexedDbOpenRecoveryMarkResult;
}>;

export type IndexedDbOpenRecoveryMarkResult = "not_recovery" | "first_failure" | "first_failure_repeat" | "later_failure";

export function isIndexedDbOpenRecoveryFailureMark(result: IndexedDbOpenRecoveryMarkResult): boolean {
  return result !== "not_recovery";
}

export function ownsIndexedDbOpenRecoveryFailure(result: IndexedDbOpenRecoveryMarkResult): boolean {
  return result === "first_failure" || result === "first_failure_repeat";
}

type AppErrorDialogContextValue = Readonly<{
  showTechnicalError: (error: unknown, context: AppTechnicalErrorContext) => boolean;
  showCapturedTechnicalError: (error: unknown) => void;
  showTechnicalErrorPreview: () => void;
  dismiss: () => void;
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
}>;

type AppErrorDialogProviderProps = Readonly<{
  children: ReactNode;
}>;

const AppErrorDialogContext = createContext<AppErrorDialogContextValue | null>(null);

function buildPresentationMessages(t: AppErrorTranslate): AppErrorPresentationMessages {
  return {
    technicalError: {
      title: t("appError.technicalError.title"),
      message: t("appError.technicalError.message"),
      close: t("appError.technicalError.close"),
    },
    indexedDbReloadRecovery: {
      title: t("appError.indexedDbReloadRecovery.title"),
      message: t("appError.indexedDbReloadRecovery.message"),
      guidance: t("appError.indexedDbReloadRecovery.guidance"),
      reload: t("appError.indexedDbReloadRecovery.reload"),
      later: t("appError.indexedDbReloadRecovery.later"),
    },
    labels: {
      name: t("appError.technicalError.labels.name"),
      message: t("appError.technicalError.labels.message"),
      endpoint: t("appError.technicalError.labels.endpoint"),
      requestId: t("appError.technicalError.labels.requestId"),
      statusCode: t("appError.technicalError.labels.statusCode"),
      code: t("appError.technicalError.labels.code"),
      bodyKind: t("appError.technicalError.labels.bodyKind"),
      attemptCount: t("appError.technicalError.labels.attemptCount"),
      originalErrorName: t("appError.technicalError.labels.originalErrorName"),
      unavailable: t("common.unavailable"),
    },
  };
}

function buildPreviewError(): Error {
  const previewError = new Error("Preview technical failure for dialog testing.");
  previewError.name = "AppErrorPreview";

  return previewError;
}

export function AppErrorDialogProvider(props: AppErrorDialogProviderProps): ReactElement {
  const { children } = props;
  const { t } = useI18n();
  const [presentation, setPresentation] = useState<AppErrorPresentation | null>(null);
  const indexedDbOpenRecoveryRef = useRef<{
    firstError: Error | null;
    hasPresented: boolean;
    isPresenting: boolean;
  }>({ firstError: null, hasPresented: false, isPresenting: false });

  const hasIndexedDbOpenRecoveryFailed = useCallback((): boolean => indexedDbOpenRecoveryRef.current.firstError !== null, []);

  const markIndexedDbOpenRecoveryFailed = useCallback((error: unknown): IndexedDbOpenRecoveryMarkResult => {
    if (isIndexedDbOpenRecoveryError(error) === false) {
      return "not_recovery";
    }

    const firstError = indexedDbOpenRecoveryRef.current.firstError;
    if (firstError === null) {
      indexedDbOpenRecoveryRef.current = {
        firstError: error,
        hasPresented: true,
        isPresenting: true,
      };
      setPresentation(buildAppErrorPresentation(error, buildPresentationMessages(t)));
      return "first_failure";
    }

    return firstError === error ? "first_failure_repeat" : "later_failure";
  }, [t]);

  const dismiss = useCallback((): void => {
    indexedDbOpenRecoveryRef.current.isPresenting = false;
    setPresentation(null);
  }, []);

  const performAction = useCallback((action: AppErrorAction): void => {
    if (action.kind === "dismiss") {
      dismiss();
      return;
    }

    window.location.reload();
  }, [dismiss]);

  const showCapturedTechnicalError = useCallback((error: unknown): void => {
    const markResult = markIndexedDbOpenRecoveryFailed(error);
    if (markResult !== "not_recovery") {
      return;
    }

    const recoveryState = indexedDbOpenRecoveryRef.current;
    if (recoveryState.firstError !== null && (recoveryState.hasPresented === false || recoveryState.isPresenting)) {
      return;
    }

    setPresentation(buildAppErrorPresentation(error, buildPresentationMessages(t)));
  }, [markIndexedDbOpenRecoveryFailed, t]);

  const showTechnicalError = useCallback((error: unknown, context: AppTechnicalErrorContext): boolean => {
    const wasCaptured = captureAppOperationError(error, {
      feature: context.feature,
      operation: context.operation,
      userId: context.userId,
      workspaceId: context.workspaceId,
      installationId: context.installationId,
      entityId: context.entityId,
    });

    if (wasCaptured) {
      showCapturedTechnicalError(error);
    }

    return wasCaptured;
  }, [showCapturedTechnicalError]);

  const showTechnicalErrorPreview = useCallback((): void => {
    setPresentation(buildAppErrorPresentation(buildPreviewError(), buildPresentationMessages(t)));
  }, [t]);

  const indexedDbOpenRecoveryState = useMemo((): IndexedDbOpenRecoveryState => ({
    hasFailed: hasIndexedDbOpenRecoveryFailed,
    markFailed: markIndexedDbOpenRecoveryFailed,
  }), [hasIndexedDbOpenRecoveryFailed, markIndexedDbOpenRecoveryFailed]);

  const contextValue = useMemo((): AppErrorDialogContextValue => ({
    showTechnicalError,
    showCapturedTechnicalError,
    showTechnicalErrorPreview,
    dismiss,
    indexedDbOpenRecoveryState,
  }), [dismiss, indexedDbOpenRecoveryState, showCapturedTechnicalError, showTechnicalError, showTechnicalErrorPreview]);

  return (
    <AppErrorDialogContext.Provider value={contextValue}>
      {children}
      <AppErrorDialog presentation={presentation} onAction={performAction} onDismiss={dismiss} />
    </AppErrorDialogContext.Provider>
  );
}

export function useAppErrorDialog(): AppErrorDialogContextValue {
  const contextValue = useContext(AppErrorDialogContext);

  if (contextValue === null) {
    throw new Error("useAppErrorDialog must be used within AppErrorDialogProvider");
  }

  return contextValue;
}

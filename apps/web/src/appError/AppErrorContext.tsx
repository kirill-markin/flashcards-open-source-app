import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { bindIndexedDbOpenRecoverySignal } from "../api/transport/transport";
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
  isFailed: boolean;
  markFailed: (error: unknown) => IndexedDbOpenRecoveryMarkResult;
  signal: AbortSignal;
  throwIfFailed: () => void;
}>;

export type IndexedDbOpenRecoveryMarkResult = "not_recovery" | "first_failure" | "first_failure_repeat" | "later_failure";

export function isIndexedDbOpenRecoveryFailureMark(result: IndexedDbOpenRecoveryMarkResult): boolean {
  return result !== "not_recovery";
}

export function markIndexedDbOpenRecoveryFailureAndCheckActive(
  state: IndexedDbOpenRecoveryState,
  error: unknown,
): boolean {
  const markResult = state.markFailed(error);
  const hasFailed = state.hasFailed();
  return isIndexedDbOpenRecoveryFailureMark(markResult) || hasFailed;
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
  const [isIndexedDbOpenRecoveryFailed, setIsIndexedDbOpenRecoveryFailed] = useState<boolean>(false);
  const [indexedDbOpenRecoveryAbortController] = useState<AbortController>(() => new AbortController());
  const indexedDbOpenRecoveryRef = useRef<{
    firstError: Error | null;
  }>({ firstError: null });

  useLayoutEffect(() => bindIndexedDbOpenRecoverySignal(indexedDbOpenRecoveryAbortController.signal), [
    indexedDbOpenRecoveryAbortController,
  ]);

  const hasIndexedDbOpenRecoveryFailed = useCallback((): boolean => indexedDbOpenRecoveryRef.current.firstError !== null, []);

  const throwIfIndexedDbOpenRecoveryFailed = useCallback((): void => {
    const firstError = indexedDbOpenRecoveryRef.current.firstError;
    if (firstError !== null) {
      throw firstError;
    }
  }, []);

  const markIndexedDbOpenRecoveryFailed = useCallback((error: unknown): IndexedDbOpenRecoveryMarkResult => {
    if (isIndexedDbOpenRecoveryError(error) === false) {
      return "not_recovery";
    }

    const firstError = indexedDbOpenRecoveryRef.current.firstError;
    if (firstError === null) {
      indexedDbOpenRecoveryRef.current = {
        firstError: error,
      };
      indexedDbOpenRecoveryAbortController.abort(error);
      setIsIndexedDbOpenRecoveryFailed(true);
      setPresentation(buildAppErrorPresentation(error, buildPresentationMessages(t)));
      return "first_failure";
    }

    return firstError === error ? "first_failure_repeat" : "later_failure";
  }, [indexedDbOpenRecoveryAbortController, t]);

  const dismiss = useCallback((): void => {
    if (indexedDbOpenRecoveryRef.current.firstError !== null) {
      return;
    }

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

    if (indexedDbOpenRecoveryRef.current.firstError !== null) {
      return;
    }

    setPresentation(buildAppErrorPresentation(error, buildPresentationMessages(t)));
  }, [markIndexedDbOpenRecoveryFailed, t]);

  const showTechnicalError = useCallback((error: unknown, context: AppTechnicalErrorContext): boolean => {
    const markResult = markIndexedDbOpenRecoveryFailed(error);
    if (markResult !== "not_recovery" || indexedDbOpenRecoveryRef.current.firstError !== null) {
      return false;
    }

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
  }, [markIndexedDbOpenRecoveryFailed, showCapturedTechnicalError]);

  const showTechnicalErrorPreview = useCallback((): void => {
    if (indexedDbOpenRecoveryRef.current.firstError !== null) {
      return;
    }

    setPresentation(buildAppErrorPresentation(buildPreviewError(), buildPresentationMessages(t)));
  }, [t]);

  const indexedDbOpenRecoveryState = useMemo((): IndexedDbOpenRecoveryState => ({
    hasFailed: hasIndexedDbOpenRecoveryFailed,
    isFailed: isIndexedDbOpenRecoveryFailed,
    markFailed: markIndexedDbOpenRecoveryFailed,
    signal: indexedDbOpenRecoveryAbortController.signal,
    throwIfFailed: throwIfIndexedDbOpenRecoveryFailed,
  }), [
    hasIndexedDbOpenRecoveryFailed,
    isIndexedDbOpenRecoveryFailed,
    indexedDbOpenRecoveryAbortController,
    markIndexedDbOpenRecoveryFailed,
    throwIfIndexedDbOpenRecoveryFailed,
  ]);

  const contextValue = useMemo((): AppErrorDialogContextValue => ({
    showTechnicalError,
    showCapturedTechnicalError,
    showTechnicalErrorPreview,
    dismiss,
    indexedDbOpenRecoveryState,
  }), [dismiss, indexedDbOpenRecoveryState, showCapturedTechnicalError, showTechnicalError, showTechnicalErrorPreview]);

  return (
    <AppErrorDialogContext.Provider value={contextValue}>
      {isIndexedDbOpenRecoveryFailed ? null : children}
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

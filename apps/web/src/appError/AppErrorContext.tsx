import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { type TranslationKey, type TranslationValues, useI18n } from "../i18n";
import { captureAppOperationError } from "../observability/appOperationObservation";
import type { WebAppOperation, WebObservationFeature } from "../observability/webObservability";
import { AppErrorDialog } from "./AppErrorDialog";
import {
  buildAppErrorPresentation,
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

type AppErrorDialogContextValue = Readonly<{
  showTechnicalError: (error: unknown, context: AppTechnicalErrorContext) => void;
  showCapturedTechnicalError: (error: unknown) => void;
  showTechnicalErrorPreview: () => void;
  dismiss: () => void;
}>;

type AppErrorDialogProviderProps = Readonly<{
  children: ReactNode;
}>;

const AppErrorDialogContext = createContext<AppErrorDialogContextValue | null>(null);

function buildPresentationMessages(t: AppErrorTranslate): AppErrorPresentationMessages {
  return {
    title: t("appError.technicalError.title"),
    message: t("appError.technicalError.message"),
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

  const dismiss = useCallback((): void => {
    setPresentation(null);
  }, []);

  const showTechnicalError = useCallback((error: unknown, context: AppTechnicalErrorContext): void => {
    captureAppOperationError(error, {
      feature: context.feature,
      operation: context.operation,
      userId: context.userId,
      workspaceId: context.workspaceId,
      installationId: context.installationId,
      entityId: context.entityId,
    });

    setPresentation(buildAppErrorPresentation(error, buildPresentationMessages(t)));
  }, [t]);

  const showCapturedTechnicalError = useCallback((error: unknown): void => {
    setPresentation(buildAppErrorPresentation(error, buildPresentationMessages(t)));
  }, [t]);

  const showTechnicalErrorPreview = useCallback((): void => {
    setPresentation(buildAppErrorPresentation(buildPreviewError(), buildPresentationMessages(t)));
  }, [t]);

  const contextValue = useMemo((): AppErrorDialogContextValue => ({
    showTechnicalError,
    showCapturedTechnicalError,
    showTechnicalErrorPreview,
    dismiss,
  }), [dismiss, showCapturedTechnicalError, showTechnicalError, showTechnicalErrorPreview]);

  return (
    <AppErrorDialogContext.Provider value={contextValue}>
      {children}
      <AppErrorDialog presentation={presentation} onDismiss={dismiss} />
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

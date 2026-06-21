import { getErrorMessage } from "../../appData/domain";
import {
  isCapturedSyncFailure,
  isExpectedUnobservedSyncFailure,
} from "../../appData/sync/observation/syncErrorObservation";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import type {
  WebAppOperation,
  WebObservationFeature,
} from "../../observability/webObservability";

type RefreshLocalDataErrorContext = Readonly<{
  feature: WebObservationFeature;
  operation: WebAppOperation;
  userId: string | null;
  workspaceId: string | null;
  installationId: string | null;
  entityId: string | null;
}>;

type HandleRefreshLocalDataErrorInput = Readonly<{
  error: unknown;
  context: RefreshLocalDataErrorContext;
  setErrorMessage: (message: string) => void;
  showCapturedTechnicalError: (error: unknown) => void;
  technicalErrorMessage: string;
}>;

export function handleRefreshLocalDataError(input: HandleRefreshLocalDataErrorInput): void {
  if (isCapturedSyncFailure(input.error)) {
    input.showCapturedTechnicalError(input.error);
    input.setErrorMessage(input.technicalErrorMessage);
    return;
  }

  if (isExpectedUnobservedSyncFailure(input.error)) {
    input.setErrorMessage(getErrorMessage(input.error));
    return;
  }

  const wasCaptured = captureAppOperationError(input.error, input.context);
  if (wasCaptured) {
    input.showCapturedTechnicalError(input.error);
    input.setErrorMessage(input.technicalErrorMessage);
    return;
  }

  input.setErrorMessage(getErrorMessage(input.error));
}

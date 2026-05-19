import { HttpError } from "../errors";
import {
  captureBackendException,
  captureBackendWarning,
  createBackendObservationScope,
  normalizeCaughtError,
} from "../observability/sentry";

export const chatResumeContractViolationCode = "CHAT_LIVE_RESUME_CONTRACT_VIOLATION";

export type ChatResumeDiagnosticsHeaders = Readonly<{
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
}>;

type ChatResumeContractViolationDetails = Readonly<{
  violationReason: string;
  requestId: string | null;
  userId: string;
  workspaceId: string;
  sessionId: string;
  resolvedLiveCursor: string | null;
  snapshotRunState: string | null;
  latestAssistantItemId: string | null;
  latestAssistantItemOrder: number | null;
  latestAssistantState: string | null;
  inProgressAssistantItemId: string | null;
  inProgressAssistantItemOrder: number | null;
  terminationReason: string | null;
}>;

function readOptionalRequestHeader(request: Request, headerName: string): string | null {
  const value = request.headers.get(headerName);
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? null : trimmedValue;
}

export function readChatResumeDiagnosticsHeaders(request: Request): ChatResumeDiagnosticsHeaders {
  return {
    resumeAttemptId: readOptionalRequestHeader(request, "X-Chat-Resume-Attempt-Id"),
    clientPlatform: readOptionalRequestHeader(request, "X-Client-Platform"),
    clientVersion: readOptionalRequestHeader(request, "X-Client-Version"),
  };
}

export function logChatResumeContractViolation(
  request: Request,
  diagnostics: ChatResumeDiagnosticsHeaders,
  details: ChatResumeContractViolationDetails,
): void {
  const path = new URL(request.url).pathname;
  captureBackendWarning({
    action: "chat_resume_contract_violation",
    message: "Chat live resume contract violation.",
    scope: createBackendObservationScope(
      "backend-api",
      details.requestId,
      path,
      request.method,
      details.userId,
      details.workspaceId,
      null,
      null,
      details.sessionId,
    ),
    details: {
      path,
      method: request.method,
      resumeAttemptId: diagnostics.resumeAttemptId,
      clientPlatform: diagnostics.clientPlatform,
      clientVersion: diagnostics.clientVersion,
      violationReason: details.violationReason,
      resolvedLiveCursor: details.resolvedLiveCursor,
      snapshotRunState: details.snapshotRunState,
      latestAssistantItemId: details.latestAssistantItemId,
      latestAssistantItemOrder: details.latestAssistantItemOrder,
      latestAssistantState: details.latestAssistantState,
      inProgressAssistantItemId: details.inProgressAssistantItemId,
      inProgressAssistantItemOrder: details.inProgressAssistantItemOrder,
      terminationReason: details.terminationReason,
    },
  });
}

export function captureUnexpectedChatLiveEnvelopeError(
  request: Request,
  requestId: string | null,
  userId: string,
  workspaceId: string,
  sessionId: string,
  runId: string,
  error: unknown,
): void {
  const path = new URL(request.url).pathname;
  captureBackendException({
    action: "request_failed",
    error: normalizeCaughtError(error),
    scope: createBackendObservationScope(
      "backend-api",
      requestId,
      path,
      request.method,
      userId,
      workspaceId,
      null,
      runId,
      sessionId,
    ),
    details: {
      statusCode: 500,
      code: chatResumeContractViolationCode,
      message: "Unexpected chat live envelope creation failure.",
      validationIssues: [],
    },
  });
}

export function createChatResumeContractViolationError(): HttpError {
  return new HttpError(500, "Chat live resume contract violation", chatResumeContractViolationCode);
}

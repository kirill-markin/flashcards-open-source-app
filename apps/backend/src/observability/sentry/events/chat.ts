import type { EventByAction } from "./common";

export type ChatLiveRequestDetails = Readonly<{
  statusCode: number;
  path: string;
  sessionId: string | null;
  runId: string | null;
  afterCursor: string | null;
  hasToken: boolean;
  hasWorkspaceId: boolean;
  origin: string | null;
  authScheme: string;
  clientRequestId: string | null;
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
  code: string | null;
  message: string | null;
}>;

export type ChatLiveAttachDetails = Readonly<{
  statusCode: number;
  path: string;
  sessionId: string;
  runId: string;
  afterCursor: number | null;
  hasToken: boolean;
  hasWorkspaceId: boolean;
  origin: string | null;
  authScheme: string;
  clientRequestId: string | null;
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
}>;

export type ChatLiveStreamCrashDetails = Readonly<{
  statusCode: number;
  path: string;
  sessionId: string;
  runId: string;
  afterCursor: number | null;
  hasToken: boolean;
  hasWorkspaceId: boolean;
  origin: string | null;
  authScheme: string;
  clientRequestId: string | null;
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
}>;

export type ChatLiveBootstrapFailureDetails = Readonly<{
  statusCode: number;
  path: string;
  sessionId: string | null;
  runId: string | null;
  afterCursor: string | null;
  hasToken: boolean;
  hasWorkspaceId: boolean;
  origin: string | null;
  authScheme: string;
  clientRequestId: string | null;
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
  code: string;
  message: string;
}>;

export type ChatLiveLifecycleDetails = Readonly<{
  afterCursor: number | null;
  clientRequestId: string | null;
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
  connectionDurationMs: number | null;
  terminationReason: string | null;
  closeReason: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
}>;

export type ChatWorkerLifecycleDetails = Readonly<{
  lambdaRequestId: string | null;
  abortReason: string | null;
  signalAborted: boolean;
  cancellationRequested: boolean;
  ownershipLost: boolean;
  runStatus: string | null;
  sessionState: string | null;
  providerErrorClass: string | null;
  providerErrorMessage: null;
  providerErrorStatus?: number | null;
  providerErrorCode?: string | null;
  providerErrorType: string | null;
  providerErrorParam: string | null;
  providerErrorCategory?: string | null;
  providerRequestId: string | null;
  // Shape of the provider event stream that produced a terminal failure. Counts,
  // lengths and enum-like strings only, so a truncated stream stays diagnosable
  // without ever carrying provider text, prompt text or attachment content.
  streamResponseId?: string | null;
  streamEventCount?: number | null;
  streamLastEventType?: string | null;
  streamSawIncompleteEvent?: boolean | null;
  streamSawFailedEvent?: boolean | null;
  streamedTextLength?: number | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: string | null;
}>;

export type ChatWorkerDispatchFailureDetails = Readonly<{
  message: string;
}>;

export type ChatWorkerFailureDetails = Readonly<{
  lambdaRequestId: string | null;
  routeRequestId: string | null;
  chatRequestId: string | null;
  runId: string;
  sessionId: string | null;
  userId: string;
  workspaceId: string;
  statusCode: number | null;
  code: string | null;
  message: string;
}>;

export type ChatTranscriptionFailureDetails = Readonly<{
  requestId: string;
  sessionId: string;
  source: "android" | "ios" | "web";
  provider: "openai";
  fileSize: number;
  fileExtension: string | null;
  mediaType: string;
  upstreamStatus: number | null;
  upstreamRequestId: string | null;
  errorClass: string;
  errorMessage: string;
}>;

export type GeneratedCardImageProviderDetails = Readonly<{
  model: string;
  size: string;
  quality: string;
  outputFormat: string;
  promptLength: number;
  attempt: number;
  maximumAttempts: number;
  retryDelayMs: number | null;
  durationMs: number;
  requestTimeoutMs: number;
  retrySkippedForBudget: boolean;
  providerStatus: number | null;
  providerRequestId: string | null;
  providerErrorType: string | null;
  providerErrorCode: string | null;
  providerErrorParam: string | null;
  providerModerationStage: string | null;
  providerModerationCategories: ReadonlyArray<string>;
  errorClass: string | null;
}>;

export type McpWorkspaceSelectionEnrichmentFailureDetails = Readonly<{
  code: "WORKSPACE_SELECTION_REQUIRED";
  enrichmentPath: "mcp_workspace_selection_details";
  toolName: string;
  errorClass: string;
  errorMessage: string;
}>;

export type LangfuseTelemetryFlushFailureDetails = Readonly<{
  errorClass: string;
  errorMessage: string;
  telemetryStarted: boolean;
  hasTracerProvider: boolean;
}>;

export type LangfuseChatTurnExportFailureDetails = Readonly<{
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  model: string;
  turnIndex: number;
  runState: string;
  errorClass: string;
  errorMessage: string;
}>;

export type LangfuseChatTurnStartFailureDetails = Readonly<{
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  model: string;
  turnIndex: number;
  runState: string;
  errorClass: string;
  errorMessage: string;
}>;

export type LangfuseChatTranscriptionExportFailureDetails = Readonly<{
  requestId: string;
  userId: string;
  sessionId: string;
  source: string;
  fileExtension: string | null;
  mediaType: string;
  fileSize: number;
  errorClass: string;
  errorMessage: string;
}>;

export type LangfuseChatTranscriptionStartFailureDetails = Readonly<{
  requestId: string;
  userId: string;
  sessionId: string;
  source: string;
  fileExtension: string | null;
  mediaType: string;
  fileSize: number;
  errorClass: string;
  errorMessage: string;
}>;

export type ChatBreadcrumbEvent =
  | EventByAction<"chat_live_attach_start", ChatLiveAttachDetails>
  | EventByAction<"chat_live_request_error", ChatLiveRequestDetails>
  | EventByAction<"chat_live_client_disconnected", ChatLiveLifecycleDetails>
  | EventByAction<"chat_live_stream_closed", ChatLiveLifecycleDetails>
  | EventByAction<"chat_worker_skip", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_claimed", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_finish", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_abort_requested", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_provider_call_started", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_provider_call_aborted", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_terminal_state_persisted", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_worker_composer_suggestions_failed", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_transcription_invalid_audio", ChatTranscriptionFailureDetails>
  | EventByAction<"generated_card_image_provider_complete", GeneratedCardImageProviderDetails>;

export type ChatWarningEvent =
  | (EventByAction<"chat_live_backlog_failed", ChatLiveLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_live_write_failed", ChatLiveLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_worker_terminal_state_persisted", ChatWorkerLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_worker_composer_suggestions_failed", ChatWorkerLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_transcription_failed", ChatTranscriptionFailureDetails> & Readonly<{ message: string }>)
  | (EventByAction<
    "generated_card_image_provider_retry",
    GeneratedCardImageProviderDetails
  > & Readonly<{ message: string }>)
  | (EventByAction<
    "generated_card_image_provider_failed",
    GeneratedCardImageProviderDetails
  > & Readonly<{ message: string }>)
  | (EventByAction<
    "mcp_workspace_selection_enrichment_failed",
    McpWorkspaceSelectionEnrichmentFailureDetails
  > & Readonly<{ message: string }>)
  | EventByAction<"langfuse_telemetry_flush_failed", LangfuseTelemetryFlushFailureDetails>
  | EventByAction<"langfuse_chat_turn_export_failed", LangfuseChatTurnExportFailureDetails>
  | EventByAction<"langfuse_chat_turn_start_failed", LangfuseChatTurnStartFailureDetails>
  | EventByAction<"langfuse_chat_transcription_export_failed", LangfuseChatTranscriptionExportFailureDetails>
  | EventByAction<"langfuse_chat_transcription_start_failed", LangfuseChatTranscriptionStartFailureDetails>
  | (EventByAction<"chat_resume_contract_violation", Readonly<{
    path: string;
    method: string;
    resumeAttemptId: string | null;
    clientPlatform: string | null;
    clientVersion: string | null;
    violationReason: string;
    resolvedLiveCursor: string | null;
    snapshotRunState: string | null;
    latestAssistantItemId: string | null;
    latestAssistantItemOrder: number | null;
    latestAssistantState: string | null;
    inProgressAssistantItemId: string | null;
    inProgressAssistantItemOrder: number | null;
    terminationReason: string | null;
  }>> & Readonly<{ message: string }>);

export type ChatExceptionEvent =
  | (EventByAction<"chat_worker_dispatch_failed", ChatWorkerDispatchFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_worker_failed", ChatWorkerFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_live_bootstrap_failed", ChatLiveBootstrapFailureDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_live_request_error", ChatLiveRequestDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_live_stream_crashed", ChatLiveStreamCrashDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_live_poll_failed", ChatLiveLifecycleDetails> & Readonly<{ error: Error }>)
  | (EventByAction<"chat_worker_terminal_state_persisted", ChatWorkerLifecycleDetails> & Readonly<{ error: Error }>);

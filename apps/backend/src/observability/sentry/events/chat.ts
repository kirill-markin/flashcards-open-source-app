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
  liveAttachClientId: string | null;
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
  // What the run was doing when an abort was requested, so a stall names the hung step.
  executionPhase?: string | null;
  toolName?: string | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: string | null;
}>;

/** Names which OpenAI key the run used, because whether a terminal failure pages depends on it. */
export type ChatWorkerTerminalStateDetails = ChatWorkerLifecycleDetails & Readonly<{
  userSuppliedKey: boolean;
}>;

/** A model call OpenAI overloaded mid-stream before any output reached the client, about to be retried. */
export type ChatWorkerProviderCallRetriedDetails = Readonly<{
  callIndex: number;
  userSuppliedKey: boolean;
  providerErrorCode: string | null;
  providerErrorType: string | null;
  providerRequestId: string | null;
  retryDelayMs: number;
}>;

/** A run heartbeat that threw; enough of them in a row and the run is repaired as interrupted. */
export type ChatWorkerHeartbeatFailedDetails = Readonly<{
  lambdaRequestId: string | null;
  errorClass: string;
  errorMessage: string;
  sqlState: string | null;
  elapsedMs: number;
  timerLagMs: number;
}>;

/** A heartbeat tick that wrote nothing because the previous heartbeat was still pending. */
export type ChatWorkerHeartbeatSkippedDetails = Readonly<{
  lambdaRequestId: string | null;
  pendingMs: number;
}>;

/** A heartbeat timer that fired this late means the event loop was blocked for that long. */
export type ChatWorkerHeartbeatTimerLaggedDetails = Readonly<{
  lambdaRequestId: string | null;
  timerLagMs: number;
  executionPhase: string;
  toolName: string | null;
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
  userSuppliedKey: boolean;
  fileSize: number;
  fileExtension: string | null;
  mediaType: string;
  upstreamStatus: number | null;
  upstreamRequestId: string | null;
  errorClass: string;
  errorMessage: string;
}>;

/** A new turn refused because its session is not the current one; the scope carries the refused session id. */
export type ChatSessionNotCurrentDetails = Readonly<{
  currentSessionId: string | null;
}>;

/** Earlier turns' reasoning items one run left out of its replay, because the other OpenAI key produced them. */
export type ChatReplayReasoningItemsDroppedDetails = Readonly<{
  droppedReasoningItems: number;
  userSuppliedKey: boolean;
}>;

/**
 * The shape of a follow-up composer suggestions response that yielded no suggestions, without any of
 * its text. Field names avoid the sanitizer's content keys (`message`, `output`, `content`), which
 * would replace these values with `<redacted-content>`.
 */
export type ChatComposerSuggestionsResponseDetails = Readonly<{
  responseStatus: string | null;
  incompleteReason: string | null;
  messageItemCount: number;
  partTypes: ReadonlyArray<string>;
  textPartLengths: ReadonlyArray<number>;
}>;

/**
 * One metered AI provider call, named by what it would be priced against. The person and the request
 * travel on the scope rather than here, so a query can group these by surface and model without
 * reading anyone's ids.
 */
export type AiUsageMeteringDetails = Readonly<{
  surface: string;
  provider: string;
  modelId: string;
  tierAtCall: string;
}>;

export type AiUsageEventWriteFailureDetails = AiUsageMeteringDetails & Readonly<{
  errorClass: string;
  errorMessage: string;
}>;

/**
 * An allowance that could not be resolved, where the fallback tier could not have refused the call.
 * The fact is attributed to `fallbackTier` instead, which is what this has to make visible: the tier on
 * those rows is a guess rather than a reading of the billing tables.
 */
export type AiUsageAllowanceResolutionFailureDetails = Readonly<{
  accountKind: string;
  fallbackTier: string;
  errorClass: string;
  errorMessage: string;
}>;

/**
 * An allowance that could not be resolved for a caller the fallback tier caps, on a surface that captured
 * the failure instead of answering it. There is no fallback to name: the caller's turn either fails
 * closed on it or, on an idempotent replay, is admitted because it was already admitted once. Reported
 * at the capture site, so the record exists whichever of the two happens.
 */
export type AiUsageAllowanceResolutionDeferralDetails = Readonly<{
  accountKind: string;
  errorClass: string;
  errorMessage: string;
}>;

/**
 * A chat turn admitted for a person whose platform-key weighted tokens this month are at or above the
 * heavy-spend threshold. The person travels on the scope; nothing was refused. The amount keys avoid
 * "token" because both the telemetry sanitizer and Sentry's server-side scrubbing redact such keys.
 */
export type AiUsageHeavyWeightedTokensDetails = Readonly<{
  tier: string;
  accountKind: string;
  usedWeightedUsage: number;
  thresholdWeightedUsage: number;
}>;

/**
 * The heavy-spend read that failed for an admitted chat turn. The turn went on: the report refuses
 * nothing, so its failure must not fail the request either.
 */
export type AiUsageWeightedTokensReadFailureDetails = Readonly<{
  tier: string;
  accountKind: string;
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

export type GeneratedCardImageProviderOutcomeUnknownDetails = Readonly<{
  identityKind: "chat_run" | "request_content";
  runId: string | null;
  operationKey: string | null;
  operationId: string;
  mediaAssetId: string;
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
  | EventByAction<"chat_worker_terminal_state_persisted", ChatWorkerTerminalStateDetails>
  | EventByAction<"chat_worker_composer_suggestions_failed", ChatWorkerLifecycleDetails>
  | EventByAction<"chat_transcription_invalid_audio", ChatTranscriptionFailureDetails>
  | EventByAction<"chat_transcription_failed", ChatTranscriptionFailureDetails>
  | EventByAction<"chat_session_not_current_refused", ChatSessionNotCurrentDetails>
  | EventByAction<"chat_replay_reasoning_items_dropped", ChatReplayReasoningItemsDroppedDetails>
  | EventByAction<"chat_composer_suggestions_declined", ChatComposerSuggestionsResponseDetails>
  | EventByAction<"chat_composer_suggestions_unparseable", ChatComposerSuggestionsResponseDetails>
  | EventByAction<"generated_card_image_provider_complete", GeneratedCardImageProviderDetails>;

export type ChatWarningEvent =
  | (EventByAction<"chat_live_backlog_failed", ChatLiveLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_live_write_failed", ChatLiveLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_worker_terminal_state_persisted", ChatWorkerTerminalStateDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_worker_composer_suggestions_failed", ChatWorkerLifecycleDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_worker_provider_call_retried", ChatWorkerProviderCallRetriedDetails> & Readonly<{
    message: string;
  }>)
  | (EventByAction<"chat_worker_heartbeat_failed", ChatWorkerHeartbeatFailedDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_worker_heartbeat_skipped", ChatWorkerHeartbeatSkippedDetails> & Readonly<{ message: string }>)
  | (EventByAction<"chat_worker_heartbeat_timer_lagged", ChatWorkerHeartbeatTimerLaggedDetails> & Readonly<{
    message: string;
  }>)
  | (EventByAction<"chat_transcription_failed", ChatTranscriptionFailureDetails> & Readonly<{ message: string }>)
  // A provider that answered without any usage numbers. The fact row is still appended with null
  // counters, so this warning is what makes an unpriceable call countable instead of invisible.
  | (EventByAction<"ai_usage_counters_missing", AiUsageMeteringDetails> & Readonly<{ message: string }>)
  // A provider that reported counters carrying nothing the weighted total weighs. The call is metered
  // and priceable, and it adds zero to the weighted total, so this is what keeps a surface from quietly
  // dropping out of the heavy-spend warning after a model change.
  | (EventByAction<"ai_usage_counters_unweighted", AiUsageMeteringDetails> & Readonly<{ message: string }>)
  // A billing read that failed where the fallback tier refuses nothing. The call proceeds on that tier
  // rather than failing a caller the fallback could never have refused.
  | (EventByAction<
    "ai_usage_allowance_resolution_failed",
    AiUsageAllowanceResolutionFailureDetails
  > & Readonly<{ message: string }>)
  // A billing read that failed for a caller the fallback tier caps, on a surface that had to hold the
  // failure until it knew whether the request was a new turn or a replay of one already accepted.
  | (EventByAction<
    "ai_usage_allowance_resolution_deferred",
    AiUsageAllowanceResolutionDeferralDetails
  > & Readonly<{ message: string }>)
  // Heavy platform-key spend this month on an admitted chat turn. Weighted tokens are never refused, so
  // this is the only signal that one person's spend is unusually high.
  | (EventByAction<
    "ai_usage_weighted_tokens_heavy",
    AiUsageHeavyWeightedTokensDetails
  > & Readonly<{ message: string }>)
  | (EventByAction<
    "ai_usage_weighted_tokens_read_failed",
    AiUsageWeightedTokensReadFailureDetails
  > & Readonly<{ message: string }>)
  // A provider call that was paid for and whose fact could not be stored. Reported rather than thrown,
  // because the money is already spent and failing the caller's request would not recover the row.
  | (EventByAction<"ai_usage_event_write_failed", AiUsageEventWriteFailureDetails> & Readonly<{
    message: string;
  }>)
  | (EventByAction<
    "generated_card_image_provider_retry",
    GeneratedCardImageProviderDetails
  > & Readonly<{ message: string }>)
  | (EventByAction<
    "generated_card_image_provider_failed",
    GeneratedCardImageProviderDetails
  > & Readonly<{ message: string }>)
  | (EventByAction<
    "generated_card_image_provider_outcome_unknown",
    GeneratedCardImageProviderOutcomeUnknownDetails
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
  | (EventByAction<"chat_worker_terminal_state_persisted", ChatWorkerTerminalStateDetails> & Readonly<{ error: Error }>);

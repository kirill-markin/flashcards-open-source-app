import Foundation

struct AIToolCallRequest: Hashable, Sendable {
    let toolCallId: String
    let name: String
    let input: String
}

struct AIChatLiveEventMetadata: Hashable, Sendable {
    let sessionId: String
    let conversationScopeId: String
    let runId: String
    let cursor: String?
    let sequenceNumber: Int
    let streamEpoch: String
}

enum AIChatLiveEvent: Sendable {
    case assistantDelta(metadata: AIChatLiveEventMetadata, text: String, itemId: String)
    case assistantToolCall(metadata: AIChatLiveEventMetadata, toolCall: AIChatToolCall, itemId: String)
    case assistantReasoningStarted(metadata: AIChatLiveEventMetadata, reasoningId: String, itemId: String)
    case assistantReasoningSummary(metadata: AIChatLiveEventMetadata, reasoningId: String, summary: String, itemId: String)
    case assistantReasoningDone(metadata: AIChatLiveEventMetadata, reasoningId: String, itemId: String)
    case assistantMessageDone(
        metadata: AIChatLiveEventMetadata,
        itemId: String,
        content: [AIChatContentPart],
        isError: Bool,
        isStopped: Bool
    )
    case composerSuggestionsUpdated(
        metadata: AIChatLiveEventMetadata,
        suggestions: [AIChatComposerSuggestion]
    )
    case repairStatus(metadata: AIChatLiveEventMetadata, status: AIChatRepairAttemptStatus)
    case runTerminal(
        metadata: AIChatLiveEventMetadata,
        outcome: AIChatRunTerminalOutcome,
        message: String?,
        assistantItemId: String?,
        isError: Bool?,
        isStopped: Bool?
    )
}

enum AIChatFailureStage: String, Codable, Hashable, Sendable {
    case requestBuild = "request_build"
    case invalidHttpResponse = "invalid_http_response"
    case httpResponseBody = "http_response_body"
    case responseNotOk = "response_not_ok"
    case readingLine = "reading_line"
    case finishingEvent = "finishing_event"
    case decodingEventJSON = "decoding_event_json"
    case processingTrailingEvent = "processing_trailing_event"
    case backendErrorEvent = "backend_error_event"
    case toolInputDecode = "tool_input_decode"
    case toolExecution = "tool_execution"
}

enum AIChatFailureKind: String, Codable, Hashable, Sendable {
    case invalidBaseUrl = "invalid_base_url"
    case invalidStreamResponse = "invalid_stream_response"
    case invalidHttpResponse = "invalid_http_response"
    case invalidSSEFraming = "invalid_sse_framing"
    case invalidSSEEventJSON = "invalid_sse_event_json"
    case invalidStreamContract = "invalid_stream_contract"
    case backendErrorEvent = "backend_error_event"
    case invalidToolInput = "invalid_tool_input"
    case toolExecutionFailed = "tool_execution_failed"
}

struct AIChatFailureDiagnostics: Codable, Hashable, Sendable {
    let clientRequestId: String
    let backendRequestId: String?
    let stage: AIChatFailureStage
    let errorKind: AIChatFailureKind
    let statusCode: Int?
    let eventType: String?
    let toolName: String?
    let toolCallId: String?
    let lineNumber: Int?
    let rawSnippet: String?
    let decoderSummary: String?
    let continuationAttempt: Int?
    let continuationToolCallIds: [String]
}

protocol AIChatFailureDiagnosticProviding: Error {
    var diagnostics: AIChatFailureDiagnostics { get }
}

struct AIChatRepairAttemptStatus: Hashable, Sendable {
    let message: String
    let attempt: Int
    let maxAttempts: Int
    let toolName: String?

    var displayText: String {
        "\(self.message) \(self.attempt)/\(self.maxAttempts)"
    }
}

enum AIChatRuntimeEvent: Sendable {
    case accepted(AIChatStartRunResponse)
    case liveEvent(AIChatLiveEvent)
    case appendAssistantAccountUpgradePrompt(message: String, buttonTitle: String)
    case finish
    case fail(String)
}

struct AIChatContext: Sendable {
    let workspace: Workspace
    let schedulerSettings: WorkspaceSchedulerSettings
    let totalActiveCards: Int
}

struct AIChatResumeAttemptDiagnostics: Equatable, Sendable {
    let sequence: Int

    var headerValue: String {
        String(self.sequence)
    }
}

protocol AIChatHistoryStoring: Sendable {
    func activateWorkspace(workspaceId: String?)
    func loadState() -> AIChatPersistedState
    func loadState(workspaceId: String?) -> AIChatPersistedState
    func saveState(state: AIChatPersistedState) async
    func saveState(workspaceId: String?, state: AIChatPersistedState) async
    func clearState() async
    func loadDraft(workspaceId: String?, sessionId: String?) -> AIChatComposerDraft
    func saveDraft(workspaceId: String?, sessionId: String?, draft: AIChatComposerDraft) async
}

protocol AIChatSessionServicing: Sendable {
    func loadSnapshot(
        session: CloudLinkedSession,
        sessionId: String?
    ) async throws -> AIChatSessionSnapshot

    func loadBootstrap(
        session: CloudLinkedSession,
        sessionId: String?,
        limit: Int,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) async throws -> AIChatBootstrapResponse

    func loadOlderMessages(
        session: CloudLinkedSession,
        sessionId: String,
        beforeCursor: String,
        limit: Int
    ) async throws -> AIChatOlderMessagesResponse

    func startRun(
        session: CloudLinkedSession,
        request: AIChatStartRunRequestBody
    ) async throws -> AIChatStartRunResponse

    func createNewSession(
        session: CloudLinkedSession,
        request: AIChatNewSessionRequestBody
    ) async throws -> AIChatNewSessionResponse

    func stopRun(
        session: CloudLinkedSession,
        sessionId: String
    ) async throws -> AIChatStopRunResponse
}

protocol AIChatContextLoading: Sendable {
    func loadContext() async throws -> AIChatContext
}

import Foundation

struct AIToolCallRequest: Hashable, Sendable {
    let toolCallId: String
    let name: String
    let input: String
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
        errorCode: String?,
        isStopped: Bool,
        completedAt: Int?
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

enum AIChatLiveStreamElement: Sendable {
    case connected(requestId: String?, clientRequestId: String)
    case event(AIChatLiveEvent)
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
    func saveStateSynchronously(workspaceId: String?, state: AIChatPersistedState)
    func saveState(state: AIChatPersistedState) async
    func saveState(workspaceId: String?, state: AIChatPersistedState) async
    func clearState() async
    func loadDraft(workspaceId: String?, sessionId: String?) -> AIChatComposerDraft
    func loadDraftRestoreSuppression(workspaceId: String?, sessionId: String?) -> Bool
    func saveDraftSynchronously(workspaceId: String?, sessionId: String?, draft: AIChatComposerDraft)
    func saveDraftRestoreSuppressionSynchronously(
        workspaceId: String?,
        sessionId: String?,
        isSuppressed: Bool
    )
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

    /// Stages the file's bytes for the next turn and returns the upload id its `upload` part names.
    func uploadChatFile(
        session: CloudLinkedSession,
        fileName: String,
        mediaType: String,
        sizeBytes: Int,
        fileURL: URL
    ) async throws -> String

    func createNewSession(
        session: CloudLinkedSession,
        request: AIChatNewSessionRequestBody
    ) async throws -> AIChatNewSessionResponse

    func stopRun(
        session: CloudLinkedSession,
        sessionId: String,
        runId: String?
    ) async throws -> AIChatStopRunResponse

    func listChatSessions(
        session: CloudLinkedSession,
        cursor: String?,
        searchText: String?
    ) async throws -> AIChatSessionHistoryPage

    func renameChatSession(
        session: CloudLinkedSession,
        sessionId: String,
        title: String
    ) async throws -> AIChatSessionHistorySummary

    func archiveChatSession(
        session: CloudLinkedSession,
        sessionId: String
    ) async throws -> AIChatArchivedSession
}

protocol AIChatContextLoading: Sendable {
    func loadContext() async throws -> AIChatContext
}

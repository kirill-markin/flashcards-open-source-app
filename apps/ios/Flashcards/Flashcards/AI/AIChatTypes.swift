import Foundation

let aiChatDefaultModelId: String = "gpt-5.4"
let aiChatDefaultModelLabel: String = "GPT-5.4"
let aiChatDefaultProviderLabel: String = "OpenAI"
let aiChatDefaultReasoningEffort: String = "medium"
let aiChatDefaultReasoningLabel: String = "Medium"
let aiChatCreateCardDraftPrompt: String = "Help me create a card."
let aiChatOptimisticAssistantStatusText: String = "Looking through your cards..."
let aiChatExternalProviderConsentUserDefaultsKey: String = "ai-chat-external-provider-consent"
let aiChatExternalProviderConsentRequiredMessage: String = "Review AI data use and accept it on this device before using AI features."
let aiChatAccuracyWarningText: String = "AI responses can be inaccurate or incomplete. Review important results before relying on them."
let aiChatGuestQuotaReachedMessage: String = "Your free guest AI limit for this month is used up. Create an account or log in to keep using AI."
let aiChatGuestQuotaButtonTitle: String = "Create account or Log in"
let aiChatMaximumAttachmentBytes: Int = 20 * 1024 * 1024
let aiChatSupportedFileExtensions: Set<String> = [
    "pdf",
    "txt",
    "csv",
    "json",
    "xml",
    "xlsx",
    "xls",
    "md",
    "html",
    "py",
    "js",
    "ts",
    "yaml",
    "yml",
    "sql",
    "log",
    "docx",
]
let aiChatToolNames: Set<String> = [
    "sql",
]
let aiChatExternalProviderDisclosureItems: [String] = [
    "Typed prompts and card-derived context needed for your request can be sent to OpenAI.",
    "Uploaded files and images can be uploaded to OpenAI for AI processing.",
    "Dictated audio and transcription requests can be sent to OpenAI for speech processing.",
    "Technical diagnostics about failed or slow AI requests can be sent to help debug the hosted AI service.",
]

enum AIChatAccessState: Equatable {
    case consentRequired
    case ready
}

func hasAIChatExternalProviderConsent(userDefaults: UserDefaults) -> Bool {
    userDefaults.bool(forKey: aiChatExternalProviderConsentUserDefaultsKey)
}

func grantAIChatExternalProviderConsent(userDefaults: UserDefaults) {
    userDefaults.set(true, forKey: aiChatExternalProviderConsentUserDefaultsKey)
}

func aiChatAccessState(
    hasExternalProviderConsent: Bool
) -> AIChatAccessState {
    guard hasExternalProviderConsent else {
        return .consentRequired
    }

    return .ready
}

func isGuestAiLimitCode(_ code: String?) -> Bool {
    code == "GUEST_AI_LIMIT_REACHED"
}

func aiChatAppVersion() -> String {
    let shortVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    let trimmedVersion = shortVersion?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmedVersion.isEmpty ? "1.0.1" : trimmedVersion
}

func makeAIChatSessionId() -> String {
    UUID().uuidString.lowercased()
}

func aiChatTruncatedSnippet(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.count <= 240 {
        return trimmed
    }

    let endIndex = trimmed.index(trimmed.startIndex, offsetBy: 240)
    return String(trimmed[..<endIndex]) + "..."
}

func aiChatDecoderSummary(error: Error) -> String {
    if let decodingError = error as? DecodingError {
        switch decodingError {
        case .dataCorrupted(let context):
            return context.debugDescription
        case .keyNotFound(let key, let context):
            return "missing key \(key.stringValue): \(context.debugDescription)"
        case .typeMismatch(let type, let context):
            return "type mismatch \(type): \(context.debugDescription)"
        case .valueNotFound(let type, let context):
            return "missing value \(type): \(context.debugDescription)"
        @unknown default:
            return String(describing: decodingError)
        }
    }

    return Flashcards.errorMessage(error: error)
}

struct AIChatProviderDef: Codable, Hashable, Sendable {
    let id: String
    let label: String
}

struct AIChatReasoningDef: Codable, Hashable, Sendable {
    let effort: String
    let label: String
}

struct AIChatFeaturesDef: Codable, Hashable, Sendable {
    let modelPickerEnabled: Bool
    let dictationEnabled: Bool
    let attachmentsEnabled: Bool
}

struct AIChatServerModelDef: Codable, Hashable, Sendable {
    let id: String
    let label: String
    let badgeLabel: String
}

struct AIChatServerConfig: Codable, Hashable, Sendable {
    let provider: AIChatProviderDef
    let model: AIChatServerModelDef
    let reasoning: AIChatReasoningDef
    let features: AIChatFeaturesDef
}

let aiChatDefaultServerConfig = AIChatServerConfig(
    provider: AIChatProviderDef(
        id: "openai",
        label: aiChatDefaultProviderLabel
    ),
    model: AIChatServerModelDef(
        id: aiChatDefaultModelId,
        label: aiChatDefaultModelLabel,
        badgeLabel: "\(aiChatDefaultModelLabel) · \(aiChatDefaultReasoningLabel)"
    ),
    reasoning: AIChatReasoningDef(
        effort: aiChatDefaultReasoningEffort,
        label: aiChatDefaultReasoningLabel
    ),
    features: AIChatFeaturesDef(
        modelPickerEnabled: false,
        dictationEnabled: true,
        attachmentsEnabled: true
    )
)

enum AIChatRole: String, Codable, Hashable, Sendable {
    case user
    case assistant
}

enum AIChatToolCallStatus: String, Codable, Hashable, Sendable {
    case started
    case completed
}

struct AIChatToolCall: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let status: AIChatToolCallStatus
    let input: String?
    let output: String?
}

struct AIChatAttachment: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let fileName: String
    let mediaType: String
    let base64Data: String

    var isImage: Bool {
        self.mediaType.hasPrefix("image/")
    }
}

enum AIChatContentPart: Codable, Hashable, Sendable {
    case text(String)
    case image(mediaType: String, base64Data: String)
    case file(fileName: String, mediaType: String, base64Data: String)
    case toolCall(AIChatToolCall)
    case accountUpgradePrompt(message: String, buttonTitle: String)

    private enum CodingKeys: String, CodingKey {
        case type
        case text
        case mediaType
        case base64Data
        case fileName
        case toolCallId
        case name
        case status
        case input
        case output
        case buttonTitle
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "text":
            self = .text(try container.decode(String.self, forKey: .text))
        case "image":
            self = .image(
                mediaType: try container.decode(String.self, forKey: .mediaType),
                base64Data: try container.decode(String.self, forKey: .base64Data)
            )
        case "file":
            self = .file(
                fileName: try container.decode(String.self, forKey: .fileName),
                mediaType: try container.decode(String.self, forKey: .mediaType),
                base64Data: try container.decode(String.self, forKey: .base64Data)
            )
        case "tool_call":
            self = .toolCall(
                AIChatToolCall(
                    id: try container.decode(String.self, forKey: .toolCallId),
                    name: try container.decode(String.self, forKey: .name),
                    status: try container.decode(AIChatToolCallStatus.self, forKey: .status),
                    input: try container.decodeIfPresent(String.self, forKey: .input),
                    output: try container.decodeIfPresent(String.self, forKey: .output)
                )
            )
        case "account_upgrade_prompt":
            self = .accountUpgradePrompt(
                message: try container.decode(String.self, forKey: .text),
                buttonTitle: try container.decode(String.self, forKey: .buttonTitle)
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Unsupported AI chat content type: \(type)"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .text(let text):
            try container.encode("text", forKey: .type)
            try container.encode(text, forKey: .text)
        case .image(let mediaType, let base64Data):
            try container.encode("image", forKey: .type)
            try container.encode(mediaType, forKey: .mediaType)
            try container.encode(base64Data, forKey: .base64Data)
        case .file(let fileName, let mediaType, let base64Data):
            try container.encode("file", forKey: .type)
            try container.encode(fileName, forKey: .fileName)
            try container.encode(mediaType, forKey: .mediaType)
            try container.encode(base64Data, forKey: .base64Data)
        case .toolCall(let toolCall):
            try container.encode("tool_call", forKey: .type)
            try container.encode(toolCall.id, forKey: .toolCallId)
            try container.encode(toolCall.name, forKey: .name)
            try container.encode(toolCall.status, forKey: .status)
            try container.encodeIfPresent(toolCall.input, forKey: .input)
            try container.encodeIfPresent(toolCall.output, forKey: .output)
        case .accountUpgradePrompt(let message, let buttonTitle):
            try container.encode("account_upgrade_prompt", forKey: .type)
            try container.encode(message, forKey: .text)
            try container.encode(buttonTitle, forKey: .buttonTitle)
        }
    }

    var textValue: String? {
        switch self {
        case .text(let text):
            return text
        default:
            return nil
        }
    }

    var toolCallValue: AIChatToolCall? {
        switch self {
        case .toolCall(let toolCall):
            return toolCall
        default:
            return nil
        }
    }
}

struct AIChatMessage: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let role: AIChatRole
    let content: [AIChatContentPart]
    let timestamp: String
    let isError: Bool
}

struct AIChatPersistedState: Codable, Hashable, Sendable {
    let messages: [AIChatMessage]
    let chatSessionId: String
    let codeInterpreterContainerId: String?
    let lastKnownChatConfig: AIChatServerConfig?

    var selectedModelId: String {
        self.lastKnownChatConfig?.model.id ?? aiChatDefaultModelId
    }

    private enum CodingKeys: String, CodingKey {
        case messages
        case selectedModelId
        case chatSessionId
        case codeInterpreterContainerId
        case lastKnownChatConfig
    }

    init(
        messages: [AIChatMessage],
        chatSessionId: String,
        codeInterpreterContainerId: String?,
        lastKnownChatConfig: AIChatServerConfig?
    ) {
        self.messages = messages
        self.chatSessionId = chatSessionId
        self.codeInterpreterContainerId = codeInterpreterContainerId
        self.lastKnownChatConfig = lastKnownChatConfig
    }

    init(
        messages: [AIChatMessage],
        selectedModelId: String,
        chatSessionId: String,
        codeInterpreterContainerId: String?,
        lastKnownChatConfig: AIChatServerConfig?
    ) {
        self.messages = messages
        self.chatSessionId = chatSessionId
        self.codeInterpreterContainerId = codeInterpreterContainerId
        self.lastKnownChatConfig = lastKnownChatConfig ?? (
            selectedModelId == aiChatDefaultModelId ? nil : AIChatServerConfig(
                provider: aiChatDefaultServerConfig.provider,
                model: AIChatServerModelDef(
                    id: selectedModelId,
                    label: selectedModelId,
                    badgeLabel: selectedModelId
                ),
                reasoning: aiChatDefaultServerConfig.reasoning,
                features: aiChatDefaultServerConfig.features
            )
        )
    }

    init(
        messages: [AIChatMessage],
        selectedModelId: String,
        chatSessionId: String,
        codeInterpreterContainerId: String?
    ) {
        self.init(
            messages: messages,
            selectedModelId: selectedModelId,
            chatSessionId: chatSessionId,
            codeInterpreterContainerId: codeInterpreterContainerId,
            lastKnownChatConfig: nil
        )
    }

    init(
        messages: [AIChatMessage],
        selectedModelId: String
    ) {
        self.init(
            messages: messages,
            selectedModelId: selectedModelId,
            chatSessionId: makeAIChatSessionId(),
            codeInterpreterContainerId: nil,
            lastKnownChatConfig: nil
        )
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.messages = try container.decode([AIChatMessage].self, forKey: .messages)
        self.chatSessionId = try container.decodeIfPresent(String.self, forKey: .chatSessionId) ?? makeAIChatSessionId()
        self.codeInterpreterContainerId = try container.decodeIfPresent(String.self, forKey: .codeInterpreterContainerId)
        let lastKnownChatConfig = try container.decodeIfPresent(AIChatServerConfig.self, forKey: .lastKnownChatConfig)
        let legacySelectedModelId = try container.decodeIfPresent(String.self, forKey: .selectedModelId) ?? aiChatDefaultModelId
        self.lastKnownChatConfig = lastKnownChatConfig ?? (
            legacySelectedModelId == aiChatDefaultModelId ? nil : AIChatServerConfig(
                provider: aiChatDefaultServerConfig.provider,
                model: AIChatServerModelDef(
                    id: legacySelectedModelId,
                    label: legacySelectedModelId,
                    badgeLabel: legacySelectedModelId
                ),
                reasoning: aiChatDefaultServerConfig.reasoning,
                features: aiChatDefaultServerConfig.features
            )
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.messages, forKey: .messages)
        try container.encode(self.chatSessionId, forKey: .chatSessionId)
        try container.encodeIfPresent(self.lastKnownChatConfig, forKey: .lastKnownChatConfig)
    }
}

struct AIChatWireMessage: Codable, Hashable, Sendable {
    let role: String
    let content: [AIChatContentPart]
}

/**
 Keep this block limited to short, stable user facts that help the model start
 from the right high-level context without replacing workspace tools.
 */
struct AIChatUserContext: Codable, Hashable, Sendable {
    let totalCards: Int
}

struct AIChatTurnRequestBody: Codable, Hashable, Sendable {
    let messages: [AIChatWireMessage]
    let model: String
    let timezone: String
    let devicePlatform: String
    let chatSessionId: String
    let codeInterpreterContainerId: String?
    let userContext: AIChatUserContext
}

struct AIToolCallRequest: Hashable, Sendable {
    let toolCallId: String
    let name: String
    let input: String
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

struct AIChatFailureReportBody: Codable, Hashable, Sendable {
    let kind: String
    let clientRequestId: String
    let backendRequestId: String?
    let stage: String
    let errorKind: String
    let statusCode: Int?
    let eventType: String?
    let toolName: String?
    let toolCallId: String?
    let lineNumber: Int?
    let rawSnippet: String?
    let decoderSummary: String?
    let continuationAttempt: Int?
    let continuationToolCallIds: [String]
    let selectedModel: String
    let messageCount: Int
    let appVersion: String
    let devicePlatform: String
}

enum AIChatLatencyResult: String, Codable, Hashable, Sendable {
    case success = "success"
    case responseNotOk = "response_not_ok"
    case missingReader = "missing_reader"
    case emptyResponse = "empty_response"
    case cancelledBeforeHeaders = "cancelled_before_headers"
    case cancelledBeforeFirstSseLine = "cancelled_before_first_sse_line"
    case cancelledBeforeFirstDelta = "cancelled_before_first_delta"
    case streamErrorBeforeFirstDelta = "stream_error_before_first_delta"
}

struct AIChatLatencyReportBody: Codable, Hashable, Sendable {
    let kind: String
    let clientRequestId: String
    let backendRequestId: String?
    let selectedModel: String
    let messageCount: Int
    let appVersion: String
    let devicePlatform: String
    let result: String
    let statusCode: Int?
    let firstEventType: String?
    let didReceiveFirstSseLine: Bool
    let didReceiveFirstDelta: Bool
    let tapToRequestStartMs: Int?
    let requestStartToHeadersMs: Int?
    let headersToFirstSseLineMs: Int?
    let firstSseLineToFirstDeltaMs: Int?
    let requestStartToFirstDeltaMs: Int?
    let tapToFirstDeltaMs: Int?
    let requestStartToTerminalMs: Int?
    let tapToTerminalMs: Int?
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

struct AITurnStreamOutcome: Hashable, Sendable {
    let requestId: String?
    let codeInterpreterContainerId: String?
}

struct AIChatBackendError: Decodable, Hashable, Sendable {
    let message: String
    let code: String
    let stage: String
    let requestId: String
}

enum AIChatBackendStreamEvent: Decodable, Hashable, Sendable {
    case delta(String)
    case toolCall(AIChatToolCall)
    case toolCallRequest(AIToolCallRequest)
    case repairAttempt(AIChatRepairAttemptStatus)
    case done
    case error(AIChatBackendError)

    private enum CodingKeys: String, CodingKey {
        case type
        case text
        case toolCallId
        case name
        case status
        case input
        case output
        case message
        case attempt
        case maxAttempts
        case toolName
        case code
        case stage
        case requestId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "delta":
            self = .delta(try container.decode(String.self, forKey: .text))
        case "tool_call":
            self = .toolCall(
                AIChatToolCall(
                    id: try container.decode(String.self, forKey: .toolCallId),
                    name: try container.decode(String.self, forKey: .name),
                    status: try container.decode(AIChatToolCallStatus.self, forKey: .status),
                    input: try container.decodeIfPresent(String.self, forKey: .input),
                    output: try container.decodeIfPresent(String.self, forKey: .output)
                )
            )
        case "tool_call_request":
            self = .toolCallRequest(
                AIToolCallRequest(
                    toolCallId: try container.decode(String.self, forKey: .toolCallId),
                    name: try container.decode(String.self, forKey: .name),
                    input: try container.decode(String.self, forKey: .input)
                )
            )
        case "repair_attempt":
            self = .repairAttempt(
                AIChatRepairAttemptStatus(
                    message: try container.decode(String.self, forKey: .message),
                    attempt: try container.decode(Int.self, forKey: .attempt),
                    maxAttempts: try container.decode(Int.self, forKey: .maxAttempts),
                    toolName: try container.decodeIfPresent(String.self, forKey: .toolName)
                )
            )
        case "done":
            self = .done
        case "error":
            self = .error(
                AIChatBackendError(
                    message: try container.decode(String.self, forKey: .message),
                    code: try container.decode(String.self, forKey: .code),
                    stage: try container.decode(String.self, forKey: .stage),
                    requestId: try container.decode(String.self, forKey: .requestId)
                )
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Unsupported chat stream event type: \(type)"
            )
        }
    }
}

enum AIChatRuntimeEvent: Sendable {
    case appendAssistantText(String)
    case appendAssistantAccountUpgradePrompt(message: String, buttonTitle: String)
    case upsertToolCall(AIChatToolCall)
    case setRepairStatus(AIChatRepairAttemptStatus?)
    case finish
    case fail(String)
}

struct AIChatContext: Sendable {
    let workspace: Workspace
    let schedulerSettings: WorkspaceSchedulerSettings
    let totalActiveCards: Int
}

struct AIChatRuntimeResult: Sendable {
    let failureReportBody: AIChatFailureReportBody?
    let latencyReportBody: AIChatLatencyReportBody?
}

protocol AIChatHistoryStoring: Sendable {
    func activateWorkspace(workspaceId: String?)
    func loadState() -> AIChatPersistedState
    func saveState(state: AIChatPersistedState) async
    func clearState() async
}

protocol AIChatStreaming: Sendable {
    func streamTurn(
        session: CloudLinkedSession,
        request: AIChatTurnRequestBody,
        tapStartedAt: Date?,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCall: @escaping @Sendable (AIChatToolCall) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void,
        onLatencyReported: @escaping @Sendable (AIChatLatencyReportBody) async -> Void
    ) async throws -> AITurnStreamOutcome

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async

    func reportLatencyDiagnostics(
        session: CloudLinkedSession,
        body: AIChatLatencyReportBody
    ) async

    func loadServerConfig(
        session: CloudLinkedSession
    ) async throws -> AIChatServerConfig
}

extension AIChatStreaming {
    func loadServerConfig(
        session: CloudLinkedSession
    ) async throws -> AIChatServerConfig {
        _ = session
        return aiChatDefaultServerConfig
    }
}

protocol AIChatContextLoading: Sendable {
    func loadContext() async throws -> AIChatContext
}

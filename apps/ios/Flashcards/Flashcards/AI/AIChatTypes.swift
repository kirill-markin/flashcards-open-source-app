import Foundation

let aiChatDefaultModelId: String = "gpt-5.4"

func aiChatAppVersion() -> String {
    let shortVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    let trimmedVersion = shortVersion?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmedVersion.isEmpty ? "0.1.0" : trimmedVersion
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

    return localizedMessage(error: error)
}

struct AIChatModelDef: Hashable, Identifiable {
    let id: String
    let label: String

    static let all: [AIChatModelDef] = [
        AIChatModelDef(id: "gpt-5.4", label: "GPT-5.4"),
        AIChatModelDef(id: "gpt-5.2", label: "GPT-5.2"),
        AIChatModelDef(id: "gpt-4.1", label: "GPT-4.1"),
        AIChatModelDef(id: "gpt-4.1-mini", label: "GPT-4.1 Mini"),
        AIChatModelDef(id: "gpt-4.1-nano", label: "GPT-4.1 Nano"),
    ]
}

enum AIChatRole: String, Codable, Hashable {
    case user
    case assistant
}

enum AIChatToolCallStatus: String, Codable, Hashable {
    case requested
    case completed
}

struct AIChatToolCall: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let status: AIChatToolCallStatus
    let input: String
    let output: String?
}

struct AIChatMessage: Codable, Hashable, Identifiable {
    let id: String
    let role: AIChatRole
    let text: String
    let toolCalls: [AIChatToolCall]
    let timestamp: String
    let isError: Bool
}

struct AIChatPersistedState: Codable, Hashable {
    let messages: [AIChatMessage]
    let selectedModelId: String
}

struct AILocalAssistantToolCall: Codable, Hashable {
    let toolCallId: String
    let name: String
    let input: String
}

struct AILocalChatWireMessage: Codable, Hashable {
    let role: String
    let content: String?
    let toolCalls: [AILocalAssistantToolCall]?
    let toolCallId: String?
    let name: String?
    let output: String?
}

struct AILocalChatRequestBody: Codable, Hashable {
    let messages: [AILocalChatWireMessage]
    let model: String
    let timezone: String
}

struct AIToolCallRequest: Hashable {
    let toolCallId: String
    let name: String
    let input: String
}

enum AIChatFailureStage: String, Codable, Hashable {
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
}

enum AIChatFailureKind: String, Codable, Hashable {
    case invalidBaseUrl = "invalid_base_url"
    case invalidStreamResponse = "invalid_stream_response"
    case invalidHttpResponse = "invalid_http_response"
    case invalidSSEFraming = "invalid_sse_framing"
    case invalidSSEEventJSON = "invalid_sse_event_json"
    case invalidStreamContract = "invalid_stream_contract"
    case backendErrorEvent = "backend_error_event"
    case invalidToolInput = "invalid_tool_input"
}

struct AIChatFailureDiagnostics: Codable, Hashable {
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
}

struct AIChatFailureReportBody: Codable, Hashable {
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
    let selectedModel: String
    let messageCount: Int
    let appVersion: String
    let devicePlatform: String
}

protocol AIChatFailureDiagnosticProviding: Error {
    var diagnostics: AIChatFailureDiagnostics { get }
}

struct AIChatRepairAttemptStatus: Hashable {
    let message: String
    let attempt: Int
    let maxAttempts: Int
    let toolName: String?

    var displayText: String {
        "\(self.message) \(self.attempt)/\(self.maxAttempts)"
    }
}

struct AITurnStreamOutcome: Hashable {
    let awaitsToolResults: Bool
    let requestedToolCalls: [AIToolCallRequest]
    let requestId: String?
}

struct AIChatBackendError: Decodable, Hashable {
    let message: String
    let code: String
    let stage: String
    let requestId: String
}

enum AIChatBackendStreamEvent: Decodable, Hashable {
    case delta(String)
    case toolCallRequest(AIToolCallRequest)
    case repairAttempt(AIChatRepairAttemptStatus)
    case awaitToolResults
    case done
    case error(AIChatBackendError)

    private enum CodingKeys: String, CodingKey {
        case type
        case text
        case toolCallId
        case name
        case input
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
        case "await_tool_results":
            self = .awaitToolResults
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

protocol AIChatHistoryStoring {
    func loadState() -> AIChatPersistedState
    func saveState(state: AIChatPersistedState)
    func clearState()
}

protocol AIChatStreaming: Sendable {
    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async
}

protocol AIToolExecuting {
    @MainActor
    func execute(toolCallRequest: AIToolCallRequest, latestUserText: String, requestId: String?) async throws -> String
}

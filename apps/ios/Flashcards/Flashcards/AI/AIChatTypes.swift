import Foundation

let aiChatDefaultModelId: String = "gpt-5.4"

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

struct AITurnStreamOutcome: Hashable {
    let awaitsToolResults: Bool
    let requestedToolCalls: [AIToolCallRequest]
}

enum AIChatBackendStreamEvent: Decodable, Hashable {
    case delta(String)
    case toolCallRequest(AIToolCallRequest)
    case awaitToolResults
    case done
    case error(String)

    private enum CodingKeys: String, CodingKey {
        case type
        case text
        case toolCallId
        case name
        case input
        case message
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
        case "await_tool_results":
            self = .awaitToolResults
        case "done":
            self = .done
        case "error":
            self = .error(try container.decode(String.self, forKey: .message))
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
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void
    ) async throws -> AITurnStreamOutcome
}

protocol AIToolExecuting {
    @MainActor
    func execute(toolCallRequest: AIToolCallRequest, latestUserText: String) async throws -> String
}

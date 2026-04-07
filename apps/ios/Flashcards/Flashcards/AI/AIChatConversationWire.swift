import Foundation

struct AIChatConversationWire: Decodable, Hashable, Sendable {
    let messages: [AIChatConversationMessageWire]
    let updatedAt: Int
    let mainContentInvalidationVersion: Int
    let hasOlder: Bool?
    let oldestCursor: String?
}

struct AIChatActiveRunLiveWire: Decodable, Hashable, Sendable {
    let cursor: String?
    let stream: AIChatLiveStreamEnvelope
}

struct AIChatActiveRunWire: Decodable, Hashable, Sendable {
    let runId: String
    let status: String
    let live: AIChatActiveRunLiveWire
    let lastHeartbeatAt: Int?

    private enum CodingKeys: String, CodingKey {
        case runId
        case status
        case live
        case lastHeartbeatAt
        case lastHeartbeatAtMillis
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.runId = try container.decode(String.self, forKey: .runId)
        self.status = try container.decode(String.self, forKey: .status)
        self.live = try container.decode(AIChatActiveRunLiveWire.self, forKey: .live)
        self.lastHeartbeatAt = try container.decodeIfPresent(Int.self, forKey: .lastHeartbeatAt)
            ?? container.decodeIfPresent(Int.self, forKey: .lastHeartbeatAtMillis)
    }
}

struct AIChatConversationEnvelopeWire: Decodable, Hashable, Sendable {
    let sessionId: String
    let conversationScopeId: String
    let conversation: AIChatConversationWire
    let composerSuggestions: [AIChatComposerSuggestion]
    let chatConfig: AIChatServerConfig
    let activeRun: AIChatActiveRunWire?

    private enum CodingKeys: String, CodingKey {
        case sessionId
        case conversationScopeId
        case conversation
        case composerSuggestions
        case chatConfig
        case activeRun
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.sessionId = try container.decode(String.self, forKey: .sessionId)
        self.conversationScopeId = try container.decode(String.self, forKey: .conversationScopeId)
        self.conversation = try container.decode(AIChatConversationWire.self, forKey: .conversation)
        self.composerSuggestions = try container.decodeIfPresent(
            [AIChatComposerSuggestion].self,
            forKey: .composerSuggestions
        ) ?? []
        self.chatConfig = try container.decode(AIChatServerConfig.self, forKey: .chatConfig)
        self.activeRun = try container.decodeIfPresent(AIChatActiveRunWire.self, forKey: .activeRun)
    }
}

typealias AIChatSessionSnapshotWire = AIChatConversationEnvelopeWire
typealias AIChatBootstrapResponseWire = AIChatConversationEnvelopeWire

struct AIChatConversationMessageWire: Decodable, Hashable, Sendable {
    let role: AIChatRole
    let content: [AIChatContentPart]
    let timestamp: String
    let isError: Bool
    let isStopped: Bool
    let cursor: String?
    let itemId: String?

    private enum CodingKeys: String, CodingKey {
        case role
        case content
        case timestamp
        case timestampMillis
        case isError
        case isStopped
        case cursor
        case itemId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.role = try container.decode(AIChatRole.self, forKey: .role)
        self.content = try decodeAIChatContentParts(container: container, key: .content)
        if let timestampMillis = try? container.decode(Int.self, forKey: .timestamp) {
            self.timestamp = isoTimestampFromMilliseconds(timestampMillis)
        } else if let timestamp = try? container.decode(String.self, forKey: .timestamp) {
            self.timestamp = timestamp
        } else if let timestampMillis = try? container.decode(Int.self, forKey: .timestampMillis) {
            self.timestamp = isoTimestampFromMilliseconds(timestampMillis)
        } else {
            throw DecodingError.keyNotFound(
                CodingKeys.timestamp,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "AI chat message timestamp is missing."
                )
            )
        }
        self.isError = try container.decode(Bool.self, forKey: .isError)
        self.isStopped = try container.decodeIfPresent(Bool.self, forKey: .isStopped) ?? false
        self.cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
        self.itemId = try container.decodeIfPresent(String.self, forKey: .itemId)
    }
}

struct AIChatAcceptedConversationEnvelopeWire: Decodable, Hashable, Sendable {
    let accepted: Bool
    let sessionId: String
    let conversationScopeId: String
    let conversation: AIChatConversationWire
    let composerSuggestions: [AIChatComposerSuggestion]
    let chatConfig: AIChatServerConfig
    let activeRun: AIChatActiveRunWire?
    let deduplicated: Bool?

    private enum CodingKeys: String, CodingKey {
        case accepted
        case sessionId
        case conversationScopeId
        case conversation
        case composerSuggestions
        case chatConfig
        case activeRun
        case deduplicated
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.accepted = try container.decode(Bool.self, forKey: .accepted)
        self.sessionId = try container.decode(String.self, forKey: .sessionId)
        self.conversationScopeId = try container.decode(String.self, forKey: .conversationScopeId)
        self.conversation = try container.decode(AIChatConversationWire.self, forKey: .conversation)
        self.composerSuggestions = try container.decodeIfPresent(
            [AIChatComposerSuggestion].self,
            forKey: .composerSuggestions
        ) ?? []
        self.chatConfig = try container.decode(AIChatServerConfig.self, forKey: .chatConfig)
        self.activeRun = try container.decodeIfPresent(AIChatActiveRunWire.self, forKey: .activeRun)
        self.deduplicated = try container.decodeIfPresent(Bool.self, forKey: .deduplicated)
    }
}

func mapConversationEnvelope(
    _ payload: AIChatConversationEnvelopeWire
) -> AIChatConversationEnvelope {
    AIChatConversationEnvelope(
        sessionId: payload.sessionId,
        conversationScopeId: payload.conversationScopeId,
        conversation: AIChatConversation(
            messages: payload.conversation.messages.enumerated().map { index, message in
                mapConversationMessage(
                    sessionId: payload.sessionId,
                    index: index,
                    message: message
                )
            },
            updatedAt: payload.conversation.updatedAt,
            mainContentInvalidationVersion: payload.conversation.mainContentInvalidationVersion,
            hasOlder: payload.conversation.hasOlder ?? false,
            oldestCursor: payload.conversation.oldestCursor
        ),
        composerSuggestions: payload.composerSuggestions,
        chatConfig: payload.chatConfig,
        activeRun: payload.activeRun.map(mapActiveRun)
    )
}

func mapAcceptedConversationEnvelope(
    _ payload: AIChatAcceptedConversationEnvelopeWire
) -> AIChatStartRunResponse {
    AIChatStartRunResponse(
        accepted: payload.accepted,
        sessionId: payload.sessionId,
        conversationScopeId: payload.conversationScopeId,
        conversation: AIChatConversation(
            messages: payload.conversation.messages.enumerated().map { index, message in
                mapConversationMessage(
                    sessionId: payload.sessionId,
                    index: index,
                    message: message
                )
            },
            updatedAt: payload.conversation.updatedAt,
            mainContentInvalidationVersion: payload.conversation.mainContentInvalidationVersion,
            hasOlder: payload.conversation.hasOlder ?? false,
            oldestCursor: payload.conversation.oldestCursor
        ),
        composerSuggestions: payload.composerSuggestions,
        chatConfig: payload.chatConfig,
        activeRun: payload.activeRun.map(mapActiveRun),
        deduplicated: payload.deduplicated
    )
}

func mapConversationMessage(
    sessionId: String,
    index: Int,
    message: AIChatConversationMessageWire
) -> AIChatMessage {
    let stableCursor = message.cursor ?? "snapshot-\(index)"
    return AIChatMessage(
        id: "\(sessionId)-\(index)-\(stableCursor)",
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        isError: message.isError,
        isStopped: message.isStopped,
        cursor: message.cursor,
        itemId: message.itemId
    )
}

func mapActiveRun(_ payload: AIChatActiveRunWire) -> AIChatActiveRun {
    AIChatActiveRun(
        runId: payload.runId,
        status: payload.status,
        live: AIChatActiveRunLive(
            cursor: payload.live.cursor,
            stream: payload.live.stream
        ),
        lastHeartbeatAt: payload.lastHeartbeatAt
    )
}

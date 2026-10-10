import Foundation

struct AIChatFeatureFlags: Codable, Hashable, Sendable {
    let dictationEnabled: Bool
    let attachmentsEnabled: Bool

    private enum CodingKeys: String, CodingKey {
        case dictationEnabled
        case attachmentsEnabled
    }
}

struct AIChatServerConfig: Codable, Hashable, Sendable {
    let features: AIChatFeatureFlags

    private enum CodingKeys: String, CodingKey {
        case features
    }

    init(features: AIChatFeatureFlags) {
        self.features = features
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.features = try container.decode(AIChatFeatureFlags.self, forKey: .features)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.features, forKey: .features)
    }
}

let aiChatDefaultServerConfig = AIChatServerConfig(
    features: AIChatFeatureFlags(
        dictationEnabled: true,
        attachmentsEnabled: true
    )
)

func aiChatServerConfig(lastKnownFeatures: AIChatFeatureFlags?) -> AIChatServerConfig {
    AIChatServerConfig(features: lastKnownFeatures ?? aiChatDefaultServerConfig.features)
}

struct AIChatStartRunRequestBody: Encodable, Hashable, Sendable {
    let sessionId: String?
    let clientRequestId: String
    let content: [AIChatStartRunContentPart]
    let timezone: String
    // Keep optional until minimum supported backend and first-party AI client versions are greater than 1.5.0.
    let uiLocale: String?
    // Keep optional until minimum supported backend and first-party AI client versions are greater than 1.5.0.
    let workspaceId: String?
}

/// File and image bytes never travel in `POST /chat`: each is staged through `POST /chat/files/uploads` and named by an `upload` part.
enum AIChatStartRunContentPart: Encodable, Hashable, Sendable {
    case text(String)
    case card(AIChatCardReference)
    case upload(uploadId: String, fileName: String, mediaType: String)

    private enum CodingKeys: String, CodingKey {
        case type
        case text
        case cardId
        case frontText
        case backText
        case tags
        case uploadId
        case fileName
        case mediaType
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .text(let text):
            try container.encode("text", forKey: .type)
            try container.encode(text, forKey: .text)
        case .card(let card):
            try container.encode("card", forKey: .type)
            try container.encode(card.cardId, forKey: .cardId)
            try container.encode(card.frontText, forKey: .frontText)
            try container.encode(card.backText, forKey: .backText)
            try container.encode(card.tags, forKey: .tags)
        case .upload(let uploadId, let fileName, let mediaType):
            try container.encode("upload", forKey: .type)
            try container.encode(uploadId, forKey: .uploadId)
            try container.encode(fileName, forKey: .fileName)
            try container.encode(mediaType, forKey: .mediaType)
        }
    }
}

/// `POST /chat/files/uploads`; the contract lives in `apps/backend/src/chatFiles/uploads.ts`.
struct AIChatFileUploadRequestBody: Encodable, Hashable, Sendable {
    let fileName: String
    let mediaType: String
    let sizeBytes: Int
}

struct AIChatFileUploadResponse: Decodable, Hashable, Sendable {
    let uploadId: String
    let upload: AIChatFileUploadTarget
}

/// The signature binds `content-type` and `content-length`, so the PUT sends `headers` unchanged with exactly the declared bytes.
struct AIChatFileUploadTarget: Decodable, Hashable, Sendable {
    let method: String
    let url: String
    let headers: [String: String]
    let expiresAt: String
}

enum AIChatComposerPhase: String, Hashable, Sendable {
    case idle
    case preparingSend
    case startingRun
    case running
    case stopping
}

enum AIChatBootstrapPhase: Hashable, Sendable {
    case ready
    case loading
    case failed(AIChatBootstrapErrorPresentation)
}

struct AIChatConversation: Hashable, Sendable {
    let messages: [AIChatMessage]
    let updatedAt: Int
    let mainContentInvalidationVersion: Int
    let hasOlder: Bool
    let oldestCursor: String?
}

struct AIChatActiveRunLive: Hashable, Sendable {
    let cursor: String?
    let stream: AIChatLiveStreamEnvelope
}

struct AIChatActiveRun: Hashable, Sendable {
    let runId: String
    let status: String
    let live: AIChatActiveRunLive
    let lastHeartbeatAt: Int?
}

struct AIChatConversationEnvelope: Hashable, Sendable {
    let sessionId: String
    let conversationScopeId: String
    let conversation: AIChatConversation
    let composerSuggestions: [AIChatComposerSuggestion]
    let chatConfig: AIChatServerConfig
    let activeRun: AIChatActiveRun?
}

typealias AIChatSessionSnapshot = AIChatConversationEnvelope
typealias AIChatBootstrapResponse = AIChatConversationEnvelope

struct AIChatOlderMessagesResponse: Sendable {
    let messages: [AIChatMessage]
    let hasOlder: Bool
    let oldestCursor: String?
}

enum AIChatRunTerminalOutcome: String, Decodable, Hashable, Sendable {
    case completed
    case stopped
    case error
    case resetRequired = "reset_required"
}

struct AIChatComposerSuggestion: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let text: String
    let source: String
    let assistantItemId: String?
}

struct AIChatStartRunResponse: Hashable, Sendable {
    let accepted: Bool
    let sessionId: String
    let conversationScopeId: String
    let conversation: AIChatConversation
    let composerSuggestions: [AIChatComposerSuggestion]
    let chatConfig: AIChatServerConfig
    let activeRun: AIChatActiveRun?
    let deduplicated: Bool?

    var envelope: AIChatConversationEnvelope {
        AIChatConversationEnvelope(
            sessionId: self.sessionId,
            conversationScopeId: self.conversationScopeId,
            conversation: self.conversation,
            composerSuggestions: self.composerSuggestions,
            chatConfig: self.chatConfig,
            activeRun: self.activeRun
        )
    }
}

struct AIChatLiveStreamEnvelope: Codable, Hashable, Sendable {
    let url: String
    let authorization: String
    let expiresAt: Int
}

struct AIChatNewSessionRequestBody: Codable, Hashable, Sendable {
    let sessionId: String?
    // Keep optional until minimum supported backend and first-party AI client versions are greater than 1.5.0.
    let uiLocale: String?
    // Keep optional until minimum supported backend and first-party AI client versions are greater than 1.5.0.
    let workspaceId: String?
}

struct AIChatNewSessionResponse: Codable, Hashable, Sendable {
    let ok: Bool
    let sessionId: String
    let composerSuggestions: [AIChatComposerSuggestion]
    let chatConfig: AIChatServerConfig

    private enum CodingKeys: String, CodingKey {
        case ok
        case sessionId
        case composerSuggestions
        case chatConfig
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try container.decode(Bool.self, forKey: .ok)
        self.sessionId = try container.decode(String.self, forKey: .sessionId)
        self.composerSuggestions = try container.decodeIfPresent(
            [AIChatComposerSuggestion].self,
            forKey: .composerSuggestions
        ) ?? []
        self.chatConfig = try container.decode(AIChatServerConfig.self, forKey: .chatConfig)
    }
}

struct AIChatStopRunResponse: Decodable, Hashable, Sendable {
    let sessionId: String
    let stopped: Bool
    let stillRunning: Bool
}

struct AIChatStopRunRequestBody: Codable, Hashable, Sendable {
    let sessionId: String
    // TODO: Make runId required once the minimum supported first-party AI client
    // version is greater than 1.5.0. This optional path supports older releases.
    let runId: String?
    // Keep optional until minimum supported backend and first-party AI client versions are greater than 1.5.0.
    let workspaceId: String?
}

extension AIChatStartRunRequestBody {
    init(
        sessionId: String?,
        clientRequestId: String,
        content: [AIChatStartRunContentPart],
        timezone: String,
        uiLocale: String?
    ) {
        self.init(
            sessionId: sessionId,
            clientRequestId: clientRequestId,
            content: content,
            timezone: timezone,
            uiLocale: uiLocale,
            workspaceId: nil
        )
    }
}

extension AIChatNewSessionRequestBody {
    init(
        sessionId: String?,
        uiLocale: String?
    ) {
        self.init(
            sessionId: sessionId,
            uiLocale: uiLocale,
            workspaceId: nil
        )
    }
}

func currentAIChatUILocaleIdentifier() -> String? {
    currentAppUILocaleIdentifier()
}

func currentAIChatUILocaleIdentifier(
    preferredLocalizations: [String]
) -> String? {
    currentAppUILocaleIdentifier(preferredLocalizations: preferredLocalizations)
}

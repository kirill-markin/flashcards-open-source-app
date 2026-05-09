import Foundation

struct AIChatProviderDescriptor: Codable, Hashable, Sendable {
    let id: String
    let label: String
}

struct AIChatReasoningDescriptor: Codable, Hashable, Sendable {
    let effort: String
    let label: String
}

struct AIChatFeatureFlags: Codable, Hashable, Sendable {
    let modelPickerEnabled: Bool
    let dictationEnabled: Bool
    let attachmentsEnabled: Bool
}

struct AIChatModelDescriptor: Codable, Hashable, Sendable {
    let id: String
    let label: String
    let badgeLabel: String
}

struct AIChatServerConfig: Codable, Hashable, Sendable {
    let provider: AIChatProviderDescriptor
    let model: AIChatModelDescriptor
    let reasoning: AIChatReasoningDescriptor
    let features: AIChatFeatureFlags
}

let aiChatDefaultServerConfig = AIChatServerConfig(
    provider: AIChatProviderDescriptor(
        id: "openai",
        label: aiChatDefaultProviderLabel
    ),
    model: AIChatModelDescriptor(
        id: aiChatDefaultModelId,
        label: aiChatDefaultModelLabel,
        badgeLabel: "\(aiChatDefaultModelLabel) · \(aiChatDefaultReasoningLabel)"
    ),
    reasoning: AIChatReasoningDescriptor(
        effort: aiChatDefaultReasoningEffort,
        label: aiChatDefaultReasoningLabel
    ),
    features: AIChatFeatureFlags(
        modelPickerEnabled: false,
        dictationEnabled: true,
        attachmentsEnabled: true
    )
)

struct AIChatStartRunRequestBody: Codable, Hashable, Sendable {
    let sessionId: String?
    let clientRequestId: String
    let content: [AIChatContentPart]
    let timezone: String
    // Keep this additive field optional while older client and backend builds roll out independently.
    let uiLocale: String?
    // Keep this additive field optional while older client and backend builds roll out independently.
    let workspaceId: String?
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
    // Keep this additive field optional while older client and backend builds roll out independently.
    let uiLocale: String?
    // Keep this additive field optional while older client and backend builds roll out independently.
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
    // TODO: Remove optional runId and make it required after most users have updated to the latest version. This is a legacy path.
    let runId: String?
    // Keep this additive field optional while older client and backend builds roll out independently.
    let workspaceId: String?
}

extension AIChatStartRunRequestBody {
    init(
        sessionId: String?,
        clientRequestId: String,
        content: [AIChatContentPart],
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
    currentAIChatUILocaleIdentifier(
        preferredLocalizations: Bundle.main.preferredLocalizations
    )
}

func currentAIChatUILocaleIdentifier(
    preferredLocalizations: [String]
) -> String? {
    let localeIdentifier = preferredLocalizations.first { candidate in
        candidate.isEmpty == false && candidate != "Base"
    }

    guard let localeIdentifier else {
        return nil
    }

    return localeIdentifier.replacingOccurrences(of: "_", with: "-")
}

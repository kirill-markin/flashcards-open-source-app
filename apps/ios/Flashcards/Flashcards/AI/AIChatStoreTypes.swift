import Foundation

let aiChatBootstrapPageLimit: Int = 20

enum AIChatAttachmentSettingsSource: String, Equatable {
    case camera
    case photos
    case files

    var title: String {
        switch self {
        case .camera:
            return String(
                localized: "ai_chat_attachment_settings.camera.title",
                table: "Foundation",
                comment: "AI chat alert title when camera access is needed"
            )
        case .photos:
            return String(
                localized: "ai_chat_attachment_settings.photos.title",
                table: "Foundation",
                comment: "AI chat alert title when photo access is needed"
            )
        case .files:
            return String(
                localized: "ai_chat_attachment_settings.files.title",
                table: "Foundation",
                comment: "AI chat alert title when file access is needed"
            )
        }
    }

    var message: String {
        switch self {
        case .camera:
            return String(
                localized: "ai_chat_attachment_settings.camera.message",
                table: "Foundation",
                comment: "AI chat alert message when camera access is blocked"
            )
        case .photos:
            return String(
                localized: "ai_chat_attachment_settings.photos.message",
                table: "Foundation",
                comment: "AI chat alert message when photo access is blocked"
            )
        case .files:
            return String(
                localized: "ai_chat_attachment_settings.files.message",
                table: "Foundation",
                comment: "AI chat alert message when file access is blocked"
            )
        }
    }
}

enum AIChatAlert: Identifiable, Equatable {
    case microphoneSettings
    case attachmentSettings(source: AIChatAttachmentSettingsSource)
    case generalError(title: String, message: String)

    var id: String {
        switch self {
        case .microphoneSettings:
            return "microphone-settings"
        case .attachmentSettings(let source):
            return "attachment-settings-\(source.rawValue)"
        case .generalError(let title, let message):
            return "general-error-\(title)-\(message)"
        }
    }

    var title: String {
        switch self {
        case .microphoneSettings:
            return String(
                localized: "ai_chat_alert.microphone.title",
                table: "Foundation",
                comment: "AI chat alert title when microphone access is needed"
            )
        case .attachmentSettings(let source):
            return source.title
        case .generalError(let title, _):
            return title
        }
    }

    var message: String {
        switch self {
        case .microphoneSettings:
            return String(
                localized: "ai_chat_alert.microphone.message",
                table: "Foundation",
                comment: "AI chat alert message when microphone access is blocked"
            )
        case .attachmentSettings(let source):
            return source.message
        case .generalError(_, let message):
            return message
        }
    }

    var showsSettingsAction: Bool {
        switch self {
        case .microphoneSettings, .attachmentSettings:
            return true
        case .generalError:
            return false
        }
    }
}

struct AIChatCompletedDictationTranscript: Identifiable, Equatable {
    let id: String
    let transcript: String
}

struct AIChatComposerDraft: Codable, Hashable, Sendable {
    let inputText: String
    let pendingAttachments: [AIChatAttachment]

    var isEmpty: Bool {
        self.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && self.pendingAttachments.isEmpty
    }
}

func aiChatShouldReuseCurrentSessionForHandoff(
    messages: [AIChatMessage],
    composerDraft: AIChatComposerDraft,
    composerPhase: AIChatComposerPhase,
    activeRunId: String?,
    currentSessionId: String
) -> Bool {
    messages.isEmpty
        && composerDraft.isEmpty
        && composerPhase == .idle
        && activeRunId == nil
        && currentSessionId.isEmpty == false
}

struct AIChatAccessContext: Equatable {
    let workspaceId: String?
    let cloudState: CloudAccountState?
    let linkedUserId: String?
    let activeWorkspaceId: String?
}

struct AIChatSurfaceActivity: Equatable {
    let isSceneActive: Bool
    let isAITabSelected: Bool
    let hasExternalProviderConsent: Bool
    let workspaceId: String?
    let cloudState: CloudAccountState?
    let linkedUserId: String?
    let activeWorkspaceId: String?

    var isVisible: Bool {
        self.isSceneActive && self.isAITabSelected && self.hasExternalProviderConsent
    }

    var accessContext: AIChatAccessContext {
        AIChatAccessContext(
            workspaceId: self.workspaceId,
            cloudState: self.cloudState,
            linkedUserId: self.linkedUserId,
            activeWorkspaceId: self.activeWorkspaceId
        )
    }
}

struct AIChatConversationState {
    var messages: [AIChatMessage]
    var hasOlderMessages: Bool
    var oldestCursor: String?
}

struct AIChatComposerState {
    var inputText: String
    var pendingAttachments: [AIChatAttachment]
    var serverSuggestions: [AIChatComposerSuggestion]
    var dictationState: AIChatDictationState
    var completedDictationTranscript: AIChatCompletedDictationTranscript?
}

struct AIChatSurfaceState {
    var activity: AIChatSurfaceActivity
    var activeAccessContext: AIChatAccessContext?
    var bootstrapPhase: AIChatBootstrapPhase
    var shouldKeepLiveAttached: Bool
}

struct AIChatActiveRunSession {
    let sessionId: String
    let conversationScopeId: String
    let runId: String
    let liveStream: AIChatLiveStreamEnvelope
    var liveCursor: String?
    var streamEpoch: String?
}

enum AIChatRunLifecycle {
    case idle
    case preparingSend
    case starting
    case streaming(AIChatActiveRunSession)
    case stopping(previousRunId: String?)

    var composerPhase: AIChatComposerPhase {
        switch self {
        case .idle:
            return .idle
        case .preparingSend:
            return .preparingSend
        case .starting:
            return .startingRun
        case .streaming:
            return .running
        case .stopping:
            return .stopping
        }
    }
}

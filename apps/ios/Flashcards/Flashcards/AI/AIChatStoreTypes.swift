import Foundation

let aiChatBootstrapPageLimit: Int = 20

enum AIChatAttachmentSettingsSource: String, Equatable {
    case camera
    case photos
    case files

    var title: String {
        switch self {
        case .camera:
            return "Camera Access Needed"
        case .photos:
            return "Photo Access Needed"
        case .files:
            return "File Access Needed"
        }
    }

    var message: String {
        switch self {
        case .camera:
            return "Camera access is turned off for Flashcards Open Source App. Open Settings to allow it."
        case .photos:
            return "Photo access is turned off for Flashcards Open Source App. Open Settings to allow it."
        case .files:
            return "File access is turned off for Flashcards Open Source App. Open Settings to allow it."
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
            return "Microphone Access Needed"
        case .attachmentSettings(let source):
            return source.title
        case .generalError(let title, _):
            return title
        }
    }

    var message: String {
        switch self {
        case .microphoneSettings:
            return "Microphone access is turned off for Flashcards Open Source App. Open Settings to allow it."
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

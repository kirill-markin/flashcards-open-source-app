import Foundation
import Observation
import OSLog

private let aiChatPresentationLifecycleLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "ai_handoff"
)

private enum AIChatPresentationLifecycleEvent: String {
    case capture
    case waitingForAITab = "waiting_for_ai_tab"
    case waitingForConsent = "waiting_for_consent"
    case waitingForInteractiveChat = "waiting_for_interactive_chat"
    case alreadyApplied = "already_applied"
    case applyAttempt = "apply_attempt"
    case postSurfaceSyncConfirmed = "post_surface_sync_confirmed"
    case postSurfaceSyncMissing = "post_surface_sync_missing"
    case reapplyAttempt = "reapply_attempt"
    case reapplyPostSurfaceSyncMissing = "reapply_post_surface_sync_missing"
    case complete
}

enum AIChatPresentationLifecycleSource: String {
    case acceptedExternalAIConsent = "accepted_external_ai_consent"
    case viewAppear = "view_appear"
    case navigationRequestChange = "navigation_request_change"
    case bootstrapReady = "bootstrap_ready"
    case composerPhaseReady = "composer_phase_ready"
    case externalProviderConsentGranted = "external_provider_consent_granted"
    case sceneActive = "scene_active"
    case surfaceInputsChanged = "surface_inputs_changed"
    case selectedAITab = "selected_ai_tab"
    case dictationIdle = "dictation_idle"
}

/// What the mounted chat view knows at the moment of one coordinator call.
struct AIChatPresentationRequestContext {
    let isPresentationActive: Bool
    let navigationRequest: AIChatPresentationRequest?
    let chatStore: AIChatStore
    let syncChatSurface: @MainActor () -> Void
    let selectedTab: AppTab
    let cloudState: CloudAccountState?
    let workspaceId: String?
    let activeWorkspaceId: String?
}

private func aiChatPresentationRequestDiagnosticKind(_ request: AIChatPresentationRequest) -> String {
    switch request {
    case .createCard:
        return "create_card"
    case .attachCard:
        return "attach_card"
    }
}

private func aiChatPresentationRequestDiagnosticCardIdSuffix(_ request: AIChatPresentationRequest) -> String {
    switch request {
    case .createCard:
        return "-"
    case .attachCard(let card):
        return aiChatDiagnosticIdSuffix(card.cardId)
    }
}

private func aiChatDiagnosticIdSuffix(_ value: String?) -> String {
    guard let value else {
        return "-"
    }
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false else {
        return "-"
    }

    return String(trimmedValue.suffix(8))
}

private func aiChatBootstrapPhaseDiagnosticValue(_ phase: AIChatBootstrapPhase) -> String {
    switch phase {
    case .ready:
        return "ready"
    case .loading:
        return "loading"
    case .failed:
        return "failed"
    }
}

private func appTabDiagnosticValue(_ tab: AppTab) -> String {
    switch tab {
    case .review:
        return "review"
    case .progress:
        return "progress"
    case .ai:
        return "ai"
    case .library:
        return "library"
    case .settings:
        return "settings"
    }
}

/// Holds a Review attachment or Create with AI request for one mounted chat view until the chat can
/// apply it. The view applies composer focus and clears the navigation request on completion.
@MainActor
@Observable
final class AIChatPresentationRequestCoordinator {
    private(set) var deferredPresentationRequest: AIChatPresentationRequest?

    init() {
        self.deferredPresentationRequest = nil
    }

    func clearDeferredPresentationRequest() {
        self.deferredPresentationRequest = nil
    }

    func capture(
        request: AIChatPresentationRequest?,
        source: AIChatPresentationLifecycleSource,
        context: AIChatPresentationRequestContext
    ) {
        guard context.isPresentationActive, let request else {
            return
        }

        self.deferredPresentationRequest = request
        self.log(
            event: .capture,
            source: source,
            request: request,
            didApply: nil,
            surfaceSynced: false,
            context: context
        )
    }

    /// Returns the request once the chat holds it after a surface sync, or nil while it still waits.
    func handle(
        request: AIChatPresentationRequest?,
        source: AIChatPresentationLifecycleSource,
        context: AIChatPresentationRequestContext
    ) -> AIChatPresentationRequest? {
        let resolvedRequest = request ?? context.navigationRequest ?? self.deferredPresentationRequest
        guard let resolvedRequest else {
            return nil
        }
        self.capture(
            request: resolvedRequest,
            source: source,
            context: context
        )
        guard context.isPresentationActive else {
            self.log(
                event: .waitingForAITab,
                source: source,
                request: resolvedRequest,
                didApply: nil,
                surfaceSynced: false,
                context: context
            )
            return nil
        }
        guard context.chatStore.hasExternalProviderConsent else {
            self.log(
                event: .waitingForConsent,
                source: source,
                request: resolvedRequest,
                didApply: nil,
                surfaceSynced: false,
                context: context
            )
            return nil
        }
        guard context.chatStore.isChatInteractive else {
            self.log(
                event: .waitingForInteractiveChat,
                source: source,
                request: resolvedRequest,
                didApply: nil,
                surfaceSynced: false,
                context: context
            )
            return nil
        }

        guard self.applyIfNeeded(
            request: resolvedRequest,
            source: source,
            context: context
        ) else {
            return nil
        }
        if self.confirmAfterSurfaceSync(
            request: resolvedRequest,
            source: source,
            missingEvent: .postSurfaceSyncMissing,
            context: context
        ) {
            return self.complete(
                request: resolvedRequest,
                source: source,
                context: context
            )
        }

        let didReapplyRequest = context.chatStore.applyPresentationRequest(request: resolvedRequest)
        self.log(
            event: .reapplyAttempt,
            source: source,
            request: resolvedRequest,
            didApply: didReapplyRequest,
            surfaceSynced: false,
            context: context
        )
        guard didReapplyRequest else {
            return nil
        }
        guard self.confirmAfterSurfaceSync(
            request: resolvedRequest,
            source: source,
            missingEvent: .reapplyPostSurfaceSyncMissing,
            context: context
        ) else {
            return nil
        }
        return self.complete(
            request: resolvedRequest,
            source: source,
            context: context
        )
    }

    private func applyIfNeeded(
        request: AIChatPresentationRequest,
        source: AIChatPresentationLifecycleSource,
        context: AIChatPresentationRequestContext
    ) -> Bool {
        if context.chatStore.hasAppliedPresentationRequest(request: request) {
            self.log(
                event: .alreadyApplied,
                source: source,
                request: request,
                didApply: nil,
                surfaceSynced: false,
                context: context
            )
            return true
        }

        let didApplyRequest = context.chatStore.applyPresentationRequest(request: request)
        self.log(
            event: .applyAttempt,
            source: source,
            request: request,
            didApply: didApplyRequest,
            surfaceSynced: false,
            context: context
        )
        return didApplyRequest
    }

    private func confirmAfterSurfaceSync(
        request: AIChatPresentationRequest,
        source: AIChatPresentationLifecycleSource,
        missingEvent: AIChatPresentationLifecycleEvent,
        context: AIChatPresentationRequestContext
    ) -> Bool {
        context.syncChatSurface()
        guard context.chatStore.hasAppliedPresentationRequest(request: request) else {
            self.log(
                event: missingEvent,
                source: source,
                request: request,
                didApply: nil,
                surfaceSynced: true,
                context: context
            )
            return false
        }

        self.log(
            event: .postSurfaceSyncConfirmed,
            source: source,
            request: request,
            didApply: nil,
            surfaceSynced: true,
            context: context
        )
        return true
    }

    private func complete(
        request: AIChatPresentationRequest,
        source: AIChatPresentationLifecycleSource,
        context: AIChatPresentationRequestContext
    ) -> AIChatPresentationRequest {
        self.log(
            event: .complete,
            source: source,
            request: request,
            didApply: nil,
            surfaceSynced: true,
            context: context
        )
        if self.deferredPresentationRequest == request {
            self.deferredPresentationRequest = nil
        }
        return request
    }

    private func log(
        event: AIChatPresentationLifecycleEvent,
        source: AIChatPresentationLifecycleSource,
        request: AIChatPresentationRequest,
        didApply: Bool?,
        surfaceSynced: Bool,
        context: AIChatPresentationRequestContext
    ) {
        let chatStore = context.chatStore
        let didApplyValue = didApply.map { didApply in String(didApply) } ?? "-"
        let isAppliedValue = String(chatStore.hasAppliedPresentationRequest(request: request))
        let surfaceSyncedValue = String(surfaceSynced)
        let hasConsentValue = String(chatStore.hasExternalProviderConsent)
        let isInteractiveValue = String(chatStore.isChatInteractive)
        let canAttachCardValue = String(chatStore.canAttachCardToDraft)
        let selectedTab = appTabDiagnosticValue(context.selectedTab)
        let bootstrapPhase = aiChatBootstrapPhaseDiagnosticValue(chatStore.bootstrapPhase)
        let cloudState = context.cloudState?.rawValue ?? "-"
        let workspaceIdSuffix = aiChatDiagnosticIdSuffix(context.workspaceId)
        let activeWorkspaceIdSuffix = aiChatDiagnosticIdSuffix(context.activeWorkspaceId)
        aiChatPresentationLifecycleLogger.log(
            """
            event=\(event.rawValue, privacy: .public) \
            source=\(source.rawValue, privacy: .public) \
            requestKind=\(aiChatPresentationRequestDiagnosticKind(request), privacy: .public) \
            cardIdSuffix=\(aiChatPresentationRequestDiagnosticCardIdSuffix(request), privacy: .public) \
            selectedTab=\(selectedTab, privacy: .public) \
            hasConsent=\(hasConsentValue, privacy: .public) \
            isInteractive=\(isInteractiveValue, privacy: .public) \
            bootstrapPhase=\(bootstrapPhase, privacy: .public) \
            composerPhase=\(chatStore.composerPhase.rawValue, privacy: .public) \
            pendingAttachmentCount=\(chatStore.pendingAttachments.count, privacy: .public) \
            inputTextLength=\(chatStore.inputText.count, privacy: .public) \
            messageCount=\(chatStore.messages.count, privacy: .public) \
            isApplied=\(isAppliedValue, privacy: .public) \
            didApply=\(didApplyValue, privacy: .public) \
            surfaceSynced=\(surfaceSyncedValue, privacy: .public) \
            canAttachCard=\(canAttachCardValue, privacy: .public) \
            cloudState=\(cloudState, privacy: .public) \
            workspaceIdSuffix=\(workspaceIdSuffix, privacy: .public) \
            activeWorkspaceIdSuffix=\(activeWorkspaceIdSuffix, privacy: .public)
            """
        )
    }
}

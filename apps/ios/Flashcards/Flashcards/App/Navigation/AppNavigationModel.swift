import Foundation
import Observation

func makeSettingsNavigationPath(destination: SettingsNavigationDestination) -> [SettingsNavigationDestination] {
    switch destination {
    case .currentWorkspace:
        return [.currentWorkspace]
    case .reviewAnimations:
        return [.reviewAnimations]
    case .aiChatSuggestions:
        return [.aiChatSuggestions]
    case .leaderboardParticipation:
        return [.leaderboardParticipation]
    case .language:
        return [.language]
    case .feedback:
        return [.feedback]
    case .device:
        return [.device]
    case .access:
        return [.access]
    case .accessPermissionDetail(let kind):
        return [.access, .accessPermissionDetail(kind)]
    case .test:
        return [.test]
    case .testAnimations:
        return [.test, .testAnimations]
    case .notificationDiagnostics:
        return [.test, .notificationDiagnostics]
    case .localSyncDiagnostics:
        return [.test, .localSyncDiagnostics]
    case .notifications:
        return [.notifications]
    case .workspaceScheduler:
        return [.workspaceScheduler]
    case .workspaceExport:
        return [.workspaceExport]
    case .workspaceImport:
        return [.workspaceImport]
    case .workspaceDecks:
        return [.workspaceDecks]
    case .workspaceTags:
        return [.workspaceTags]
    case .accountStatus:
        return [.accountStatus]
    case .accountLegal:
        return [.accountLegal]
    case .accountSupport:
        return [.accountSupport]
    case .accountOpenSource:
        return [.accountOpenSource]
    case .accountServer:
        return [.accountServer]
    case .accountAgentConnections:
        return [.accountAgentConnections]
    case .accountDangerZone:
        return [.accountDangerZone]
    case .resetStudyProgress:
        return [.resetStudyProgress]
    case .deleteCurrentWorkspace:
        return [.deleteCurrentWorkspace]
    }
}

@MainActor
@Observable
final class AppNavigationModel {
    private(set) var selectedTab: AppTab
    private(set) var aiTabVisitID: UUID
    var settingsPath: [SettingsNavigationDestination]
    var cardsPresentationRequest: CardsPresentationRequest?
    var aiChatPresentationRequest: AIChatPresentationRequest?
    var progressPresentationRequest: ProgressPresentationRequest?

    init() {
        self.selectedTab = .review
        self.aiTabVisitID = UUID()
        self.settingsPath = []
        self.cardsPresentationRequest = nil
        self.aiChatPresentationRequest = nil
        self.progressPresentationRequest = nil
    }

    init(
        selectedTab: AppTab,
        settingsPath: [SettingsNavigationDestination],
        cardsPresentationRequest: CardsPresentationRequest?,
        aiChatPresentationRequest: AIChatPresentationRequest?,
        progressPresentationRequest: ProgressPresentationRequest?
    ) {
        self.selectedTab = selectedTab
        self.aiTabVisitID = UUID()
        self.settingsPath = settingsPath
        self.cardsPresentationRequest = cardsPresentationRequest
        self.aiChatPresentationRequest = aiChatPresentationRequest
        self.progressPresentationRequest = progressPresentationRequest
    }

    /**
     * Every tab change goes through here, and the destination's `screen_viewed` is claimed before the
     * selection actually moves.
     *
     * Doing it before the mutation is what makes the funnel independent of SwiftUI callback ordering.
     * The tab-bar tap already had that property, because the selection `Binding.set` in `RootTabView`
     * reports the destination and only then calls this. A programmatic change — a deck or tag opening
     * review, a notification tap, `openCardCreation`, `openProgress`, `openSettings` — used to be
     * reported afterwards, from an ancestor's `.onChange(of: selectedTab)`, and the ordering between
     * that and the outgoing screen's `.onDisappear` is not established. Losing the race let a screen
     * that restores a surface on dismissal name one the user had already left, which would also hide
     * their genuine next view of it behind the dedupe.
     *
     * The reports from `prepareVisibleTabForPresentation` stay where they are: that one also covers
     * the tab shown at launch, which never passes through here, and a repeat of the surface already
     * being viewed is dropped.
     *
     * A call that names the tab already selected is not a tab change and reports nothing. The tab-bar
     * re-selection tap arrives here right behind the same binding setter that feeds
     * `prepareVisibleTabForPresentation`, so the gate has to hold at both or the re-selection would
     * simply be reported from this one instead — and it would report a tab whose pushed detail screen
     * is what the user is actually looking at. `openCardCreation`, `openProgress` and `openSettings`
     * can also target the tab already on screen, and what the user then arrives at is the editor or
     * the pushed destination, which is not this tab's own surface.
     */
    func selectTab(_ tab: AppTab) {
        if self.selectedTab != tab {
            Analytics.trackScreenViewed(analyticsSurface(tab: tab))
        }
        if self.selectedTab != .ai, tab == .ai {
            self.aiTabVisitID = UUID()
        }

        self.selectedTab = tab
    }

    func openCardCreation() {
        self.selectTab(.cards)
        self.cardsPresentationRequest = .createCard
    }

    func openAICardCreation() {
        self.selectTab(.ai)
        self.aiChatPresentationRequest = .createCard
    }

    func openAICardHandoff(card: AIChatCardReference) {
        // Publish the reset request before tab entry can enqueue a scroll against the old transcript.
        self.aiChatPresentationRequest = .attachCard(card)
        self.selectTab(.ai)
    }

    func openProgress(target: ProgressPresentationTarget) {
        self.selectTab(.progress)
        self.progressPresentationRequest = ProgressPresentationRequest(
            id: UUID(),
            target: target
        )
    }

    func openSettings(destination: SettingsNavigationDestination) {
        self.selectTab(.settings)
        self.settingsPath = makeSettingsNavigationPath(destination: destination)
    }

    func clearCardsPresentationRequest() {
        self.cardsPresentationRequest = nil
    }

    func clearAIChatPresentationRequest(request: AIChatPresentationRequest) {
        guard self.aiChatPresentationRequest == request else {
            return
        }

        self.aiChatPresentationRequest = nil
    }

    func clearProgressPresentationRequest(id: UUID) {
        guard self.progressPresentationRequest?.id == id else {
            return
        }

        self.progressPresentationRequest = nil
    }
}

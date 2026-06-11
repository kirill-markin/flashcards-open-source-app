import Foundation
import Observation

func makeSettingsNavigationPath(destination: SettingsNavigationDestination) -> [SettingsNavigationDestination] {
    switch destination {
    case .currentWorkspace:
        return [.currentWorkspace]
    case .reviewAnimations:
        return [.reviewAnimations]
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
    case .workspaceNotifications:
        return [.workspaceNotifications]
    case .workspaceScheduler:
        return [.workspaceScheduler]
    case .workspaceExport:
        return [.workspaceExport]
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
    var selectedTab: AppTab
    var settingsPath: [SettingsNavigationDestination]
    var cardsPresentationRequest: CardsPresentationRequest?
    var aiChatPresentationRequest: AIChatPresentationRequest?
    var progressPresentationRequest: ProgressPresentationRequest?

    init() {
        self.selectedTab = .review
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
        self.settingsPath = settingsPath
        self.cardsPresentationRequest = cardsPresentationRequest
        self.aiChatPresentationRequest = aiChatPresentationRequest
        self.progressPresentationRequest = progressPresentationRequest
    }

    func selectTab(_ tab: AppTab) {
        self.selectedTab = tab
    }

    func openCardCreation() {
        self.selectedTab = .cards
        self.cardsPresentationRequest = .createCard
    }

    func openAICardCreation() {
        self.selectedTab = .ai
        self.aiChatPresentationRequest = .createCard
    }

    func openAICardHandoff(card: AIChatCardReference) {
        self.selectedTab = .ai
        self.aiChatPresentationRequest = .attachCard(card)
    }

    func openProgress(target: ProgressPresentationTarget) {
        self.selectedTab = .progress
        self.progressPresentationRequest = ProgressPresentationRequest(
            id: UUID(),
            target: target
        )
    }

    func openSettings(destination: SettingsNavigationDestination) {
        self.selectedTab = .settings
        self.settingsPath = makeSettingsNavigationPath(destination: destination)
    }

    func clearCardsPresentationRequest() {
        self.cardsPresentationRequest = nil
    }

    func clearAIChatPresentationRequest() {
        self.aiChatPresentationRequest = nil
    }

    func clearProgressPresentationRequest(id: UUID) {
        guard self.progressPresentationRequest?.id == id else {
            return
        }

        self.progressPresentationRequest = nil
    }
}

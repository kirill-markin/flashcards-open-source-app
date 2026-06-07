import Foundation
import Observation

func makeSettingsNavigationPath(destination: SettingsNavigationDestination) -> [SettingsNavigationDestination] {
    switch destination {
    case .currentWorkspace:
        return [.currentWorkspace]
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
    case .workspace:
        return [.workspace]
    case .workspaceNotifications:
        return [.workspaceNotifications]
    case .workspaceOverview:
        return [.workspace, .workspaceOverview]
    case .workspaceScheduler:
        return [.workspaceScheduler]
    case .workspaceExport:
        return [.workspaceExport]
    case .workspaceDecks:
        return [.workspaceDecks]
    case .workspaceTags:
        return [.workspaceTags]
    case .account:
        return [.account]
    case .accountStatus:
        return [.accountStatus]
    case .accountLegalSupport:
        return [.accountLegalSupport]
    case .accountOpenSource:
        return [.accountOpenSource]
    case .accountAdvanced:
        return [.account, .accountAdvanced]
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

    init() {
        self.selectedTab = .review
        self.settingsPath = []
        self.cardsPresentationRequest = nil
        self.aiChatPresentationRequest = nil
    }

    init(
        selectedTab: AppTab,
        settingsPath: [SettingsNavigationDestination],
        cardsPresentationRequest: CardsPresentationRequest?,
        aiChatPresentationRequest: AIChatPresentationRequest?
    ) {
        self.selectedTab = selectedTab
        self.settingsPath = settingsPath
        self.cardsPresentationRequest = cardsPresentationRequest
        self.aiChatPresentationRequest = aiChatPresentationRequest
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
}

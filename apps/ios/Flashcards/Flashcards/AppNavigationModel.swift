import Foundation
import Observation

func makeSettingsNavigationPath(destination: SettingsNavigationDestination) -> [SettingsNavigationDestination] {
    switch destination {
    case .access:
        return [.access]
    case .workspace:
        return [.workspace]
    case .workspaceOverview:
        return [.workspace, .workspaceOverview]
    case .workspaceScheduler:
        return [.workspace, .workspaceScheduler]
    case .workspaceDecks:
        return [.workspace, .workspaceDecks]
    case .workspaceTags:
        return [.workspace, .workspaceTags]
    case .workspaceDevice:
        return [.workspace, .workspaceDevice]
    case .account:
        return [.account]
    case .accountStatus:
        return [.account, .accountStatus]
    case .accountLegalSupport:
        return [.account, .accountLegalSupport]
    case .accountOpenSource:
        return [.account, .accountOpenSource]
    case .accountAdvanced:
        return [.account, .accountAdvanced]
    case .accountServer:
        return [.account, .accountAdvanced, .accountServer]
    case .accountAgentConnections:
        return [.account, .accountAgentConnections]
    case .accountDangerZone:
        return [.account, .accountDangerZone]
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

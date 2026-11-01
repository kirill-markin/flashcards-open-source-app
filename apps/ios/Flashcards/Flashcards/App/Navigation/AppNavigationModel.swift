import Foundation
import Observation
import SwiftUI
import UIKit

func makeSettingsNavigationPath(destination: SettingsNavigationDestination) -> [SettingsNavigationDestination] {
    switch destination {
    case .subscription:
        return [.subscription]
    case .currentWorkspace:
        return [.currentWorkspace]
    case .accentColor:
        return [.accentColor]
    case .reviewAnimations:
        return [.reviewAnimations]
    case .aiChatSuggestions:
        return [.aiChatSuggestions]
    case .appIcon:
        return [.appIcon]
    case .ownOpenAIKey:
        return [.ownOpenAIKey]
    case .leaderboardParticipation:
        return [.leaderboardParticipation]
    case .productAnalytics:
        return [.productAnalytics]
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
    var aiPath: NavigationPath
    var cardsPresentationRequest: CardsPresentationRequest?
    var aiChatPresentationRequest: AIChatPresentationRequest?
    var progressPresentationRequest: ProgressPresentationRequest?
    var isAICompanionPresented: Bool = false
    private(set) var canPresentAICompanion: Bool = false
    /// Open presentations that disable the Review commands; see `View.reviewKeyboardBlockingPresentation`.
    private(set) var reviewKeyboardBlockingPresentationIDs: Set<UUID> = []

    var isAICompanionVisible: Bool {
        self.canPresentAICompanion && self.isAICompanionPresented
            && (self.selectedTab != .ai && self.selectedTab != .settings)
    }

    var isAIChatVisible: Bool {
        self.selectedTab == .ai || self.isAICompanionVisible
    }

    init() {
        self.selectedTab = .review
        self.aiTabVisitID = UUID()
        self.settingsPath = []
        self.aiPath = NavigationPath()
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
        self.aiPath = NavigationPath()
        self.cardsPresentationRequest = cardsPresentationRequest
        self.aiChatPresentationRequest = aiChatPresentationRequest
        self.progressPresentationRequest = progressPresentationRequest
    }

    func selectTab(_ tab: AppTab) {
        if self.selectedTab != tab {
            Analytics.trackScreenViewed(analyticsSurface(tab: tab))
        }
        if self.selectedTab != .ai, tab == .ai {
            self.aiTabVisitID = UUID()
        }

        self.selectedTab = tab
    }

    func setReviewKeyboardBlockingPresentation(id: UUID, isPresented: Bool) {
        // Mutating the observed set notifies even when membership is unchanged.
        guard self.reviewKeyboardBlockingPresentationIDs.contains(id) != isPresented else {
            return
        }
        if isPresented {
            self.reviewKeyboardBlockingPresentationIDs.insert(id)
        } else {
            self.reviewKeyboardBlockingPresentationIDs.remove(id)
        }
    }

    func openCardCreation() {
        self.selectTab(.cards)
        self.cardsPresentationRequest = .createCard
    }

    func updateAICompanionAvailability(_ isAvailable: Bool) {
        // Retain the pane preference and shared draft when a window gets smaller.
        // A layout change should not switch the person's selected tab.
        self.canPresentAICompanion = isAvailable
    }

    func toggleAICompanion() {
        guard self.canPresentAICompanion else {
            self.selectTab(.ai)
            return
        }
        if self.isAICompanionVisible {
            // End typing before SwiftUI removes the focused composer.
            UIApplication.shared.sendAction(
                #selector(UIResponder.resignFirstResponder),
                to: nil,
                from: nil,
                for: nil
            )
        }
        self.isAICompanionPresented.toggle()
    }

    func openAICardCreation() {
        if self.isAICompanionVisible == false {
            self.selectTab(.ai)
        }
        self.popAIToLiveChat()
        self.aiChatPresentationRequest = .createCard
    }

    func openAICardHandoff(card: AIChatCardReference) {
        // Publish the reset request before tab entry can enqueue a scroll against the old transcript.
        self.aiChatPresentationRequest = .attachCard(card)
        if self.isAICompanionVisible == false {
            self.selectTab(.ai)
        }
        self.popAIToLiveChat()
    }

    func popAIToLiveChat() {
        guard self.aiPath.isEmpty == false else {
            return
        }
        self.aiPath = NavigationPath()
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

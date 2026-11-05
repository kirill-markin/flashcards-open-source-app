import Foundation
import Observation
import SwiftUI
import UIKit

#if targetEnvironment(macCatalyst)
/// The Mac split view keeps one navigation state for its detail column and compares the paths
/// of every tab's stack inside it; a typed array beside `NavigationPath` stacks traps SwiftUI
/// with `AnyNavigationPath.Error.comparisonTypeMismatch`, so Settings and Library use `NavigationPath` there.
typealias SettingsNavigationPath = NavigationPath
typealias LibraryNavigationPath = NavigationPath
#else
typealias SettingsNavigationPath = [SettingsNavigationDestination]
typealias LibraryNavigationPath = [LibraryNavigationDestination]
#endif

func makeLibraryNavigationPath(destination: LibraryNavigationDestination) -> [LibraryNavigationDestination] {
    switch destination {
    case .cards:
        return [.cards]
    case .tags:
        return [.tags]
    case .decks:
        return [.decks]
    case .deckDetail(let deck):
        return [.decks, .deckDetail(deck)]
    case .importData:
        return [.importData]
    case .exportData:
        return [.exportData]
    }
}

func makeSettingsNavigationPath(destination: SettingsNavigationDestination) -> [SettingsNavigationDestination] {
    switch destination {
    case .subscription:
        return [.subscription]
    case .currentWorkspace:
        return [.currentWorkspace]
    case .theme:
        return [.theme]
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
    #if targetEnvironment(macCatalyst)
    private(set) var cardSearchFocusRequestID: UUID? = nil
    #endif
    var settingsPath: SettingsNavigationPath
    var libraryPath: LibraryNavigationPath
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
        self.settingsPath = SettingsNavigationPath()
        self.libraryPath = LibraryNavigationPath()
        self.aiPath = NavigationPath()
        self.cardsPresentationRequest = nil
        self.aiChatPresentationRequest = nil
        self.progressPresentationRequest = nil
    }

    init(
        selectedTab: AppTab,
        settingsPath: [SettingsNavigationDestination],
        libraryPath: [LibraryNavigationDestination],
        cardsPresentationRequest: CardsPresentationRequest?,
        aiChatPresentationRequest: AIChatPresentationRequest?,
        progressPresentationRequest: ProgressPresentationRequest?
    ) {
        self.selectedTab = selectedTab
        self.aiTabVisitID = UUID()
        self.settingsPath = SettingsNavigationPath(settingsPath)
        self.libraryPath = LibraryNavigationPath(libraryPath)
        self.aiPath = NavigationPath()
        self.cardsPresentationRequest = cardsPresentationRequest
        self.aiChatPresentationRequest = aiChatPresentationRequest
        self.progressPresentationRequest = progressPresentationRequest
    }

    func selectTab(_ tab: AppTab) {
        if self.selectedTab != tab {
            Analytics.trackScreenViewed(self.visibleAnalyticsSurface(tab: tab))
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

    #if targetEnvironment(macCatalyst)
    func searchCards() {
        self.openLibrary(destination: .cards)
        self.cardSearchFocusRequestID = UUID()
    }

    func clearCardSearchFocusRequest() {
        self.cardSearchFocusRequestID = nil
    }
    #endif

    func openCardCreation() {
        self.openLibrary(destination: .cards)
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
        self.settingsPath = SettingsNavigationPath(makeSettingsNavigationPath(destination: destination))
    }

    func openLibrary(destination: LibraryNavigationDestination) {
        // The path goes first so the tab switch reports the page it lands on.
        self.libraryPath = LibraryNavigationPath(makeLibraryNavigationPath(destination: destination))
        self.selectTab(.library)
    }

    /// The surface a tab shows: Library names the page on top of its stack.
    func visibleAnalyticsSurface(tab: AppTab) -> AnalyticsSurface {
        tab == .library ? self.visibleLibraryAnalyticsSurface : analyticsSurface(tab: tab)
    }

    /// The hub, Import and Export report `library`.
    var visibleLibraryAnalyticsSurface: AnalyticsSurface {
        if self.libraryPath.count > 1 {
            return .deckDetail
        }
        if self.isLibraryPathRoot(.cards) {
            return .cards
        }
        if self.isLibraryPathRoot(.tags) {
            return .tags
        }
        if self.isLibraryPathRoot(.decks) {
            return .decks
        }
        return .library
    }

    /// Whether the Cards list is still on the Library stack.
    var isCardsOnLibraryPath: Bool {
        self.isLibraryPathRoot(.cards)
    }

    /// Whether the Decks list is still on the Library stack.
    var isDecksOnLibraryPath: Bool {
        self.isLibraryPathRoot(.decks)
    }

    /// Whether the Tags list is still on the Library stack.
    var isTagsOnLibraryPath: Bool {
        self.isLibraryPathRoot(.tags)
    }

    /// Every Library screen except a deck detail is reachable only as the first page of the stack,
    /// and `NavigationPath` is opaque on Mac, so this compares the first page.
    private func isLibraryPathRoot(_ destination: LibraryNavigationDestination) -> Bool {
        #if targetEnvironment(macCatalyst)
        guard self.libraryPath.isEmpty == false else {
            return false
        }
        var root = self.libraryPath
        root.removeLast(root.count - 1)
        return root == NavigationPath([destination])
        #else
        return self.libraryPath.first == destination
        #endif
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

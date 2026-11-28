import Foundation
import Observation
import SwiftUI
import UIKit
#if targetEnvironment(macCatalyst)
import Combine
#endif

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

#if targetEnvironment(macCatalyst)
/// A Library page as the Mac sidebar section it sits under and the pages pushed above it.
struct LibraryLocation {
    let section: LibrarySection
    let pages: [LibraryNavigationDestination]
}

func makeLibraryLocation(destination: LibraryNavigationDestination) -> LibraryLocation {
    switch destination {
    case .cards:
        return LibraryLocation(section: .cards, pages: [])
    case .tags:
        return LibraryLocation(section: .tags, pages: [])
    case .tagDetail:
        return LibraryLocation(section: .tags, pages: [destination])
    case .decks:
        return LibraryLocation(section: .decks, pages: [])
    case .deckDetail(let deck):
        return LibraryLocation(section: .decks, pages: [.deckDetail(deck)])
    case .deckCatalog:
        return LibraryLocation(section: .deckCatalog, pages: [])
    case .catalogDeck(let deck):
        return LibraryLocation(section: .deckCatalog, pages: [.catalogDeck(deck)])
    case .importData:
        return LibraryLocation(section: .importData, pages: [])
    case .importFormat:
        return LibraryLocation(section: .importData, pages: [destination])
    case .exportData:
        return LibraryLocation(section: .exportData, pages: [])
    case .exportFormat:
        return LibraryLocation(section: .exportData, pages: [destination])
    }
}
#else
func makeLibraryNavigationPath(destination: LibraryNavigationDestination) -> [LibraryNavigationDestination] {
    switch destination {
    case .cards:
        return [.cards]
    case .tags:
        return [.tags]
    case .tagDetail:
        return [.tags, destination]
    case .decks:
        return [.decks]
    case .deckDetail(let deck):
        return [.decks, .deckDetail(deck)]
    case .deckCatalog:
        return [.deckCatalog]
    case .catalogDeck(let deck):
        return [.deckCatalog, .catalogDeck(deck)]
    case .importData:
        return [.importData]
    case .importFormat:
        return [.importData, destination]
    case .exportData:
        return [.exportData]
    case .exportFormat:
        return [.exportData, destination]
    }
}
#endif

func makeSettingsNavigationPath(destination: SettingsNavigationDestination) -> [SettingsNavigationDestination] {
    switch destination {
    case .subscription:
        return [.subscription]
    case .currentWorkspace:
        return [.currentWorkspace]
    case .chatCustomInstructions:
        return [.currentWorkspace, .chatCustomInstructions]
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
    @ObservationIgnored private var catalogSceneDisconnectObservation: AnyCancellable?
    #endif
    var settingsPath: SettingsNavigationPath
    #if targetEnvironment(macCatalyst)
    /// The Mac sidebar section at the bottom of the Library stack, below `libraryPath`; nil until
    /// Library is first shown.
    private(set) var librarySection: LibrarySection? = nil
    #endif
    var libraryPath: LibraryNavigationPath
    var aiPath: NavigationPath
    /// The side chat pane's own pages on iOS, above its live chat. Every section's pane shows this one path, so a page
    /// stays open across section switches; the Mac pane opens history in the AI tab.
    var aiCompanionPath: [AICompanionPaneRoute]
    var cardsPresentationRequest: CardsPresentationRequest?
    var aiChatPresentationRequest: AIChatPresentationRequest?
    private(set) var aiImportRequest: AIImportPresentationRequest?
    var progressPresentationRequest: ProgressPresentationRequest?
    var isAICompanionPresented: Bool = false
    private(set) var canPresentAICompanion: Bool = false
    /// Open presentations that disable the Review commands; see `View.reviewKeyboardBlockingPresentation`.
    private(set) var reviewKeyboardBlockingPresentationIDs: Set<UUID> = []

    /// The AI tab shows the chat itself; the Mac keeps Settings without the pane.
    var isAICompanionVisible: Bool {
        #if targetEnvironment(macCatalyst)
        self.isAICompanionPaneOpen && self.selectedTab != .ai && self.selectedTab != .settings
            && self.pendingCatalogAIDeckRequest == nil
        #else
        self.isAICompanionPaneOpen && self.selectedTab != .ai
        #endif
    }

    /// Every host keeps its pane mounted while this is true, so a section switch never inserts or removes it.
    var isAICompanionPaneOpen: Bool {
        self.canPresentAICompanion && self.isAICompanionPresented
    }

    var isAIChatVisible: Bool {
        self.selectedTab == .ai || self.isAICompanionVisible
    }

    var isLiveAIChatVisible: Bool {
        if self.selectedTab == .ai {
            return self.aiPath.isEmpty
        }
        return self.isAICompanionVisible && self.aiCompanionPath.isEmpty
    }

    init() {
        self.selectedTab = .review
        self.aiTabVisitID = UUID()
        self.settingsPath = SettingsNavigationPath()
        self.libraryPath = LibraryNavigationPath()
        self.aiPath = NavigationPath()
        self.aiCompanionPath = []
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
        #if targetEnvironment(macCatalyst)
        if let root = libraryPath.first {
            self.librarySection = makeLibraryLocation(destination: root).section
            self.libraryPath = LibraryNavigationPath(libraryPath.dropFirst())
        } else {
            self.librarySection = selectedTab == .library ? .cards : nil
            self.libraryPath = LibraryNavigationPath()
        }
        #else
        self.libraryPath = LibraryNavigationPath(libraryPath)
        #endif
        self.aiPath = NavigationPath()
        self.aiCompanionPath = []
        self.cardsPresentationRequest = cardsPresentationRequest
        self.aiChatPresentationRequest = aiChatPresentationRequest
        self.progressPresentationRequest = progressPresentationRequest
    }

    func selectTab(_ tab: AppTab) {
        #if targetEnvironment(macCatalyst)
        // The Mac has no hub.
        if tab == .library, self.librarySection == nil {
            self.showLibrarySection(.cards)
        }
        #endif
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

    func updateAICompanionAvailability(_ isAvailable: Bool, sceneID: String?) {
        #if targetEnvironment(macCatalyst)
        guard self.allowsCatalogAIPresentation(in: sceneID) else { return }
        self.canPresentAICompanion = isAvailable
        #else
        let movesPendingCatalogRequestToTab = isAvailable == false
            && self.isAICompanionVisible && self.pendingCatalogAIDeckRequest != nil
        self.canPresentAICompanion = isAvailable
        if movesPendingCatalogRequestToTab {
            self.presentLiveAIChat()
        }
        #endif
    }

    func toggleAICompanion() {
        guard self.canPresentAICompanion else {
            self.selectTab(.ai)
            return
        }
        #if targetEnvironment(macCatalyst)
        let closesReviewCompanion = self.selectedTab == .review && self.isAICompanionVisible
        if closesReviewCompanion {
            FlashcardsObservability.addBreadcrumb(.macReviewCompanionClose(.requested))
        } else if self.selectedTab == .review {
            FlashcardsObservability.addBreadcrumb(.macReviewCompanionOpen(.requested))
        }
        #endif
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
        #if targetEnvironment(macCatalyst)
        if closesReviewCompanion {
            FlashcardsObservability.addBreadcrumb(.macReviewCompanionClose(.visibilityUpdated))
        }
        #endif
    }

    func openAICardCreation() {
        self.openAIChatPresentation(.createCard)
    }

    func openAICardHandoff(card: AIChatCardReference) {
        self.openAIChatPresentation(.attachCard(card))
    }

    private func openAIChatPresentation(_ request: AIChatPresentationRequest) {
        guard self.canStartOtherAIRequest() else { return }

        self.cancelAIImport()
        // The transcript must see the handoff before a tab visit can enqueue a scroll.
        self.aiChatPresentationRequest = request
        self.presentLiveAIChat()
    }

    private func canStartOtherAIRequest() -> Bool {
        guard self.pendingCatalogAIDeckRequest == nil else {
            self.presentLiveAIChat()
            return false
        }
        return true
    }

    private func presentLiveAIChat() {
        if self.isAICompanionVisible == false {
            self.selectTab(.ai)
        }
        self.popAIToLiveChat()
    }

    var canOpenCatalogAIDeck: Bool {
        self.aiChatPresentationRequest == nil && self.aiImportRequest == nil
    }

    var pendingCatalogAIDeckRequest: AIChatPresentationRequest? {
        guard case .createCatalogDeck = self.aiChatPresentationRequest else { return nil }
        return self.aiChatPresentationRequest
    }

    #if targetEnvironment(macCatalyst)
    func allowsCatalogAIPresentation(in sceneID: String?) -> Bool {
        guard case .createCatalogDeck(let request) = self.pendingCatalogAIDeckRequest,
              let ownerSceneID = request.sceneID else {
            return true
        }
        return sceneID == ownerSceneID
    }
    #endif

    func openCatalogAIDeck(
        prompt: String,
        resultCount: Int,
        originatingScene: UIWindowScene?,
        accessContext: AICatalogDeckAccessContext
    ) {
        guard self.canOpenCatalogAIDeck else { return }

        let request = AIChatPresentationRequest.createCatalogDeck(AICatalogDeckPresentationRequest(
            id: UUID(),
            prompt: prompt,
            sceneID: originatingScene?.session.persistentIdentifier,
            accessContext: accessContext
        ))
        #if targetEnvironment(macCatalyst)
        if let originatingScene {
            let wasCompanionAvailable = self.canPresentAICompanion
            self.catalogSceneDisconnectObservation = NotificationCenter.default
                .publisher(for: UIScene.didDisconnectNotification, object: originatingScene)
                .sink { [weak self] _ in
                    guard let self, self.pendingCatalogAIDeckRequest == request else { return }
                    self.clearAIChatPresentationRequest(request: request)
                    self.canPresentAICompanion = wasCompanionAvailable
                    if self.selectedTab == .ai {
                        self.selectTab(.library)
                    }
                }
        }
        #endif
        Analytics.track(.catalogAIDeckClicked(resultCount: resultCount), screen: .catalog)
        self.aiChatPresentationRequest = request
        #if !targetEnvironment(macCatalyst)
        if self.canPresentAICompanion {
            self.isAICompanionPresented = true
        }
        #endif
        self.presentLiveAIChat()
    }

    func retireStaleCatalogAIDeckRequest(
        accessContext: AICatalogDeckAccessContext,
        preservedGuestLink: PreservedGuestWorkspaceLink?
    ) {
        guard let request = self.aiChatPresentationRequest,
              case .createCatalogDeck(let catalogRequest) = request,
              catalogRequest.accessContext.matches(current: accessContext, preservedGuestLink: preservedGuestLink) == false else {
            return
        }
        self.clearAIChatPresentationRequest(request: request)
    }

    func openAIImport(request: AIImportPresentationRequest) -> AIImportOpenResult {
        guard self.pendingCatalogAIDeckRequest == nil else { return .catalogRequestPending }
        guard self.aiImportRequest == nil else { return .importRequestPending }

        self.aiChatPresentationRequest = nil
        self.aiImportRequest = request
        self.presentLiveAIChat()
        return .opened
    }

    func takeAIImportRequest() -> AIImportPresentationRequest? {
        guard let request = self.aiImportRequest else {
            return nil
        }
        self.aiImportRequest = nil
        return request
    }

    func cancelAIImport() {
        if let request = self.takeAIImportRequest() {
            aiChatRemoveAttachmentFiles(attachments: request.attachments)
        }
    }

    /// Returns both the AI tab and the side chat pane to the one live chat.
    func popAIToLiveChat() {
        if self.aiPath.isEmpty == false {
            self.aiPath = NavigationPath()
        }
        if self.aiCompanionPath.isEmpty == false {
            self.aiCompanionPath = []
        }
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
        #if targetEnvironment(macCatalyst)
        let location = makeLibraryLocation(destination: destination)
        self.librarySection = location.section
        self.libraryPath = LibraryNavigationPath(location.pages)
        #else
        self.libraryPath = LibraryNavigationPath(makeLibraryNavigationPath(destination: destination))
        #endif
        self.selectTab(.library)
    }

    #if targetEnvironment(macCatalyst)
    /// A sidebar row: puts the section at the bottom of the Library stack. Reselecting the shown
    /// section keeps its pages.
    func showLibrarySection(_ section: LibrarySection) {
        guard self.librarySection != section else {
            return
        }
        self.libraryPath = LibraryNavigationPath()
        self.librarySection = section
        // A tab switch reports its destination itself; a section switch inside Library does not.
        if self.selectedTab == .library {
            Analytics.trackScreenViewed(self.visibleLibraryAnalyticsSurface)
        }
    }
    #endif

    /// The surface a tab shows: Library names the page on top of its stack.
    func visibleAnalyticsSurface(tab: AppTab) -> AnalyticsSurface {
        tab == .library ? self.visibleLibraryAnalyticsSurface : analyticsSurface(tab: tab)
    }

    /// The catalog list and its deck pages report `catalog`; the hub, Import and Export report
    /// `library`.
    var visibleLibraryAnalyticsSurface: AnalyticsSurface {
        if self.isLibraryPathRoot(.deckCatalog) {
            return .catalog
        }
        if self.isLibraryPathRoot(.cards) {
            return .cards
        }
        if self.isLibraryPathRoot(.tags) {
            return .tags
        }
        if self.isLibraryPathRoot(.decks) {
            #if targetEnvironment(macCatalyst)
            return self.libraryPath.isEmpty ? .decks : .deckDetail
            #else
            return self.libraryPath.count == 1 ? .decks : .deckDetail
            #endif
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

    private func isLibraryPathRoot(_ destination: LibraryNavigationDestination) -> Bool {
        #if targetEnvironment(macCatalyst)
        return self.librarySection?.destination == destination
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

        #if targetEnvironment(macCatalyst)
        self.catalogSceneDisconnectObservation = nil
        #endif
        self.aiChatPresentationRequest = nil
    }

    func clearProgressPresentationRequest(id: UUID) {
        guard self.progressPresentationRequest?.id == id else {
            return
        }

        self.progressPresentationRequest = nil
    }
}

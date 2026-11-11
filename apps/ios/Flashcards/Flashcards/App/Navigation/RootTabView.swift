import Foundation
import StoreKit
import SwiftUI
import UIKit

private struct StoreReviewRequestTaskID: Hashable {
    let isSceneActive: Bool
    let isPresentationBlocked: Bool
    let requestAttemptId: String?
}

private struct ReviewDueBadgeTaskID: Hashable {
    let workspaceId: String?
    let reviewFilter: ReviewFilter
    let localReadVersion: Int
    let isSceneActive: Bool
}

#if targetEnvironment(macCatalyst)
/// A Mac sidebar row: a top-level destination, or a Library section listed under Library.
private enum MacSidebarSelection: Hashable {
    case tab(AppTab)
    case librarySection(LibrarySection)
}

private func librarySidebarItemIdentifier(_ section: LibrarySection) -> String {
    switch section {
    case .cards: UITestIdentifier.rootTabLibraryCardsItem
    case .tags: UITestIdentifier.rootTabLibraryTagsItem
    case .decks: UITestIdentifier.rootTabLibraryDecksItem
    case .deckCatalog: UITestIdentifier.rootTabLibraryDeckCatalogItem
    case .importData: UITestIdentifier.rootTabLibraryImportItem
    case .exportData: UITestIdentifier.rootTabLibraryExportItem
    }
}
#endif

#if !targetEnvironment(macCatalyst)
private struct WidgetSnapshotTaskID: Hashable {
    let workspaceId: String?
    let reviewFilter: ReviewFilter
    let dueCount: Int
    let presentedReviewCardId: String?
    let progressBadgeState: ReviewProgressBadgeState
    let progressSnapshot: ProgressSnapshot?
    let reviewScheduleSnapshot: ReviewScheduleSnapshot?
    let accentColor: AccountAccentColor
    let scenePhase: ScenePhase
}
#endif

struct RootTabView: View {
    @Environment(\.requestReview) private var requestReview
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.scenePhase) private var scenePhase
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    @Environment(AppleSubscriptionService.self) private var appleSubscriptions: AppleSubscriptionService
    @State private var premiumPresenter: PremiumPresenter = PremiumPresenter()
    @State private var isGuestSignInCloudSignInPresented: Bool = false
    @State private var isKeyboardDocked: Bool = false
    #if targetEnvironment(macCatalyst)
    @State private var macSidebarVisibility: NavigationSplitViewVisibility = .all
    @Environment(\.macSidebarCommandTarget) private var macSidebarCommandTarget
    @Environment(\.sidebarRowSize) private var sidebarRowSize
    #endif

    private var isGuestSignInAfterReviewPromptBlockedByModal: Bool {
        self.isGuestSignInCloudSignInPresented
            || self.premiumPresenter.request != nil
            || store.feedbackPresentation != nil
            || store.activeCloudSignInSheetCount > 0
            || store.accountDeletionState != .hidden
            || store.accountDeletionSuccessMessage != nil
            || store.reviewSubmissionFailure != nil
            || store.isReviewNotificationPrePromptPresented
            || store.isReviewHardReminderPresented
    }

    private var isStoreReviewRequestBlockedByPresentation: Bool {
        self.isGuestSignInAfterReviewPromptBlockedByModal
            || store.isGuestSignInAfterReviewPromptPresented
    }

    private var storeReviewRequestTaskID: StoreReviewRequestTaskID {
        StoreReviewRequestTaskID(
            isSceneActive: self.scenePhase == .active,
            isPresentationBlocked: self.isStoreReviewRequestBlockedByPresentation,
            requestAttemptId: store.pendingStoreReviewRequestAttempt?.id
        )
    }

    private var settingsAttentionSummary: SettingsAttentionSummary {
        makeSettingsAttentionSummary(
            issues: makeSettingsAttentionIssues(cloudState: store.cloudSettings?.cloudState)
        )
    }

    private var reviewDueBadgeTaskID: ReviewDueBadgeTaskID {
        ReviewDueBadgeTaskID(
            workspaceId: store.workspace?.workspaceId,
            reviewFilter: store.selectedReviewFilter,
            localReadVersion: store.localReadVersion,
            isSceneActive: self.scenePhase == .active
        )
    }

    #if !targetEnvironment(macCatalyst)
    private var widgetSnapshotTaskID: WidgetSnapshotTaskID {
        WidgetSnapshotTaskID(
            workspaceId: store.workspace?.workspaceId,
            reviewFilter: store.selectedReviewFilter,
            dueCount: store.reviewDueBadgeCount,
            presentedReviewCardId: store.presentedReviewCard?.cardId,
            progressBadgeState: store.reviewProgressBadgeState,
            progressSnapshot: store.widgetProgressSnapshot,
            reviewScheduleSnapshot: store.reviewScheduleSnapshot,
            accentColor: store.effectiveAccountAccentColor,
            scenePhase: self.scenePhase
        )
    }
    #endif

    private var reviewDueBadgeLabel: Text? {
        makeReviewDueBadgeLabel(dueCount: store.reviewDueBadgeCount).map { label in
            Text(label)
        }
    }

    private var guestSignInAfterReviewPromptPresentation: Binding<Bool> {
        Binding<Bool>(
            get: {
                store.isGuestSignInAfterReviewPromptPresented
            },
            set: { isPresented in
                if isPresented == false {
                    store.dismissGuestSignInAfterReviewPrompt()
                }
            }
        )
    }

    private var accountDeletionSuccessPresentation: Binding<Bool> {
        Binding<Bool>(
            get: {
                store.accountDeletionSuccessMessage != nil
            },
            set: { isPresented in
                if isPresented == false {
                    store.dismissAccountDeletionSuccessMessage()
                }
            }
        )
    }

    private var canShowPremiumPresentation: Bool {
        store.feedbackPresentation == nil
            && store.presentedTechnicalError == nil
            && store.activeCloudSignInSheetCount == 0
            && self.isGuestSignInCloudSignInPresented == false
            && store.isGuestSignInAfterReviewPromptPresented == false
    }

    private var premiumPresentation: Binding<PremiumPresentationRequest?> {
        Binding(
            get: {
                self.canShowPremiumPresentation ? self.premiumPresenter.request : nil
            },
            set: { presentation in
                if presentation == nil, self.canShowPremiumPresentation {
                    self.premiumPresenter.finish(outcome: .dismissed)
                }
            }
        )
    }

    private func clearPremiumPresentationForIdentityChange() {
        self.premiumPresenter.finish(outcome: .identityChanged)
        self.appleSubscriptions.runtimeErrorMessage = nil
        self.store.aiChatStore.quotaRefusal = nil
    }

    private var feedbackPresentation: Binding<FeedbackPresentation?> {
        Binding<FeedbackPresentation?>(
            get: {
                store.feedbackPresentation
            },
            set: { presentation in
                if presentation == nil {
                    store.dismissFeedbackSheet()
                } else {
                    store.feedbackPresentation = presentation
                }
            }
        )
    }

    private var accountDeletedTitle: String {
        String(
            localized: "root_tab.account_deleted.title",
            table: "Foundation",
            comment: "Account deletion success alert title"
        )
    }

    private var confirmationButtonTitle: String {
        String(
            localized: "shared.ok",
            table: "Foundation",
            comment: "Confirmation button title"
        )
    }

    @MainActor
    private func requestStoreReviewIfNeeded() async {
        guard let requestAttempt = store.pendingStoreReviewRequestAttempt else { return }
        guard AutomationRun.current.isAutomation == false,
              self.scenePhase == .active, self.isStoreReviewRequestBlockedByPresentation == false,
              self.store.isSavedReviewPromptSurfaceAvailable else {
            store.consumeStoreReviewRequestAttempt(attemptId: requestAttempt.id)
            return
        }
        guard store.recordStoreReviewRequestAttempt(requestAttempt: requestAttempt, now: Date()) else {
            return
        }

        self.requestReview()
        store.consumeStoreReviewRequestAttempt(attemptId: requestAttempt.id)
    }

    @MainActor
    private func prepareTabForPresentationIfNeeded(nextTab: AppTab) {
        guard self.store.currentVisibleTab != nextTab else {
            return
        }

        let previousTab = self.store.currentVisibleTab
        prepareVisibleTabForPresentationWithBreadcrumb(
            store: self.store,
            selectedTab: nextTab,
            librarySurface: self.navigation.visibleLibraryAnalyticsSurface,
            previousTab: previousTab,
            scenePhase: self.scenePhase,
            isStartupReady: nil,
            isRecoveryGateActive: self.store.cloudCredentialRecoveryState != nil,
            now: Date()
        )
    }

    @MainActor
    private func refreshSelectedTabIfNeeded(nextTab: AppTab) async {
        guard self.store.isCloudSyncBlocked == false else {
            return
        }

        switch nextTab {
        case .review:
            await self.store.refreshReviewBadgesIfNeeded()
        case .progress:
            await self.store.refreshProgressIfNeeded()
        case .ai, .library, .settings:
            return
        }
    }

    private var subscriptionIdentity: AppleSubscriptionIdentity? {
        try? self.store.appleSubscriptionIdentity()
    }

    var body: some View {
        Group {
            if let recoveryState = store.cloudCredentialRecoveryState ?? store.cloudSignInAttempt.credentialRecoveryPresentation {
                CloudCredentialRecoveryGateView(recoveryState: recoveryState)
                    .environment(store)
                    .overlay {
                        self.uiTestLaunchPreparationStatusMarker
                    }
            } else {
                self.tabRoot
            }
        }
        #if targetEnvironment(macCatalyst)
        .backgroundPreferenceValue(MacToolbarPreferenceKey.self) { preferences in
            MacWindowAppearance(
                configuration: self.macToolbarConfiguration(preferences),
                sidebarCommandTarget: self.macSidebarCommandTarget,
                onSidebarVisibilityChange: { isVisible in
                    withAnimation(self.reduceMotion ? nil : .default) {
                        self.macSidebarVisibility = isVisible ? .all : .detailOnly
                    }
                }
            )
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .onChange(of: self.macSidebarVisibility, initial: true) { _, visibility in
            self.macSidebarCommandTarget?.isSidebarVisible = visibility != .detailOnly
        }
        #endif
        .onChange(of: self.subscriptionIdentity) { _, _ in
            self.clearPremiumPresentationForIdentityChange()
        }
        .onChange(of: self.appleSubscriptions.confirmationRevision) { _, _ in
            self.premiumPresenter.confirmAppleAccess(entitlement: self.store.cloudEntitlement, identity: self.subscriptionIdentity)
        }
        .onChange(of: store.cloudEntitlement) { _, entitlement in
            self.premiumPresenter.reconcileAccess(entitlement: entitlement, identity: self.subscriptionIdentity)
            self.store.applyEffectiveAppIcon()
        }
    }

    @ViewBuilder
    private var uiTestLaunchPreparationStatusMarker: some View {
        if AutomationRun.current.isUITestLaunch {
            let preparationValue = store.uiTestLaunchPreparationStatus.accessibilityValue ?? "state=notRequested;launchScenario=none"
            let automationValue = "event=automation_run_decided;isAutomation=\(AutomationRun.current.isAutomation)"
            Text("ui-test-launch-preparation-status")
                .font(.system(size: 1))
                .foregroundStyle(.clear)
                .allowsHitTesting(false)
                .accessibilityElement(children: .ignore)
                .accessibilityIdentifier(UITestIdentifier.uiTestLaunchPreparationStatus)
                .accessibilityLabel("UI test launch preparation status")
                .accessibilityValue("\(preparationValue);\(automationValue)")
        }
    }

    private var tabRoot: some View {
        self.tabRootAlerts
            .environment(self.premiumPresenter)
    }

    private var selectedTabBinding: Binding<AppTab> {
        Binding<AppTab>(
            get: {
                self.navigation.selectedTab
            },
            set: { nextTab in
                let previousTab = self.navigation.selectedTab
                prepareVisibleTabForPresentationWithBreadcrumb(
                    store: self.store,
                    selectedTab: nextTab,
                    librarySurface: self.navigation.visibleLibraryAnalyticsSurface,
                    previousTab: previousTab,
                    scenePhase: self.scenePhase,
                    isStartupReady: nil,
                    isRecoveryGateActive: self.store.cloudCredentialRecoveryState != nil,
                    now: Date()
                )
                self.navigation.selectTab(nextTab)
            }
        )
    }

    #if !targetEnvironment(macCatalyst)
    private var tabRootBase: some View {
        @Bindable var navigation = self.navigation
        return TabView(selection: self.selectedTabBinding) {
            Tab(value: AppTab.review) {
                self.reviewTab
                    .background {
                        if UIDevice.current.userInterfaceIdiom == .phone {
                            RootTabAccessibilityMetadataAdapter()
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                    }
            } label: {
                self.tabLabel(.review, identifier: UITestIdentifier.rootTabReviewItem)
            }
            .accessibilityIdentifier(UITestIdentifier.rootTabReviewItem, isEnabled: true)
            .badge(self.reviewDueBadgeLabel)

            Tab(value: AppTab.progress) {
                self.progressTab
                    .background {
                        if UIDevice.current.userInterfaceIdiom == .phone {
                            RootTabAccessibilityMetadataAdapter()
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                    }
            } label: {
                self.tabLabel(.progress, identifier: UITestIdentifier.rootTabProgressItem)
            }
            .accessibilityIdentifier(UITestIdentifier.rootTabProgressItem, isEnabled: true)

            Tab(value: AppTab.ai) {
                self.aiTab(aiPath: $navigation.aiPath)
                    .background {
                        if UIDevice.current.userInterfaceIdiom == .phone {
                            RootTabAccessibilityMetadataAdapter()
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                    }
            } label: {
                self.tabLabel(.ai, identifier: UITestIdentifier.rootTabAIItem)
            }
            .accessibilityIdentifier(UITestIdentifier.rootTabAIItem, isEnabled: true)

            Tab(value: AppTab.library) {
                self.libraryTab(libraryPath: $navigation.libraryPath)
                    .background {
                        if UIDevice.current.userInterfaceIdiom == .phone {
                            RootTabAccessibilityMetadataAdapter()
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                    }
            } label: {
                self.tabLabel(.library, identifier: UITestIdentifier.rootTabLibraryItem)
            }
            .accessibilityIdentifier(UITestIdentifier.rootTabLibraryItem, isEnabled: true)

            Tab(value: AppTab.settings) {
                self.settingsTab(settingsPath: $navigation.settingsPath)
                    .background {
                        if UIDevice.current.userInterfaceIdiom == .phone {
                            RootTabAccessibilityMetadataAdapter()
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                    }
            } label: {
                self.tabLabel(.settings, identifier: UITestIdentifier.rootTabSettingsItem)
            }
            .accessibilityIdentifier(UITestIdentifier.rootTabSettingsItem, isEnabled: true)
            .badge(self.settingsAttentionSummary.settingsTabCount)
        }
    }
    #endif

    @ViewBuilder
    private var tabRootPresentation: some View {
        #if targetEnvironment(macCatalyst)
        NavigationSplitView(columnVisibility: self.$macSidebarVisibility) {
            self.macSidebar
        } detail: {
            self.macDetail(for: self.navigation.selectedTab)
                .modifier(MacDetailToolbarBackdrop(context: MacToolbarBackdropContext(
                    selectedTab: self.navigation.selectedTab,
                    companionVisible: self.navigation.isAICompanionVisible && self.navigation.canPresentAICompanion,
                    aiDepth: self.navigation.aiPath.count,
                    librarySection: self.navigation.librarySection,
                    libraryDepth: self.navigation.libraryPath.count,
                    settingsDepth: self.navigation.settingsPath.count
                )))
                .background {
                    AICompanionAvailabilityObserver { isAvailable in
                        self.navigation.updateAICompanionAvailability(isAvailable)
                    }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
        }
        .ignoresSafeArea(.container, edges: .top)
        #else
        if #available(iOS 26.0, *) {
            self.tabRootBase
                .tabViewStyle(.sidebarAdaptable)
                .tabBarMinimizeBehavior(.never)
        } else {
            self.tabRootBase
                .tabViewStyle(.sidebarAdaptable)
        }
        #endif
    }

    #if targetEnvironment(macCatalyst)
    /// The detail shows only the selected section; what must survive a switch lives in
    /// the navigation model and the app-owned screen models.
    @ViewBuilder
    private func macDetail(for tab: AppTab) -> some View {
        switch tab {
        case .review:
            self.reviewTab
        case .progress:
            self.progressTab
        case .ai:
            self.aiTab(aiPath: self.macSectionPath(\.aiPath, section: .ai))
        case .library:
            self.libraryTab(libraryPath: self.macLibraryPath(section: self.navigation.librarySection))
        case .settings:
            self.settingsTab(settingsPath: self.macSectionPath(\.settingsPath, section: .settings))
        }
    }

    /// SwiftUI writes an empty path back while it tears down a section's stack, after the
    /// selection has moved on; accept writes only from the shown section to keep its pages.
    private func macSectionPath<Path>(
        _ path: ReferenceWritableKeyPath<AppNavigationModel, Path>,
        section: AppTab
    ) -> Binding<Path> {
        Binding(
            get: { self.navigation[keyPath: path] },
            set: { nextPath in
                guard self.navigation.selectedTab == section else { return }
                self.navigation[keyPath: path] = nextPath
            }
        )
    }

    /// Like `macSectionPath`, and also drops the empty path a replaced section's stack writes back
    /// while SwiftUI tears it down.
    private func macLibraryPath(section: LibrarySection?) -> Binding<LibraryNavigationPath> {
        Binding(
            get: { self.navigation.libraryPath },
            set: { nextPath in
                guard self.navigation.selectedTab == .library, self.navigation.librarySection == section else { return }
                self.navigation.libraryPath = nextPath
            }
        )
    }

    private var macSidebar: some View {
        List(selection: Binding<MacSidebarSelection?>(
            get: {
                if self.navigation.selectedTab == .library, let section = self.navigation.librarySection {
                    return .librarySection(section)
                }
                return .tab(self.navigation.selectedTab)
            },
            set: { selection in
                switch selection {
                case .tab(let tab):
                    self.selectedTabBinding.wrappedValue = tab
                case .librarySection(let section):
                    // Before the tab switch, so it reports the section's page.
                    self.navigation.showLibrarySection(section)
                    self.selectedTabBinding.wrappedValue = .library
                case nil:
                    break
                }
            }
        )) {
            self.macSidebarRow(.review, identifier: UITestIdentifier.rootTabReviewItem, shortcutKey: MacNavigationShortcut.review.key)
                .badge(self.reviewDueBadgeLabel)
                .tag(MacSidebarSelection.tab(.review))
            self.macSidebarRow(.progress, identifier: UITestIdentifier.rootTabProgressItem, shortcutKey: MacNavigationShortcut.progress.key)
            self.macSidebarRow(.ai, identifier: UITestIdentifier.rootTabAIItem, shortcutKey: MacNavigationShortcut.ai.key)
            Section(AppTab.library.localizedTitle) {
                ForEach(LibrarySection.allCases, id: \.self) { section in
                    let row = Label(section.localizedTitle, systemImage: section.systemImage)
                        .accessibilityIdentifier(librarySidebarItemIdentifier(section))
                        .macSidebarIconColumn(MacSidebarRowMetrics(size: self.sidebarRowSize))
                    Group {
                        if section == .cards {
                            row.macSidebarShortcutHelp(title: section.localizedTitle, key: MacNavigationShortcut.cards.key)
                        } else {
                            row
                        }
                    }
                    .tag(MacSidebarSelection.librarySection(section))
                }
            }
            Section(String(localized: "mac.sidebar.app_section.title", table: "Foundation")) {
                self.macSidebarRow(.settings, identifier: UITestIdentifier.rootTabSettingsItem, shortcutKey: macAppSettingsShortcutKey)
                    .badge(self.settingsAttentionSummary.settingsTabCount)
                    .tag(MacSidebarSelection.tab(.settings))
            }
        }
        .listStyle(.sidebar)
        .environment(\.defaultMinListRowHeight, MacSidebarRowMetrics(size: self.sidebarRowSize).rowHeight)
        .scrollContentBackground(.hidden)
        .navigationSplitViewColumnWidth(min: 220, ideal: 280, max: 400)
        .toolbar(.hidden, for: .navigationBar)
    }

    private func macSidebarRow(_ tab: AppTab, identifier: String, shortcutKey: KeyEquivalent) -> some View {
        Label(tab.localizedTitle, systemImage: tab.systemImage)
            .macSidebarIconColumn(MacSidebarRowMetrics(size: self.sidebarRowSize))
            .macSidebarShortcutHelp(title: tab.localizedTitle, key: shortcutKey)
            .tag(MacSidebarSelection.tab(tab))
            .accessibilityIdentifier(identifier)
    }
    #endif

    private func tabLabel(_ tab: AppTab, identifier: String) -> some View {
        Label(tab.localizedTitle, systemImage: tab.systemImage)
            .accessibilityIdentifier(identifier)
    }

    private func aiCompanionPane(hostTab: AppTab) -> some View {
        AIChatView(chatStore: store.aiChatStore, isCompanion: true, companionHostTab: hostTab)
            .ignoresSafeArea(UIDevice.current.userInterfaceIdiom == .pad || self.isKeyboardDocked || self.navigation.canPresentAICompanion == false ? [] : .keyboard, edges: .bottom)
            .background(Color(uiColor: .systemBackground))
            .presentationBackground(Color(uiColor: .systemBackground))
    }

    // Paired Progress shares one native bar in both tab placements; Review does under a top tab bar.
    // Their screen-owned drafts and presentations survive sidebar transitions.
    @ViewBuilder
    private func aiCompanionHost<Content: View>(for hostTab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        #if targetEnvironment(macCatalyst)
        NavigationStack {
            self.aiCompanionColumns(for: hostTab, content: content)
                .toolbar(.hidden, for: .navigationBar)
        }
        #else
        if UIDevice.current.userInterfaceIdiom == .pad {
            NavigationStack {
                self.aiCompanionColumns(for: hostTab, content: content)
                    .toolbarBackground(.bar, for: .navigationBar)
                    .toolbarBackground(self.navigation.isAICompanionVisible && self.navigation.selectedTab == hostTab ? .visible : .automatic, for: .navigationBar)
            }
        } else {
            NavigationStack {
                self.aiCompanionColumns(for: hostTab, content: content)
            }
        }
        #endif
    }

    #if targetEnvironment(macCatalyst)
    private func macToolbarConfiguration(_ preferences: MacToolbarPreferences) -> MacWindowToolbarConfiguration {
        let tab = self.navigation.selectedTab
        if let recovery = self.store.cloudCredentialRecoveryState ?? self.store.cloudSignInAttempt.credentialRecoveryPresentation {
            return MacWindowToolbarConfiguration(
                tab: tab, title: makeCloudCredentialRecoveryGatePresentation(reason: recovery.reason).title,
                leading: [], trailing: []
            )
        }
        let header = preferences.headers.last { $0.tab == tab }
        let isNested = (tab == .ai && self.navigation.aiPath.isEmpty == false)
            || (tab == .library && self.navigation.libraryPath.isEmpty == false)
            || (tab == .settings && self.navigation.settingsPath.isEmpty == false)
        // Library pages contribute as pushed pages, also with their section at the bottom of the stack.
        let isLibraryPage = tab == .library && self.navigation.librarySection != nil
        let role: MacToolbarContribution.Role = isNested || isLibraryPage ? .navigation : .screen
        let screen = preferences.contributions.last { $0.tab == tab && $0.role == role }
        var leading: [MacToolbarGroup] = []
        if isNested {
            leading.append(MacToolbarGroup(identifier: "nibomo.navigation", actions: [MacToolbarAction(
                identifier: "mac.navigation.back", symbol: "chevron.backward",
                label: aiSettingsLocalized("common.back", "Back"),
                perform: { _ in
                    if let header, header.isPresented {
                        header.dismiss()
                    } else if tab == .ai, self.navigation.aiPath.isEmpty == false {
                        self.navigation.aiPath.removeLast()
                    } else if tab == .library, self.navigation.libraryPath.isEmpty == false {
                        self.navigation.libraryPath.removeLast()
                    } else if tab == .settings, self.navigation.settingsPath.isEmpty == false {
                        self.navigation.settingsPath.removeLast()
                    }
                }
            )]))
        }
        if self.navigation.canPresentAICompanion && tab != .ai && tab != .settings {
            let companion = preferences.contributions.last { $0.tab == tab && $0.role == .companion }
            let toggle = MacToolbarAction(
                identifier: UITestIdentifier.aiCompanionToggle,
                symbol: "bubble.left.and.bubble.right",
                label: String(localized: self.navigation.isAICompanionVisible ? "ai_companion.hide" : "ai_companion.show", table: "Foundation"),
                isSelected: self.navigation.isAICompanionVisible,
                perform: { _ in
                    withAnimation(self.reduceMotion ? nil : .smooth(duration: 0.35)) {
                        self.navigation.toggleAICompanion()
                    }
                }
            )
            leading.append(MacToolbarGroup(identifier: "nibomo.companion", actions: [toggle] + (companion?.companionActions ?? [])))
        }
        leading += screen?.leading ?? []
        let title = header.flatMap { $0.title.isEmpty ? nil : $0.title } ?? tab.localizedTitle
        return MacWindowToolbarConfiguration(
            tab: tab, title: isNested ? title : "",
            leading: leading, trailing: screen?.trailing ?? [], search: screen?.search
        )
    }
    #endif

    // Native edge bars keep their outer bounds. Regular-width content reserves chat space.
    @ViewBuilder
    private func aiCompanionColumns<Content: View>(for hostTab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        let hostContent = content()
        let isRequested = self.navigation.isAICompanionVisible
            && self.navigation.selectedTab == hostTab
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        // Duo chat stays on the physical left; iPad retains logical leading.
        let isLeading = isPad || self.layoutDirection == .leftToRight
        GeometryReader { geometry in
            #if targetEnvironment(macCatalyst)
            // Apply the current layout proposal immediately during a resize,
            // before the observer publishes the updated toolbar availability.
            let isVisible = isRequested && fitsMacAICompanionColumns(geometry.size)
            #else
            let isVisible = isRequested
            #endif
            let leftInset = self.layoutDirection == .leftToRight ? geometry.safeAreaInsets.leading : geometry.safeAreaInsets.trailing
            let rightInset = self.layoutDirection == .leftToRight ? geometry.safeAreaInsets.trailing : geometry.safeAreaInsets.leading
            // The content excludes native edge bars. Include their asymmetric
            // insets when locating the full window's midpoint on inner landscape.
            #if targetEnvironment(macCatalyst)
            // Keep study content dominant instead of stretching chat over half a desktop.
            let width = min(480, max(360, geometry.size.width * 0.38))
            #else
            let width = isPad
                ? geometry.size.width / 2
                : max(0, min(geometry.size.width, (geometry.size.width + rightInset - leftInset) / 2))
            #endif
            HStack(spacing: 0) {
                Color.clear
                    .frame(width: isVisible && isLeading ? width : 0)
                    .accessibilityHidden(true)
                hostContent
                    #if targetEnvironment(macCatalyst)
                    // The geometry is known. Avoid asking rich Review text to size itself for speculative column widths.
                    .frame(width: max(0, geometry.size.width - (isVisible ? width : 0)))
                    .frame(maxHeight: .infinity)
                    #else
                    .frame(width: isPad ? geometry.size.width - (isVisible ? width : 0) : nil)
                    #endif
                Color.clear
                    .frame(width: isVisible && !isLeading ? width : 0)
                    .accessibilityHidden(true)
            }
            .overlay(alignment: isLeading ? .leading : .trailing) {
                if isVisible {
                    self.aiCompanionPane(hostTab: hostTab)
                        .frame(width: width)
                        .overlay(alignment: isLeading ? .trailing : .leading) {
                            if isPad == false {
                                HStack(spacing: 0) { Divider() }.frame(width: 1)
                            }
                        }
                        .transition(.move(edge: isLeading ? .leading : .trailing).combined(with: .opacity))
                }
            }
            .animation(self.reduceMotion ? nil : .smooth(duration: 0.35), value: isRequested)

        }
        // The paired columns share one keyboard boundary and one layout proposal.
        .ignoresSafeArea(isPad && self.isKeyboardDocked == false ? .keyboard : [], edges: .all)
    }

    private var tabRootTasks: some View {
        self.tabRootPresentation
        .ignoresSafeArea(UIDevice.current.userInterfaceIdiom == .pad || self.isKeyboardDocked || self.navigation.canPresentAICompanion == false ? [] : .keyboard, edges: .bottom)
        .environment(\.isKeyboardDocked, self.isKeyboardDocked)
        #if !targetEnvironment(macCatalyst)
        .background {
            AICompanionAvailabilityObserver { isAvailable in
                self.navigation.updateAICompanionAvailability(isAvailable)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        #endif
        .background {
            DockedKeyboardObserver(isDocked: self.$isKeyboardDocked)
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .onChange(of: self.navigation.isAIChatVisible) { _, isVisible in
            // Both AI presentations share one chat session and composer draft.
            self.store.aiChatStore.updateSurface(activity: AIChatSurfaceActivity(
                isSceneActive: self.scenePhase == .active,
                isAITabSelected: isVisible,
                hasExternalProviderConsent: self.store.aiChatStore.hasExternalProviderConsent,
                workspaceId: self.store.workspace?.workspaceId,
                cloudState: self.store.cloudSettings?.cloudState,
                linkedUserId: self.store.cloudSettings?.linkedUserId,
                activeWorkspaceId: self.store.cloudSettings?.activeWorkspaceId
            ))
        }
        .task {
            self.store.retryAIConsentSync()
            let previousTab = store.currentVisibleTab
            prepareVisibleTabForPresentationWithBreadcrumb(
                store: self.store,
                selectedTab: self.navigation.selectedTab,
                librarySurface: self.navigation.visibleLibraryAnalyticsSurface,
                previousTab: previousTab,
                scenePhase: self.scenePhase,
                isStartupReady: nil,
                isRecoveryGateActive: self.store.cloudCredentialRecoveryState != nil,
                now: Date()
            )
        }
        .task(id: self.subscriptionIdentity) {
            self.store.syncPaywallStateIfNeeded()
        }
        .task(id: self.storeReviewRequestTaskID) {
            await self.requestStoreReviewIfNeeded()
        }
        .task(id: self.reviewDueBadgeTaskID) {
            await self.store.runReviewDueBadgeUpdates()
        }
        #if !targetEnvironment(macCatalyst)
        .task(id: self.widgetSnapshotTaskID) {
            // Leaving the foreground writes at once; while active the widget is hidden, so it trails
            // the last rating like other non-visible screens instead of re-reading after every rating.
            if self.scenePhase == .active {
                do {
                    try await Task.sleep(for: progressDeferredRefreshDelay)
                } catch {
                    return
                }
            }
            await self.store.refreshWidgetSnapshot()
        }
        .task(id: self.scenePhase) {
            // Runs on cold and warm foregrounds alike; widgets are added and removed outside the app.
            guard self.scenePhase == .active else {
                return
            }
            await self.store.reportWidgetPlacementIfChanged()
        }
        #endif
        .overlay {
            ZStack {
                GlobalTransientBannerHost()

                if store.accountDeletionState != .hidden {
                    AccountDeletionProgressView()
                        .environment(store)
                }

                self.uiTestLaunchPreparationStatusMarker
            }
        }
    }

    private var tabRootChangeHandlers: some View {
        self.tabRootTasks
        .onChange(of: self.navigation.selectedTab) { _, nextTab in
            self.prepareTabForPresentationIfNeeded(nextTab: nextTab)
            Task { @MainActor in
                await self.refreshSelectedTabIfNeeded(nextTab: nextTab)
            }

            guard usesFastCloudSyncPolling(tab: nextTab) else {
                return
            }

            let triggerSource: CloudSyncTriggerSource = nextTab == .review ? .reviewTabSelected : .libraryTabSelected
            store.triggerCloudSyncIfLinked(
                trigger: CloudSyncTrigger(
                    source: triggerSource,
                    now: Date(),
                    extendsFastPolling: true,
                    allowsVisibleChangeBanner: true,
                    surfacesGlobalErrorMessage: false,
                    capturesTechnicalFailures: false
                )
            )
        }
        .onChange(of: store.cloudSettings?.cloudState) { _, _ in
            self.store.retryAIConsentSync()
        }
        .onChange(of: store.lastSuccessfulCloudSyncAt) { _, _ in
            self.store.syncPaywallStateIfNeeded()
        }
        .onChange(of: self.premiumPresenter.request) { _, request in
            self.store.isPremiumPresentationActive = request != nil
        }
        .onChange(of: self.scenePhase) { _, nextPhase in
            if nextPhase == .active {
                self.store.retryAIConsentSync()
                self.store.syncPaywallStateIfNeeded()
            }
        }
    }

    private var tabRootSheets: some View {
        self.tabRootChangeHandlers
        .cloudSignInSheet(
            isPresented: self.$isGuestSignInCloudSignInPresented,
            presentationContext: .standard(originSurface: .review)
        )
        .sheet(item: self.premiumPresentation) { request in
            self.premiumOffer(request: request)
        }
        .sheet(item: self.feedbackPresentation) { presentation in
            FeedbackSheet(presentation: presentation)
                .environment(store)
        }
    }

    private func premiumOffer(request: PremiumPresentationRequest) -> some View {
        self.recordPremiumPresentation(
            request: request, phase: .preparing, isSubscriptionServiceExplicitlyInjected: false
        )
        let content = PremiumOfferView(request: request)
            .environment(self.store)
            .environment(self.premiumPresenter)
            .environment(self.appleSubscriptions)
        self.recordPremiumPresentation(
            request: request, phase: .contentPrepared, isSubscriptionServiceExplicitlyInjected: true
        )
        return content
            .onAppear {
                self.recordPremiumPresentation(
                    request: request, phase: .appeared, isSubscriptionServiceExplicitlyInjected: true
                )
            }
            .onDisappear {
                self.recordPremiumPresentation(
                    request: request, phase: .disappeared, isSubscriptionServiceExplicitlyInjected: true
                )
            }
    }

    private func recordPremiumPresentation(
        request: PremiumPresentationRequest,
        phase: PremiumPresentationPhase,
        isSubscriptionServiceExplicitlyInjected: Bool
    ) {
        FlashcardsObservability.addBreadcrumb(.premiumPresentation(PremiumPresentationObservation(
            phase: phase,
            requestId: request.id,
            reason: request.reason,
            entryPoint: request.analyticsEntryPoint,
            selectedTab: analyticsSurface(tab: self.navigation.selectedTab).rawValue,
            scenePhase: String(describing: self.scenePhase),
            isSubscriptionServiceExplicitlyInjected: isSubscriptionServiceExplicitlyInjected
        )))
    }

    private var tabRootAlerts: some View {
        self.tabRootSheets
        .guestSignInAfterReviewPromptAlert(
            isPresented: self.guestSignInAfterReviewPromptPresentation,
            onLater: {
                store.snoozeGuestSignInAfterReviewPrompt()
            },
            onSignIn: {
                store.acceptGuestSignInAfterReviewPrompt()
                self.isGuestSignInCloudSignInPresented = true
            }
        )
        .alert(
            self.accountDeletedTitle,
            isPresented: self.accountDeletionSuccessPresentation
        ) {
            Button(
                self.confirmationButtonTitle,
                role: .cancel
            ) {
                store.dismissAccountDeletionSuccessMessage()
            }
        } message: {
            Text(store.accountDeletionSuccessMessage ?? "")
        }
    }

    private var reviewTab: some View {
        self.aiCompanionHost(for: .review) {
            ReviewView()
        }
        #if targetEnvironment(macCatalyst)
        .environment(\.macToolbarOwnerTab, .review)
        #endif
    }

    private var progressTab: some View {
        self.aiCompanionHost(for: .progress) {
            ProgressScreen()
        }
        #if targetEnvironment(macCatalyst)
        .environment(\.macToolbarOwnerTab, .progress)
        #endif
    }

    private func aiTab(aiPath: Binding<NavigationPath>) -> some View {
        NavigationStack(path: aiPath) {
            Group {
                if self.navigation.selectedTab == .ai {
                    if UIDevice.current.userInterfaceIdiom == .pad {
                        // Match the paired columns: the fixed viewport owns keyboard avoidance
                        // inside the native navigation stack, below its toolbar.
                        GeometryReader { _ in
                            AIChatView(chatStore: store.aiChatStore)
                                .id(self.navigation.aiTabVisitID)
                        }
                        .ignoresSafeArea(self.isKeyboardDocked ? [] : .keyboard, edges: .all)
                    } else {
                        AIChatView(chatStore: store.aiChatStore)
                            .id(self.navigation.aiTabVisitID)
                    }
                }
            }
            .navigationDestination(for: AIChatHistoryListRoute.self) { _ in
                AIChatHistoryView(chatStore: store.aiChatStore)
                    #if targetEnvironment(macCatalyst)
                    .environment(\.macToolbarOwnerTab, .ai)
                    #endif
            }
            #if targetEnvironment(macCatalyst)
            .toolbar(.hidden, for: .navigationBar)
            #endif
        }
        #if targetEnvironment(macCatalyst)
        .environment(\.macToolbarOwnerTab, .ai)
        #endif
    }

    /// The companion pane sits beside the whole stack, so it stays open across Library pages.
    private func libraryTab(libraryPath: Binding<LibraryNavigationPath>) -> some View {
        self.aiCompanionColumns(for: .library) {
            NavigationStack(path: libraryPath) {
                self.libraryRoot
                    .navigationDestination(for: LibraryNavigationDestination.self) { destination in
                        self.libraryDestinationView(destination: destination)
                            #if targetEnvironment(macCatalyst)
                            .environment(\.macToolbarOwnerTab, .library)
                            #endif
                    }
                    #if targetEnvironment(macCatalyst)
                    .toolbar(.hidden, for: .navigationBar)
                    #endif
            }
            #if targetEnvironment(macCatalyst)
            .id(self.navigation.librarySection)
            #endif
        }
        #if targetEnvironment(macCatalyst)
        .environment(\.macToolbarOwnerTab, .library)
        #endif
    }

    /// The Mac sidebar lists Library's sections instead of a hub, so the shown section is the root.
    @ViewBuilder
    private var libraryRoot: some View {
        #if targetEnvironment(macCatalyst)
        if let section = self.navigation.librarySection {
            self.libraryDestinationView(destination: section.destination)
        }
        #else
        LibraryScreen()
        #endif
    }

    @ViewBuilder
    private func libraryDestinationView(destination: LibraryNavigationDestination) -> some View {
        switch destination {
        case .cards:
            CardsScreen()
        case .tags:
            TagsScreen()
        case .decks:
            DecksScreen()
        case .deckDetail(let deck):
            DeckDetailScreen(destination: deck)
        case .deckCatalog:
            CatalogListScreen()
        case .catalogDeck(let deck):
            CatalogDeckScreen(deck: deck)
        case .importData:
            WorkspaceImportView()
        case .importAnki:
            WorkspaceAnkiImportView()
        case .exportData:
            WorkspaceExportView()
        }
    }

    private func settingsTab(settingsPath: Binding<SettingsNavigationPath>) -> some View {
        NavigationStack(path: settingsPath) {
            SettingsView()
                .navigationDestination(for: SettingsNavigationDestination.self) { destination in
                    self.settingsDestinationView(destination: destination)
                        #if targetEnvironment(macCatalyst)
                        .environment(\.macToolbarOwnerTab, .settings)
                        #endif
                }
                #if targetEnvironment(macCatalyst)
                .toolbar(.hidden, for: .navigationBar)
                #endif
        }
        #if targetEnvironment(macCatalyst)
        .environment(\.macToolbarOwnerTab, .settings)
        #endif
    }

    @ViewBuilder
    private func settingsDestinationView(destination: SettingsNavigationDestination) -> some View {
        switch destination {
        case .subscription:
            SubscriptionSettingsView()
        case .currentWorkspace:
            CurrentWorkspaceView()
        case .theme:
            ThemeSettingsView()
        case .accentColor:
            AccentColorSettingsView()
        case .reviewAnimations:
            ReviewAnimationsSettingsView()
        case .aiChatSuggestions:
            AIChatSuggestionsSettingsView()
        case .appIcon:
            AppIconSettingsView()
        case .ownOpenAIKey:
            OwnOpenAIKeySettingsView()
        case .leaderboardParticipation:
            LeaderboardParticipationSettingsView()
        case .productAnalytics:
            ProductAnalyticsSettingsView()
        case .language:
            LanguageSettingsView()
        case .feedback:
            FeedbackSettingsView()
        case .device:
            ThisDeviceSettingsView()
        case .access:
            AccessSettingsView()
        case .accessPermissionDetail(let kind):
            AccessPermissionDetailView(kind: kind)
        case .test:
            TestSettingsView()
        case .testAnimations:
            TestAnimationsView()
        case .notificationDiagnostics:
            NotificationDiagnosticsView()
        case .localSyncDiagnostics:
            LocalSyncDiagnosticsView()
        case .notifications:
            NotificationsSettingsView()
        case .workspaceScheduler:
            SchedulerSettingsDetailView()
        case .accountStatus:
            AccountStatusView()
        case .accountLegal:
            AccountLegalView()
        case .accountSupport:
            AccountSupportView()
        case .accountOpenSource:
            AccountOpenSourceView()
        case .accountServer:
            ServerSettingsView()
        case .accountAgentConnections:
            AgentConnectionsView()
        case .accountDangerZone:
            DangerZoneView()
        case .resetStudyProgress:
            ResetStudyProgressView()
        case .deleteCurrentWorkspace:
            DeleteCurrentWorkspaceView()
        }
    }
}

#if targetEnvironment(macCatalyst)
private struct MacDetailToolbarBackdrop: ViewModifier {
    let context: MacToolbarBackdropContext

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .scrollEdgeEffectHidden(true, for: .top)
                .overlay {
                    MacSharedToolbarBackdrop(contextID: self.context)
                        .ignoresSafeArea(.container, edges: .top)
                        .allowsHitTesting(false)
                }
        } else {
            content
        }
    }
}

/// Native macOS sidebar geometry for the System Settings sidebar size, which Catalyst
/// reports as `sidebarRowSize` and already applies to the row's text and symbol.
/// Mac points come from AppKit's source list on macOS 27.2: 24/32/40-point rows, with the
/// icon centred 17/19/20 and the title starting 32.5/36/38.5 points inside the selection.
/// Widths count from Catalyst's own 6.2-point content inset, which badged rows also keep;
/// a custom leading row inset would misalign them. Divided by Catalyst's 77% scale.
private struct MacSidebarRowMetrics {
    private static let interfaceScale: CGFloat = 0.77

    let rowHeight: CGFloat
    let iconWidth: CGFloat
    let iconToTitleSpacing: CGFloat

    init(size: SidebarRowSize) {
        let mac: (row: CGFloat, icon: CGFloat, spacing: CGFloat)
        switch size {
        case .small:
            mac = (24, 21.6, 4.7)
        case .large:
            mac = (40, 27.6, 4.7)
        case .medium:
            mac = (32, 25.6, 4.2)
        @unknown default:
            mac = (32, 25.6, 4.2)
        }
        self.rowHeight = mac.row / Self.interfaceScale
        self.iconWidth = mac.icon / Self.interfaceScale
        self.iconToTitleSpacing = mac.spacing / Self.interfaceScale
    }
}

private extension View {
    @ViewBuilder
    func macSidebarIconColumn(_ metrics: MacSidebarRowMetrics) -> some View {
        if #available(iOS 26.0, *) {
            self.labelReservedIconWidth(metrics.iconWidth)
                .labelIconToTitleSpacing(metrics.iconToTitleSpacing)
        } else {
            self
        }
    }
}
#endif

#Preview {
    let store = FlashcardsStore()
    RootTabView()
        .environment(store)
        .environment(AppleSubscriptionService(store: store, session: .shared))
        .environment(AppNavigationModel())
        .environment(SettingsScrollModel())
        .environment(CardsScreenModel())
        .environment(ReviewScreenModel())
        .environment(ProgressScreenState())
        .environment(CatalogIndexStore(urlSession: .shared))
}

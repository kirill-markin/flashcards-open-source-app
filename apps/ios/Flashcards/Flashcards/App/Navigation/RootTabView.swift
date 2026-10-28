import Foundation
import StoreKit
import SwiftUI
import UIKit

private let rootTabUITestLaunchScenarioEnvironmentKey: String = "FLASHCARDS_UI_TEST_LAUNCH_SCENARIO"

private struct StoreReviewRequestTaskID: Hashable {
    let isSceneActive: Bool
    let isPresentationBlocked: Bool
    let requestAttemptId: String?
}

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

    private var reviewReminderAttentionBadgeCount: Int {
        isReviewReminderAttentionVisible(
            state: store.reviewReminderAttentionState,
            workspaceId: store.workspace?.workspaceId
        ) ? 1 : 0
    }

    private var shouldExposeReviewReminderAttentionBadgeMarker: Bool {
        ProcessInfo.processInfo.environment[rootTabUITestLaunchScenarioEnvironmentKey] != nil
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

    private var guestSignInAfterReviewPromptTitle: String {
        String(
            localized: "root_tab.guest_sign_in_after_review_prompt.title",
            defaultValue: "Save your progress",
            table: "Foundation",
            comment: "Guest sign-in prompt title after reviewing enough cards"
        )
    }

    private var guestSignInAfterReviewPromptMessage: String {
        String(
            localized: "root_tab.guest_sign_in_after_review_prompt.message",
            defaultValue: "Sign in with email so these cards and review progress are not lost.",
            table: "Foundation",
            comment: "Guest sign-in prompt body after reviewing enough cards"
        )
    }

    private var guestSignInAfterReviewPromptLaterTitle: String {
        String(
            localized: "root_tab.guest_sign_in_after_review_prompt.later",
            defaultValue: "Later",
            table: "Foundation",
            comment: "Guest sign-in prompt secondary button"
        )
    }

    private var guestSignInAfterReviewPromptSignInTitle: String {
        String(
            localized: "root_tab.guest_sign_in_after_review_prompt.sign_in",
            defaultValue: "Sign in",
            table: "Foundation",
            comment: "Guest sign-in prompt primary button"
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
        guard self.scenePhase == .active, self.isStoreReviewRequestBlockedByPresentation == false,
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
        case .ai, .cards, .settings:
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

    private var tabRootBase: some View {
        @Bindable var navigation = self.navigation
        let selectedTabBinding = Binding<AppTab>(
            get: {
                navigation.selectedTab
            },
            set: { nextTab in
                let previousTab = navigation.selectedTab
                prepareVisibleTabForPresentationWithBreadcrumb(
                    store: self.store,
                    selectedTab: nextTab,
                    previousTab: previousTab,
                    scenePhase: self.scenePhase,
                    isStartupReady: nil,
                    isRecoveryGateActive: self.store.cloudCredentialRecoveryState != nil,
                    now: Date()
                )
                navigation.selectTab(nextTab)
            }
        )

        return TabView(selection: selectedTabBinding) {
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
            .badge(self.reviewReminderAttentionBadgeCount)

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

            Tab(value: AppTab.cards) {
                self.cardsTab
                    .background {
                        if UIDevice.current.userInterfaceIdiom == .phone {
                            RootTabAccessibilityMetadataAdapter()
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                    }
            } label: {
                self.tabLabel(.cards, identifier: UITestIdentifier.rootTabCardsItem)
            }
            .accessibilityIdentifier(UITestIdentifier.rootTabCardsItem, isEnabled: true)

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

    @ViewBuilder
    private var tabRootPresentation: some View {
        if #available(iOS 26.0, *) {
            self.tabRootBase
                .tabViewStyle(.sidebarAdaptable)
                .tabBarMinimizeBehavior(.never)
        } else {
            self.tabRootBase
                .tabViewStyle(.sidebarAdaptable)
        }
    }

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

    // Paired Cards and Progress share one native bar in both tab placements.
    // Their screen-owned drafts and presentations survive sidebar transitions.
    @ViewBuilder
    private func aiCompanionHost<Content: View>(for hostTab: AppTab, @ViewBuilder content: () -> Content) -> some View {
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
    }

    // Native edge bars keep their outer bounds. Regular-width content reserves chat space.
    @ViewBuilder
    private func aiCompanionColumns<Content: View>(for hostTab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        let hostContent = content()
        let isVisible = self.navigation.isAICompanionVisible
            && self.navigation.selectedTab == hostTab
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        // Duo chat stays on the physical left; iPad retains logical leading.
        let isLeading = isPad || self.layoutDirection == .leftToRight
        GeometryReader { geometry in
            let leftInset = self.layoutDirection == .leftToRight ? geometry.safeAreaInsets.leading : geometry.safeAreaInsets.trailing
            let rightInset = self.layoutDirection == .leftToRight ? geometry.safeAreaInsets.trailing : geometry.safeAreaInsets.leading
            // The content excludes native edge bars. Include their asymmetric
            // insets when locating the full window's midpoint on inner landscape.
            let width = isPad
                ? geometry.size.width / 2
                : max(0, min(geometry.size.width, (geometry.size.width + rightInset - leftInset) / 2))
            HStack(spacing: 0) {
                Color.clear
                    .frame(width: isVisible && isLeading ? width : 0)
                    .accessibilityHidden(true)
                hostContent
                    .frame(width: isPad ? geometry.size.width - (isVisible ? width : 0) : nil)
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
            .animation(self.reduceMotion ? nil : .smooth(duration: 0.35), value: isVisible)
        }
        // The paired columns share one keyboard boundary and one layout proposal.
        .ignoresSafeArea(isPad && self.isKeyboardDocked == false ? .keyboard : [], edges: .all)
    }

    private var tabRootTasks: some View {
        self.tabRootPresentation
        .ignoresSafeArea(UIDevice.current.userInterfaceIdiom == .pad || self.isKeyboardDocked || self.navigation.canPresentAICompanion == false ? [] : .keyboard, edges: .bottom)
        .environment(\.isKeyboardDocked, self.isKeyboardDocked)
        .background {
            AICompanionAvailabilityObserver { isAvailable in
                self.navigation.updateAICompanionAvailability(isAvailable)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
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

            let triggerSource: CloudSyncTriggerSource = nextTab == .review ? .reviewTabSelected : .cardsTabSelected
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
        .alert(
            self.guestSignInAfterReviewPromptTitle,
            isPresented: self.guestSignInAfterReviewPromptPresentation
        ) {
            Button(
                self.guestSignInAfterReviewPromptLaterTitle,
                role: .cancel
            ) {
                store.snoozeGuestSignInAfterReviewPrompt()
            }
            Button(
                self.guestSignInAfterReviewPromptSignInTitle
            ) {
                store.acceptGuestSignInAfterReviewPrompt()
                self.isGuestSignInCloudSignInPresented = true
            }
        } message: {
            Text(self.guestSignInAfterReviewPromptMessage)
        }
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
                .overlay(alignment: .topLeading) {
                    self.reviewReminderAttentionBadgeMarker
                }
        }
    }

    @ViewBuilder
    private var reviewReminderAttentionBadgeMarker: some View {
        if self.shouldExposeReviewReminderAttentionBadgeMarker && self.reviewReminderAttentionBadgeCount > 0 {
            Color.clear
                .frame(width: 1, height: 1)
                .allowsHitTesting(false)
                .accessibilityElement(children: .ignore)
                .accessibilityIdentifier(UITestIdentifier.rootTabReviewReminderBadge)
                .accessibilityValue(String(self.reviewReminderAttentionBadgeCount))
        }
    }

    private var progressTab: some View {
        self.aiCompanionHost(for: .progress) {
            ProgressScreen()
        }
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
            }
        }
    }

    private var cardsTab: some View {
        self.aiCompanionHost(for: .cards) {
            CardsScreen()
        }
    }

    private func settingsTab(settingsPath: Binding<[SettingsNavigationDestination]>) -> some View {
        NavigationStack(path: settingsPath) {
            SettingsView()
                .navigationDestination(for: SettingsNavigationDestination.self) { destination in
                    self.settingsDestinationView(destination: destination)
                }
        }
    }

    @ViewBuilder
    private func settingsDestinationView(destination: SettingsNavigationDestination) -> some View {
        switch destination {
        case .subscription:
            SubscriptionSettingsView()
        case .currentWorkspace:
            CurrentWorkspaceView()
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
        case .workspaceExport:
            WorkspaceExportView()
        case .workspaceImport:
            WorkspaceImportView()
        case .workspaceDecks:
            DecksScreen()
        case .workspaceTags:
            TagsScreen()
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

#Preview {
    let store = FlashcardsStore()
    RootTabView()
        .environment(store)
        .environment(AppleSubscriptionService(store: store, session: .shared))
        .environment(AppNavigationModel())
}

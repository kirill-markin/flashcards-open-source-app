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

private struct GuestSignInAfterReviewPromptRecheckTaskID: Hashable {
    let isSceneActive: Bool
    let cloudState: CloudAccountState?
    let reviewedCount: Int
    let promptState: GuestSignInAfterReviewPromptState
    let isModalOrAuthFlowActive: Bool
}

struct RootTabView: View {
    @Environment(\.requestReview) private var requestReview
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
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

    private var guestSignInAfterReviewPromptRecheckTaskID: GuestSignInAfterReviewPromptRecheckTaskID {
        GuestSignInAfterReviewPromptRecheckTaskID(
            isSceneActive: self.scenePhase == .active,
            cloudState: store.cloudSettings?.cloudState,
            reviewedCount: store.homeSnapshot.reviewedCount,
            promptState: store.guestSignInAfterReviewPromptState,
            isModalOrAuthFlowActive: self.isGuestSignInAfterReviewPromptBlockedByModal
        )
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

    private var premiumPresentation: Binding<PremiumPresentationRequest?> {
        Binding(
            get: {
                guard store.feedbackPresentation == nil,
                      store.presentedTechnicalError == nil,
                      store.activeCloudSignInSheetCount == 0,
                      self.isGuestSignInCloudSignInPresented == false,
                      store.isGuestSignInAfterReviewPromptPresented == false else {
                    return nil
                }
                return self.premiumPresenter.request
            },
            set: { presentation in
                if presentation == nil {
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
    private func reconcileGuestSignInAfterReviewPrompt() {
        self.store.reconcileGuestSignInAfterReviewPrompt(
            isModalOrAuthFlowActive: self.isGuestSignInAfterReviewPromptBlockedByModal,
            now: Date()
        )
    }

    @MainActor
    private func waitForGuestSignInAfterReviewPromptRecheckIfNeeded() async {
        guard self.scenePhase == .active else {
            return
        }

        let now = Date()
        guard let recheckDate = nextGuestSignInAfterReviewPromptRecheckDate(
            cloudState: store.cloudSettings?.cloudState,
            reviewedCount: store.homeSnapshot.reviewedCount,
            promptState: store.guestSignInAfterReviewPromptState,
            now: now,
            isModalOrAuthFlowActive: self.isGuestSignInAfterReviewPromptBlockedByModal
        ) else {
            return
        }

        let secondsUntilRecheck = recheckDate.timeIntervalSince(now)
        guard secondsUntilRecheck > 0 else {
            self.reconcileGuestSignInAfterReviewPrompt()
            return
        }

        let nanosecondsPerSecond: Double = 1_000_000_000
        let maximumSleepSeconds = Double(UInt64.max) / nanosecondsPerSecond
        let sleepNanoseconds = UInt64(min(secondsUntilRecheck, maximumSleepSeconds) * nanosecondsPerSecond)

        do {
            try await Task.sleep(nanoseconds: sleepNanoseconds)
        } catch is CancellationError {
            return
        } catch {
            FlashcardsObservability.captureSilentFailure(
                error: error,
                scope: IOSObservationScope(
                    feature: .prompts,
                    userId: store.cloudSettings?.linkedUserId,
                    workspaceId: store.workspace?.workspaceId,
                    requestId: nil,
                    clientRequestId: nil,
                    sessionId: nil,
                    runId: nil,
                    cloudState: store.cloudSettings?.cloudState,
                    configurationMode: try? store.currentCloudServiceConfiguration().mode
                ),
                action: "guest_sign_in_after_review_prompt_recheck_sleep",
                stage: "sleep",
                statusCode: nil,
                backendCode: nil,
                requestId: nil
            )
            assertionFailure("Unexpected guest sign-in prompt recheck sleep failure: \(error)")
            return
        }

        guard Task.isCancelled == false else {
            return
        }

        self.reconcileGuestSignInAfterReviewPrompt()
    }

    @MainActor
    private func requestStoreReviewIfNeeded() async {
        guard self.scenePhase == .active else {
            return
        }
        guard self.isStoreReviewRequestBlockedByPresentation == false else {
            return
        }
        guard let requestAttempt = store.pendingStoreReviewRequestAttempt else {
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
            if let recoveryState = store.cloudCredentialRecoveryState {
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
        }
    }

    @ViewBuilder
    private var uiTestLaunchPreparationStatusMarker: some View {
        if let uiTestLaunchPreparationValue = store.uiTestLaunchPreparationStatus.accessibilityValue {
            Text("ui-test-launch-preparation-status")
                .font(.system(size: 1))
                .foregroundStyle(.clear)
                .allowsHitTesting(false)
                .accessibilityElement(children: .ignore)
                .accessibilityIdentifier(UITestIdentifier.uiTestLaunchPreparationStatus)
                .accessibilityLabel("UI test launch preparation status")
                .accessibilityValue(uiTestLaunchPreparationValue)
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
            } label: {
                self.tabLabel(.review, identifier: UITestIdentifier.rootTabReviewItem)
            }
            .badge(self.reviewReminderAttentionBadgeCount)

            Tab(value: AppTab.progress) {
                self.progressTab
            } label: {
                self.tabLabel(.progress, identifier: UITestIdentifier.rootTabProgressItem)
            }

            Tab(value: AppTab.ai) {
                self.aiTab
            } label: {
                self.tabLabel(.ai, identifier: UITestIdentifier.rootTabAIItem)
            }

            Tab(value: AppTab.cards) {
                self.cardsTab
            } label: {
                self.tabLabel(.cards, identifier: UITestIdentifier.rootTabCardsItem)
            }

            Tab(value: AppTab.settings) {
                self.settingsTab(settingsPath: $navigation.settingsPath)
            } label: {
                self.tabLabel(.settings, identifier: UITestIdentifier.rootTabSettingsItem)
            }
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

    private func aiCompanionPane(hostTab: AppTab, isInspector: Bool = false) -> some View {
        AIChatView(chatStore: store.aiChatStore, isCompanion: true, isCompanionPresentationActive: isInspector != self.usesSideBySideAICompanion, companionHostTab: hostTab)
            .ignoresSafeArea(self.isKeyboardDocked ? [] : .keyboard, edges: .bottom)
            .background(Color(uiColor: .systemBackground))
            .presentationBackground(Color(uiColor: .systemBackground))
    }

    private var usesSideBySideAICompanion: Bool {
        self.horizontalSizeClass == .regular
    }

    // Native bars keep their outer bounds. Regular-width content reserves chat space.
    @ViewBuilder
    private func aiCompanionHost<Content: View>(for hostTab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        let hostContent = content()
        let isVisible = self.usesSideBySideAICompanion && self.navigation.isAICompanionVisible
            && self.navigation.selectedTab == hostTab
        let isLeading = UIDevice.current.userInterfaceIdiom == .pad
        GeometryReader { geometry in
            let width = min(400, max(320, geometry.size.width / 3))
            HStack(spacing: 0) {
                Color.clear
                    .frame(width: isVisible && isLeading ? width : 0)
                    .accessibilityHidden(true)
                hostContent
                Color.clear
                    .frame(width: isVisible && !isLeading ? width : 0)
                    .accessibilityHidden(true)
            }
            .overlay(alignment: isLeading ? .leading : .trailing) {
                if isVisible {
                    self.aiCompanionPane(hostTab: hostTab)
                        .frame(width: width)
                        .overlay(alignment: isLeading ? .trailing : .leading) {
                            HStack(spacing: 0) { Divider() }.frame(width: 1)
                        }
                        .transition(.move(edge: isLeading ? .leading : .trailing).combined(with: .opacity))
                }
            }
            .animation(self.reduceMotion ? nil : .smooth(duration: 0.35), value: isVisible)
        }
    }

    private var tabRootTasks: some View {
        self.tabRootPresentation
        // A floating keyboard is an overlay, not a bottom inset. Keep SwiftUI's
        // normal avoidance only when the native guide reports a docked keyboard.
        .ignoresSafeArea(self.isKeyboardDocked ? [] : .keyboard, edges: .bottom)
        .environment(\.isKeyboardDocked, self.isKeyboardDocked)
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
            self.reconcileGuestSignInAfterReviewPrompt()
        }
        .task(id: self.guestSignInAfterReviewPromptRecheckTaskID) {
            await self.waitForGuestSignInAfterReviewPromptRecheckIfNeeded()
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
            self.reconcileGuestSignInAfterReviewPrompt()
        }
        .onChange(of: self.premiumPresenter.request) { _, _ in
            self.reconcileGuestSignInAfterReviewPrompt()
        }
        .onChange(of: store.guestSignInAfterReviewPromptReconciliationToken) { _, _ in
            self.reconcileGuestSignInAfterReviewPrompt()
        }
        .onChange(of: store.feedbackPresentation) { _, _ in
            self.reconcileGuestSignInAfterReviewPrompt()
        }
        .onChange(of: store.activeCloudSignInSheetCount) { _, _ in
            self.reconcileGuestSignInAfterReviewPrompt()
        }
        .onChange(of: self.scenePhase) { _, nextPhase in
            if nextPhase == .active {
                self.reconcileGuestSignInAfterReviewPrompt()
            }
        }
        .onChange(of: store.accountDeletionState) { _, _ in
            self.reconcileGuestSignInAfterReviewPrompt()
        }
        .onChange(of: store.accountDeletionSuccessMessage) { _, _ in
            self.reconcileGuestSignInAfterReviewPrompt()
        }
        .onChange(of: store.reviewSubmissionFailure != nil) { _, _ in
            self.reconcileGuestSignInAfterReviewPrompt()
        }
        .onChange(of: store.isReviewNotificationPrePromptPresented) { _, _ in
            self.reconcileGuestSignInAfterReviewPrompt()
        }
        .onChange(of: store.isReviewHardReminderPresented) { _, _ in
            self.reconcileGuestSignInAfterReviewPrompt()
        }
        .onChange(of: self.isGuestSignInCloudSignInPresented) { _, _ in
            self.reconcileGuestSignInAfterReviewPrompt()
        }
    }

    private var tabRootSheets: some View {
        self.tabRootChangeHandlers
        .cloudSignInSheet(
            isPresented: self.$isGuestSignInCloudSignInPresented,
            presentationContext: .standard(originSurface: .review)
        )
        .sheet(item: self.premiumPresentation) { request in
            PremiumOfferView(request: request)
            .environment(store)
            .environment(self.premiumPresenter)
            .onAppear {
                self.premiumPresenter.recordShown(
                    requestId: request.id,
                    screen: analyticsSurface(tab: store.currentVisibleTab)
                )
            }
        }
        .sheet(item: self.feedbackPresentation) { presentation in
            FeedbackSheet(presentation: presentation)
                .environment(store)
        }
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
                store.snoozeGuestSignInAfterReviewPrompt(
                    reviewedCount: store.homeSnapshot.reviewedCount,
                    now: Date()
                )
            }
            Button(
                self.guestSignInAfterReviewPromptSignInTitle
            ) {
                store.acceptGuestSignInAfterReviewPrompt(now: Date())
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
        NavigationStack {
            self.aiCompanionHost(for: .review) {
                ReviewView()
                    .overlay(alignment: .topLeading) {
                        self.reviewReminderAttentionBadgeMarker
                    }
            }
            .inspector(isPresented: self.aiCompanionInspectorPresentation(for: .review)) {
                self.aiCompanionInspectorContent(for: .review)
            }
        }
    }

    private func aiCompanionInspectorPresentation(for hostTab: AppTab) -> Binding<Bool> {
        // Read intent during view construction so cached inspectors observe host changes.
        let shouldPresent = self.navigation.selectedTab == hostTab
            && self.navigation.isAICompanionVisible
            && self.usesSideBySideAICompanion == false
        return Binding(
            get: { shouldPresent },
            set: { isPresented in
                // Hidden tabs and outgoing compact presentations cannot dismiss the active pane.
                guard self.navigation.selectedTab == hostTab,
                      self.usesSideBySideAICompanion == false else { return }
                withAnimation(self.reduceMotion ? nil : .smooth(duration: 0.35)) {
                    self.navigation.isAICompanionPresented = isPresented
                }
            }
        )
    }

    private func aiCompanionInspectorContent(for hostTab: AppTab) -> some View {
        // Cached native inspectors keep their content; the binding and active-host
        // guard control visibility and ownership rather than returning an empty pane.
        self.aiCompanionPane(hostTab: hostTab, isInspector: true)
            .inspectorColumnWidth(min: 320, ideal: 400, max: 520)
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
        NavigationStack {
            self.aiCompanionHost(for: .progress) {
                ProgressScreen()
            }
            .inspector(isPresented: self.aiCompanionInspectorPresentation(for: .progress)) {
                self.aiCompanionInspectorContent(for: .progress)
            }
        }
    }

    private var aiTab: some View {
        NavigationStack {
            if self.navigation.selectedTab == .ai {
                AIChatView(chatStore: store.aiChatStore)
            }
        }
        .id(self.navigation.aiTabVisitID)
    }

    private var cardsTab: some View {
        NavigationStack {
            self.aiCompanionHost(for: .cards) {
                CardsScreen()
            }
            .inspector(isPresented: self.aiCompanionInspectorPresentation(for: .cards)) {
                self.aiCompanionInspectorContent(for: .cards)
            }
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

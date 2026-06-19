import Foundation
import StoreKit
import SwiftUI

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
    @Environment(\.scenePhase) private var scenePhase
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    @State private var isGuestSignInCloudSignInPresented: Bool = false

    private var isGuestSignInAfterReviewPromptBlockedByModal: Bool {
        self.isGuestSignInCloudSignInPresented
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

        self.store.prepareVisibleTabForPresentation(tab: nextTab, now: Date())
    }

    @MainActor
    private func refreshSelectedTabIfNeeded(nextTab: AppTab) async {
        switch nextTab {
        case .review:
            async let refreshProgressBadge: Void = self.store.refreshReviewProgressBadgeIfNeeded()
            async let refreshLeaderboardBadge: Void = self.store.refreshReviewLeaderboardBadgeIfNeeded()
            _ = await (refreshProgressBadge, refreshLeaderboardBadge)
        case .progress:
            await self.store.refreshProgressIfNeeded()
        case .ai, .cards, .settings:
            return
        }
    }

    var body: some View {
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
    }

    private var tabRootBase: some View {
        @Bindable var navigation = self.navigation
        let selectedTabBinding = Binding<AppTab>(
            get: {
                navigation.selectedTab
            },
            set: { nextTab in
                self.store.prepareVisibleTabForPresentation(tab: nextTab, now: Date())
                navigation.selectedTab = nextTab
            }
        )

        return TabView(selection: selectedTabBinding) {
            self.reviewTab
            self.progressTab
            self.aiTab
            self.cardsTab
            self.settingsTab(settingsPath: $navigation.settingsPath)
        }
    }

    private var tabRootTasks: some View {
        self.tabRootBase
        .tabBarMinimizeBehavior(.never)
        .task {
            store.prepareVisibleTabForPresentation(tab: self.navigation.selectedTab, now: Date())
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
                    surfacesGlobalErrorMessage: false
                )
            )
        }
        .onChange(of: store.cloudSettings?.cloudState) { _, _ in
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
        .sheet(isPresented: self.$isGuestSignInCloudSignInPresented) {
            CloudSignInSheet(presentationContext: .standard)
                .environment(store)
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
            ReviewView()
                .overlay(alignment: .topLeading) {
                    self.reviewReminderAttentionBadgeMarker
                }
        }
        .tabItem {
            Label(
                String(
                    localized: "root_tab.review.title",
                    table: "Foundation",
                    comment: "Review tab title"
                ),
                systemImage: "rectangle.on.rectangle"
            )
            .accessibilityIdentifier(UITestIdentifier.rootTabReviewItem)
        }
        .badge(self.reviewReminderAttentionBadgeCount)
        .tag(AppTab.review)
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
            ProgressScreen()
        }
        .tabItem {
            Label(
                String(
                    localized: "root_tab.progress.title",
                    defaultValue: "Progress",
                    table: "Foundation",
                    comment: "Progress tab title"
                ),
                systemImage: "chart.bar.xaxis"
            )
            .accessibilityIdentifier(UITestIdentifier.rootTabProgressItem)
        }
        .tag(AppTab.progress)
    }

    private var aiTab: some View {
        NavigationStack {
            AIChatView(chatStore: store.aiChatStore)
        }
        .tabItem {
            Label(
                String(
                    localized: "root_tab.ai.title",
                    defaultValue: "AI",
                    table: "Foundation",
                    comment: "AI tab title"
                ),
                systemImage: "sparkles.rectangle.stack"
            )
            .accessibilityIdentifier(UITestIdentifier.rootTabAIItem)
        }
        .tag(AppTab.ai)
    }

    private var cardsTab: some View {
        NavigationStack {
            CardsScreen()
        }
        .tabItem {
            Label(
                String(
                    localized: "root_tab.cards.title",
                    defaultValue: "Cards",
                    table: "Foundation",
                    comment: "Cards tab title"
                ),
                systemImage: "rectangle.stack"
            )
            .accessibilityIdentifier(UITestIdentifier.rootTabCardsItem)
        }
        .tag(AppTab.cards)
    }

    private func settingsTab(settingsPath: Binding<[SettingsNavigationDestination]>) -> some View {
        NavigationStack(path: settingsPath) {
            SettingsView()
                .navigationDestination(for: SettingsNavigationDestination.self) { destination in
                    self.settingsDestinationView(destination: destination)
                }
        }
        .tabItem {
            Label(
                String(
                    localized: "root_tab.settings.title",
                    table: "Foundation",
                    comment: "Settings tab title"
                ),
                systemImage: "gearshape"
            )
            .accessibilityIdentifier(UITestIdentifier.rootTabSettingsItem)
        }
        .badge(self.settingsAttentionSummary.settingsTabCount)
        .tag(AppTab.settings)
    }

    @ViewBuilder
    private func settingsDestinationView(destination: SettingsNavigationDestination) -> some View {
        switch destination {
        case .currentWorkspace:
            CurrentWorkspaceView()
        case .reviewAnimations:
            ReviewAnimationsSettingsView()
        case .leaderboardParticipation:
            LeaderboardParticipationSettingsView()
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
        case .workspaceNotifications:
            ReviewNotificationsSettingsView()
        case .workspaceScheduler:
            SchedulerSettingsDetailView()
        case .workspaceExport:
            WorkspaceExportView()
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
    RootTabView()
        .environment(FlashcardsStore())
        .environment(AppNavigationModel())
}

import SwiftUI

private struct GuestSignInAfterReviewPromptRecheckTaskID: Hashable {
    let isSceneActive: Bool
    let cloudState: CloudAccountState?
    let reviewedCount: Int
    let promptState: GuestSignInAfterReviewPromptState
    let isModalOrAuthFlowActive: Bool
}

struct RootTabView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    @State private var isGuestSignInCloudSignInPresented: Bool = false

    private var isGuestSignInAfterReviewPromptBlockedByModal: Bool {
        self.isGuestSignInCloudSignInPresented
            || store.activeCloudSignInSheetCount > 0
            || store.accountDeletionState != .hidden
            || store.accountDeletionSuccessMessage != nil
            || store.reviewSubmissionFailure != nil
            || store.isReviewNotificationPrePromptPresented
            || store.isReviewHardReminderPresented
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
            assertionFailure("Unexpected guest sign-in prompt recheck sleep failure: \(error)")
            return
        }

        guard Task.isCancelled == false else {
            return
        }

        self.reconcileGuestSignInAfterReviewPrompt()
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
            await self.store.refreshReviewProgressBadgeIfNeeded()
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
        @Bindable var navigation = self.navigation
        let selectedTabBinding = Binding(
            get: {
                navigation.selectedTab
            },
            set: { nextTab in
                self.store.prepareVisibleTabForPresentation(tab: nextTab, now: Date())
                navigation.selectedTab = nextTab
            }
        )

        return TabView(selection: selectedTabBinding) {
            NavigationStack {
                ReviewView()
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
            .tag(AppTab.review)

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

            NavigationStack(path: $navigation.settingsPath) {
                SettingsView()
                    .navigationDestination(for: SettingsNavigationDestination.self) { destination in
                        switch destination {
                        case .currentWorkspace:
                            CurrentWorkspaceView()
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
                        case .workspace:
                            WorkspaceSettingsView()
                        case .workspaceNotifications:
                            ReviewNotificationsSettingsView()
                        case .workspaceOverview:
                            WorkspaceOverviewView()
                        case .workspaceScheduler:
                            SchedulerSettingsDetailView()
                        case .workspaceExport:
                            WorkspaceExportView()
                        case .workspaceDecks:
                            DecksScreen()
                        case .workspaceTags:
                            TagsScreen()
                        case .account:
                            AccountSettingsView()
                        case .accountStatus:
                            AccountStatusView()
                        case .accountLegalSupport:
                            AccountLegalSupportView()
                        case .accountOpenSource:
                            AccountOpenSourceView()
                        case .accountAdvanced:
                            AccountAdvancedSettingsView()
                        case .accountServer:
                            ServerSettingsView()
                        case .accountAgentConnections:
                            AgentConnectionsView()
                        case .accountDangerZone:
                            DangerZoneView()
                        }
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
            .tag(AppTab.settings)
        }
        .tabBarMinimizeBehavior(.never)
        .task {
            store.prepareVisibleTabForPresentation(tab: navigation.selectedTab, now: Date())
            self.reconcileGuestSignInAfterReviewPrompt()
        }
        .task(id: self.guestSignInAfterReviewPromptRecheckTaskID) {
            await self.waitForGuestSignInAfterReviewPromptRecheckIfNeeded()
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
        .onChange(of: navigation.selectedTab) { _, nextTab in
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
        .sheet(isPresented: self.$isGuestSignInCloudSignInPresented) {
            CloudSignInSheet(presentationContext: .standard)
                .environment(store)
        }
        .alert(
            String(
                localized: "root_tab.guest_sign_in_after_review_prompt.title",
                defaultValue: "Save your progress",
                table: "Foundation",
                comment: "Guest sign-in prompt title after reviewing enough cards"
            ),
            isPresented: Binding(
                get: {
                    store.isGuestSignInAfterReviewPromptPresented
                },
                set: { isPresented in
                    if isPresented == false {
                        store.dismissGuestSignInAfterReviewPrompt()
                    }
                }
            )
        ) {
            Button(
                String(
                    localized: "root_tab.guest_sign_in_after_review_prompt.later",
                    defaultValue: "Later",
                    table: "Foundation",
                    comment: "Guest sign-in prompt secondary button"
                ),
                role: .cancel
            ) {
                store.snoozeGuestSignInAfterReviewPrompt(
                    reviewedCount: store.homeSnapshot.reviewedCount,
                    now: Date()
                )
            }
            Button(
                String(
                    localized: "root_tab.guest_sign_in_after_review_prompt.sign_in",
                    defaultValue: "Sign in",
                    table: "Foundation",
                    comment: "Guest sign-in prompt primary button"
                )
            ) {
                store.acceptGuestSignInAfterReviewPrompt(now: Date())
                self.isGuestSignInCloudSignInPresented = true
            }
        } message: {
            Text(
                String(
                    localized: "root_tab.guest_sign_in_after_review_prompt.message",
                    defaultValue: "Sign in with email so these cards and review progress are not lost.",
                    table: "Foundation",
                    comment: "Guest sign-in prompt body after reviewing enough cards"
                )
            )
        }
        .alert(
            String(
                localized: "root_tab.account_deleted.title",
                table: "Foundation",
                comment: "Account deletion success alert title"
            ),
            isPresented: Binding(
                get: {
                    store.accountDeletionSuccessMessage != nil
                },
                set: { isPresented in
                    if isPresented == false {
                        store.dismissAccountDeletionSuccessMessage()
                    }
                }
            )
        ) {
            Button(
                String(
                    localized: "shared.ok",
                    table: "Foundation",
                    comment: "Confirmation button title"
                ),
                role: .cancel
            ) {
                store.dismissAccountDeletionSuccessMessage()
            }
        } message: {
            Text(store.accountDeletionSuccessMessage ?? "")
        }
    }
}

#Preview {
    RootTabView()
        .environment(FlashcardsStore())
        .environment(AppNavigationModel())
}

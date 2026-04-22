import SwiftUI

struct RootTabView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

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
        }
        .overlay {
            ZStack {
                GlobalTransientBannerHost()

                if store.accountDeletionState != .hidden {
                    AccountDeletionProgressView()
                        .environment(store)
                }
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

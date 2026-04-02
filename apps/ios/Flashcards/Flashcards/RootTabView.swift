import SwiftUI

struct RootTabView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    var body: some View {
        @Bindable var navigation = self.navigation

        return TabView(selection: $navigation.selectedTab) {
            NavigationStack {
                ReviewView()
            }
            .tabItem {
                Label("Review", systemImage: "rectangle.on.rectangle")
            }
            .tag(AppTab.review)

            NavigationStack {
                CardsScreen()
            }
            .tabItem {
                Label("Cards", systemImage: "rectangle.stack")
            }
            .tag(AppTab.cards)

            NavigationStack {
                AIChatView(chatStore: store.aiChatStore)
            }
            .tabItem {
                Label("AI", systemImage: "sparkles.rectangle.stack")
            }
            .tag(AppTab.ai)

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
                Label("Settings", systemImage: "gearshape")
            }
            .tag(AppTab.settings)
        }
        .tabBarMinimizeBehavior(.never)
        .task {
            store.updateCurrentVisibleTab(tab: navigation.selectedTab)
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
            store.updateCurrentVisibleTab(tab: nextTab)

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
            "Account deleted",
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
            Button("OK", role: .cancel) {
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

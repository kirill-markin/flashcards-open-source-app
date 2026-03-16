import SwiftUI

struct RootTabView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @State private var selectedTab: AppTab = .review
    @State private var settingsNavigationPath: [SettingsNavigationDestination] = []

    var body: some View {
        TabView(selection: Binding(
            get: {
                self.selectedTab
            },
            set: { nextTab in
                self.selectedTab = nextTab
                store.selectTab(tab: nextTab)
            }
        )) {
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

            NavigationStack(path: self.$settingsNavigationPath) {
                SettingsView()
                    .navigationDestination(for: SettingsNavigationDestination.self) { destination in
                        switch destination {
                        case .access:
                            AccessSettingsView()
                        case .workspace:
                            WorkspaceSettingsView()
                        case .workspaceOverview:
                            WorkspaceOverviewView()
                        case .workspaceScheduler:
                            SchedulerSettingsDetailView()
                        case .workspaceDecks:
                            DecksScreen()
                        case .workspaceTags:
                            TagsScreen()
                        case .workspaceDevice:
                            ThisDeviceSettingsView()
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
        .tabBarMinimizeBehavior(.onScrollDown)
        .onAppear {
            self.selectedTab = store.selectedTab
            self.handleSettingsPresentationRequest(request: store.settingsPresentationRequest)
        }
        .onChange(of: store.tabSelectionRequest) { _, request in
            guard let request else {
                return
            }

            self.selectedTab = request.tab
        }
        .onChange(of: store.settingsPresentationRequest) { _, request in
            self.handleSettingsPresentationRequest(request: request)
        }
        .fullScreenCover(
            isPresented: Binding(
                get: {
                    store.accountDeletionState != .hidden
                },
                set: { _ in }
            )
        ) {
            AccountDeletionProgressView()
                .environment(store)
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

    private func handleSettingsPresentationRequest(request: SettingsNavigationDestination?) {
        guard let request else {
            return
        }

        self.settingsNavigationPath = self.buildSettingsNavigationPath(request: request)
        store.clearSettingsPresentationRequest()
    }

    private func buildSettingsNavigationPath(request: SettingsNavigationDestination) -> [SettingsNavigationDestination] {
        switch request {
        case .access:
            return [.access]
        case .workspace:
            return [.workspace]
        case .workspaceOverview:
            return [.workspace, .workspaceOverview]
        case .workspaceScheduler:
            return [.workspace, .workspaceScheduler]
        case .workspaceDecks:
            return [.workspace, .workspaceDecks]
        case .workspaceTags:
            return [.workspace, .workspaceTags]
        case .workspaceDevice:
            return [.workspace, .workspaceDevice]
        case .account:
            return [.account]
        case .accountStatus:
            return [.account, .accountStatus]
        case .accountLegalSupport:
            return [.account, .accountLegalSupport]
        case .accountOpenSource:
            return [.account, .accountOpenSource]
        case .accountAdvanced:
            return [.account, .accountAdvanced]
        case .accountServer:
            return [.account, .accountAdvanced, .accountServer]
        case .accountAgentConnections:
            return [.account, .accountAgentConnections]
        case .accountDangerZone:
            return [.account, .accountDangerZone]
        }
    }
}

#Preview {
    RootTabView()
        .environment(FlashcardsStore())
}

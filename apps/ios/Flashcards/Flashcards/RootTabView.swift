import SwiftUI

struct RootTabView: View {
    @EnvironmentObject private var store: FlashcardsStore
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
                AIChatView(flashcardsStore: store, chatStore: store.aiChatStore)
            }
            .tabItem {
                Label("AI", systemImage: "sparkles.rectangle.stack")
            }
            .tag(AppTab.ai)

            NavigationStack(path: self.$settingsNavigationPath) {
                SettingsView()
                    .navigationDestination(for: SettingsNavigationDestination.self) { destination in
                        switch destination {
                        case .decks:
                            DecksScreen()
                        case .tags:
                            TagsScreen()
                        }
                    }
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape")
            }
            .tag(AppTab.settings)
        }
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
    }

    private func handleSettingsPresentationRequest(request: SettingsNavigationDestination?) {
        guard let request else {
            return
        }

        self.settingsNavigationPath = [request]
        store.clearSettingsPresentationRequest()
    }
}

#Preview {
    RootTabView()
        .environmentObject(FlashcardsStore())
}

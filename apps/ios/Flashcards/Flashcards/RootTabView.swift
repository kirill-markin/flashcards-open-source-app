import SwiftUI

struct RootTabView: View {
    @EnvironmentObject private var store: FlashcardsStore
    @State private var selectedTab: AppTab = .review

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
                DecksScreen()
            }
            .tabItem {
                Label("Decks", systemImage: "line.3.horizontal.decrease.circle")
            }
            .tag(AppTab.decks)

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

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape")
            }
            .tag(AppTab.settings)
        }
        .onAppear {
            self.selectedTab = store.selectedTab
        }
        .onChange(of: store.tabSelectionRequest) { _, request in
            guard let request else {
                return
            }

            self.selectedTab = request.tab
        }
    }
}

#Preview {
    RootTabView()
        .environmentObject(FlashcardsStore())
}

import SwiftUI

struct RootTabView: View {
    @EnvironmentObject private var store: FlashcardsStore

    var body: some View {
        TabView(selection: Binding(
            get: {
                store.selectedTab
            },
            set: { nextTab in
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
                SettingsView()
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape")
            }
            .tag(AppTab.settings)
        }
    }
}

#Preview {
    RootTabView()
        .environmentObject(FlashcardsStore())
}

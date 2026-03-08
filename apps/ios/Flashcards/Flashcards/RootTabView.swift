import SwiftUI

struct RootTabView: View {
    @State private var selectedTab: AppTab = .home

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                HomeView(startReview: {
                    selectedTab = .review
                })
            }
            .tabItem {
                Label("Home", systemImage: "house")
            }
            .tag(AppTab.home)

            NavigationStack {
                ReviewView()
            }
            .tabItem {
                Label("Review", systemImage: "rectangle.on.rectangle")
            }
            .tag(AppTab.review)

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

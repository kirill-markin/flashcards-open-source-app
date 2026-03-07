import SwiftUI

struct RootTabView: View {
    let decks: [DeckSummary]
    let reviewCards: [ReviewCard]

    @State private var selectedTab: AppTab = .home

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                HomeView(
                    decks: decks,
                    reviewCards: reviewCards,
                    startReview: {
                        selectedTab = .review
                    }
                )
            }
            .tabItem {
                Label("Home", systemImage: "house")
            }
            .tag(AppTab.home)

            NavigationStack {
                ReviewView(cards: reviewCards)
            }
            .tabItem {
                Label("Review", systemImage: "rectangle.on.rectangle")
            }
            .tag(AppTab.review)

            NavigationStack {
                SettingsView(snapshot: makeHomeSnapshot(decks: decks, reviewCards: reviewCards))
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape")
            }
            .tag(AppTab.settings)
        }
    }
}

#Preview {
    RootTabView(
        decks: sampleDecks(),
        reviewCards: sampleReviewCards()
    )
}

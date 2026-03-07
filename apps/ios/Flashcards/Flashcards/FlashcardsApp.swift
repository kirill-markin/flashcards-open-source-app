import SwiftUI

@main
struct FlashcardsApp: App {
    var body: some Scene {
        WindowGroup {
            RootTabView(
                decks: sampleDecks(),
                reviewCards: sampleReviewCards()
            )
        }
    }
}

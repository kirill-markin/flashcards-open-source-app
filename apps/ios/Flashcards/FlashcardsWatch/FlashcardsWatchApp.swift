import SwiftUI

@main
struct FlashcardsWatchApp: App {
    var body: some Scene {
        WindowGroup {
            WatchRootView()
        }
    }
}

struct WatchRootView: View {
    var body: some View {
        // The product name is never localized.
        Text(verbatim: "Nibomo")
            .font(.title2)
    }
}

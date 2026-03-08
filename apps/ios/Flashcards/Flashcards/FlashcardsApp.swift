import SwiftUI

@main
struct FlashcardsApp: App {
    @StateObject private var store: FlashcardsStore

    init() {
        _store = StateObject(wrappedValue: FlashcardsStore())
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(store)
        }
    }
}

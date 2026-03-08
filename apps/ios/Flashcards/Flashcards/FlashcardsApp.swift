import Combine
import SwiftUI

@main
struct FlashcardsApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store: FlashcardsStore
    private let syncTimer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    init() {
        _store = StateObject(wrappedValue: FlashcardsStore())
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(store)
                .task {
                    await store.syncCloudIfLinked()
                }
                .onChange(of: scenePhase) { _, nextPhase in
                    if nextPhase == .active {
                        Task { @MainActor in
                            await store.syncCloudIfLinked()
                        }
                    }
                }
                .onReceive(syncTimer) { _ in
                    if scenePhase == .active {
                        Task { @MainActor in
                            await store.syncCloudIfLinked()
                        }
                    }
                }
        }
    }
}

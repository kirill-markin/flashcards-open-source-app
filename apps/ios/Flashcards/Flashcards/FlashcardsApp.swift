import SwiftUI

private struct CloudSyncPollingTaskID: Hashable {
    let isSceneActive: Bool
    let selectedTab: AppTab
    let fastPollingUntil: Date?
}

@main
struct FlashcardsApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var store: FlashcardsStore

    init() {
        _store = State(initialValue: FlashcardsStore())
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(store)
                .task {
                    await store.resumePendingAccountDeletionIfNeeded()
                    await store.syncCloudIfLinked()
                }
                .onChange(of: scenePhase) { _, nextPhase in
                    if nextPhase == .active {
                        Task { @MainActor in
                            await store.syncCloudIfLinked()
                        }
                    }
                }
                .task(id: self.cloudSyncPollingTaskID) {
                    await self.runCloudSyncPollingLoop()
                }
        }
    }

    private var cloudSyncPollingTaskID: CloudSyncPollingTaskID {
        CloudSyncPollingTaskID(
            isSceneActive: self.scenePhase == .active,
            selectedTab: self.store.selectedTab,
            fastPollingUntil: self.store.cloudSyncFastPollingUntil
        )
    }

    @MainActor
    private func runCloudSyncPollingLoop() async {
        guard self.scenePhase == .active else {
            return
        }

        while Task.isCancelled == false && self.scenePhase == .active {
            let intervalSeconds = self.store.currentCloudSyncPollingInterval(now: Date())
            let intervalNanoseconds = UInt64(intervalSeconds * 1_000_000_000)

            do {
                try await Task.sleep(nanoseconds: intervalNanoseconds)
            } catch is CancellationError {
                return
            } catch {
                return
            }

            guard Task.isCancelled == false, self.scenePhase == .active else {
                return
            }

            await self.store.syncCloudIfLinked()
        }
    }
}

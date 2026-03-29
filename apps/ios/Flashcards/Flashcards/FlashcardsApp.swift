import SwiftUI

private let flashcardsUITestResetStateEnvironmentKey: String = "FLASHCARDS_UI_TEST_RESET_STATE"
private let flashcardsUITestSelectedTabEnvironmentKey: String = "FLASHCARDS_UI_TEST_SELECTED_TAB"

private enum FlashcardsUITestSelectedTab: String {
    case review
    case cards
    case ai
    case settings

    var appTab: AppTab {
        switch self {
        case .review:
            return .review
        case .cards:
            return .cards
        case .ai:
            return .ai
        case .settings:
            return .settings
        }
    }
}

private struct CloudSyncPollingTaskID: Hashable {
    let isSceneActive: Bool
    let selectedTab: AppTab
    let fastPollingUntil: Date?
}

@main
struct FlashcardsApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @UIApplicationDelegateAdaptor(ReviewNotificationsAppDelegate.self) private var reviewNotificationsAppDelegate
    @State private var store: FlashcardsStore
    @State private var navigation: AppNavigationModel

    @MainActor
    init() {
        let store = FlashcardsStore()
        let selectedTab = ProcessInfo.processInfo.environment[flashcardsUITestSelectedTabEnvironmentKey]
            .flatMap(FlashcardsUITestSelectedTab.init(rawValue:))
            ?.appTab ?? .review
        if let resetStateRawValue = ProcessInfo.processInfo.environment[flashcardsUITestResetStateEnvironmentKey],
           let resetState = FlashcardsUITestResetState(rawValue: resetStateRawValue) {
            do {
                try store.applyUITestResetState(resetState: resetState)
            } catch {
                store.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }

        _store = State(initialValue: store)
        _navigation = State(
            initialValue: AppNavigationModel(
                selectedTab: selectedTab,
                settingsPath: [],
                cardsPresentationRequest: nil,
                aiChatPresentationRequest: nil
            )
        )
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(store)
                .environment(navigation)
                .task {
                    await store.resumePendingAccountDeletionIfNeeded()
                    await store.syncCloudIfLinked()
                    store.markReviewNotificationsAppActive(now: Date())
                }
                .onChange(of: scenePhase) { _, nextPhase in
                    if nextPhase == .active {
                        Task { @MainActor in
                            await store.syncCloudIfLinked()
                            store.markReviewNotificationsAppActive(now: Date())
                        }
                    } else if nextPhase == .background || nextPhase == .inactive {
                        store.markReviewNotificationsAppBackground(now: Date())
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: reviewNotificationTapPayloadNotificationName)) { notification in
                    guard let payload = notification.object as? ScheduledReviewNotificationPayload else {
                        return
                    }

                    store.handleReviewNotificationTap(payload: payload, navigation: navigation)
                }
                .task(id: self.cloudSyncPollingTaskID) {
                    await self.runCloudSyncPollingLoop()
                }
        }
    }

    private var cloudSyncPollingTaskID: CloudSyncPollingTaskID {
        CloudSyncPollingTaskID(
            isSceneActive: self.scenePhase == .active,
            selectedTab: self.navigation.selectedTab,
            fastPollingUntil: self.store.cloudSyncFastPollingUntil
        )
    }

    @MainActor
    private func runCloudSyncPollingLoop() async {
        guard self.scenePhase == .active else {
            return
        }

        while Task.isCancelled == false && self.scenePhase == .active {
            let intervalSeconds = self.store.currentCloudSyncPollingInterval(
                selectedTab: self.navigation.selectedTab,
                now: Date()
            )
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

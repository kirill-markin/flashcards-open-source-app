import SwiftUI

private let flashcardsUITestResetStateEnvironmentKey: String = "FLASHCARDS_UI_TEST_RESET_STATE"
private let flashcardsUITestSelectedTabEnvironmentKey: String = "FLASHCARDS_UI_TEST_SELECTED_TAB"
private let flashcardsUITestAppNotificationTapTypeEnvironmentKey: String = "FLASHCARDS_UI_TEST_APP_NOTIFICATION_TAP_TYPE"
@MainActor
private var hasConsumedFlashcardsUITestAppNotificationTapEnvironment: Bool = false

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
    let isSyncBlocked: Bool
}

@MainActor
private func consumeFlashcardsUITestAppNotificationTapRequest(processInfo: ProcessInfo) -> AppNotificationTapRequest? {
    guard hasConsumedFlashcardsUITestAppNotificationTapEnvironment == false else {
        return nil
    }
    guard let appNotificationTapType = processInfo.environment[flashcardsUITestAppNotificationTapTypeEnvironmentKey] else {
        return nil
    }

    hasConsumedFlashcardsUITestAppNotificationTapEnvironment = true
    let userInfo: [AnyHashable: Any] = [
        appNotificationTapTypeUserInfoKey: appNotificationTapType
    ]
    return parseAppNotificationTapRequest(userInfo: userInfo)
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
            .map(\.appTab) ?? .review
        if let resetStateRawValue = ProcessInfo.processInfo.environment[flashcardsUITestResetStateEnvironmentKey],
           let resetState = FlashcardsUITestResetState(rawValue: resetStateRawValue) {
            do {
                try store.applyUITestResetState(resetState: resetState)
            } catch {
                store.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
        if let request = consumeFlashcardsUITestAppNotificationTapRequest(processInfo: ProcessInfo.processInfo) {
            let receivedMetadata = makeAppNotificationTapLogMetadata(
                request: request,
                source: .uiTestEnvironment,
                appState: "ui_test_launch",
                scenePhase: nil,
                receivedAtMillis: nil,
                stage: "receive",
                reason: nil,
                details: nil
            )
            logAppNotificationTapEvent(action: "notification_tap_received", metadata: receivedMetadata)

            do {
                let envelope = try AppNotificationTapCoordinator.persist(
                    request: request,
                    source: .uiTestEnvironment,
                    userDefaults: .standard
                )
                let persistedMetadata = makeAppNotificationTapLogMetadata(
                    request: request,
                    source: envelope.source,
                    appState: "ui_test_launch",
                    scenePhase: nil,
                    receivedAtMillis: envelope.receivedAtMillis,
                    stage: "persist",
                    reason: nil,
                    details: nil
                )
                logAppNotificationTapEvent(action: "notification_tap_persisted", metadata: persistedMetadata)
            } catch {
                let droppedMetadata = makeAppNotificationTapLogMetadata(
                    request: request,
                    source: .uiTestEnvironment,
                    appState: "ui_test_launch",
                    scenePhase: nil,
                    receivedAtMillis: nil,
                    stage: "persist",
                    reason: "persistence_failed",
                    details: Flashcards.errorMessage(error: error)
                )
                logAppNotificationTapEvent(action: "notification_tap_dropped", metadata: droppedMetadata)
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
                    store.updateCurrentVisibleTab(tab: navigation.selectedTab)
                    await store.resumePendingAccountDeletionIfNeeded()
                    let now = Date()
                    store.triggerCloudSyncIfLinked(
                        trigger: CloudSyncTrigger(
                            source: .appLaunch,
                            now: now,
                            extendsFastPolling: usesFastCloudSyncPolling(tab: navigation.selectedTab),
                            allowsVisibleChangeBanner: true,
                            surfacesGlobalErrorMessage: false
                        )
                    )
                    store.markReviewNotificationsAppActive(now: now)
                }
                .onChange(of: scenePhase) { _, nextPhase in
                    if nextPhase == .active {
                        let now = Date()
                        store.updateCurrentVisibleTab(tab: navigation.selectedTab)
                        store.triggerCloudSyncIfLinked(
                            trigger: CloudSyncTrigger(
                                source: .appForeground,
                                now: now,
                                extendsFastPolling: usesFastCloudSyncPolling(tab: navigation.selectedTab),
                                allowsVisibleChangeBanner: true,
                                surfacesGlobalErrorMessage: false
                            )
                        )
                        store.markReviewNotificationsAppActive(now: now)
                    } else if nextPhase == .background || nextPhase == .inactive {
                        store.markReviewNotificationsAppBackground(now: Date())
                    }
                }
                .task(id: self.isAppNotificationTapConsumptionReady) {
                    await self.consumePendingAppNotificationTapIfNeeded()
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
            fastPollingUntil: self.store.cloudSyncFastPollingUntil,
            isSyncBlocked: self.store.isCloudSyncBlocked
        )
    }

    private var isAppNotificationTapConsumptionReady: Bool {
        self.scenePhase == .active
    }

    @MainActor
    private func consumePendingAppNotificationTapIfNeeded() async {
        guard self.scenePhase == .active else {
            return
        }

        await Task.yield()
        guard self.scenePhase == .active else {
            return
        }

        let envelope: PendingAppNotificationTapEnvelope
        do {
            guard let loadedEnvelope = try AppNotificationTapCoordinator.takePendingEnvelope(userDefaults: .standard) else {
                return
            }
            envelope = loadedEnvelope
        } catch {
            let droppedMetadata = makeAppNotificationTapLogMetadata(
                request: .fallback(
                    AppNotificationTapFallback(
                        stage: "consume",
                        reason: "invalid_pending_envelope",
                        notificationType: nil,
                        details: Flashcards.errorMessage(error: error)
                    )
                ),
                source: nil,
                appState: nil,
                scenePhase: "active",
                receivedAtMillis: nil,
                stage: "consume",
                reason: "invalid_pending_envelope",
                details: Flashcards.errorMessage(error: error)
            )
            logAppNotificationTapEvent(action: "notification_tap_dropped", metadata: droppedMetadata)
            return
        }

        self.store.handleAppNotificationTap(request: envelope.request, navigation: self.navigation)
        let consumedMetadata = makeAppNotificationTapLogMetadata(
            request: envelope.request,
            source: envelope.source,
            appState: nil,
            scenePhase: "active",
            receivedAtMillis: envelope.receivedAtMillis,
            stage: "consume",
            reason: nil,
            details: nil
        )
        logAppNotificationTapEvent(action: "notification_tap_consumed", metadata: consumedMetadata)
    }

    @MainActor
    private func runCloudSyncPollingLoop() async {
        guard self.scenePhase == .active else {
            return
        }
        guard self.store.isCloudSyncBlocked == false else {
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
            guard self.store.isCloudSyncBlocked == false else {
                return
            }

            await self.store.syncCloudIfLinked(
                trigger: CloudSyncTrigger(
                    source: .polling,
                    now: Date(),
                    extendsFastPolling: false,
                    allowsVisibleChangeBanner: true,
                    surfacesGlobalErrorMessage: false
                )
            )
        }
    }
}

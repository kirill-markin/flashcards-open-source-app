import SwiftUI
import UIKit

private let flashcardsUITestResetStateEnvironmentKey: String = "FLASHCARDS_UI_TEST_RESET_STATE"
private let flashcardsUITestSelectedTabEnvironmentKey: String = "FLASHCARDS_UI_TEST_SELECTED_TAB"
private let flashcardsUITestAppNotificationTapTypeEnvironmentKey: String = "FLASHCARDS_UI_TEST_APP_NOTIFICATION_TAP_TYPE"
private let flashcardsUITestAIHandoffCardEnvironmentKey: String = "FLASHCARDS_UI_TEST_AI_HANDOFF_CARD"
@MainActor
private var hasConsumedFlashcardsUITestAppNotificationTapEnvironment: Bool = false

private enum FlashcardsUITestSelectedTab: String {
    case review
    case progress
    case ai
    case cards
    case settings

    var appTab: AppTab {
        switch self {
        case .review:
            return .review
        case .progress:
            return .progress
        case .ai:
            return .ai
        case .cards:
            return .cards
        case .settings:
            return .settings
        }
    }
}

private enum FlashcardsUITestAIHandoffCard: String {
    case firstCard = "first_card"
}

private struct CloudSyncPollingTaskID: Hashable {
    let isSceneActive: Bool
    let selectedTab: AppTab
    let fastPollingUntil: Date?
    let isSyncBlocked: Bool
}

private struct ProgressContextWatcherTaskID: Hashable {
    let isSceneActive: Bool
    let refreshToken: Int
}

private func nextProgressContextRolloverDate(now: Date) -> Date {
    let calendar = Calendar.autoupdatingCurrent
    let startOfCurrentDay = calendar.startOfDay(for: now)
    guard let nextDay = calendar.date(byAdding: .day, value: 1, to: startOfCurrentDay) else {
        preconditionFailure("Expected to compute the next local day boundary.")
    }

    return nextDay
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

@MainActor
private func makeFlashcardsUITestAIChatPresentationRequest(
    processInfo: ProcessInfo,
    store: FlashcardsStore
) -> AIChatPresentationRequest? {
    guard let rawValue = processInfo.environment[flashcardsUITestAIHandoffCardEnvironmentKey],
          let handoffCard = FlashcardsUITestAIHandoffCard(rawValue: rawValue) else {
        return nil
    }

    switch handoffCard {
    case .firstCard:
        guard let card = store.cards.first else {
            return nil
        }

        return .attachCard(makeAIChatCardReference(card: card))
    }
}

@main
struct FlashcardsApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @UIApplicationDelegateAdaptor(ReviewNotificationsAppDelegate.self) private var reviewNotificationsAppDelegate
    @State private var store: FlashcardsStore
    @State private var navigation: AppNavigationModel
    @State private var progressContextWatcherRefreshToken: Int

    @MainActor
    init() {
        let store = FlashcardsStore()
        let processInfo = ProcessInfo.processInfo
        let selectedTab = processInfo.environment[flashcardsUITestSelectedTabEnvironmentKey]
            .flatMap(FlashcardsUITestSelectedTab.init(rawValue:))
            .map(\.appTab) ?? .review
        if let resetStateRawValue = processInfo.environment[flashcardsUITestResetStateEnvironmentKey],
           let resetState = FlashcardsUITestResetState(rawValue: resetStateRawValue) {
            do {
                try store.applyUITestResetState(resetState: resetState)
            } catch {
                store.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
        let aiChatPresentationRequest = makeFlashcardsUITestAIChatPresentationRequest(
            processInfo: processInfo,
            store: store
        )
        if let request = consumeFlashcardsUITestAppNotificationTapRequest(processInfo: processInfo) {
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

        store.prepareVisibleTabForPresentation(tab: selectedTab, now: Date())

        _store = State(initialValue: store)
        _navigation = State(
            initialValue: AppNavigationModel(
                selectedTab: selectedTab,
                settingsPath: [],
                cardsPresentationRequest: nil,
                aiChatPresentationRequest: aiChatPresentationRequest
            )
        )
        _progressContextWatcherRefreshToken = State(initialValue: 0)
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
                    self.refreshProgressContext(now: now, restartWatcher: false)
                    store.triggerCloudSyncIfLinked(
                        trigger: CloudSyncTrigger(
                            source: .appLaunch,
                            now: now,
                            extendsFastPolling: usesFastCloudSyncPolling(tab: navigation.selectedTab),
                            allowsVisibleChangeBanner: true,
                            surfacesGlobalErrorMessage: false
                        )
                    )
                    store.reconcileReviewNotifications(trigger: .appActive, now: now)
                    store.reconcileStrictReminders(trigger: .appActive, now: now)
                }
                .onChange(of: scenePhase) { _, nextPhase in
                    if nextPhase == .active {
                        let now = Date()
                        self.refreshProgressContext(now: now, restartWatcher: true)
                        store.triggerCloudSyncIfLinked(
                            trigger: CloudSyncTrigger(
                                source: .appForeground,
                                now: now,
                                extendsFastPolling: usesFastCloudSyncPolling(tab: navigation.selectedTab),
                                allowsVisibleChangeBanner: true,
                                surfacesGlobalErrorMessage: false
                            )
                        )
                        store.reconcileReviewNotifications(trigger: .appActive, now: now)
                        store.reconcileStrictReminders(trigger: .appActive, now: now)
                    } else if nextPhase == .background || nextPhase == .inactive {
                        store.reconcileReviewNotifications(trigger: .appBackground, now: Date())
                        store.reconcileStrictReminders(trigger: .appBackground, now: Date())
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged)) { _ in
                    self.handleProgressContextSystemChange()
                }
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.significantTimeChangeNotification)) { _ in
                    self.handleProgressContextSystemChange()
                }
                .onReceive(NotificationCenter.default.publisher(for: .NSSystemTimeZoneDidChange)) { _ in
                    self.handleProgressContextSystemChange()
                }
                .task(id: self.isAppNotificationTapConsumptionReady) {
                    await self.consumePendingAppNotificationTapIfNeeded()
                }
                .task(id: self.progressContextWatcherTaskID) {
                    await self.runProgressContextWatcherLoop()
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

    private var progressContextWatcherTaskID: ProgressContextWatcherTaskID {
        ProgressContextWatcherTaskID(
            isSceneActive: self.scenePhase == .active,
            refreshToken: self.progressContextWatcherRefreshToken
        )
    }

    @MainActor
    private func refreshProgressContext(now: Date, restartWatcher: Bool) {
        self.store.updateCurrentVisibleTab(tab: self.navigation.selectedTab)
        self.store.handleProgressContextDidChange(now: now)
        if restartWatcher {
            self.progressContextWatcherRefreshToken = self.progressContextWatcherRefreshToken &+ 1
        }
    }

    @MainActor
    private func handleProgressContextSystemChange() {
        guard self.scenePhase == .active else {
            return
        }

        self.refreshProgressContext(now: Date(), restartWatcher: true)
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

    @MainActor
    private func runProgressContextWatcherLoop() async {
        guard self.scenePhase == .active else {
            return
        }

        while Task.isCancelled == false && self.scenePhase == .active {
            let now = Date()
            let nextRollover = nextProgressContextRolloverDate(now: now)
            let intervalSeconds = nextRollover.timeIntervalSince(now)
            if intervalSeconds <= 0 {
                self.refreshProgressContext(now: now, restartWatcher: false)
                await Task.yield()
                continue
            }

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

            self.refreshProgressContext(now: Date(), restartWatcher: false)
        }
    }
}

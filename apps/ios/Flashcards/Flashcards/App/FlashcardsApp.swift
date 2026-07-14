import SwiftUI
import UIKit

private struct CloudSyncPollingTaskID: Hashable {
    let isStartupReady: Bool
    let isSceneActive: Bool
    let isRecoveryGateActive: Bool
    let selectedTab: AppTab
    let fastPollingUntil: Date?
    let isSyncBlocked: Bool
}

private struct ProgressContextWatcherTaskID: Hashable {
    let isStartupReady: Bool
    let isSceneActive: Bool
    let isRecoveryGateActive: Bool
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

@main
struct FlashcardsApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @UIApplicationDelegateAdaptor(ReviewNotificationsAppDelegate.self) private var reviewNotificationsAppDelegate
    @State private var store: FlashcardsStore
    @State private var navigation: AppNavigationModel
    @State private var progressContextWatcherRefreshToken: Int
    @State private var uiTestLaunchScenario: FlashcardsUITestLaunchScenario?
    @State private var uiTestAIHandoffCard: FlashcardsUITestAIHandoffCard?
    @State private var hasRunInitialStartup: Bool
    @State private var isStartupReadyForBackgroundWork: Bool
    @State private var isLowPowerModeEnabled: Bool

    @MainActor
    init() {
        FlashcardsObservability.configure(bundle: .main, processInfo: ProcessInfo.processInfo)
        logAppLifecycleBreadcrumb(
            action: .appInitConfigured,
            store: nil,
            stage: "app_init",
            scenePhase: nil,
            selectedTab: nil,
            isStartupReady: false,
            isRecoveryGateActive: nil,
            messageSummary: nil
        )
        let store = FlashcardsStore()
        let processInfo = ProcessInfo.processInfo
        let selectedTab = processInfo.environment[flashcardsUITestSelectedTabEnvironmentKey]
            .flatMap(FlashcardsUITestSelectedTab.init(rawValue:))
            .map(\.appTab) ?? .review
        let launchScenario = processInfo.environment[flashcardsUITestLaunchScenarioEnvironmentKey]
            .flatMap(FlashcardsUITestLaunchScenario.init(rawValue:))
        let aiHandoffCard = makeFlashcardsUITestAIHandoffCard(processInfo: processInfo)
        logAppLifecycleBreadcrumb(
            action: .appStoreInitialized,
            store: store,
            stage: "store_init",
            scenePhase: nil,
            selectedTab: selectedTab,
            isStartupReady: false,
            isRecoveryGateActive: store.cloudCredentialRecoveryState != nil,
            messageSummary: nil
        )
        if let launchScenario {
            store.uiTestLaunchPreparationStatus = .running(launchScenario: launchScenario)
        }
        if let request = consumeFlashcardsUITestAppNotificationTapRequest(
            processInfo: processInfo,
            workspaceId: store.workspace?.workspaceId
        ) {
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

        if store.cloudCredentialRecoveryState == nil {
            logAppLifecycleBreadcrumb(
                action: .visibleTabPrepareStart,
                store: store,
                stage: "visible_tab_prepare",
                scenePhase: nil,
                selectedTab: selectedTab,
                isStartupReady: false,
                isRecoveryGateActive: false,
                messageSummary: nil
            )
            prepareVisibleTabForPresentationWithBreadcrumb(
                store: store,
                selectedTab: selectedTab,
                previousTab: nil,
                scenePhase: nil,
                isStartupReady: false,
                isRecoveryGateActive: false,
                now: Date()
            )
            logAppLifecycleBreadcrumb(
                action: .visibleTabPrepareSuccess,
                store: store,
                stage: "visible_tab_prepare",
                scenePhase: nil,
                selectedTab: selectedTab,
                isStartupReady: false,
                isRecoveryGateActive: false,
                messageSummary: nil
            )
        }

        _store = State(initialValue: store)
        _navigation = State(
            initialValue: AppNavigationModel(
                selectedTab: selectedTab,
                settingsPath: [],
                cardsPresentationRequest: nil,
                aiChatPresentationRequest: nil,
                progressPresentationRequest: nil
            )
        )
        _progressContextWatcherRefreshToken = State(initialValue: 0)
        _uiTestLaunchScenario = State(initialValue: launchScenario)
        _uiTestAIHandoffCard = State(initialValue: aiHandoffCard)
        _hasRunInitialStartup = State(initialValue: false)
        _isStartupReadyForBackgroundWork = State(initialValue: false)
        _isLowPowerModeEnabled = State(initialValue: processInfo.isLowPowerModeEnabled)
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(store)
                .environment(navigation)
                .environment(\.isLowPowerModeEnabled, self.isLowPowerModeEnabled)
                .task(id: self.isCloudCredentialRecoveryGateActive) {
                    await self.runInitialAppStartupIfNeeded()
                }
                .onChange(of: scenePhase) { _, nextPhase in
                    if nextPhase == .active {
                        self.refreshLowPowerModeState()
                    }
                    logAppLifecycleBreadcrumb(
                        action: .scenePhaseChanged,
                        store: store,
                        stage: "scene_phase",
                        scenePhase: nextPhase,
                        selectedTab: navigation.selectedTab,
                        isStartupReady: self.isStartupReadyForBackgroundWork,
                        isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
                        messageSummary: nil
                    )
                    guard self.isStartupReadyForBackgroundWork else {
                        return
                    }
                    guard self.isCloudCredentialRecoveryGateActive == false else {
                        return
                    }

                    if nextPhase == .active {
                        let now = Date()
                        self.refreshProgressContext(now: now, restartWatcher: true)
                        store.triggerCloudSyncIfLinked(
                            trigger: CloudSyncTrigger(
                                source: .appForeground,
                                now: now,
                                extendsFastPolling: usesFastCloudSyncPolling(tab: navigation.selectedTab),
                                allowsVisibleChangeBanner: true,
                                surfacesGlobalErrorMessage: false,
                                capturesTechnicalFailures: false
                            )
                        )
                        store.triggerCloudAccountContextRefreshIfActive(surfacesGlobalErrorMessage: false)
                        store.reconcileReviewNotifications(trigger: .appActive, now: now)
                        store.reconcileStrictReminders(trigger: .appActive, now: now)
                    } else if nextPhase == .background {
                        let now = Date()
                        runAppBackgroundTask(name: "AppBackgroundNotificationReconcile") {
                            await store.reconcileAppBackgroundNotifications(now: now)
                        }
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged)) { _ in
                    self.handleProgressContextSystemChange()
                }
                .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in
                    self.refreshLowPowerModeState()
                }
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.significantTimeChangeNotification)) { _ in
                    self.handleProgressContextSystemChange()
                }
                .onReceive(NotificationCenter.default.publisher(for: .NSSystemTimeZoneDidChange)) { _ in
                    self.handleProgressContextSystemChange()
                }
                .onReceive(NotificationCenter.default.publisher(for: reviewReminderAttentionStateDidChangeNotificationName)) { _ in
                    let now = Date()
                    self.store.reloadReviewReminderAttentionState()
                    self.store.reconcileReviewReminderAttentionAfterReviewLogs(now: now)
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
                .technicalErrorSheet(store: self.store)
        }
    }

    private var cloudSyncPollingTaskID: CloudSyncPollingTaskID {
        CloudSyncPollingTaskID(
            isStartupReady: self.isStartupReadyForBackgroundWork,
            isSceneActive: self.scenePhase == .active,
            isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
            selectedTab: self.navigation.selectedTab,
            fastPollingUntil: self.store.cloudSyncFastPollingUntil,
            isSyncBlocked: self.store.isCloudSyncBlocked
        )
    }

    private var isAppNotificationTapConsumptionReady: Bool {
        self.isStartupReadyForBackgroundWork
            && self.scenePhase == .active
            && self.isCloudCredentialRecoveryGateActive == false
    }

    private var progressContextWatcherTaskID: ProgressContextWatcherTaskID {
        ProgressContextWatcherTaskID(
            isStartupReady: self.isStartupReadyForBackgroundWork,
            isSceneActive: self.scenePhase == .active,
            isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
            refreshToken: self.progressContextWatcherRefreshToken
        )
    }

    private var isCloudCredentialRecoveryGateActive: Bool {
        self.store.cloudCredentialRecoveryState != nil
    }

    @MainActor
    private func refreshLowPowerModeState() {
        self.isLowPowerModeEnabled = ProcessInfo.processInfo.isLowPowerModeEnabled
    }

    @MainActor
    private func runInitialAppStartupIfNeeded() async {
        guard self.hasRunInitialStartup == false else {
            return
        }

        logAppLifecycleBreadcrumb(
            action: .initialStartupStart,
            store: self.store,
            stage: "initial_startup",
            scenePhase: self.scenePhase,
            selectedTab: self.navigation.selectedTab,
            isStartupReady: self.isStartupReadyForBackgroundWork,
            isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
            messageSummary: nil
        )
        if self.isCloudCredentialRecoveryGateActive {
            if let launchScenario = self.uiTestLaunchScenario {
                self.store.uiTestLaunchPreparationStatus = .failed(
                    launchScenario: launchScenario,
                    message: "UI test launch scenario is blocked while cloud credential recovery is active."
                )
                self.uiTestLaunchScenario = nil
            }
            self.uiTestAIHandoffCard = nil
            return
        }

        let initialStartupStartedAt = Date()
        logAppForegroundOperationBreadcrumb(
            action: .initialStartup,
            phase: .start,
            store: self.store,
            selectedTab: self.navigation.selectedTab,
            previousTab: nil,
            scenePhase: self.scenePhase,
            isStartupReady: self.isStartupReadyForBackgroundWork,
            isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
            startedAt: nil,
            finishedAt: nil,
            error: nil
        )
        self.hasRunInitialStartup = true
        self.isStartupReadyForBackgroundWork = false

        do {
            try await self.runUITestLaunchScenarioIfNeeded()
            try self.applyUITestAIHandoffIfNeeded()

            self.store.updateCurrentVisibleTab(tab: self.navigation.selectedTab)
            await self.store.resumePendingAccountDeletionIfNeeded()

            let now = Date()
            logAppLifecycleBreadcrumb(
                action: .progressContextRefresh,
                store: self.store,
                stage: "initial_startup",
                scenePhase: self.scenePhase,
                selectedTab: self.navigation.selectedTab,
                isStartupReady: self.isStartupReadyForBackgroundWork,
                isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
                messageSummary: nil
            )
            let progressContextRefreshStartedAt = Date()
            logAppForegroundOperationBreadcrumb(
                action: .initialProgressContextRefresh,
                phase: .start,
                store: self.store,
                selectedTab: self.navigation.selectedTab,
                previousTab: nil,
                scenePhase: self.scenePhase,
                isStartupReady: self.isStartupReadyForBackgroundWork,
                isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
                startedAt: nil,
                finishedAt: nil,
                error: nil
            )
            self.refreshProgressContext(now: now, restartWatcher: false)
            logAppForegroundOperationBreadcrumb(
                action: .initialProgressContextRefresh,
                phase: .success,
                store: self.store,
                selectedTab: self.navigation.selectedTab,
                previousTab: nil,
                scenePhase: self.scenePhase,
                isStartupReady: self.isStartupReadyForBackgroundWork,
                isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
                startedAt: progressContextRefreshStartedAt,
                finishedAt: Date(),
                error: nil
            )
            if self.uiTestLaunchScenario == nil {
                logAppLifecycleBreadcrumb(
                    action: .launchCloudSyncTriggered,
                    store: self.store,
                    stage: "initial_startup",
                    scenePhase: self.scenePhase,
                    selectedTab: self.navigation.selectedTab,
                    isStartupReady: self.isStartupReadyForBackgroundWork,
                    isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
                    messageSummary: nil
                )
                self.store.triggerCloudSyncIfLinked(
                    trigger: CloudSyncTrigger(
                        source: .appLaunch,
                        now: now,
                        extendsFastPolling: usesFastCloudSyncPolling(tab: self.navigation.selectedTab),
                        allowsVisibleChangeBanner: true,
                        surfacesGlobalErrorMessage: false,
                        capturesTechnicalFailures: false
                    )
                )
                self.store.triggerCloudAccountContextRefreshIfActive(surfacesGlobalErrorMessage: false)
            }
            logAppLifecycleBreadcrumb(
                action: .launchNotificationReconcileTriggered,
                store: self.store,
                stage: "initial_startup",
                scenePhase: self.scenePhase,
                selectedTab: self.navigation.selectedTab,
                isStartupReady: self.isStartupReadyForBackgroundWork,
                isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
                messageSummary: nil
            )
            let notificationReconcileStartedAt = Date()
            logAppForegroundOperationBreadcrumb(
                action: .initialNotificationReconcile,
                phase: .start,
                store: self.store,
                selectedTab: self.navigation.selectedTab,
                previousTab: nil,
                scenePhase: self.scenePhase,
                isStartupReady: self.isStartupReadyForBackgroundWork,
                isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
                startedAt: nil,
                finishedAt: nil,
                error: nil
            )
            self.store.reconcileReviewNotifications(trigger: .appActive, now: now)
            self.store.reconcileStrictReminders(trigger: .appActive, now: now)
            logAppForegroundOperationBreadcrumb(
                action: .initialNotificationReconcile,
                phase: .success,
                store: self.store,
                selectedTab: self.navigation.selectedTab,
                previousTab: nil,
                scenePhase: self.scenePhase,
                isStartupReady: self.isStartupReadyForBackgroundWork,
                isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
                startedAt: notificationReconcileStartedAt,
                finishedAt: Date(),
                error: nil
            )

            if let launchScenario = self.uiTestLaunchScenario {
                self.store.uiTestLaunchPreparationStatus = .ready(launchScenario: launchScenario)
            }
            self.isStartupReadyForBackgroundWork = true
            logAppLifecycleBreadcrumb(
                action: .initialStartupReady,
                store: self.store,
                stage: "initial_startup",
                scenePhase: self.scenePhase,
                selectedTab: self.navigation.selectedTab,
                isStartupReady: self.isStartupReadyForBackgroundWork,
                isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
                messageSummary: nil
            )
            logAppForegroundOperationBreadcrumb(
                action: .initialStartup,
                phase: .success,
                store: self.store,
                selectedTab: self.navigation.selectedTab,
                previousTab: nil,
                scenePhase: self.scenePhase,
                isStartupReady: self.isStartupReadyForBackgroundWork,
                isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
                startedAt: initialStartupStartedAt,
                finishedAt: Date(),
                error: nil
            )
        } catch {
            self.store.globalErrorMessage = Flashcards.errorMessage(error: error)
            logAppLifecycleBreadcrumb(
                action: .initialStartupFailed,
                store: self.store,
                stage: "initial_startup",
                scenePhase: self.scenePhase,
                selectedTab: self.navigation.selectedTab,
                isStartupReady: self.isStartupReadyForBackgroundWork,
                isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
                messageSummary: Flashcards.errorMessage(error: error)
            )
            logAppForegroundOperationBreadcrumb(
                action: .initialStartup,
                phase: .failure,
                store: self.store,
                selectedTab: self.navigation.selectedTab,
                previousTab: nil,
                scenePhase: self.scenePhase,
                isStartupReady: self.isStartupReadyForBackgroundWork,
                isRecoveryGateActive: self.isCloudCredentialRecoveryGateActive,
                startedAt: initialStartupStartedAt,
                finishedAt: Date(),
                error: error
            )
            if let launchScenario = self.uiTestLaunchScenario {
                self.store.uiTestLaunchPreparationStatus = .failed(
                    launchScenario: launchScenario,
                    message: Flashcards.errorMessage(error: error)
                )
            }
        }
    }

    @MainActor
    private func runUITestLaunchScenarioIfNeeded() async throws {
        guard let launchScenario = self.uiTestLaunchScenario else {
            return
        }

        try await self.store.executeUITestLaunchScenario(
            launchScenario: launchScenario,
            processInfo: ProcessInfo.processInfo
        )
    }

    @MainActor
    private func applyUITestAIHandoffIfNeeded() throws {
        guard let handoffCard = self.uiTestAIHandoffCard else {
            return
        }

        self.navigation.aiChatPresentationRequest = try makeFlashcardsUITestAIChatPresentationRequest(
            handoffCard: handoffCard,
            store: self.store
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
        guard self.isStartupReadyForBackgroundWork,
              self.scenePhase == .active,
              self.isCloudCredentialRecoveryGateActive == false else {
            return
        }

        self.refreshProgressContext(now: Date(), restartWatcher: true)
    }

    @MainActor
    private func consumePendingAppNotificationTapIfNeeded() async {
        guard self.isStartupReadyForBackgroundWork,
              self.scenePhase == .active,
              self.isCloudCredentialRecoveryGateActive == false else {
            return
        }

        await Task.yield()
        guard self.isStartupReadyForBackgroundWork,
              self.scenePhase == .active,
              self.isCloudCredentialRecoveryGateActive == false else {
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

        if let fallback = appNotificationTapWorkspaceOwnershipFallback(
            request: envelope.request,
            currentWorkspaceId: self.store.workspace?.workspaceId
        ) {
            if case .openReviewReminder(let workspaceId) = envelope.request {
                self.store.clearReviewReminderAttention(workspaceId: workspaceId)
            }
            let droppedMetadata = makeAppNotificationTapLogMetadata(
                request: envelope.request,
                source: envelope.source,
                appState: nil,
                scenePhase: "active",
                receivedAtMillis: envelope.receivedAtMillis,
                stage: fallback.stage,
                reason: fallback.reason,
                details: fallback.details
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
        guard self.isStartupReadyForBackgroundWork,
              self.scenePhase == .active,
              self.isCloudCredentialRecoveryGateActive == false else {
            return
        }
        guard self.store.isCloudSyncBlocked == false else {
            return
        }

        while Task.isCancelled == false
            && self.isStartupReadyForBackgroundWork
            && self.scenePhase == .active
            && self.isCloudCredentialRecoveryGateActive == false {
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
                FlashcardsObservability.captureSilentFailure(
                    error: error,
                    scope: IOSObservationScope(
                        feature: .cloudSync,
                        userId: self.store.cloudSettings?.linkedUserId,
                        workspaceId: self.store.workspace?.workspaceId,
                        requestId: nil,
                        clientRequestId: nil,
                        sessionId: nil,
                        runId: nil,
                        cloudState: self.store.cloudSettings?.cloudState,
                        configurationMode: try? self.store.currentCloudServiceConfiguration().mode
                    ),
                    action: "cloud_sync_polling_loop_sleep",
                    stage: "sleep",
                    statusCode: nil,
                    backendCode: nil,
                    requestId: nil
                )
                return
            }

            guard Task.isCancelled == false,
                  self.isStartupReadyForBackgroundWork,
                  self.scenePhase == .active,
                  self.isCloudCredentialRecoveryGateActive == false else {
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
                    surfacesGlobalErrorMessage: false,
                    capturesTechnicalFailures: false
                )
            )
        }
    }

    @MainActor
    private func runProgressContextWatcherLoop() async {
        guard self.isStartupReadyForBackgroundWork,
              self.scenePhase == .active,
              self.isCloudCredentialRecoveryGateActive == false else {
            return
        }

        while Task.isCancelled == false
            && self.isStartupReadyForBackgroundWork
            && self.scenePhase == .active
            && self.isCloudCredentialRecoveryGateActive == false {
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
                FlashcardsObservability.captureSilentFailure(
                    error: error,
                    scope: IOSObservationScope(
                        feature: .progress,
                        userId: self.store.cloudSettings?.linkedUserId,
                        workspaceId: self.store.workspace?.workspaceId,
                        requestId: nil,
                        clientRequestId: nil,
                        sessionId: nil,
                        runId: nil,
                        cloudState: self.store.cloudSettings?.cloudState,
                        configurationMode: try? self.store.currentCloudServiceConfiguration().mode
                    ),
                    action: "progress_context_watcher_sleep",
                    stage: "sleep",
                    statusCode: nil,
                    backendCode: nil,
                    requestId: nil
                )
                return
            }

            guard Task.isCancelled == false,
                  self.isStartupReadyForBackgroundWork,
                  self.scenePhase == .active,
                  self.isCloudCredentialRecoveryGateActive == false else {
                return
            }

            self.refreshProgressContext(now: Date(), restartWatcher: false)
        }
    }
}

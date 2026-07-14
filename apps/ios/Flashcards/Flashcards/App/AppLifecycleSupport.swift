import SwiftUI
import UIKit

@MainActor
func runAppBackgroundTask(
    name: String,
    operation: @escaping @MainActor () async -> Void
) {
    var backgroundTaskIdentifier: UIBackgroundTaskIdentifier = .invalid
    var operationTask: Task<Void, Never>?
    var hasBackgroundTaskExpired: Bool = false

    func endBackgroundTaskIfNeeded() {
        let identifier = backgroundTaskIdentifier
        backgroundTaskIdentifier = .invalid
        guard identifier != .invalid else {
            return
        }

        UIApplication.shared.endBackgroundTask(identifier)
    }

    backgroundTaskIdentifier = UIApplication.shared.beginBackgroundTask(withName: name) {
        hasBackgroundTaskExpired = true
        operationTask?.cancel()
        endBackgroundTaskIfNeeded()
    }

    operationTask = Task { @MainActor in
        defer {
            endBackgroundTaskIfNeeded()
        }
        guard hasBackgroundTaskExpired == false else {
            return
        }

        await operation()
    }
}

private func appForegroundOperationTabName(tab: AppTab) -> String {
    switch tab {
    case .review:
        return "review"
    case .progress:
        return "progress"
    case .ai:
        return "ai"
    case .cards:
        return "cards"
    case .settings:
        return "settings"
    }
}

private func appLifecycleTabName(tab: AppTab) -> String {
    appForegroundOperationTabName(tab: tab)
}

private func appLifecycleScenePhaseName(scenePhase: ScenePhase) -> String {
    switch scenePhase {
    case .active:
        return "active"
    case .inactive:
        return "inactive"
    case .background:
        return "background"
    @unknown default:
        return "unknown"
    }
}

private func appForegroundOperationSelectionName(selectedTab: AppTab, previousTab: AppTab?) -> String {
    let selectedTabName = appForegroundOperationTabName(tab: selectedTab)
    guard let previousTab,
          previousTab != selectedTab else {
        return selectedTabName
    }

    return "\(appForegroundOperationTabName(tab: previousTab))->\(selectedTabName)"
}

private func appForegroundOperationDurationMilliseconds(startedAt: Date, finishedAt: Date) -> Int {
    max(0, Int((finishedAt.timeIntervalSince(startedAt) * 1_000).rounded()))
}

@MainActor
private func makeAppLifecycleScope(store: FlashcardsStore?) -> IOSObservationScope {
    let configurationMode: CloudServiceConfigurationMode?
    if let store {
        configurationMode = try? store.currentCloudServiceConfiguration().mode
    } else {
        configurationMode = nil
    }

    return IOSObservationScope(
        feature: .appStartup,
        userId: store?.cloudSettings?.linkedUserId,
        workspaceId: store?.workspace?.workspaceId,
        requestId: nil,
        clientRequestId: nil,
        sessionId: nil,
        runId: nil,
        cloudState: store?.cloudSettings?.cloudState,
        configurationMode: configurationMode
    )
}

@MainActor
private func makeAppForegroundOperationScope(store: FlashcardsStore) -> IOSObservationScope {
    IOSObservationScope(
        feature: .appStartup,
        userId: store.cloudSettings?.linkedUserId,
        workspaceId: store.workspace?.workspaceId,
        requestId: nil,
        clientRequestId: nil,
        sessionId: nil,
        runId: nil,
        cloudState: store.cloudSettings?.cloudState,
        configurationMode: try? store.currentCloudServiceConfiguration().mode
    )
}

@MainActor
func logAppForegroundOperationBreadcrumb(
    action: ForegroundOperationAction,
    phase: ForegroundOperationPhase,
    store: FlashcardsStore,
    selectedTab: AppTab,
    previousTab: AppTab?,
    scenePhase: ScenePhase?,
    isStartupReady: Bool?,
    isRecoveryGateActive: Bool?,
    startedAt: Date?,
    finishedAt: Date?,
    error: Error?
) {
    let scenePhaseName: String?
    if let scenePhase {
        scenePhaseName = appLifecycleScenePhaseName(scenePhase: scenePhase)
    } else {
        scenePhaseName = nil
    }

    let durationMilliseconds: Int?
    if let startedAt,
       let finishedAt {
        durationMilliseconds = appForegroundOperationDurationMilliseconds(startedAt: startedAt, finishedAt: finishedAt)
    } else {
        durationMilliseconds = nil
    }

    FlashcardsObservability.addBreadcrumb(
        .foregroundOperation(
            ForegroundOperationObservation(
                scope: makeAppForegroundOperationScope(store: store),
                action: action,
                phase: phase,
                durationMilliseconds: durationMilliseconds,
                selectedTab: appForegroundOperationSelectionName(selectedTab: selectedTab, previousTab: previousTab),
                scenePhase: scenePhaseName,
                isStartupReady: isStartupReady,
                isRecoveryGateActive: isRecoveryGateActive,
                cardCount: store.cards.count,
                deckCount: store.decks.count,
                pendingOutboxOperationCount: nil,
                reviewQueueCount: store.reviewQueue.count,
                reviewDueCount: store.homeSnapshot.dueCount,
                cloudSyncBlocked: store.isCloudSyncBlocked,
                errorSummary: error.map { operationError in Flashcards.errorMessage(error: operationError) }
            )
        )
    )
}

@MainActor
func prepareVisibleTabForPresentationWithBreadcrumb(
    store: FlashcardsStore,
    selectedTab: AppTab,
    previousTab: AppTab?,
    scenePhase: ScenePhase?,
    isStartupReady: Bool?,
    isRecoveryGateActive: Bool?,
    now: Date
) {
    logAppForegroundOperationBreadcrumb(
        action: .visibleTabPresentation,
        phase: .start,
        store: store,
        selectedTab: selectedTab,
        previousTab: previousTab,
        scenePhase: scenePhase,
        isStartupReady: isStartupReady,
        isRecoveryGateActive: isRecoveryGateActive,
        startedAt: nil,
        finishedAt: nil,
        error: nil
    )
    store.prepareVisibleTabForPresentation(tab: selectedTab, now: now)
    logAppForegroundOperationBreadcrumb(
        action: .visibleTabPresentation,
        phase: .success,
        store: store,
        selectedTab: selectedTab,
        previousTab: previousTab,
        scenePhase: scenePhase,
        isStartupReady: isStartupReady,
        isRecoveryGateActive: isRecoveryGateActive,
        startedAt: now,
        finishedAt: Date(),
        error: nil
    )
}

@MainActor
func logAppLifecycleBreadcrumb(
    action: AppLifecycleAction,
    store: FlashcardsStore?,
    stage: String?,
    scenePhase: ScenePhase?,
    selectedTab: AppTab?,
    isStartupReady: Bool?,
    isRecoveryGateActive: Bool?,
    messageSummary: String?
) {
    let scenePhaseName: String?
    if let scenePhase {
        scenePhaseName = appLifecycleScenePhaseName(scenePhase: scenePhase)
    } else {
        scenePhaseName = nil
    }

    let selectedTabName: String?
    if let selectedTab {
        selectedTabName = appLifecycleTabName(tab: selectedTab)
    } else {
        selectedTabName = nil
    }

    FlashcardsObservability.addBreadcrumb(
        .appLifecycle(
            AppLifecycleObservation(
                action: action,
                scope: makeAppLifecycleScope(store: store),
                stage: stage,
                scenePhase: scenePhaseName,
                selectedTab: selectedTabName,
                isStartupReady: isStartupReady,
                isRecoveryGateActive: isRecoveryGateActive,
                messageSummary: messageSummary
            )
        )
    )
}

import XCTest
@testable import Flashcards

private enum AIChatStoreTestWaitTiming {
    static let backgroundTaskTimeout: Duration = .seconds(2)
    static let taskTimeout: Duration = .seconds(3)
    static let toolRunPostSyncTaskTimeout: Duration = .seconds(5)
    static let workspaceSwitchToolRunPostSyncTimeout: Duration = .seconds(8)
    static let taskPollInterval: Duration = .milliseconds(10)
}

extension AIChatStoreTestSupport {
    @MainActor
    static func waitForBackgroundTasks(store: AIChatStore) async {
        _ = await self.waitForCondition(
            description: "AI chat background tasks to become idle",
            timeout: AIChatStoreTestWaitTiming.backgroundTaskTimeout,
            pollInterval: AIChatStoreTestWaitTiming.taskPollInterval,
            condition: {
                store.activeToolRunPostSyncTask == nil
                    && store.activeBootstrapTask == nil
                    && store.activeSendTask == nil
                    && store.activeDictationTask == nil
                    && store.activeNewSessionTask == nil
                    && store.activePersistTask == nil
                    && store.hasPendingStatePersistence() == false
            }
        )
    }

    @MainActor
    static func waitForCondition(
        description: String,
        timeout: Duration,
        pollInterval: Duration,
        condition: @escaping @MainActor () -> Bool
    ) async -> Bool {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)

        while true {
            if condition() {
                return true
            }

            if clock.now >= deadline {
                XCTFail("Timed out waiting for \(description).")
                return false
            }

            try? await Task.sleep(for: pollInterval)
        }
    }

    @MainActor
    static func waitForTaskToClear(
        description: String,
        timeout: Duration,
        pollInterval: Duration,
        taskProvider: @escaping @MainActor () -> Task<Void, Never>?
    ) async -> Bool {
        return await self.waitForCondition(
            description: "\(description) became nil",
            timeout: timeout,
            pollInterval: pollInterval,
            condition: {
                taskProvider() == nil
            }
        )
    }

    @MainActor
    static func waitForPendingStatePersistenceToDrain(store: AIChatStore) async {
        _ = await self.waitForCondition(
            description: "pending state persistence drained",
            timeout: AIChatStoreTestWaitTiming.taskTimeout,
            pollInterval: AIChatStoreTestWaitTiming.taskPollInterval,
            condition: {
                store.activePersistTask == nil && store.hasPendingStatePersistence() == false
            }
        )
    }

    @MainActor
    static func waitForToolRunPostSyncToSettle(store: AIChatStore) async {
        let didSettle = await self.waitForTaskToClear(
            description: "activeToolRunPostSyncTask",
            timeout: AIChatStoreTestWaitTiming.toolRunPostSyncTaskTimeout,
            pollInterval: AIChatStoreTestWaitTiming.taskPollInterval,
            taskProvider: {
                store.activeToolRunPostSyncTask
            }
        )
        if didSettle == false {
            return
        }
        await self.waitForPendingStatePersistenceToDrain(store: store)
    }

    @MainActor
    static func waitForToolRunPostSyncWorkspaceSwitchToSettle(
        store: AIChatStore,
        historyStore: any AIChatHistoryStoring,
        originalWorkspaceId: String,
        replacementWorkspaceId: String
    ) async {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: AIChatStoreTestWaitTiming.workspaceSwitchToolRunPostSyncTimeout)

        while true {
            let originalState = historyStore.loadState(workspaceId: originalWorkspaceId)
            let replacementState = historyStore.loadState(workspaceId: replacementWorkspaceId)
            let isSettled = store.activeToolRunPostSyncTask == nil
                && store.activePersistTask == nil
                && store.hasPendingStatePersistence() == false
                && store.chatSessionId == replacementState.chatSessionId
                && store.pendingToolRunPostSync
                && originalState.pendingToolRunPostSync == false
                && replacementState.pendingToolRunPostSync

            if isSettled {
                return
            }

            if clock.now >= deadline {
                XCTFail(
                    """
                    Timed out waiting for workspace-switch post-sync settled. \
                    activeToolRunPostSyncTask=\(store.activeToolRunPostSyncTask != nil) \
                    activePersistTask=\(store.activePersistTask != nil) \
                    hasPendingStatePersistence=\(store.hasPendingStatePersistence()) \
                    chatSessionId=\(store.chatSessionId) \
                    replacementChatSessionId=\(replacementState.chatSessionId) \
                    storePendingToolRunPostSync=\(store.pendingToolRunPostSync) \
                    originalPendingToolRunPostSync=\(originalState.pendingToolRunPostSync) \
                    replacementPendingToolRunPostSync=\(replacementState.pendingToolRunPostSync)
                    """
                )
                return
            }

            try? await Task.sleep(for: AIChatStoreTestWaitTiming.taskPollInterval)
        }
    }

    @MainActor
    static func waitForBootstrapToSettle(store: AIChatStore) async {
        _ = await self.waitForTaskToClear(
            description: "activeBootstrapTask",
            timeout: AIChatStoreTestWaitTiming.taskTimeout,
            pollInterval: AIChatStoreTestWaitTiming.taskPollInterval,
            taskProvider: {
                store.activeBootstrapTask
            }
        )
    }

    @MainActor
    static func waitForSendToSettle(store: AIChatStore) async {
        _ = await self.waitForTaskToClear(
            description: "activeSendTask",
            timeout: AIChatStoreTestWaitTiming.taskTimeout,
            pollInterval: AIChatStoreTestWaitTiming.taskPollInterval,
            taskProvider: {
                store.activeSendTask
            }
        )
    }

    @MainActor
    static func waitForDictationToSettle(store: AIChatStore) async {
        _ = await self.waitForTaskToClear(
            description: "activeDictationTask",
            timeout: AIChatStoreTestWaitTiming.taskTimeout,
            pollInterval: AIChatStoreTestWaitTiming.taskPollInterval,
            taskProvider: {
                store.activeDictationTask
            }
        )
    }

    @MainActor
    static func waitForNewSessionToSettle(store: AIChatStore) async {
        _ = await self.waitForTaskToClear(
            description: "activeNewSessionTask",
            timeout: AIChatStoreTestWaitTiming.taskTimeout,
            pollInterval: AIChatStoreTestWaitTiming.taskPollInterval,
            taskProvider: {
                store.activeNewSessionTask
            }
        )
    }
}

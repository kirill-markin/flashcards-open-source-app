import Foundation

private struct FlashcardsUITestPreservedLaunchState {
    let pendingAppNotificationTapData: Data?

    @MainActor
    init(userDefaults: UserDefaults) {
        self.pendingAppNotificationTapData = userDefaults.data(forKey: pendingAppNotificationTapUserDefaultsKey)
    }

    @MainActor
    func restore(userDefaults: UserDefaults) {
        if let pendingAppNotificationTapData = self.pendingAppNotificationTapData {
            userDefaults.set(pendingAppNotificationTapData, forKey: pendingAppNotificationTapUserDefaultsKey)
        } else {
            userDefaults.removeObject(forKey: pendingAppNotificationTapUserDefaultsKey)
        }
    }
}

private struct FlashcardsUITestLaunchCoordinator {
    let launchScenario: FlashcardsUITestLaunchScenario
    let processInfo: ProcessInfo

    @MainActor
    func execute(store: FlashcardsStore) async throws {
        let preservedLaunchState = FlashcardsUITestPreservedLaunchState(userDefaults: store.userDefaults)

        if self.launchScenario.requiresStoredGuestRemoteCleanup {
            try await store.deleteStoredGuestCloudSessionForUITestCleanupIfNeeded()
        }

        do {
            try store.resetLocalStateForCloudIdentityChange()
        } catch {
            preservedLaunchState.restore(userDefaults: store.userDefaults)
            throw error
        }

        preservedLaunchState.restore(userDefaults: store.userDefaults)
        if self.launchScenario == .marketingGuestSessionCleanup {
            return
        }
        guard self.launchScenario.requiresGuestCloudBootstrap else {
            try store.applyUITestLaunchScenarioContent(
                launchScenario: self.launchScenario,
                processInfo: self.processInfo
            )
            try store.reload(now: Date(), refreshVisibleProgress: false)
            return
        }

        let guestSession = try await store.prepareGuestCloudSessionForUITestLaunch()
        try store.applyUITestLaunchScenarioContent(
            launchScenario: self.launchScenario,
            processInfo: self.processInfo
        )
        try await store.finishCloudLink(
            linkedSession: guestSession,
            trigger: store.manualCloudSyncTrigger(now: Date())
        )
    }
}

@MainActor
extension FlashcardsStore {
    func executeUITestLaunchScenario(
        launchScenario: FlashcardsUITestLaunchScenario,
        processInfo: ProcessInfo
    ) async throws {
        let coordinator = FlashcardsUITestLaunchCoordinator(
            launchScenario: launchScenario,
            processInfo: processInfo
        )
        try await coordinator.execute(store: self)
    }
}

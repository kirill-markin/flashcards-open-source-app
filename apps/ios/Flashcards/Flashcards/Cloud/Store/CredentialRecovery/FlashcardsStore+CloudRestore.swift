import Foundation

@MainActor
extension FlashcardsStore {
    /**
     Restores a cloud session for the already-linked local workspace without
     resetting review UI state. This keeps the locally rendered card visible
     unless the sync result produces an actual review data change.
     */
    func performSameWorkspaceCloudRestore(
        linkedSession: CloudLinkedSession,
        trigger: CloudSyncTrigger
    ) async throws {
        self.syncStatus = .syncing

        do {
            self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
            let syncResult = try await self.runLinkedSync(linkedSession: linkedSession)
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date(),
                trigger: trigger
            )
            self.userDefaults.removeObject(forKey: pendingCloudServerBootstrapUserDefaultsKey)
        } catch {
            self.cloudRuntime.clearActiveCloudSessionIfMatchingStableContext(linkedSession: linkedSession)
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "failure",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            self.captureCloudSyncFailureIfNeeded(
                error: error,
                linkedSession: linkedSession,
                fallbackCloudState: self.cloudSettings?.cloudState,
                trigger: trigger,
                action: "same_workspace_cloud_restore"
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            throw error
        }
    }

    func performActiveWorkspaceCloudRestore(
        linkedSession: CloudLinkedSession,
        trigger: CloudSyncTrigger
    ) async throws {
        let database = try requireLocalDatabase(database: self.database)
        let cachedWorkspace = try database.loadCachedWorkspaces().first { workspace in
            workspace.workspaceId == linkedSession.workspaceId
        }
        let workspaceSummary = CloudWorkspaceSummary(
            workspaceId: linkedSession.workspaceId,
            name: cachedWorkspace?.name ?? "Personal",
            createdAt: cachedWorkspace?.createdAt ?? nowIsoTimestamp(),
            isSelected: true
        )

        self.cloudRuntime.cancelForWorkspaceSwitch()
        await self.prepareWorkspaceScopedStateForSwitch(nextWorkspaceId: linkedSession.workspaceId)
        try database.switchActiveWorkspace(workspace: workspaceSummary, linkedSession: linkedSession)
        self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
        try self.reload()
        try await self.performSameWorkspaceCloudRestore(linkedSession: linkedSession, trigger: trigger)
    }
}

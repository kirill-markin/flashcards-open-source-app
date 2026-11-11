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
        try self.cloudRuntime.checkSyncGeneration(self.cloudRuntime.syncGeneration)
        self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
        let syncGeneration = self.cloudRuntime.syncGeneration
        self.syncStatus = .syncing

        do {
            let refreshToken = try await self.cardMaintenanceRefreshTokenAfterReconciliation(linkedSession: linkedSession)
            try self.cloudRuntime.checkSyncGeneration(syncGeneration)
            let syncResult = try await self.runFreshLinkedSyncAfterActiveSyncSettles(linkedSession: linkedSession)
            try await self.applyCurrentLinkedSyncResult(
                syncResult: syncResult,
                linkedSession: linkedSession,
                syncGeneration: syncGeneration,
                now: Date(),
                trigger: trigger
            )
            try self.cloudRuntime.checkSyncGeneration(syncGeneration)
            try self.cloudRuntime.checkCurrentLinkedSyncSession(linkedSession: linkedSession)
            try self.finishCardMaintenanceRefresh(linkedSession: linkedSession, token: refreshToken)
            self.userDefaults.removeObject(forKey: pendingCloudServerBootstrapUserDefaultsKey)
        } catch {
            guard self.cloudRuntime.isCurrentSyncGeneration(syncGeneration) else {
                throw CancellationError()
            }
            if isRequestCancellationError(error: error) {
                self.syncStatus = .idle
                throw error
            }
            self.cloudRuntime.clearActiveCloudSessionIfMatchingStableContext(linkedSession: linkedSession)
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "failure",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            let didCapture = self.captureCloudSyncFailureIfNeeded(
                error: error,
                linkedSession: linkedSession,
                fallbackCloudState: self.cloudSettings?.cloudState,
                trigger: trigger,
                action: "same_workspace_cloud_restore"
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error, trigger: trigger)
            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            throw didCapture ? markTechnicalErrorObserved(error: error) : error
        }
    }

    func performActiveWorkspaceCloudRestore(
        linkedSession: CloudLinkedSession,
        trigger: CloudSyncTrigger
    ) async throws {
        try await self.performActiveWorkspaceCloudRestore(
            linkedSession: linkedSession,
            trigger: trigger,
            didChangeSyncGeneration: { _ in }
        )
    }

    func performActiveWorkspaceCloudRestore(
        linkedSession: CloudLinkedSession,
        trigger: CloudSyncTrigger,
        didChangeSyncGeneration: @MainActor (UUID) -> Void
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

        let transition = self.cloudRuntime.beginWorkspaceSyncTransition()
        didChangeSyncGeneration(transition)
        do {
            defer { self.cloudRuntime.endWorkspaceSyncTransition(transition) }
            try await self.prepareWorkspaceScopedStateForSwitch(
                nextWorkspaceId: linkedSession.workspaceId,
                transition: transition
            )
            try self.cloudRuntime.checkWorkspaceSyncTransition(transition)
            try database.switchActiveWorkspace(workspace: workspaceSummary, linkedSession: linkedSession)
            self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
            didChangeSyncGeneration(self.cloudRuntime.syncGeneration)
            try self.reload()
        }
        try await self.performSameWorkspaceCloudRestore(linkedSession: linkedSession, trigger: trigger)
    }
}

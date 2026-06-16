import Foundation

/*
 Keep the iOS sync runner flow aligned with:
 - apps/backend/src/sync/replication/bootstrap.ts
 - apps/backend/src/sync/replication/hotPull.ts
 - apps/backend/src/sync/replication/push.ts
 - apps/backend/src/sync/replication/reviewHistory.ts
 - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/cloudsync/sync/CloudSyncRunner.kt
 */

struct CloudSyncRunner {
    let database: LocalDatabase
    let transport: CloudSyncTransport

    init(database: LocalDatabase, transport: CloudSyncTransport) {
        self.database = database
        self.transport = transport
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        try await self.runLinkedSyncWithRecovery(linkedSession: linkedSession)
    }

    func runGuestLocalRecoveryLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        try self.markLegacyGuestLocalReviewHistoryImportIfNeeded(workspaceId: linkedSession.workspaceId)
        return try await self.runLinkedSyncWithRecovery(linkedSession: linkedSession)
    }

    private func runLinkedSyncWithRecovery(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        let cloudSettings = try self.database.loadBootstrapSnapshot().cloudSettings
        let workspaceId = linkedSession.workspaceId
        let syncBasePath = "/workspaces/\(workspaceId)/sync"
        var repairedPublicWorkspaceForkConflicts: Set<PublicWorkspaceForkRecoveryKey> = []
        var publicWorkspaceForkRepairEntityTypes: Set<SyncEntityType> = []

        while true {
            do {
                let syncResult = try await self.runLinkedSyncOnce(
                    linkedSession: linkedSession,
                    workspaceId: workspaceId,
                    installationId: cloudSettings.installationId,
                    syncBasePath: syncBasePath
                )

                guard publicWorkspaceForkRepairEntityTypes.isEmpty == false else {
                    return syncResult
                }

                return syncResult.merging(
                    self.makeLocalIdRepairSyncResult(changedEntityTypes: publicWorkspaceForkRepairEntityTypes)
                )
            } catch {
                do {
                    if let recovery = try self.repairPublicWorkspaceForkConflictIfNeeded(
                        linkedSession: linkedSession,
                        workspaceId: workspaceId,
                        error: error,
                        repairedConflicts: repairedPublicWorkspaceForkConflicts
                    ) {
                        repairedPublicWorkspaceForkConflicts.insert(recovery.key)
                        publicWorkspaceForkRepairEntityTypes.insert(recovery.entityType)
                        continue
                    }
                } catch {
                    throw self.wrapFailureAfterLocalIdRepairIfNeeded(
                        error: error,
                        changedEntityTypes: publicWorkspaceForkRepairEntityTypes
                    )
                }

                throw self.wrapFailureAfterLocalIdRepairIfNeeded(
                    error: error,
                    changedEntityTypes: publicWorkspaceForkRepairEntityTypes
                )
            }
        }
    }

    private func runLinkedSyncOnce(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        installationId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        var syncResult = try self.cleanupStaleReviewEventOutboxEntries(
            workspaceId: workspaceId,
            installationId: installationId
        )
        let initialHotStateSyncResult: InitialHotStateSyncResult?

        if try self.database.hasHydratedHotState(workspaceId: workspaceId) == false {
            let hotStateSyncResult = try await self.performInitialHotStateSync(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                installationId: installationId,
                syncBasePath: syncBasePath
            )
            syncResult = syncResult.merging(hotStateSyncResult.syncResult)
            initialHotStateSyncResult = hotStateSyncResult
        } else {
            initialHotStateSyncResult = nil
        }

        syncResult = syncResult.merging(
            try await self.pushOutboxBatches(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                installationId: installationId,
                syncBasePath: syncBasePath
            )
        )
        let hotPullResult: CloudSyncResult
        if initialHotStateSyncResult?.requiresPostPushHotHydration == true {
            hotPullResult = try await self.pullHotChangesCompletingInitialHotStateHydration(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                installationId: installationId,
                syncBasePath: syncBasePath
            )
        } else {
            hotPullResult = try await self.pullHotChanges(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                installationId: installationId,
                syncBasePath: syncBasePath
            )
        }
        syncResult = syncResult.merging(hotPullResult)
        let hasHydratedReviewHistory = try self.database.hasHydratedReviewHistory(workspaceId: workspaceId)
        let hasPendingReviewHistoryImport = try self.database.hasPendingReviewHistoryImport(workspaceId: workspaceId)
        if hasHydratedReviewHistory == false && hasPendingReviewHistoryImport {
            syncResult = syncResult.merging(
                try await self.importPendingLocalReviewHistory(
                    linkedSession: linkedSession,
                    workspaceId: workspaceId,
                    installationId: installationId,
                    syncBasePath: syncBasePath
                )
            )
        }
        syncResult = syncResult.merging(
            try await self.pullReviewHistory(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                installationId: installationId,
                syncBasePath: syncBasePath
            )
        )

        return syncResult
    }
}

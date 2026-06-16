import Foundation

struct PendingLocalHotEntityKey: Hashable {
    let entityType: SyncEntityType
    let entityId: String
}

extension CloudSyncRunner {
    func pullHotChangesCompletingInitialHotStateHydration(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        installationId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        let syncResult = try await self.pullHotChanges(
            linkedSession: linkedSession,
            workspaceId: workspaceId,
            installationId: installationId,
            syncBasePath: syncBasePath
        )
        try self.database.setHasHydratedHotState(
            workspaceId: workspaceId,
            hasHydratedHotState: true
        )
        return syncResult
    }

    func loadPendingLocalHotEntityKeys(workspaceId: String) throws -> Set<PendingLocalHotEntityKey> {
        let outboxEntries = try self.database.loadOutboxEntries(workspaceId: workspaceId, limit: Int.max)
        return Set(
            outboxEntries.compactMap { entry in
                self.makePendingLocalHotEntityKey(
                    entityType: entry.operation.entityType,
                    entityId: entry.operation.entityId
                )
            }
        )
    }

    func makePendingLocalHotEntityKey(
        entityType: SyncEntityType,
        entityId: String
    ) -> PendingLocalHotEntityKey? {
        switch entityType {
        case .card, .deck, .workspaceSchedulerSettings:
            return PendingLocalHotEntityKey(entityType: entityType, entityId: entityId)
        case .reviewEvent:
            return nil
        }
    }

    func pullHotChanges(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        installationId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        var afterHotChangeId = try self.database.loadLastAppliedHotChangeId(workspaceId: workspaceId)
        var appliedPullChangeCount = 0
        var reviewScheduleImpactingPullChangeCount = 0
        var changedEntityTypes = Set<SyncEntityType>()

        while true {
            let pullEnvelope: RemotePullResponseEnvelope = try await self.transport.request(
                apiBaseUrl: linkedSession.apiBaseUrl,
                authorizationHeader: linkedSession.authorization.headerValue,
                path: "\(syncBasePath)/pull",
                method: "POST",
                body: PullRequest(
                    installationId: installationId,
                    platform: "ios",
                    appVersion: self.transport.appVersion(),
                    afterHotChangeId: afterHotChangeId,
                    limit: 200
                )
            )

            for change in pullEnvelope.changes {
                let applyResult = try self.database.applySyncChange(
                    workspaceId: workspaceId,
                    change: CloudSyncMapper.makeSyncChange(workspaceId: workspaceId, change: change)
                )
                if applyResult.didApply == false {
                    continue
                }

                appliedPullChangeCount += 1
                if applyResult.reviewScheduleImpact {
                    reviewScheduleImpactingPullChangeCount += 1
                }
                changedEntityTypes.insert(change.entityType)
            }

            afterHotChangeId = pullEnvelope.nextHotChangeId
            try self.database.setLastAppliedHotChangeId(
                workspaceId: workspaceId,
                changeId: afterHotChangeId
            )

            if pullEnvelope.hasMore == false {
                return CloudSyncResult(
                    appliedPullChangeCount: appliedPullChangeCount,
                    reviewScheduleImpactingPullChangeCount: reviewScheduleImpactingPullChangeCount,
                    changedEntityTypes: changedEntityTypes,
                    localIdRepairEntityTypes: [],
                    acknowledgedOperationCount: 0,
                    acknowledgedReviewEventOperationCount: 0,
                    acknowledgedReviewScheduleImpactingOperationCount: 0,
                    cleanedUpOperationCount: 0,
                    cleanedUpReviewEventOperationCount: 0,
                    cleanedUpReviewScheduleImpactingOperationCount: 0
                )
            }
        }
    }
}

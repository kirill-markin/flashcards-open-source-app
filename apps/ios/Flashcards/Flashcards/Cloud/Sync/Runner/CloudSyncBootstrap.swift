import Foundation

struct InitialHotStateSyncResult: Hashable {
    let syncResult: CloudSyncResult
    let requiresPostPushHotHydration: Bool
}

extension CloudSyncRunner {
    /// Bootstraps the blocking mutable current state first.
    ///
    /// Every request to `\(syncBasePath)/bootstrap` must use the same explicit
    /// nullable `cursor` contract documented in `BootstrapPullRequest` above and
    /// accepted by `apps/backend/src/sync/contracts/input.ts`. Keep this flow aligned with
    /// `apps/backend/src/sync/contracts/input.ts` `syncBootstrapPullInputSchema`.
    ///
    /// If the remote workspace is empty, the local workspace becomes the source
    /// of truth through bootstrap push/import instead of replaying the entire
    /// outbox through normal sync/push.
    func performInitialHotStateSync(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        installationId: String,
        syncBasePath: String
    ) async throws -> InitialHotStateSyncResult {
        let firstPage: RemoteBootstrapPullResponseEnvelope = try await self.transport.request(
            apiBaseUrl: linkedSession.apiBaseUrl,
            authorizationHeader: linkedSession.authorization.headerValue,
            path: "\(syncBasePath)/bootstrap",
            method: "POST",
            body: BootstrapPullRequest(
                mode: "pull",
                installationId: installationId,
                platform: "ios",
                appVersion: self.transport.appVersion(),
                cursor: nil,
                limit: 200
            )
        )

        if firstPage.remoteIsEmpty {
            return InitialHotStateSyncResult(
                syncResult: try await self.bootstrapEmptyRemoteWorkspace(
                    linkedSession: linkedSession,
                    workspaceId: workspaceId,
                    installationId: installationId,
                    syncBasePath: syncBasePath
                ),
                requiresPostPushHotHydration: false
            )
        }

        return try await self.bootstrapNonEmptyRemoteWorkspace(
            firstPage: firstPage,
            linkedSession: linkedSession,
            workspaceId: workspaceId,
            installationId: installationId,
            syncBasePath: syncBasePath
        )
    }

    private func bootstrapNonEmptyRemoteWorkspace(
        firstPage: RemoteBootstrapPullResponseEnvelope,
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        installationId: String,
        syncBasePath: String
    ) async throws -> InitialHotStateSyncResult {
        var appliedPullChangeCount = 0
        var reviewScheduleImpactingPullChangeCount = 0
        var changedEntityTypes = Set<SyncEntityType>()
        var currentPage = firstPage
        var pendingLocalHotEntityKeys = Set<PendingLocalHotEntityKey>()
        var appliedBootstrapHotEntityKeys = Set<PendingLocalHotEntityKey>()
        var requiresPostPushHotHydration = false

        while true {
            let latestPendingLocalHotEntityKeys = try self.loadPendingLocalHotEntityKeys(workspaceId: workspaceId)
            if latestPendingLocalHotEntityKeys.isDisjoint(with: appliedBootstrapHotEntityKeys) == false {
                requiresPostPushHotHydration = true
            }
            pendingLocalHotEntityKeys.formUnion(latestPendingLocalHotEntityKeys)

            for entry in currentPage.entries {
                let entryKey = self.makePendingLocalHotEntityKey(
                    entityType: entry.entityType,
                    entityId: entry.entityId
                )
                if let entryKey, pendingLocalHotEntityKeys.contains(entryKey) {
                    requiresPostPushHotHydration = true
                    continue
                }

                let applyResult = try self.database.applySyncBootstrapEntry(
                    workspaceId: workspaceId,
                    entry: CloudSyncMapper.makeSyncBootstrapEntry(workspaceId: workspaceId, entry: entry)
                )
                if applyResult.didApply == false {
                    continue
                }
                if let entryKey {
                    appliedBootstrapHotEntityKeys.insert(entryKey)
                }
                appliedPullChangeCount += 1
                if applyResult.reviewScheduleImpact {
                    reviewScheduleImpactingPullChangeCount += 1
                }
                changedEntityTypes.insert(entry.entityType)
            }

            if currentPage.hasMore == false {
                if requiresPostPushHotHydration == false {
                    requiresPostPushHotHydration = try self.finalizeBootstrapHotStateIfClean(
                        workspaceId: workspaceId,
                        bootstrapHotChangeId: currentPage.bootstrapHotChangeId,
                        appliedBootstrapHotEntityKeys: appliedBootstrapHotEntityKeys
                    )
                }

                return InitialHotStateSyncResult(
                    syncResult: CloudSyncResult(
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
                    ),
                    requiresPostPushHotHydration: requiresPostPushHotHydration
                )
            }

            guard let nextCursor = currentPage.nextCursor else {
                throw LocalStoreError.database("Bootstrap cursor is missing while more bootstrap pages remain")
            }

            currentPage = try await self.transport.request(
                apiBaseUrl: linkedSession.apiBaseUrl,
                authorizationHeader: linkedSession.authorization.headerValue,
                path: "\(syncBasePath)/bootstrap",
                method: "POST",
                body: BootstrapPullRequest(
                    mode: "pull",
                    installationId: installationId,
                    platform: "ios",
                    appVersion: self.transport.appVersion(),
                    cursor: nextCursor,
                    limit: 200
                )
            )
        }
    }

    private func finalizeBootstrapHotStateIfClean(
        workspaceId: String,
        bootstrapHotChangeId: Int64,
        appliedBootstrapHotEntityKeys: Set<PendingLocalHotEntityKey>
    ) throws -> Bool {
        try self.database.core.inTransaction {
            let latestPendingLocalHotEntityKeys = try self.loadPendingLocalHotEntityKeys(workspaceId: workspaceId)
            guard latestPendingLocalHotEntityKeys.isDisjoint(with: appliedBootstrapHotEntityKeys) else {
                return true
            }

            try self.database.setLastAppliedHotChangeId(
                workspaceId: workspaceId,
                changeId: bootstrapHotChangeId
            )
            try self.database.setHasHydratedHotState(
                workspaceId: workspaceId,
                hasHydratedHotState: true
            )
            return false
        }
    }

    private func bootstrapEmptyRemoteWorkspace(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        installationId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        let bootstrapEntries = try self.database.loadHotBootstrapEntries(workspaceId: workspaceId)
        let reviewEvents = try self.database.loadReviewEvents(workspaceId: workspaceId)
        let pendingOutboxEntries = try self.database.loadOutboxEntries(workspaceId: workspaceId, limit: Int.max)
        let pendingOutboxCount = pendingOutboxEntries.count
        let pendingReviewEventOutboxCount = pendingOutboxEntries.filter { entry in
            entry.operation.entityType == .reviewEvent
        }.count
        let pendingReviewScheduleImpactingOutboxCount = pendingOutboxEntries.filter(\.reviewScheduleImpact).count

        if reviewEvents.isEmpty == false {
            try self.database.setPendingReviewHistoryImport(
                workspaceId: workspaceId,
                pendingReviewHistoryImport: true
            )
        }

        var bootstrapHotChangeId: Int64 = 0
        if bootstrapEntries.isEmpty == false {
            let response: RemoteBootstrapPushResponseEnvelope = try await self.transport.request(
                apiBaseUrl: linkedSession.apiBaseUrl,
                authorizationHeader: linkedSession.authorization.headerValue,
                path: "\(syncBasePath)/bootstrap",
                method: "POST",
                body: BootstrapPushRequest(
                    mode: "push",
                    installationId: installationId,
                    platform: "ios",
                    appVersion: self.transport.appVersion(),
                    entries: bootstrapEntries.map { entry in
                        SyncBootstrapEntryEnvelope(entry: entry)
                    }
                )
            )
            guard let responseHotChangeId = response.bootstrapHotChangeId else {
                throw LocalStoreError.validation("Bootstrap push response is missing bootstrapHotChangeId")
            }

            bootstrapHotChangeId = responseHotChangeId
        }

        try self.database.deleteAllOutboxEntries(workspaceId: workspaceId)
        try self.database.setLastAppliedHotChangeId(
            workspaceId: workspaceId,
            changeId: bootstrapHotChangeId
        )
        try self.database.setHasHydratedHotState(workspaceId: workspaceId, hasHydratedHotState: true)

        var changedEntityTypes = Set<SyncEntityType>()
        if bootstrapEntries.isEmpty == false {
            changedEntityTypes.formUnion(bootstrapEntries.map(\.entityType))
        }

        return CloudSyncResult(
            appliedPullChangeCount: 0,
            reviewScheduleImpactingPullChangeCount: 0,
            changedEntityTypes: changedEntityTypes,
            localIdRepairEntityTypes: [],
            acknowledgedOperationCount: 0,
            acknowledgedReviewEventOperationCount: 0,
            acknowledgedReviewScheduleImpactingOperationCount: 0,
            cleanedUpOperationCount: pendingOutboxCount,
            cleanedUpReviewEventOperationCount: pendingReviewEventOutboxCount,
            cleanedUpReviewScheduleImpactingOperationCount: pendingReviewScheduleImpactingOutboxCount
        )
    }
}

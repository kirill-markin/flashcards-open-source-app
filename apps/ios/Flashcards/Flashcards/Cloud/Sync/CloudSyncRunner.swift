import Foundation

/*
 Keep the iOS sync runner flow aligned with:
 - apps/backend/src/sync.ts
 - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/CloudRepositories.kt
 */

private let syncWorkspaceForkRequiredErrorCode: String = "SYNC_WORKSPACE_FORK_REQUIRED"
private let maxPublicWorkspaceForkRecoveriesPerSync: Int = 10

private struct PublicWorkspaceForkRecoveryKey: Hashable {
    let entityType: SyncEntityType
    let entityId: String
}

private struct PublicWorkspaceForkRecoveryResult: Hashable {
    let key: PublicWorkspaceForkRecoveryKey
    let entityType: SyncEntityType
}

private struct InitialHotStateSyncResult: Hashable {
    let syncResult: CloudSyncResult
    let requiresPostPushHotHydration: Bool
}

struct CloudSyncLocalIdRepairFailure: LocalizedError, @unchecked Sendable {
    let syncResult: CloudSyncResult
    let underlyingError: Error

    var errorDescription: String? {
        if let errorDescription = (self.underlyingError as? LocalizedError)?.errorDescription {
            return errorDescription
        }

        return self.underlyingError.localizedDescription
    }
}

private struct PendingLocalHotEntityKey: Hashable {
    let entityType: SyncEntityType
    let entityId: String
}

struct CloudSyncRunner {
    private let database: LocalDatabase
    private let transport: CloudSyncTransport

    init(database: LocalDatabase, transport: CloudSyncTransport) {
        self.database = database
        self.transport = transport
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
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

    private func repairPublicWorkspaceForkConflictIfNeeded(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        error: Error,
        repairedConflicts: Set<PublicWorkspaceForkRecoveryKey>
    ) throws -> PublicWorkspaceForkRecoveryResult? {
        guard linkedSession.authorization.isGuest == false else {
            return nil
        }
        guard let syncError = error as? CloudSyncError else {
            return nil
        }
        guard case .invalidResponse(let details, let statusCode) = syncError else {
            return nil
        }
        guard details.code == syncWorkspaceForkRequiredErrorCode else {
            return nil
        }
        guard let syncConflict = details.syncConflict, syncConflict.recoverable else {
            return nil
        }
        let recoveryKey = PublicWorkspaceForkRecoveryKey(
            entityType: syncConflict.entityType,
            entityId: syncConflict.entityId
        )
        guard repairedConflicts.contains(recoveryKey) == false else {
            let conflictDescription = "\(syncConflict.entityType.rawValue) \(syncConflict.entityId)"
            throw self.makePublicWorkspaceForkRecoveryBlockedError(
                details: details,
                statusCode: statusCode,
                reason: "automatic local id repair already repaired \(conflictDescription) in this sync attempt and the backend still reports the same conflict"
            )
        }
        guard repairedConflicts.count < maxPublicWorkspaceForkRecoveriesPerSync else {
            throw self.makePublicWorkspaceForkRecoveryBlockedError(
                details: details,
                statusCode: statusCode,
                reason: "automatic local id repair reached the limit of \(maxPublicWorkspaceForkRecoveriesPerSync) distinct conflicts in this sync attempt"
            )
        }

        do {
            let recovery = try self.database.repairLocalIdForPublicSyncConflict(
                workspaceId: workspaceId,
                syncConflict: syncConflict
            )
            return PublicWorkspaceForkRecoveryResult(
                key: recoveryKey,
                entityType: recovery.entityType
            )
        } catch {
            let repairErrorMessage: String = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
            throw self.makePublicWorkspaceForkRecoveryBlockedError(
                details: details,
                statusCode: statusCode,
                reason: "local id repair failed: \(repairErrorMessage)"
            )
        }
    }

    private func makePublicWorkspaceForkRecoveryBlockedError(
        details: CloudApiErrorDetails,
        statusCode: Int,
        reason: String
    ) -> CloudSyncError {
        let entityDescription: String
        if let syncConflict = details.syncConflict {
            entityDescription = "\(syncConflict.entityType.rawValue) \(syncConflict.entityId)"
        } else {
            entityDescription = "the conflicting local entity"
        }

        return .invalidResponse(
            CloudApiErrorDetails(
                message: "Cloud sync is blocked because automatic local id repair for \(entityDescription) could not complete: \(reason).",
                requestId: details.requestId,
                code: syncWorkspaceForkRequiredErrorCode,
                syncConflict: details.syncConflict
            ),
            statusCode
        )
    }

    private func makeLocalIdRepairSyncResult(changedEntityTypes: Set<SyncEntityType>) -> CloudSyncResult {
        CloudSyncResult(
            appliedPullChangeCount: 0,
            changedEntityTypes: changedEntityTypes,
            localIdRepairEntityTypes: changedEntityTypes,
            acknowledgedOperationCount: 0,
            acknowledgedReviewEventOperationCount: 0,
            cleanedUpOperationCount: 0,
            cleanedUpReviewEventOperationCount: 0
        )
    }

    private func wrapFailureAfterLocalIdRepairIfNeeded(
        error: Error,
        changedEntityTypes: Set<SyncEntityType>
    ) -> Error {
        guard changedEntityTypes.isEmpty == false else {
            return error
        }

        return CloudSyncLocalIdRepairFailure(
            syncResult: self.makeLocalIdRepairSyncResult(changedEntityTypes: changedEntityTypes),
            underlyingError: error
        )
    }

    private func cleanupStaleReviewEventOutboxEntries(
        workspaceId: String,
        installationId: String
    ) throws -> CloudSyncResult {
        let removedReviewEventCount = try self.database.deleteStaleReviewEventOutboxEntries(workspaceId: workspaceId)
        if removedReviewEventCount == 0 {
            return .noChanges
        }

        logCloudFlowPhase(
            phase: .initialPush,
            outcome: "self_heal",
            workspaceId: workspaceId,
            installationId: installationId,
            operationsCount: removedReviewEventCount
        )

        return CloudSyncResult(
            appliedPullChangeCount: 0,
            changedEntityTypes: [],
            localIdRepairEntityTypes: [],
            acknowledgedOperationCount: 0,
            acknowledgedReviewEventOperationCount: 0,
            cleanedUpOperationCount: removedReviewEventCount,
            cleanedUpReviewEventOperationCount: removedReviewEventCount
        )
    }

    /// Bootstraps the blocking mutable current state first.
    ///
    /// Every request to `\(syncBasePath)/bootstrap` must use the same explicit
    /// nullable `cursor` contract documented in `BootstrapPullRequest` above and
    /// accepted by `apps/backend/src/sync.ts`. Keep this flow aligned with
    /// `apps/backend/src/sync.ts` `syncBootstrapPullInputSchema`.
    ///
    /// If the remote workspace is empty, the local workspace becomes the source
    /// of truth through bootstrap push/import instead of replaying the entire
    /// outbox through normal sync/push.
    private func performInitialHotStateSync(
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

                try self.database.applySyncBootstrapEntry(
                    workspaceId: workspaceId,
                    entry: CloudSyncMapper.makeSyncBootstrapEntry(workspaceId: workspaceId, entry: entry)
                )
                if let entryKey {
                    appliedBootstrapHotEntityKeys.insert(entryKey)
                }
                appliedPullChangeCount += 1
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
                        changedEntityTypes: changedEntityTypes,
                        localIdRepairEntityTypes: [],
                        acknowledgedOperationCount: 0,
                        acknowledgedReviewEventOperationCount: 0,
                        cleanedUpOperationCount: 0,
                        cleanedUpReviewEventOperationCount: 0
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

    private func pullHotChangesCompletingInitialHotStateHydration(
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

        var nextReviewSequenceId: Int64 = 0
        if reviewEvents.isEmpty == false {
            var startIndex = 0
            while startIndex < reviewEvents.count {
                let endIndex = min(startIndex + 200, reviewEvents.count)
                let response: RemoteReviewHistoryImportResponseEnvelope = try await self.transport.request(
                    apiBaseUrl: linkedSession.apiBaseUrl,
                    authorizationHeader: linkedSession.authorization.headerValue,
                    path: "\(syncBasePath)/review-history/import",
                    method: "POST",
                    body: ReviewHistoryImportRequest(
                        installationId: installationId,
                        platform: "ios",
                        appVersion: self.transport.appVersion(),
                        reviewEvents: Array(reviewEvents[startIndex..<endIndex])
                    )
                )
                guard let responseReviewSequenceId = response.nextReviewSequenceId else {
                    throw LocalStoreError.validation("Review history import response is missing nextReviewSequenceId")
                }

                nextReviewSequenceId = responseReviewSequenceId
                startIndex = endIndex
            }
        }

        try self.database.deleteAllOutboxEntries(workspaceId: workspaceId)
        try self.database.setLastAppliedHotChangeId(
            workspaceId: workspaceId,
            changeId: bootstrapHotChangeId
        )
        try self.database.setLastAppliedReviewSequenceId(
            workspaceId: workspaceId,
            reviewSequenceId: nextReviewSequenceId
        )
        try self.database.setHasHydratedHotState(workspaceId: workspaceId, hasHydratedHotState: true)
        try self.database.setHasHydratedReviewHistory(
            workspaceId: workspaceId,
            hasHydratedReviewHistory: true
        )

        var changedEntityTypes = Set<SyncEntityType>()
        if bootstrapEntries.isEmpty == false {
            changedEntityTypes.formUnion(bootstrapEntries.map(\.entityType))
        }
        if reviewEvents.isEmpty == false {
            changedEntityTypes.insert(.reviewEvent)
        }

        return CloudSyncResult(
            appliedPullChangeCount: 0,
            changedEntityTypes: changedEntityTypes,
            localIdRepairEntityTypes: [],
            acknowledgedOperationCount: 0,
            acknowledgedReviewEventOperationCount: 0,
            cleanedUpOperationCount: pendingOutboxCount,
            cleanedUpReviewEventOperationCount: pendingReviewEventOutboxCount
        )
    }

    private func pushOutboxBatches(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        installationId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        var acknowledgedOperationCount = 0
        var acknowledgedReviewEventOperationCount = 0

        while true {
            let outboxEntries = try self.database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
            if outboxEntries.isEmpty {
                return CloudSyncResult(
                    appliedPullChangeCount: 0,
                    changedEntityTypes: [],
                    localIdRepairEntityTypes: [],
                    acknowledgedOperationCount: acknowledgedOperationCount,
                    acknowledgedReviewEventOperationCount: acknowledgedReviewEventOperationCount,
                    cleanedUpOperationCount: 0,
                    cleanedUpReviewEventOperationCount: 0
                )
            }

            do {
                let pushResponse: SyncPushResponse = try await self.transport.request(
                    apiBaseUrl: linkedSession.apiBaseUrl,
                    authorizationHeader: linkedSession.authorization.headerValue,
                    path: "\(syncBasePath)/push",
                    method: "POST",
                    body: PushRequest(
                        installationId: installationId,
                        platform: "ios",
                        appVersion: self.transport.appVersion(),
                        operations: outboxEntries.map { entry in
                            SyncOperationEnvelope(operation: entry.operation)
                        }
                    )
                )

                let acknowledgedOperationIds = pushResponse.operations.compactMap { result -> String? in
                    switch result.status {
                    case "applied", "ignored", "duplicate":
                        return result.operationId
                    case "rejected":
                        return nil
                    default:
                        return nil
                    }
                }
                let rejectedResults = pushResponse.operations.filter { result in
                    result.status == "rejected"
                }

                if acknowledgedOperationIds.isEmpty == false {
                    let acknowledgedOperationIdSet = Set(acknowledgedOperationIds)
                    let acknowledgedReviewEventCount = outboxEntries.filter { entry in
                        acknowledgedOperationIdSet.contains(entry.operationId)
                            && entry.operation.entityType == .reviewEvent
                    }.count
                    try self.database.deleteOutboxEntries(operationIds: acknowledgedOperationIds)
                    acknowledgedOperationCount += acknowledgedOperationIds.count
                    acknowledgedReviewEventOperationCount += acknowledgedReviewEventCount
                }

                if rejectedResults.isEmpty == false {
                    let rejectionMessage = rejectedResults.map { result in
                        let errorMessage = result.error ?? "Unknown rejection"
                        return "\(result.operationId): \(errorMessage)"
                    }.joined(separator: "; ")
                    try self.database.markOutboxEntriesFailed(
                        operationIds: rejectedResults.map(\.operationId),
                        message: rejectionMessage
                    )
                    throw LocalStoreError.validation("Cloud sync rejected one or more operations: \(rejectionMessage)")
                }
            } catch {
                try self.database.markOutboxEntriesFailed(
                    operationIds: outboxEntries.map(\.operationId),
                    message: error.localizedDescription
                )
                throw error
            }
        }
    }

    private func loadPendingLocalHotEntityKeys(workspaceId: String) throws -> Set<PendingLocalHotEntityKey> {
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

    private func makePendingLocalHotEntityKey(
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

    private func pullHotChanges(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        installationId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        var afterHotChangeId = try self.database.loadLastAppliedHotChangeId(workspaceId: workspaceId)
        var appliedPullChangeCount = 0
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
                try self.database.applySyncChange(
                    workspaceId: workspaceId,
                    change: CloudSyncMapper.makeSyncChange(workspaceId: workspaceId, change: change)
                )
                changedEntityTypes.insert(change.entityType)
            }

            appliedPullChangeCount += pullEnvelope.changes.count
            afterHotChangeId = pullEnvelope.nextHotChangeId
            try self.database.setLastAppliedHotChangeId(
                workspaceId: workspaceId,
                changeId: afterHotChangeId
            )

            if pullEnvelope.hasMore == false {
                return CloudSyncResult(
                    appliedPullChangeCount: appliedPullChangeCount,
                    changedEntityTypes: changedEntityTypes,
                    localIdRepairEntityTypes: [],
                    acknowledgedOperationCount: 0,
                    acknowledgedReviewEventOperationCount: 0,
                    cleanedUpOperationCount: 0,
                    cleanedUpReviewEventOperationCount: 0
                )
            }
        }
    }

    private func pullReviewHistory(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        installationId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        var afterReviewSequenceId = try self.database.loadLastAppliedReviewSequenceId(workspaceId: workspaceId)
        var appliedReviewEventCount = 0

        while true {
            let reviewHistoryEnvelope: RemoteReviewHistoryPullResponseEnvelope = try await self.transport.request(
                apiBaseUrl: linkedSession.apiBaseUrl,
                authorizationHeader: linkedSession.authorization.headerValue,
                path: "\(syncBasePath)/review-history/pull",
                method: "POST",
                body: ReviewHistoryPullRequest(
                    installationId: installationId,
                    platform: "ios",
                    appVersion: self.transport.appVersion(),
                    afterReviewSequenceId: afterReviewSequenceId,
                    limit: 200
                )
            )

            for reviewEvent in reviewHistoryEnvelope.reviewEvents {
                try self.database.applyReviewHistoryEvent(
                    workspaceId: workspaceId,
                    reviewEvent: CloudSyncMapper.makeReviewEvent(payload: reviewEvent)
                )
            }

            appliedReviewEventCount += reviewHistoryEnvelope.reviewEvents.count
            afterReviewSequenceId = reviewHistoryEnvelope.nextReviewSequenceId
            try self.database.setLastAppliedReviewSequenceId(
                workspaceId: workspaceId,
                reviewSequenceId: afterReviewSequenceId
            )

            if reviewHistoryEnvelope.hasMore == false {
                if try self.database.hasHydratedReviewHistory(workspaceId: workspaceId) == false {
                    try self.database.setHasHydratedReviewHistory(
                        workspaceId: workspaceId,
                        hasHydratedReviewHistory: true
                    )
                }

                return CloudSyncResult(
                    appliedPullChangeCount: appliedReviewEventCount,
                    changedEntityTypes: appliedReviewEventCount == 0 ? [] : [.reviewEvent],
                    localIdRepairEntityTypes: [],
                    acknowledgedOperationCount: 0,
                    acknowledgedReviewEventOperationCount: 0,
                    cleanedUpOperationCount: 0,
                    cleanedUpReviewEventOperationCount: 0
                )
            }
        }
    }
}

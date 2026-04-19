/*
 Keep the iOS sync runner flow aligned with:
 - apps/backend/src/sync.ts
 - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/CloudRepositories.kt
 */

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
        var syncResult = CloudSyncResult.noChanges

        let removedReviewEventCount = try self.database.deleteStaleReviewEventOutboxEntries(workspaceId: workspaceId)
        if removedReviewEventCount > 0 {
            syncResult = syncResult.merging(
                CloudSyncResult(
                    appliedPullChangeCount: 0,
                    changedEntityTypes: [],
                    acknowledgedOperationCount: 0,
                    acknowledgedReviewEventOperationCount: 0,
                    cleanedUpOperationCount: removedReviewEventCount,
                    cleanedUpReviewEventOperationCount: removedReviewEventCount
                )
            )
            logCloudFlowPhase(
                phase: .initialPush,
                outcome: "self_heal",
                workspaceId: workspaceId,
                installationId: cloudSettings.installationId,
                operationsCount: removedReviewEventCount
            )
        }

        if try self.database.hasHydratedHotState(workspaceId: workspaceId) == false {
            syncResult = syncResult.merging(
                try await self.performInitialHotStateSync(
                    linkedSession: linkedSession,
                    workspaceId: workspaceId,
                    installationId: cloudSettings.installationId,
                    syncBasePath: syncBasePath
                )
            )
        }

        syncResult = syncResult.merging(
            try await self.pushOutboxBatches(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                installationId: cloudSettings.installationId,
                syncBasePath: syncBasePath
            )
        )
        syncResult = syncResult.merging(
            try await self.pullHotChanges(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                installationId: cloudSettings.installationId,
                syncBasePath: syncBasePath
            )
        )
        syncResult = syncResult.merging(
            try await self.pullReviewHistory(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                installationId: cloudSettings.installationId,
                syncBasePath: syncBasePath
            )
        )

        return syncResult
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
    ) async throws -> CloudSyncResult {
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
            return try await self.bootstrapEmptyRemoteWorkspace(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                installationId: installationId,
                syncBasePath: syncBasePath
            )
        }

        var appliedPullChangeCount = 0
        var changedEntityTypes = Set<SyncEntityType>()
        var currentPage = firstPage

        while true {
            for entry in currentPage.entries {
                try self.database.applySyncBootstrapEntry(
                    workspaceId: workspaceId,
                    entry: CloudSyncMapper.makeSyncBootstrapEntry(workspaceId: workspaceId, entry: entry)
                )
                appliedPullChangeCount += 1
                changedEntityTypes.insert(entry.entityType)
            }

            if currentPage.hasMore == false {
                try self.database.setLastAppliedHotChangeId(
                    workspaceId: workspaceId,
                    changeId: currentPage.bootstrapHotChangeId
                )
                try self.database.setHasHydratedHotState(
                    workspaceId: workspaceId,
                    hasHydratedHotState: true
                )
                return CloudSyncResult(
                    appliedPullChangeCount: appliedPullChangeCount,
                    changedEntityTypes: changedEntityTypes,
                    acknowledgedOperationCount: 0,
                    acknowledgedReviewEventOperationCount: 0,
                    cleanedUpOperationCount: 0,
                    cleanedUpReviewEventOperationCount: 0
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
            var startIndex = 0
            while startIndex < bootstrapEntries.count {
                let endIndex = min(startIndex + 200, bootstrapEntries.count)
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
                        entries: bootstrapEntries[startIndex..<endIndex].map { entry in
                            SyncBootstrapEntryEnvelope(entry: entry)
                        }
                    )
                )
                guard let responseHotChangeId = response.bootstrapHotChangeId else {
                    throw LocalStoreError.validation("Bootstrap push response is missing bootstrapHotChangeId")
                }

                bootstrapHotChangeId = responseHotChangeId
                startIndex = endIndex
            }
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
                    acknowledgedOperationCount: 0,
                    acknowledgedReviewEventOperationCount: 0,
                    cleanedUpOperationCount: 0,
                    cleanedUpReviewEventOperationCount: 0
                )
            }
        }
    }
}

import Foundation

extension CloudSyncRunner {
    func markLegacyGuestLocalReviewHistoryImportIfNeeded(workspaceId: String) throws {
        guard try self.database.hasHydratedHotState(workspaceId: workspaceId) else {
            return
        }
        guard try self.database.hasHydratedReviewHistory(workspaceId: workspaceId) == false else {
            return
        }
        guard try self.database.hasPendingReviewHistoryImport(workspaceId: workspaceId) == false else {
            return
        }
        guard try self.database.loadReviewEvents(workspaceId: workspaceId).isEmpty == false else {
            return
        }

        // Legacy iOS guest-local recovery predates `pending_review_history_import`.
        // A device can upgrade after local hot state was committed to the new cloud
        // workspace but before local review history was imported. Convert that
        // partial state to the marker-driven recovery path used by current builds.
        try self.database.setPendingReviewHistoryImport(
            workspaceId: workspaceId,
            pendingReviewHistoryImport: true
        )
    }

    func importPendingLocalReviewHistory(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        installationId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        let reviewEvents = try self.database.loadReviewEvents(workspaceId: workspaceId)
        let currentReviewSequenceId = try self.database.loadLastAppliedReviewSequenceId(workspaceId: workspaceId)

        guard reviewEvents.isEmpty == false else {
            try self.database.setPendingReviewHistoryImport(
                workspaceId: workspaceId,
                pendingReviewHistoryImport: false
            )
            return .noChanges
        }

        _ = try await self.importReviewEventsToRemote(
            linkedSession: linkedSession,
            installationId: installationId,
            syncBasePath: syncBasePath,
            initialReviewSequenceId: currentReviewSequenceId,
            reviewEvents: reviewEvents
        )
        try self.database.setPendingReviewHistoryImport(
            workspaceId: workspaceId,
            pendingReviewHistoryImport: false
        )

        return CloudSyncResult(
            appliedPullChangeCount: 0,
            reviewScheduleImpactingPullChangeCount: 0,
            changedEntityTypes: [.reviewEvent],
            localIdRepairEntityTypes: [],
            acknowledgedOperationCount: 0,
            acknowledgedReviewEventOperationCount: 0,
            acknowledgedReviewScheduleImpactingOperationCount: 0,
            cleanedUpOperationCount: 0,
            cleanedUpReviewEventOperationCount: 0,
            cleanedUpReviewScheduleImpactingOperationCount: 0
        )
    }

    private func importReviewEventsToRemote(
        linkedSession: CloudLinkedSession,
        installationId: String,
        syncBasePath: String,
        initialReviewSequenceId: Int64,
        reviewEvents: [ReviewEvent]
    ) async throws -> Int64 {
        var nextReviewSequenceId = initialReviewSequenceId
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

        return nextReviewSequenceId
    }

    func pullReviewHistory(
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
                if try self.database.hasPendingReviewHistoryImport(workspaceId: workspaceId) {
                    try self.database.setPendingReviewHistoryImport(
                        workspaceId: workspaceId,
                        pendingReviewHistoryImport: false
                    )
                }
                if try self.database.hasHydratedReviewHistory(workspaceId: workspaceId) == false {
                    try self.database.setHasHydratedReviewHistory(
                        workspaceId: workspaceId,
                        hasHydratedReviewHistory: true
                    )
                }

                return CloudSyncResult(
                    appliedPullChangeCount: appliedReviewEventCount,
                    reviewScheduleImpactingPullChangeCount: 0,
                    changedEntityTypes: appliedReviewEventCount == 0 ? [] : [.reviewEvent],
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

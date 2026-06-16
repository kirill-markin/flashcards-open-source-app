import Foundation

extension CloudSyncRunner {
    func cleanupStaleReviewEventOutboxEntries(
        workspaceId: String,
        installationId: String
    ) throws -> CloudSyncResult {
        let deletionSummary = try self.database.deleteStaleReviewEventOutboxEntries(workspaceId: workspaceId)
        if deletionSummary.operationCount == 0 {
            return .noChanges
        }

        logCloudFlowPhase(
            phase: .initialPush,
            outcome: "self_heal",
            workspaceId: workspaceId,
            installationId: installationId,
            operationsCount: deletionSummary.operationCount,
            // review_event outbox rows are always non-impacting (see
            // OutboxStore.enqueueReviewEventAppendOperation), so this cleanup
            // can never touch the schedule-impacting counter. The literal 0
            // makes that invariant visible in the structured log instead of
            // implicit by omission.
            reviewScheduleImpactingOperationCount: 0
        )

        return CloudSyncResult(
            appliedPullChangeCount: 0,
            reviewScheduleImpactingPullChangeCount: 0,
            changedEntityTypes: [],
            localIdRepairEntityTypes: [],
            acknowledgedOperationCount: 0,
            acknowledgedReviewEventOperationCount: 0,
            acknowledgedReviewScheduleImpactingOperationCount: 0,
            cleanedUpOperationCount: deletionSummary.operationCount,
            cleanedUpReviewEventOperationCount: deletionSummary.operationCount,
            // Review-event outbox rows are always enqueued non-impacting (see
            // OutboxStore.enqueueReviewEventAppendOperation), so cleanup never
            // touches the schedule-impacting counter.
            cleanedUpReviewScheduleImpactingOperationCount: 0
        )
    }

    func pushOutboxBatches(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        installationId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        var acknowledgedOperationCount = 0
        var acknowledgedReviewEventOperationCount = 0
        var acknowledgedReviewScheduleImpactingOperationCount = 0

        while true {
            let outboxEntries = try self.database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
            if outboxEntries.isEmpty {
                return CloudSyncResult(
                    appliedPullChangeCount: 0,
                    reviewScheduleImpactingPullChangeCount: 0,
                    changedEntityTypes: [],
                    localIdRepairEntityTypes: [],
                    acknowledgedOperationCount: acknowledgedOperationCount,
                    acknowledgedReviewEventOperationCount: acknowledgedReviewEventOperationCount,
                    acknowledgedReviewScheduleImpactingOperationCount: acknowledgedReviewScheduleImpactingOperationCount,
                    cleanedUpOperationCount: 0,
                    cleanedUpReviewEventOperationCount: 0,
                    cleanedUpReviewScheduleImpactingOperationCount: 0
                )
            }

            // Only the network call goes through the transport-failure catch so we don't
            // double-bump attempt_count when handling per-operation rejections below.
            let pushResponse: SyncPushResponse
            do {
                pushResponse = try await self.transport.request(
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
            } catch {
                try self.database.markOutboxEntriesFailed(
                    operationIds: outboxEntries.map(\.operationId),
                    message: error.localizedDescription
                )
                throw error
            }

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
                let acknowledgedReviewScheduleImpactingCount = outboxEntries.filter { entry in
                    acknowledgedOperationIdSet.contains(entry.operationId) && entry.reviewScheduleImpact
                }.count
                try self.database.deleteOutboxEntries(operationIds: acknowledgedOperationIds)
                acknowledgedOperationCount += acknowledgedOperationIds.count
                acknowledgedReviewEventOperationCount += acknowledgedReviewEventCount
                acknowledgedReviewScheduleImpactingOperationCount += acknowledgedReviewScheduleImpactingCount
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
        }
    }
}

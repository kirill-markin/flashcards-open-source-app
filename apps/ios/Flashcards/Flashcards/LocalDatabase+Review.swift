import Foundation

extension LocalDatabase {
    // Keep in sync with apps/backend/src/cards.ts::submitReview.
    func submitReview(workspaceId: String, reviewSubmission: ReviewSubmission) throws -> Card {
        return try self.core.inTransaction {
            let card = try self.cardStore.loadCard(workspaceId: workspaceId, cardId: reviewSubmission.cardId)
            let schedulerSettings = try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
            guard let reviewedAtClient = parseIsoTimestamp(value: reviewSubmission.reviewedAtClient) else {
                throw LocalStoreError.validation("reviewedAtClient must be a valid ISO timestamp")
            }
            let schedule = try computeReviewSchedule(
                card: card,
                settings: schedulerSettings,
                rating: reviewSubmission.rating,
                now: reviewedAtClient
            )
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let reviewEventOperationId = UUID().uuidString.lowercased()
            let cardOperationId = UUID().uuidString.lowercased()
            let reviewEventId = UUID().uuidString.lowercased()
            let clientEventId = UUID().uuidString.lowercased()
            let reviewedAtServer = nowIsoTimestamp()

            let reviewEvent = try self.cardStore.appendReviewEvent(
                workspaceId: workspaceId,
                cardId: reviewSubmission.cardId,
                rating: reviewSubmission.rating,
                reviewedAtClient: reviewSubmission.reviewedAtClient,
                deviceId: cloudSettings.deviceId,
                reviewEventId: reviewEventId,
                clientEventId: clientEventId,
                reviewedAtServer: reviewedAtServer
            )

            let updatedCard = try self.cardStore.applyReviewSchedule(
                workspaceId: workspaceId,
                cardId: reviewSubmission.cardId,
                reviewSubmission: reviewSubmission,
                schedule: schedule,
                deviceId: cloudSettings.deviceId,
                operationId: cardOperationId,
                reviewedAtServer: reviewedAtServer
            )

            try self.outboxStore.enqueueReviewEventAppendOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: reviewEventOperationId,
                clientUpdatedAt: reviewSubmission.reviewedAtClient,
                reviewEvent: reviewEvent
            )

            try self.outboxStore.enqueueCardUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: cardOperationId,
                clientUpdatedAt: reviewSubmission.reviewedAtClient,
                card: updatedCard
            )
            return updatedCard
        }
    }

    // Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::updateWorkspaceSchedulerSettings.
    func updateWorkspaceSchedulerSettings(
        workspaceId: String,
        desiredRetention: Double,
        learningStepsMinutes: [Int],
        relearningStepsMinutes: [Int],
        maximumIntervalDays: Int,
        enableFuzz: Bool
    ) throws {
        try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
            let now = nowIsoTimestamp()
            let updatedSettings = try self.workspaceSettingsStore.updateWorkspaceSchedulerSettings(
                workspaceId: workspaceId,
                desiredRetention: desiredRetention,
                learningStepsMinutes: learningStepsMinutes,
                relearningStepsMinutes: relearningStepsMinutes,
                maximumIntervalDays: maximumIntervalDays,
                enableFuzz: enableFuzz,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                now: now
            )
            try self.outboxStore.enqueueWorkspaceSchedulerSettingsUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                settings: updatedSettings
            )
        }
    }
}

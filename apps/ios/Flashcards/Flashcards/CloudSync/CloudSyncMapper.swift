enum CloudSyncMapper {
    static func makeCard(workspaceId: String, payload: RemoteCardChangePayload) -> Card {
        Card(
            cardId: payload.cardId,
            workspaceId: workspaceId,
            frontText: payload.frontText,
            backText: payload.backText,
            tags: payload.tags,
            effortLevel: payload.effortLevel,
            dueAt: payload.dueAt,
            createdAt: payload.createdAt,
            reps: payload.reps,
            lapses: payload.lapses,
            fsrsCardState: payload.fsrsCardState,
            fsrsStepIndex: payload.fsrsStepIndex,
            fsrsStability: payload.fsrsStability,
            fsrsDifficulty: payload.fsrsDifficulty,
            fsrsLastReviewedAt: payload.fsrsLastReviewedAt,
            fsrsScheduledDays: payload.fsrsScheduledDays,
            clientUpdatedAt: payload.clientUpdatedAt,
            lastModifiedByDeviceId: payload.lastModifiedByDeviceId,
            lastOperationId: payload.lastOperationId,
            updatedAt: payload.updatedAt,
            deletedAt: payload.deletedAt
        )
    }

    static func makeDeck(workspaceId: String, payload: RemoteDeckChangePayload) -> Deck {
        Deck(
            deckId: payload.deckId,
            workspaceId: workspaceId,
            name: payload.name,
            filterDefinition: payload.filterDefinition,
            createdAt: payload.createdAt,
            clientUpdatedAt: payload.clientUpdatedAt,
            lastModifiedByDeviceId: payload.lastModifiedByDeviceId,
            lastOperationId: payload.lastOperationId,
            updatedAt: payload.updatedAt,
            deletedAt: payload.deletedAt
        )
    }

    static func makeWorkspaceSchedulerSettings(
        payload: RemoteWorkspaceSchedulerSettingsChangePayload
    ) -> WorkspaceSchedulerSettings {
        WorkspaceSchedulerSettings(
            algorithm: payload.algorithm,
            desiredRetention: payload.desiredRetention,
            learningStepsMinutes: payload.learningStepsMinutes,
            relearningStepsMinutes: payload.relearningStepsMinutes,
            maximumIntervalDays: payload.maximumIntervalDays,
            enableFuzz: payload.enableFuzz,
            clientUpdatedAt: payload.clientUpdatedAt,
            lastModifiedByDeviceId: payload.lastModifiedByDeviceId,
            lastOperationId: payload.lastOperationId,
            updatedAt: payload.updatedAt
        )
    }

    static func makeReviewEvent(workspaceId: String, payload: RemoteReviewEventChangePayload) -> ReviewEvent {
        ReviewEvent(
            reviewEventId: payload.reviewEventId,
            workspaceId: workspaceId,
            cardId: payload.cardId,
            deviceId: payload.deviceId,
            clientEventId: payload.clientEventId,
            rating: payload.rating,
            reviewedAtClient: payload.reviewedAtClient,
            reviewedAtServer: payload.reviewedAtServer
        )
    }

    static func makeReviewEvent(payload: RemoteReviewEventEnvelope) -> ReviewEvent {
        ReviewEvent(
            reviewEventId: payload.reviewEventId,
            workspaceId: payload.workspaceId,
            cardId: payload.cardId,
            deviceId: payload.deviceId,
            clientEventId: payload.clientEventId,
            rating: payload.rating,
            reviewedAtClient: payload.reviewedAtClient,
            reviewedAtServer: payload.reviewedAtServer
        )
    }

    static func makeSyncBootstrapEntry(
        workspaceId: String,
        entry: RemoteSyncBootstrapEntryEnvelope
    ) -> SyncBootstrapEntry {
        switch entry.payload {
        case .card(let payload):
            return SyncBootstrapEntry(
                entityType: entry.entityType,
                entityId: entry.entityId,
                action: entry.action,
                payload: .card(Self.makeCard(workspaceId: workspaceId, payload: payload))
            )
        case .deck(let payload):
            return SyncBootstrapEntry(
                entityType: entry.entityType,
                entityId: entry.entityId,
                action: entry.action,
                payload: .deck(Self.makeDeck(workspaceId: workspaceId, payload: payload))
            )
        case .workspaceSchedulerSettings(let payload):
            return SyncBootstrapEntry(
                entityType: entry.entityType,
                entityId: entry.entityId,
                action: entry.action,
                payload: .workspaceSchedulerSettings(Self.makeWorkspaceSchedulerSettings(payload: payload))
            )
        }
    }

    /// Maps one backend hot pull change into the local hot-state model.
    ///
    /// Hot pull must never contain review events. If that ever changes in the
    /// backend, update both this function and `RemoteSyncChangeEnvelope`.
    static func makeSyncChange(workspaceId: String, change: RemoteSyncChangeEnvelope) -> SyncChange {
        switch change.payload {
        case .card(let payload):
            return SyncChange(
                changeId: change.changeId,
                entityType: change.entityType,
                entityId: change.entityId,
                action: change.action,
                payload: .card(Self.makeCard(workspaceId: workspaceId, payload: payload))
            )
        case .deck(let payload):
            return SyncChange(
                changeId: change.changeId,
                entityType: change.entityType,
                entityId: change.entityId,
                action: change.action,
                payload: .deck(Self.makeDeck(workspaceId: workspaceId, payload: payload))
            )
        case .workspaceSchedulerSettings(let payload):
            return SyncChange(
                changeId: change.changeId,
                entityType: change.entityType,
                entityId: change.entityId,
                action: change.action,
                payload: .workspaceSchedulerSettings(Self.makeWorkspaceSchedulerSettings(payload: payload))
            )
        }
    }
}

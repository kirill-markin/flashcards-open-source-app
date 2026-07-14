import CryptoKit
import Foundation

private let referencedMediaAssetCacheValidationChunkSizeBytes: Int = 1_048_576

private struct ReferencedMediaAssetCacheFileValidation: Hashable {
    let sizeBytes: Int64
    let sha256: String
}

extension LocalDatabase {
    /// Loads the next FIFO outbox page for one batched push request.
    func loadOutboxEntries(workspaceId: String, limit: Int) throws -> [PersistedOutboxEntry] {
        try self.outboxStore.loadOutboxEntries(workspaceId: workspaceId, limit: limit)
    }

    func deleteOutboxEntries(operationIds: [String]) throws {
        try self.outboxStore.deleteOutboxEntries(operationIds: operationIds)
    }

    func deleteAllOutboxEntries(workspaceId: String) throws {
        try self.outboxStore.deleteAllOutboxEntries(workspaceId: workspaceId)
    }

    func clearCloudSyncState(workspaceId: String) throws {
        try self.core.inTransaction {
            try self.outboxStore.deleteAllOutboxEntries(workspaceId: workspaceId)

            let updatedRows = try self.core.execute(
                sql: """
                UPDATE sync_state
                SET
                    last_applied_hot_change_id = 0,
                    last_applied_review_sequence_id = 0,
                    has_hydrated_hot_state = 0,
                    has_hydrated_review_history = 0,
                    pending_review_history_import = 0,
                    updated_at = ?
                WHERE workspace_id = ?
                """,
                values: [
                    .text(nowIsoTimestamp()),
                    .text(workspaceId)
                ]
            )

            if updatedRows == 0 {
                try self.core.execute(
                    sql: """
                    INSERT INTO sync_state (
                        workspace_id,
                        last_applied_hot_change_id,
                        last_applied_review_sequence_id,
                        has_hydrated_hot_state,
                        has_hydrated_review_history,
                        pending_review_history_import,
                        updated_at
                    )
                    VALUES (?, 0, 0, 0, 0, 0, ?)
                    """,
                    values: [
                        .text(workspaceId),
                        .text(nowIsoTimestamp())
                    ]
                )
            }
        }
    }

    func deleteStaleReviewEventOutboxEntries(workspaceId: String) throws -> DeletedOutboxEntriesSummary {
        try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            return try self.outboxStore.deleteStaleReviewEventOutboxEntries(
                workspaceId: workspaceId,
                currentInstallationId: cloudSettings.installationId
            )
        }
    }

    func markOutboxEntriesFailed(operationIds: [String], message: String) throws {
        try self.outboxStore.markOutboxEntriesFailed(operationIds: operationIds, message: message)
    }

    func loadLastAppliedHotChangeId(workspaceId: String) throws -> Int64 {
        try self.outboxStore.loadLastAppliedHotChangeId(workspaceId: workspaceId)
    }

    func setLastAppliedHotChangeId(workspaceId: String, changeId: Int64) throws {
        try self.outboxStore.setLastAppliedHotChangeId(workspaceId: workspaceId, changeId: changeId)
    }

    func loadLastAppliedReviewSequenceId(workspaceId: String) throws -> Int64 {
        try self.outboxStore.loadLastAppliedReviewSequenceId(workspaceId: workspaceId)
    }

    func setLastAppliedReviewSequenceId(workspaceId: String, reviewSequenceId: Int64) throws {
        try self.outboxStore.setLastAppliedReviewSequenceId(
            workspaceId: workspaceId,
            reviewSequenceId: reviewSequenceId
        )
    }

    func hasHydratedHotState(workspaceId: String) throws -> Bool {
        try self.outboxStore.hasHydratedHotState(workspaceId: workspaceId)
    }

    func setHasHydratedHotState(workspaceId: String, hasHydratedHotState: Bool) throws {
        try self.outboxStore.setHasHydratedHotState(
            workspaceId: workspaceId,
            hasHydratedHotState: hasHydratedHotState
        )
    }

    func hasHydratedReviewHistory(workspaceId: String) throws -> Bool {
        try self.outboxStore.hasHydratedReviewHistory(workspaceId: workspaceId)
    }

    func setHasHydratedReviewHistory(workspaceId: String, hasHydratedReviewHistory: Bool) throws {
        try self.outboxStore.setHasHydratedReviewHistory(
            workspaceId: workspaceId,
            hasHydratedReviewHistory: hasHydratedReviewHistory
        )
    }

    func hasPendingReviewHistoryImport(workspaceId: String) throws -> Bool {
        try self.outboxStore.hasPendingReviewHistoryImport(workspaceId: workspaceId)
    }

    func setPendingReviewHistoryImport(workspaceId: String, pendingReviewHistoryImport: Bool) throws {
        try self.outboxStore.setPendingReviewHistoryImport(
            workspaceId: workspaceId,
            pendingReviewHistoryImport: pendingReviewHistoryImport
        )
    }

    func loadReviewEvents(workspaceId: String) throws -> [ReviewEvent] {
        try self.cardStore.loadReviewEvents(workspaceId: workspaceId)
    }

    func loadPendingReviewEventPayloads(
        workspaceId: String,
        installationId: String
    ) throws -> [ReviewEventSyncPayload] {
        let outboxEntries = try self.outboxStore.loadOutboxEntries(
            workspaceId: workspaceId,
            limit: Int.max
        )

        var pendingReviewEvents: [ReviewEventSyncPayload] = []
        for outboxEntry in outboxEntries {
            guard outboxEntry.operation.entityType == .reviewEvent else {
                continue
            }

            guard outboxEntry.operation.action == .append else {
                throw LocalStoreError.database(
                    "Pending review event outbox action is invalid: \(outboxEntry.operation.action.rawValue)"
                )
            }

            guard case .reviewEvent(let payload) = outboxEntry.operation.payload else {
                throw LocalStoreError.database("Pending review event outbox payload is invalid")
            }

            guard payload.installationId == installationId else {
                continue
            }

            pendingReviewEvents.append(payload)
        }

        return pendingReviewEvents
    }

    func hasPendingCardOperation(
        workspaceId: String,
        installationId: String
    ) throws -> Bool {
        try self.outboxStore.hasPendingCardOperation(
            workspaceId: workspaceId,
            installationId: installationId
        )
    }

    func hasPendingReviewScheduleImpactingCardOperation(
        workspaceId: String,
        installationId: String
    ) throws -> Bool {
        try self.outboxStore.hasPendingReviewScheduleImpactingCardOperation(
            workspaceId: workspaceId,
            installationId: installationId
        )
    }

    func loadPendingReviewScheduleCardTotalDelta(
        workspaceIds: [String],
        installationId: String
    ) throws -> Int {
        var totalDelta = 0
        for workspaceId in workspaceIds {
            totalDelta += try self.outboxStore.loadPendingReviewScheduleCardTotalDelta(
                workspaceId: workspaceId,
                installationId: installationId
            )
        }

        return totalDelta
    }

    func loadJournalMode() throws -> String {
        try self.core.scalarText(sql: "PRAGMA journal_mode;", values: [])
    }

    /// Exports the current mutable workspace winners for empty-remote bootstrap.
    func loadHotBootstrapEntries(workspaceId: String) throws -> [SyncBootstrapEntry] {
        let cards = try self.cardStore.loadCardsIncludingDeleted(workspaceId: workspaceId).map { card in
            SyncBootstrapEntry(
                entityType: .card,
                entityId: card.cardId,
                action: .upsert,
                payload: .card(card)
            )
        }
        let decks = try self.deckStore.loadDecksIncludingDeleted(workspaceId: workspaceId).map { deck in
            SyncBootstrapEntry(
                entityType: .deck,
                entityId: deck.deckId,
                action: .upsert,
                payload: .deck(deck)
            )
        }
        let schedulerSettings = try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
        let schedulerEntry = SyncBootstrapEntry(
            entityType: .workspaceSchedulerSettings,
            entityId: workspaceId,
            action: .upsert,
            payload: .workspaceSchedulerSettings(schedulerSettings)
        )

        // Media assets are registered remotely only through the upload API.
        // Keep local rows for offline rendering, but never bootstrap-push them.
        return cards + decks + [schedulerEntry]
    }

    @discardableResult
    func prepareReferencedMediaAssetUploadsForHotBootstrap(workspaceId: String) throws -> [MediaTransferQueueEntry] {
        let activeCards = try self.cardStore.loadCardsIncludingDeleted(workspaceId: workspaceId).filter { card in
            card.deletedAt == nil
        }
        let referencedMediaAssetIds = managedMediaAssetIdsReferencedByCards(cards: activeCards)
        guard referencedMediaAssetIds.isEmpty == false else {
            return []
        }

        let createdAt = nowIsoTimestamp()
        return try self.core.inTransaction {
            var transferEntries: [MediaTransferQueueEntry] = []
            for mediaAssetId in referencedMediaAssetIds.sorted() {
                if let transferEntry = try self.prepareReferencedMediaAssetUploadForHotBootstrap(
                    workspaceId: workspaceId,
                    mediaAssetId: mediaAssetId,
                    createdAt: createdAt
                ) {
                    transferEntries.append(transferEntry)
                }
            }

            return transferEntries
        }
    }

    func loadOptionalMediaAssetIncludingDeleted(workspaceId: String, mediaAssetId: String) throws -> MediaAsset? {
        try self.mediaAssetStore.loadOptionalMediaAssetIncludingDeleted(
            workspaceId: workspaceId,
            mediaAssetId: mediaAssetId
        )
    }

    /// Applies one bootstrap entry from the hot current-state lane.
    func applySyncBootstrapEntry(workspaceId: String, entry: SyncBootstrapEntry) throws -> SyncApplyResult {
        try self.core.inTransaction {
            try self.syncApplier.applySyncBootstrapEntry(workspaceId: workspaceId, entry: entry)
        }
    }

    /// Applies one immutable review-history event from background pull/import.
    ///
    /// Review history is no longer part of hot change replay. Keep this path
    /// aligned with:
    /// - `apps/ios/Flashcards/Flashcards/Cloud/Sync/CloudSyncService.swift`
    /// - `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/cloud/sync/SyncLocalStore.kt`
    /// - the iOS sync tests that cover review-history application semantics
    func applyReviewHistoryEvent(workspaceId: String, reviewEvent: ReviewEvent) throws {
        try self.core.inTransaction {
            try self.syncApplier.applyReviewHistoryEvent(workspaceId: workspaceId, reviewEvent: reviewEvent)
        }
    }

    /// Applies one hot current-state change from `/sync/pull`.
    ///
    /// If you add another hot entity type here, update the pull contract in
    /// `apps/backend/src/sync/contracts/types.ts`,
    /// `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/cloud/sync/SyncLocalStore.kt`,
    /// and the iOS sync tests that assert hot-state application semantics.
    func applySyncChange(workspaceId: String, change: SyncChange) throws -> SyncApplyResult {
        try self.core.inTransaction {
            try self.syncApplier.applySyncChange(workspaceId: workspaceId, change: change)
        }
    }

    func prepareReferencedMediaAssetUploadForSavedCard(
        workspaceId: String,
        mediaAssetId: String,
        createdAt: String
    ) throws -> MediaTransferQueueEntry? {
        try self.prepareReferencedMediaAssetUpload(
            workspaceId: workspaceId,
            mediaAssetId: mediaAssetId,
            createdAt: createdAt,
            context: .savedCard,
            existingTransferPolicy: .anyUpload
        )
    }

    private func prepareReferencedMediaAssetUploadForHotBootstrap(
        workspaceId: String,
        mediaAssetId: String,
        createdAt: String
    ) throws -> MediaTransferQueueEntry? {
        try self.prepareReferencedMediaAssetUpload(
            workspaceId: workspaceId,
            mediaAssetId: mediaAssetId,
            createdAt: createdAt,
            context: .hotBootstrap,
            existingTransferPolicy: .pendingOnly
        )
    }

    private func prepareReferencedMediaAssetUpload(
        workspaceId: String,
        mediaAssetId: String,
        createdAt: String,
        context: ReferencedMediaAssetUploadContext,
        existingTransferPolicy: ReferencedMediaAssetUploadExistingTransferPolicy
    ) throws -> MediaTransferQueueEntry? {
        guard let mediaAsset = try self.mediaAssetStore.loadOptionalMediaAssetIncludingDeleted(
            workspaceId: workspaceId,
            mediaAssetId: mediaAssetId
        ) else {
            throw LocalStoreError.validation(
                "\(context.actionDescription) because a card references a missing media asset: workspaceId=\(workspaceId) mediaAssetId=\(mediaAssetId)"
            )
        }
        guard mediaAsset.deletedAt == nil else {
            throw LocalStoreError.validation(
                "\(context.actionDescription) because a card references a deleted media asset: workspaceId=\(workspaceId) mediaAssetId=\(mediaAssetId)"
            )
        }

        let normalizedSha256 = try normalizedMediaSha256(sha256: mediaAsset.sha256)
        guard let cacheEntry = try self.mediaTransferStore.loadOptionalBlobCacheEntry(sha256: normalizedSha256) else {
            throw LocalStoreError.validation(
                "\(context.actionDescription) because referenced media is not cached for upload: workspaceId=\(workspaceId) mediaAssetId=\(mediaAssetId) sha256=\(normalizedSha256)"
            )
        }
        try validateReferencedMediaAssetCache(
            databaseURL: self.databaseURL,
            mediaAsset: mediaAsset,
            cacheEntry: cacheEntry,
            context: context
        )

        guard try self.hasExistingReferencedMediaAssetUploadTransfer(
            workspaceId: workspaceId,
            mediaAssetId: mediaAssetId,
            sha256: normalizedSha256,
            mimeType: mediaAsset.mimeType,
            sizeBytes: mediaAsset.sizeBytes,
            existingTransferPolicy: existingTransferPolicy
        ) == false else {
            return nil
        }

        return try self.mediaTransferStore.enqueueTransfer(
            request: MediaTransferEnqueueRequest(
                transferId: UUID().uuidString.lowercased(),
                workspaceId: workspaceId,
                mediaAssetId: mediaAssetId,
                kind: .upload,
                sha256: normalizedSha256,
                mimeType: mediaAsset.mimeType,
                sizeBytes: mediaAsset.sizeBytes,
                createdAt: createdAt
            )
        )
    }

    private func hasExistingReferencedMediaAssetUploadTransfer(
        workspaceId: String,
        mediaAssetId: String,
        sha256: String,
        mimeType: String,
        sizeBytes: Int64,
        existingTransferPolicy: ReferencedMediaAssetUploadExistingTransferPolicy
    ) throws -> Bool {
        switch existingTransferPolicy {
        case .pendingOnly:
            return try self.mediaTransferStore.hasPendingUploadTransferMatchingAsset(
                workspaceId: workspaceId,
                mediaAssetId: mediaAssetId,
                sha256: sha256,
                mimeType: mimeType,
                sizeBytes: sizeBytes
            )
        case .anyUpload:
            return try self.mediaTransferStore.hasUploadTransferMatchingAsset(
                workspaceId: workspaceId,
                mediaAssetId: mediaAssetId,
                sha256: sha256,
                mimeType: mimeType,
                sizeBytes: sizeBytes
            )
        }
    }
}

private enum ReferencedMediaAssetUploadContext {
    case hotBootstrap
    case savedCard

    var actionDescription: String {
        switch self {
        case .hotBootstrap:
            return "Cannot bootstrap workspace"
        case .savedCard:
            return "Cannot save card"
        }
    }
}

private enum ReferencedMediaAssetUploadExistingTransferPolicy {
    case pendingOnly
    case anyUpload
}

private func managedMediaAssetIdsReferencedByCards(cards: [Card]) -> Set<String> {
    cards.reduce(into: Set<String>()) { result, card in
        result.formUnion(managedMediaAssetIdsReferencedInMarkdown(text: card.frontText))
        result.formUnion(managedMediaAssetIdsReferencedInMarkdown(text: card.backText))
    }
}

private func validateReferencedMediaAssetCache(
    databaseURL: URL,
    mediaAsset: MediaAsset,
    cacheEntry: MediaBlobCacheEntry,
    context: ReferencedMediaAssetUploadContext
) throws {
    let normalizedSha256 = try normalizedMediaSha256(sha256: mediaAsset.sha256)
    let expectedRelativePath = try mediaBlobCacheRelativePath(sha256: normalizedSha256)
    guard mediaAsset.sizeBytes > 0 else {
        throw LocalStoreError.validation(
            "\(context.actionDescription) because referenced media asset size must be positive: mediaAssetId=\(mediaAsset.mediaAssetId) sizeBytes=\(mediaAsset.sizeBytes)"
        )
    }
    guard cacheEntry.sha256 == normalizedSha256,
          cacheEntry.localRelativePath == expectedRelativePath,
          cacheEntry.mimeType.lowercased() == mediaAsset.mimeType.lowercased(),
          cacheEntry.sizeBytes == mediaAsset.sizeBytes else {
        throw LocalStoreError.validation(
            "\(context.actionDescription) because referenced media cache metadata does not match the media asset: mediaAssetId=\(mediaAsset.mediaAssetId)"
        )
    }

    let cacheURL = databaseURL
        .deletingLastPathComponent()
        .appendingPathComponent(cacheEntry.localRelativePath, isDirectory: false)
    guard FileManager.default.fileExists(atPath: cacheURL.path) else {
        throw LocalStoreError.validation(
            "\(context.actionDescription) because referenced media cache file is missing: mediaAssetId=\(mediaAsset.mediaAssetId) path=\(cacheEntry.localRelativePath)"
        )
    }

    let fileValidation = try streamReferencedMediaAssetCacheFileValidation(
        fileURL: cacheURL,
        mediaAssetId: mediaAsset.mediaAssetId,
        context: context
    )
    guard fileValidation.sizeBytes == mediaAsset.sizeBytes else {
        throw LocalStoreError.validation(
            "\(context.actionDescription) because referenced media cache file size does not match the media asset: mediaAssetId=\(mediaAsset.mediaAssetId) expected=\(mediaAsset.sizeBytes) actual=\(fileValidation.sizeBytes)"
        )
    }
    guard fileValidation.sha256 == normalizedSha256 else {
        throw LocalStoreError.validation(
            "\(context.actionDescription) because referenced media cache file SHA-256 does not match the media asset: mediaAssetId=\(mediaAsset.mediaAssetId) expected=\(normalizedSha256) actual=\(fileValidation.sha256)"
        )
    }
}

private func streamReferencedMediaAssetCacheFileValidation(
    fileURL: URL,
    mediaAssetId: String,
    context: ReferencedMediaAssetUploadContext
) throws -> ReferencedMediaAssetCacheFileValidation {
    do {
        let fileHandle = try FileHandle(forReadingFrom: fileURL)
        return try scanReferencedMediaAssetCacheFile(
            fileHandle: fileHandle,
            mediaAssetId: mediaAssetId
        )
    } catch let error as LocalStoreError {
        throw error
    } catch {
        throw LocalStoreError.validation(
            "\(context.actionDescription) because referenced media cache file is unreadable: mediaAssetId=\(mediaAssetId) path=\(fileURL.path) error=\(Flashcards.errorMessage(error: error))"
        )
    }
}

private func scanReferencedMediaAssetCacheFile(
    fileHandle: FileHandle,
    mediaAssetId: String
) throws -> ReferencedMediaAssetCacheFileValidation {
    do {
        var sizeBytes: Int64 = 0
        var hasher = SHA256()
        while true {
            guard let chunk = try fileHandle.read(upToCount: referencedMediaAssetCacheValidationChunkSizeBytes),
                  chunk.isEmpty == false else {
                break
            }

            hasher.update(data: chunk)
            sizeBytes += Int64(chunk.count)
        }

        try closeReferencedMediaAssetCacheFileHandle(fileHandle: fileHandle, mediaAssetId: mediaAssetId)
        return ReferencedMediaAssetCacheFileValidation(
            sizeBytes: sizeBytes,
            sha256: referencedMediaAssetHexSHA256(digest: hasher.finalize())
        )
    } catch {
        try closeReferencedMediaAssetCacheFileHandleAfterFailure(
            fileHandle: fileHandle,
            mediaAssetId: mediaAssetId,
            failure: error
        )
    }
}

private func closeReferencedMediaAssetCacheFileHandle(
    fileHandle: FileHandle,
    mediaAssetId: String
) throws {
    do {
        try fileHandle.close()
    } catch {
        throw LocalStoreError.validation(
            "Cannot bootstrap workspace because referenced media cache file close failed: mediaAssetId=\(mediaAssetId) error=\(Flashcards.errorMessage(error: error))"
        )
    }
}

private func closeReferencedMediaAssetCacheFileHandleAfterFailure(
    fileHandle: FileHandle,
    mediaAssetId: String,
    failure: Error
) throws -> Never {
    do {
        try fileHandle.close()
    } catch {
        throw LocalStoreError.validation(
            "Cannot bootstrap workspace because referenced media cache file validation and close failed: mediaAssetId=\(mediaAssetId) validationError=\(Flashcards.errorMessage(error: failure)); closeError=\(Flashcards.errorMessage(error: error))"
        )
    }

    throw failure
}

private func referencedMediaAssetHexSHA256(digest: SHA256.Digest) -> String {
    digest.map { byte in
        String(format: "%02x", byte)
    }.joined()
}

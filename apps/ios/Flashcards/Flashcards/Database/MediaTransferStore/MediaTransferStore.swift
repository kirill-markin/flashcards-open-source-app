import Foundation

private let mediaBlobCacheSelectColumnsSQL: String = """
    sha256,
    mime_type,
    size_bytes,
    local_relative_path,
    created_at,
    last_accessed_at,
    source_media_asset_id
"""

private let mediaTransferQueueSelectColumnsSQL: String = """
    transfer_id,
    workspace_id,
    media_asset_id,
    kind,
    status,
    sha256,
    mime_type,
    size_bytes,
    local_relative_path,
    attempt_count,
    next_attempt_at,
    claimed_at,
    last_error,
    created_at,
    updated_at
"""

private func nonEmptyMediaTransferText(value: String, fieldName: String) throws -> String {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false else {
        throw LocalStoreError.validation("\(fieldName) must not be empty")
    }

    return trimmedValue
}

private func mediaTransferOptionalTextValue(value: String?) -> SQLiteValue {
    if let value {
        return .text(value)
    }

    return .null
}

struct MediaTransferStore {
    let core: DatabaseCore

    func upsertBlobCacheEntry(entry: MediaBlobCacheUpsert) throws -> MediaBlobCacheEntry {
        let normalizedSha256 = try normalizedMediaSha256(sha256: entry.sha256)
        let localRelativePath = try mediaBlobCacheRelativePath(sha256: normalizedSha256)
        let mimeType = try nonEmptyMediaTransferText(value: entry.mimeType, fieldName: "Media blob cache MIME type")
        let sourceMediaAssetId = try entry.sourceMediaAssetId.map { value in
            try nonEmptyMediaTransferText(value: value, fieldName: "Media blob cache sourceMediaAssetId")
        }
        guard entry.sizeBytes >= 0 else {
            throw LocalStoreError.validation("Media blob cache size must be greater than or equal to zero")
        }

        try self.core.execute(
            sql: """
            INSERT INTO media_blob_cache (
                sha256,
                mime_type,
                size_bytes,
                local_relative_path,
                created_at,
                last_accessed_at,
                source_media_asset_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(sha256) DO UPDATE SET
                mime_type = excluded.mime_type,
                size_bytes = excluded.size_bytes,
                local_relative_path = excluded.local_relative_path,
                last_accessed_at = excluded.last_accessed_at,
                source_media_asset_id = excluded.source_media_asset_id
            """,
            values: [
                .text(normalizedSha256),
                .text(mimeType),
                .integer(entry.sizeBytes),
                .text(localRelativePath),
                .text(try nonEmptyMediaTransferText(value: entry.createdAt, fieldName: "Media blob cache createdAt")),
                .text(try nonEmptyMediaTransferText(value: entry.lastAccessedAt, fieldName: "Media blob cache lastAccessedAt")),
                mediaTransferOptionalTextValue(value: sourceMediaAssetId)
            ]
        )

        guard let cacheEntry = try self.loadOptionalBlobCacheEntry(sha256: normalizedSha256) else {
            throw LocalStoreError.database("Media blob cache upsert did not produce a readable row")
        }

        return cacheEntry
    }

    func resolveCacheHit(sha256: String, accessedAt: String) throws -> MediaBlobCacheEntry? {
        let normalizedSha256 = try normalizedMediaSha256(sha256: sha256)
        let normalizedAccessedAt = try nonEmptyMediaTransferText(
            value: accessedAt,
            fieldName: "Media blob cache accessedAt"
        )

        return try self.core.inTransaction {
            guard try self.loadOptionalBlobCacheEntry(sha256: normalizedSha256) != nil else {
                return nil
            }

            try self.core.execute(
                sql: """
                UPDATE media_blob_cache
                SET last_accessed_at = ?
                WHERE sha256 = ?
                """,
                values: [
                    .text(normalizedAccessedAt),
                    .text(normalizedSha256)
                ]
            )

            guard let cacheEntry = try self.loadOptionalBlobCacheEntry(sha256: normalizedSha256) else {
                throw LocalStoreError.database("Media blob cache row disappeared while resolving sha256=\(normalizedSha256)")
            }

            return cacheEntry
        }
    }

    func hasPendingUploadTransferMatchingAsset(
        workspaceId: String,
        mediaAssetId: String,
        sha256: String,
        mimeType: String,
        sizeBytes: Int64
    ) throws -> Bool {
        let normalizedWorkspaceId = try nonEmptyMediaTransferText(
            value: workspaceId,
            fieldName: "Media transfer workspaceId"
        )
        let normalizedMediaAssetId = try nonEmptyMediaTransferText(
            value: mediaAssetId,
            fieldName: "Media transfer mediaAssetId"
        )
        let normalizedSha256 = try normalizedMediaSha256(sha256: sha256)
        let normalizedMimeType = try nonEmptyMediaTransferText(value: mimeType, fieldName: "Media transfer MIME type")
        let localRelativePath = try mediaBlobCacheRelativePath(sha256: normalizedSha256)
        guard sizeBytes > 0 else {
            throw LocalStoreError.validation("Media transfer size must be greater than zero")
        }
        let rows = try self.core.query(
            sql: """
            SELECT 1
            FROM media_transfer_queue
            WHERE workspace_id = ?
                AND media_asset_id = ?
                AND kind = 'upload'
                AND status = 'pending'
                AND sha256 = ?
                AND LOWER(mime_type) = LOWER(?)
                AND size_bytes = ?
                AND local_relative_path = ?
            LIMIT 1
            """,
            values: [
                .text(normalizedWorkspaceId),
                .text(normalizedMediaAssetId),
                .text(normalizedSha256),
                .text(normalizedMimeType),
                .integer(sizeBytes),
                .text(localRelativePath)
            ]
        ) { statement in
            DatabaseCore.columnInt64(statement: statement, index: 0)
        }

        return rows.isEmpty == false
    }

    func hasUploadTransferMatchingAsset(
        workspaceId: String,
        mediaAssetId: String,
        sha256: String,
        mimeType: String,
        sizeBytes: Int64
    ) throws -> Bool {
        let normalizedWorkspaceId = try nonEmptyMediaTransferText(
            value: workspaceId,
            fieldName: "Media transfer workspaceId"
        )
        let normalizedMediaAssetId = try nonEmptyMediaTransferText(
            value: mediaAssetId,
            fieldName: "Media transfer mediaAssetId"
        )
        let normalizedSha256 = try normalizedMediaSha256(sha256: sha256)
        let normalizedMimeType = try nonEmptyMediaTransferText(value: mimeType, fieldName: "Media transfer MIME type")
        let localRelativePath = try mediaBlobCacheRelativePath(sha256: normalizedSha256)
        guard sizeBytes > 0 else {
            throw LocalStoreError.validation("Media transfer size must be greater than zero")
        }
        let rows = try self.core.query(
            sql: """
            SELECT 1
            FROM media_transfer_queue
            WHERE workspace_id = ?
                AND media_asset_id = ?
                AND kind = 'upload'
                AND sha256 = ?
                AND LOWER(mime_type) = LOWER(?)
                AND size_bytes = ?
                AND local_relative_path = ?
            LIMIT 1
            """,
            values: [
                .text(normalizedWorkspaceId),
                .text(normalizedMediaAssetId),
                .text(normalizedSha256),
                .text(normalizedMimeType),
                .integer(sizeBytes),
                .text(localRelativePath)
            ]
        ) { statement in
            DatabaseCore.columnInt64(statement: statement, index: 0)
        }

        return rows.isEmpty == false
    }

    func enqueueTransfer(request: MediaTransferEnqueueRequest) throws -> MediaTransferQueueEntry {
        let transferId = try nonEmptyMediaTransferText(value: request.transferId, fieldName: "Media transfer id")
        let normalizedSha256 = try normalizedMediaSha256(sha256: request.sha256)
        let localRelativePath = try mediaBlobCacheRelativePath(sha256: normalizedSha256)
        let createdAt = try nonEmptyMediaTransferText(value: request.createdAt, fieldName: "Media transfer createdAt")
        let mimeType = try nonEmptyMediaTransferText(value: request.mimeType, fieldName: "Media transfer MIME type")
        guard request.sizeBytes >= 0 else {
            throw LocalStoreError.validation("Media transfer size must be greater than or equal to zero")
        }

        try self.core.execute(
            sql: """
            INSERT INTO media_transfer_queue (
                transfer_id,
                workspace_id,
                media_asset_id,
                kind,
                status,
                sha256,
                mime_type,
                size_bytes,
                local_relative_path,
                attempt_count,
                next_attempt_at,
                claimed_at,
                last_error,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?)
            """,
            values: [
                .text(transferId),
                .text(try nonEmptyMediaTransferText(value: request.workspaceId, fieldName: "Media transfer workspaceId")),
                .text(try nonEmptyMediaTransferText(value: request.mediaAssetId, fieldName: "Media transfer mediaAssetId")),
                .text(request.kind.rawValue),
                .text(normalizedSha256),
                .text(mimeType),
                .integer(request.sizeBytes),
                .text(localRelativePath),
                .text(createdAt),
                .text(createdAt)
            ]
        )

        return try self.loadTransfer(transferId: transferId)
    }

    /// Moves queued byte transfers onto the forked workspace and asset ids.
    ///
    /// Transfer rows cascade away with the source workspace, so an interrupted
    /// upload would otherwise be lost during a workspace identity fork. Queue
    /// timestamps stay untouched because the fork changes only identity, not
    /// the transfer attempt state or its retry position.
    func rewriteTransfersForWorkspaceFork(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String,
        mediaAssetIdsBySourceId: [String: String]
    ) throws {
        let transferRows = try self.core.query(
            sql: """
            SELECT transfer_id, media_asset_id
            FROM media_transfer_queue
            WHERE workspace_id = ?
            ORDER BY transfer_id ASC
            """,
            values: [.text(sourceWorkspaceId)]
        ) { statement in
            (
                DatabaseCore.columnText(statement: statement, index: 0),
                DatabaseCore.columnText(statement: statement, index: 1)
            )
        }

        for (transferId, sourceMediaAssetId) in transferRows {
            try self.core.execute(
                sql: """
                UPDATE media_transfer_queue
                SET workspace_id = ?, media_asset_id = ?
                WHERE transfer_id = ?
                """,
                values: [
                    .text(destinationWorkspaceId),
                    .text(
                        try mediaAssetIdsBySourceId.requireMappedId(
                            entityType: "media_asset",
                            sourceId: sourceMediaAssetId
                        )
                    ),
                    .text(transferId)
                ]
            )
        }
    }

    func claimDueTransfers(
        now: String,
        staleClaimedBefore: String,
        limit: Int
    ) throws -> [MediaTransferQueueEntry] {
        try self.claimDueTransfersMatchingKind(
            workspaceId: nil,
            kind: nil,
            now: now,
            staleClaimedBefore: staleClaimedBefore,
            limit: limit
        )
    }

    func claimDueTransfers(
        kind: MediaTransferKind,
        now: String,
        staleClaimedBefore: String,
        limit: Int
    ) throws -> [MediaTransferQueueEntry] {
        try self.claimDueTransfersMatchingKind(
            workspaceId: nil,
            kind: kind,
            now: now,
            staleClaimedBefore: staleClaimedBefore,
            limit: limit
        )
    }

    func claimDueTransfers(
        workspaceId: String,
        kind: MediaTransferKind,
        now: String,
        staleClaimedBefore: String,
        limit: Int
    ) throws -> [MediaTransferQueueEntry] {
        try self.claimDueTransfersMatchingKind(
            workspaceId: workspaceId,
            kind: kind,
            now: now,
            staleClaimedBefore: staleClaimedBefore,
            limit: limit
        )
    }

    private func claimDueTransfersMatchingKind(
        workspaceId: String?,
        kind: MediaTransferKind?,
        now: String,
        staleClaimedBefore: String,
        limit: Int
    ) throws -> [MediaTransferQueueEntry] {
        guard limit > 0 else {
            throw LocalStoreError.validation("Media transfer claim limit must be greater than zero")
        }

        let normalizedNow = try nonEmptyMediaTransferText(value: now, fieldName: "Media transfer claim timestamp")
        let normalizedStaleClaimedBefore = try nonEmptyMediaTransferText(
            value: staleClaimedBefore,
            fieldName: "Media transfer stale claimed-before timestamp"
        )
        let normalizedWorkspaceId = try workspaceId.map { value in
            try nonEmptyMediaTransferText(value: value, fieldName: "Media transfer workspaceId")
        }
        return try self.core.inTransaction {
            let transferIds = try self.core.query(
                sql: """
                SELECT transfer_id
                FROM media_transfer_queue
                WHERE (? IS NULL OR workspace_id = ?)
                    AND (? IS NULL OR kind = ?)
                    AND (
                        (
                            status IN ('pending', 'failed')
                            AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                        ) OR (
                            status = 'in_progress'
                            AND claimed_at IS NOT NULL
                            AND claimed_at <= ?
                        )
                    )
                ORDER BY
                    CASE WHEN status = 'in_progress' THEN 0 ELSE 1 END ASC,
                    COALESCE(claimed_at, next_attempt_at, created_at) ASC,
                    created_at ASC,
                    transfer_id ASC
                LIMIT ?
                """,
                values: [
                    mediaTransferOptionalTextValue(value: normalizedWorkspaceId),
                    mediaTransferOptionalTextValue(value: normalizedWorkspaceId),
                    mediaTransferOptionalTextValue(value: kind?.rawValue),
                    mediaTransferOptionalTextValue(value: kind?.rawValue),
                    .text(normalizedNow),
                    .text(normalizedStaleClaimedBefore),
                    .integer(Int64(limit))
                ]
            ) { statement in
                DatabaseCore.columnText(statement: statement, index: 0)
            }

            for transferId in transferIds {
                let updatedRows = try self.core.execute(
                    sql: """
                    UPDATE media_transfer_queue
                    SET
                        status = 'in_progress',
                        claimed_at = ?,
                        next_attempt_at = NULL,
                        updated_at = ?
                    WHERE transfer_id = ?
                        AND (? IS NULL OR workspace_id = ?)
                        AND (? IS NULL OR kind = ?)
                        AND (
                            (
                                status IN ('pending', 'failed')
                                AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                            ) OR (
                                status = 'in_progress'
                                AND claimed_at IS NOT NULL
                                AND claimed_at <= ?
                            )
                        )
                    """,
                    values: [
                        .text(normalizedNow),
                        .text(normalizedNow),
                        .text(transferId),
                        mediaTransferOptionalTextValue(value: normalizedWorkspaceId),
                        mediaTransferOptionalTextValue(value: normalizedWorkspaceId),
                        mediaTransferOptionalTextValue(value: kind?.rawValue),
                        mediaTransferOptionalTextValue(value: kind?.rawValue),
                        .text(normalizedNow),
                        .text(normalizedStaleClaimedBefore)
                    ]
                )
                guard updatedRows > 0 else {
                    throw LocalStoreError.database("Media transfer claim changed while claiming transferId=\(transferId)")
                }
            }

            return try transferIds.map { transferId in
                try self.loadTransfer(transferId: transferId)
            }
        }
    }

    func markTransferSucceeded(
        transferId: String,
        claimedAt: String,
        updatedAt: String
    ) throws -> MediaTransferQueueEntry {
        let normalizedTransferId = try nonEmptyMediaTransferText(value: transferId, fieldName: "Media transfer id")
        let normalizedClaimedAt = try nonEmptyMediaTransferText(value: claimedAt, fieldName: "Media transfer claimedAt")
        let normalizedUpdatedAt = try nonEmptyMediaTransferText(value: updatedAt, fieldName: "Media transfer updatedAt")
        let updatedRows = try self.core.execute(
            sql: """
            UPDATE media_transfer_queue
            SET
                status = 'succeeded',
                next_attempt_at = NULL,
                claimed_at = NULL,
                last_error = NULL,
                updated_at = ?
            WHERE transfer_id = ?
                AND status = 'in_progress'
                AND claimed_at = ?
            """,
            values: [
                .text(normalizedUpdatedAt),
                .text(normalizedTransferId),
                .text(normalizedClaimedAt)
            ]
        )
        guard updatedRows > 0 else {
            try self.throwMissingActiveClaimError(transferId: normalizedTransferId)
        }

        return try self.loadTransfer(transferId: normalizedTransferId)
    }

    func renewTransferClaim(
        transferId: String,
        workspaceId: String,
        kind: MediaTransferKind,
        claimedAt: String,
        renewedAt: String
    ) throws -> MediaTransferQueueEntry {
        let normalizedTransferId = try nonEmptyMediaTransferText(value: transferId, fieldName: "Media transfer id")
        let normalizedWorkspaceId = try nonEmptyMediaTransferText(value: workspaceId, fieldName: "Media transfer workspaceId")
        let normalizedClaimedAt = try nonEmptyMediaTransferText(value: claimedAt, fieldName: "Media transfer claimedAt")
        let normalizedRenewedAt = try nonEmptyMediaTransferText(value: renewedAt, fieldName: "Media transfer renewedAt")
        let updatedRows = try self.core.execute(
            sql: """
            UPDATE media_transfer_queue
            SET
                claimed_at = ?,
                updated_at = ?
            WHERE transfer_id = ?
                AND workspace_id = ?
                AND kind = ?
                AND status = 'in_progress'
                AND claimed_at = ?
            """,
            values: [
                .text(normalizedRenewedAt),
                .text(normalizedRenewedAt),
                .text(normalizedTransferId),
                .text(normalizedWorkspaceId),
                .text(kind.rawValue),
                .text(normalizedClaimedAt)
            ]
        )
        guard updatedRows > 0 else {
            try self.throwMissingActiveClaimError(transferId: normalizedTransferId)
        }

        return try self.loadTransfer(transferId: normalizedTransferId)
    }

    func markTransferFailed(
        transferId: String,
        claimedAt: String,
        errorMessage: String,
        nextAttemptAt: String?,
        updatedAt: String
    ) throws -> MediaTransferQueueEntry {
        let normalizedTransferId = try nonEmptyMediaTransferText(value: transferId, fieldName: "Media transfer id")
        let normalizedClaimedAt = try nonEmptyMediaTransferText(value: claimedAt, fieldName: "Media transfer claimedAt")
        let normalizedErrorMessage = try nonEmptyMediaTransferText(
            value: errorMessage,
            fieldName: "Media transfer error message"
        )
        let normalizedNextAttemptAt = try nextAttemptAt.map { value in
            try nonEmptyMediaTransferText(value: value, fieldName: "Media transfer nextAttemptAt")
        }
        let normalizedUpdatedAt = try nonEmptyMediaTransferText(value: updatedAt, fieldName: "Media transfer updatedAt")
        let updatedRows = try self.core.execute(
            sql: """
            UPDATE media_transfer_queue
            SET
                status = 'failed',
                attempt_count = attempt_count + 1,
                next_attempt_at = ?,
                claimed_at = NULL,
                last_error = ?,
                updated_at = ?
            WHERE transfer_id = ?
                AND status = 'in_progress'
                AND claimed_at = ?
            """,
            values: [
                mediaTransferOptionalTextValue(value: normalizedNextAttemptAt),
                .text(normalizedErrorMessage),
                .text(normalizedUpdatedAt),
                .text(normalizedTransferId),
                .text(normalizedClaimedAt)
            ]
        )
        guard updatedRows > 0 else {
            try self.throwMissingActiveClaimError(transferId: normalizedTransferId)
        }

        return try self.loadTransfer(transferId: normalizedTransferId)
    }

    func markTransferCompletionTerminal(
        transferId: String,
        kind: MediaTransferKind,
        errorMessage: String,
        nextAttemptAt: String,
        updatedAt: String
    ) throws -> MediaTransferQueueEntry {
        let normalizedTransferId = try nonEmptyMediaTransferText(value: transferId, fieldName: "Media transfer id")
        let normalizedErrorMessage = try nonEmptyMediaTransferText(
            value: errorMessage,
            fieldName: "Media transfer error message"
        )
        let normalizedNextAttemptAt = try nonEmptyMediaTransferText(
            value: nextAttemptAt,
            fieldName: "Media transfer nextAttemptAt"
        )
        let normalizedUpdatedAt = try nonEmptyMediaTransferText(value: updatedAt, fieldName: "Media transfer updatedAt")
        let updatedRows = try self.core.execute(
            sql: """
            UPDATE media_transfer_queue
            SET
                status = 'failed',
                attempt_count = attempt_count + 1,
                next_attempt_at = ?,
                claimed_at = NULL,
                last_error = ?,
                updated_at = ?
            WHERE transfer_id = ?
                AND kind = ?
                AND status = 'in_progress'
            """,
            values: [
                .text(normalizedNextAttemptAt),
                .text(normalizedErrorMessage),
                .text(normalizedUpdatedAt),
                .text(normalizedTransferId),
                .text(kind.rawValue)
            ]
        )
        guard updatedRows > 0 else {
            try self.throwMissingActiveClaimError(transferId: normalizedTransferId)
        }

        return try self.loadTransfer(transferId: normalizedTransferId)
    }

    func loadOptionalBlobCacheEntry(sha256: String) throws -> MediaBlobCacheEntry? {
        let normalizedSha256 = try normalizedMediaSha256(sha256: sha256)
        let rows = try self.core.query(
            sql: """
            SELECT
            \(mediaBlobCacheSelectColumnsSQL)
            FROM media_blob_cache
            WHERE sha256 = ?
            LIMIT 1
            """,
            values: [.text(normalizedSha256)]
        ) { statement in
            self.mapBlobCacheEntry(statement: statement)
        }

        return rows.first
    }

    private func loadTransfer(transferId: String) throws -> MediaTransferQueueEntry {
        guard let entry = try self.loadOptionalTransfer(transferId: transferId) else {
            throw LocalStoreError.notFound("Media transfer not found: transferId=\(transferId)")
        }

        return entry
    }

    private func loadOptionalTransfer(transferId: String) throws -> MediaTransferQueueEntry? {
        let rows = try self.core.query(
            sql: """
            SELECT
            \(mediaTransferQueueSelectColumnsSQL)
            FROM media_transfer_queue
            WHERE transfer_id = ?
            LIMIT 1
            """,
            values: [.text(transferId)]
        ) { statement in
            try self.mapTransferQueueEntry(statement: statement)
        }

        return rows.first
    }

    private func throwMissingActiveClaimError(transferId: String) throws -> Never {
        guard try self.loadOptionalTransfer(transferId: transferId) != nil else {
            throw LocalStoreError.notFound("Media transfer not found: transferId=\(transferId)")
        }

        throw LocalStoreError.validation("Media transfer is not actively claimed: transferId=\(transferId)")
    }

    private func mapBlobCacheEntry(statement: OpaquePointer) -> MediaBlobCacheEntry {
        MediaBlobCacheEntry(
            sha256: DatabaseCore.columnText(statement: statement, index: 0),
            mimeType: DatabaseCore.columnText(statement: statement, index: 1),
            sizeBytes: DatabaseCore.columnInt64(statement: statement, index: 2),
            localRelativePath: DatabaseCore.columnText(statement: statement, index: 3),
            createdAt: DatabaseCore.columnText(statement: statement, index: 4),
            lastAccessedAt: DatabaseCore.columnText(statement: statement, index: 5),
            sourceMediaAssetId: DatabaseCore.columnOptionalText(statement: statement, index: 6)
        )
    }

    private func mapTransferQueueEntry(statement: OpaquePointer) throws -> MediaTransferQueueEntry {
        let kindRawValue = DatabaseCore.columnText(statement: statement, index: 3)
        guard let kind = MediaTransferKind(rawValue: kindRawValue) else {
            throw LocalStoreError.database("Stored media transfer kind is invalid: \(kindRawValue)")
        }
        let statusRawValue = DatabaseCore.columnText(statement: statement, index: 4)
        guard let status = MediaTransferStatus(rawValue: statusRawValue) else {
            throw LocalStoreError.database("Stored media transfer status is invalid: \(statusRawValue)")
        }

        return MediaTransferQueueEntry(
            transferId: DatabaseCore.columnText(statement: statement, index: 0),
            workspaceId: DatabaseCore.columnText(statement: statement, index: 1),
            mediaAssetId: DatabaseCore.columnText(statement: statement, index: 2),
            kind: kind,
            status: status,
            sha256: DatabaseCore.columnText(statement: statement, index: 5),
            mimeType: DatabaseCore.columnText(statement: statement, index: 6),
            sizeBytes: DatabaseCore.columnInt64(statement: statement, index: 7),
            localRelativePath: DatabaseCore.columnText(statement: statement, index: 8),
            attemptCount: Int(DatabaseCore.columnInt64(statement: statement, index: 9)),
            nextAttemptAt: DatabaseCore.columnOptionalText(statement: statement, index: 10),
            claimedAt: DatabaseCore.columnOptionalText(statement: statement, index: 11),
            lastError: DatabaseCore.columnOptionalText(statement: statement, index: 12),
            createdAt: DatabaseCore.columnText(statement: statement, index: 13),
            updatedAt: DatabaseCore.columnText(statement: statement, index: 14)
        )
    }
}

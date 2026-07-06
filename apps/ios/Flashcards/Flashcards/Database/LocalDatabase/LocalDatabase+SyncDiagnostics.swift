import Foundation

private let localSyncDiagnosticsProblemRecordLimit: Int = 5
private let localSyncDiagnosticsShortErrorMaximumLength: Int = 96

private struct LocalSyncDiagnosticsAppLocalSettingsRow: Hashable {
    let installationId: String
    let cloudState: String
}

private struct LocalSyncDiagnosticsSyncStateRow: Hashable {
    let hotCursor: Int64
    let reviewCursor: Int64
    let hotStateHydrated: Bool
}

private struct LocalSyncDiagnosticsCardTextRow: Hashable {
    let frontText: String
    let backText: String
}

private struct LocalSyncDiagnosticsMediaAssetRow: Hashable {
    let mediaAssetId: String
    let sha256: String
}

private struct LocalSyncDiagnosticsMediaBlobCacheRow: Hashable {
    let sha256: String
    let sizeBytes: Int64
    let localRelativePath: String
    let lastAccessedAt: String
}

private struct LocalSyncDiagnosticsOutboxProblemRow: Hashable {
    let operationId: String
    let entityId: String
    let createdAt: String
    let lastError: String?
}

private struct LocalSyncDiagnosticsMediaTransferProblemRow: Hashable {
    let transferId: String
    let mediaAssetId: String
    let kind: String
    let status: String
    let lastError: String?
}

extension LocalDatabase {
    func loadLocalSyncDiagnosticsSnapshot(
        workspaceId: String,
        latestCardSyncSuccess: String?,
        latestSyncError: String?
    ) throws -> LocalSyncDiagnosticsSnapshot {
        let appLocalSettings = try self.loadLocalSyncDiagnosticsAppLocalSettings()
        let syncState = try self.loadLocalSyncDiagnosticsSyncState(workspaceId: workspaceId)
        let activeCards = try self.loadLocalSyncDiagnosticsActiveCardTexts(workspaceId: workspaceId)
        let referencedMediaAssetIds = localSyncDiagnosticsReferencedMediaAssetIds(cardTexts: activeCards)
        let activeMediaAssets = try self.loadLocalSyncDiagnosticsActiveMediaAssets(workspaceId: workspaceId)
        let activeMediaAssetIds = Set(activeMediaAssets.map(\.mediaAssetId))
        let activeMediaAssetSha256s = Set(activeMediaAssets.map(\.sha256))
        let localMediaBlobCacheRows = try self.loadLocalSyncDiagnosticsExistingMediaBlobCacheRows()
        let localMediaBlobSha256s = Set(localMediaBlobCacheRows.map(\.sha256))
        let missingMediaAssetIds = referencedMediaAssetIds.subtracting(activeMediaAssetIds).sorted()
        let assetRowsMissingBlob = activeMediaAssets.filter { mediaAsset in
            localMediaBlobSha256s.contains(mediaAsset.sha256) == false
        }
        let durableDownloadTransferCount = try self.loadLocalSyncDiagnosticsDurableDownloadTransferCount(
            workspaceId: workspaceId
        )

        return LocalSyncDiagnosticsSnapshot(
            cardsSync: LocalSyncDiagnosticsCardsSync(
                workspaceId: workspaceId,
                installationId: appLocalSettings.installationId,
                cloudState: appLocalSettings.cloudState,
                localActiveCards: activeCards.count,
                localDeletedCards: try self.loadLocalSyncDiagnosticsCount(
                    sql: "SELECT COUNT(*) FROM cards WHERE workspace_id = ? AND deleted_at IS NOT NULL",
                    values: [.text(workspaceId)]
                ),
                pendingCardOperations: try self.loadLocalSyncDiagnosticsCount(
                    sql: "SELECT COUNT(*) FROM outbox WHERE workspace_id = ? AND entity_type = 'card'",
                    values: [.text(workspaceId)]
                ),
                failedCardOperations: try self.loadLocalSyncDiagnosticsCount(
                    sql: """
                    SELECT COUNT(*)
                    FROM outbox
                    WHERE workspace_id = ? AND entity_type = 'card' AND last_error IS NOT NULL
                    """,
                    values: [.text(workspaceId)]
                ),
                oldestPendingCardOperation: try self.core.scalarOptionalText(
                    sql: "SELECT MIN(created_at) FROM outbox WHERE workspace_id = ? AND entity_type = 'card'",
                    values: [.text(workspaceId)]
                ),
                latestCardSyncSuccess: latestCardSyncSuccess,
                hotStateHydrated: syncState?.hotStateHydrated,
                hotCursor: syncState?.hotCursor,
                reviewCursor: syncState?.reviewCursor,
                latestSyncError: latestSyncError
            ),
            managedMediaSync: LocalSyncDiagnosticsManagedMediaSync(
                localActiveMediaAssets: activeMediaAssets.count,
                deletedMediaAssets: try self.loadLocalSyncDiagnosticsCount(
                    sql: "SELECT COUNT(*) FROM media_assets WHERE workspace_id = ? AND deleted_at IS NOT NULL",
                    values: [.text(workspaceId)]
                ),
                localMediaBlobs: localMediaBlobSha256s.count,
                localMediaBytes: localSyncDiagnosticsMediaBlobByteCount(rows: localMediaBlobCacheRows),
                referencedMediaInCards: referencedMediaAssetIds.count,
                referencesMissingLocalAsset: missingMediaAssetIds.count,
                assetsMissingLocalBlob: assetRowsMissingBlob.count,
                pendingMediaUploads: try self.loadLocalSyncDiagnosticsCount(
                    sql: """
                    SELECT COUNT(*)
                    FROM media_transfer_queue
                    WHERE workspace_id = ? AND kind = 'upload' AND status IN ('pending', 'in_progress')
                    """,
                    values: [.text(workspaceId)]
                ),
                failedMediaUploads: try self.loadLocalSyncDiagnosticsCount(
                    sql: """
                    SELECT COUNT(*)
                    FROM media_transfer_queue
                    WHERE workspace_id = ? AND kind = 'upload' AND status = 'failed'
                    """,
                    values: [.text(workspaceId)]
                ),
                pendingMediaDownloads: try self.loadLocalSyncDiagnosticsOptionalDownloadTransferCount(
                    workspaceId: workspaceId,
                    durableDownloadTransferCount: durableDownloadTransferCount,
                    statusSQL: "status IN ('pending', 'in_progress')"
                ),
                failedMediaDownloads: try self.loadLocalSyncDiagnosticsOptionalDownloadTransferCount(
                    workspaceId: workspaceId,
                    durableDownloadTransferCount: durableDownloadTransferCount,
                    statusSQL: "status = 'failed'"
                ),
                oldestPendingMediaTransfer: try self.core.scalarOptionalText(
                    sql: """
                    SELECT MIN(created_at)
                    FROM media_transfer_queue
                    WHERE workspace_id = ? AND status IN ('pending', 'in_progress')
                    """,
                    values: [.text(workspaceId)]
                ),
                latestMediaUploadSuccess: try self.core.scalarOptionalText(
                    sql: """
                    SELECT MAX(updated_at)
                    FROM media_transfer_queue
                    WHERE workspace_id = ? AND kind = 'upload' AND status = 'succeeded'
                    """,
                    values: [.text(workspaceId)]
                ),
                latestMediaDownloadCacheSuccess: localSyncDiagnosticsLatestCacheSuccess(
                    activeMediaAssetSha256s: activeMediaAssetSha256s,
                    localMediaBlobCacheRows: localMediaBlobCacheRows
                ),
                latestMediaTransferError: try self.core.scalarOptionalText(
                    sql: """
                    SELECT last_error
                    FROM media_transfer_queue
                    WHERE workspace_id = ? AND last_error IS NOT NULL
                    ORDER BY updated_at DESC, transfer_id ASC
                    LIMIT 1
                    """,
                    values: [.text(workspaceId)]
                )
            ),
            problemRecords: try self.loadLocalSyncDiagnosticsProblemRecords(
                workspaceId: workspaceId,
                missingMediaAssetIds: missingMediaAssetIds,
                assetRowsMissingBlob: assetRowsMissingBlob
            )
        )
    }

    private func loadLocalSyncDiagnosticsAppLocalSettings() throws -> LocalSyncDiagnosticsAppLocalSettingsRow {
        let rows = try self.core.query(
            sql: """
            SELECT installation_id, cloud_state
            FROM app_local_settings
            WHERE settings_id = 1
            LIMIT 1
            """,
            values: []
        ) { statement in
            LocalSyncDiagnosticsAppLocalSettingsRow(
                installationId: DatabaseCore.columnText(statement: statement, index: 0),
                cloudState: DatabaseCore.columnText(statement: statement, index: 1)
            )
        }

        guard let row = rows.first else {
            throw LocalStoreError.database("App local settings row is missing for local sync diagnostics")
        }

        return row
    }

    private func loadLocalSyncDiagnosticsSyncState(workspaceId: String) throws -> LocalSyncDiagnosticsSyncStateRow? {
        let rows = try self.core.query(
            sql: """
            SELECT
                last_applied_hot_change_id,
                last_applied_review_sequence_id,
                has_hydrated_hot_state
            FROM sync_state
            WHERE workspace_id = ?
            LIMIT 1
            """,
            values: [.text(workspaceId)]
        ) { statement in
            LocalSyncDiagnosticsSyncStateRow(
                hotCursor: DatabaseCore.columnInt64(statement: statement, index: 0),
                reviewCursor: DatabaseCore.columnInt64(statement: statement, index: 1),
                hotStateHydrated: DatabaseCore.columnInt64(statement: statement, index: 2) != 0
            )
        }

        return rows.first
    }

    private func loadLocalSyncDiagnosticsActiveCardTexts(workspaceId: String) throws -> [LocalSyncDiagnosticsCardTextRow] {
        try self.core.query(
            sql: """
            SELECT front_text, back_text
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL
            """,
            values: [.text(workspaceId)]
        ) { statement in
            LocalSyncDiagnosticsCardTextRow(
                frontText: DatabaseCore.columnText(statement: statement, index: 0),
                backText: DatabaseCore.columnText(statement: statement, index: 1)
            )
        }
    }

    private func loadLocalSyncDiagnosticsActiveMediaAssets(
        workspaceId: String
    ) throws -> [LocalSyncDiagnosticsMediaAssetRow] {
        try self.core.query(
            sql: """
            SELECT media_asset_id, sha256
            FROM media_assets
            WHERE workspace_id = ? AND deleted_at IS NULL
            """,
            values: [.text(workspaceId)]
        ) { statement in
            LocalSyncDiagnosticsMediaAssetRow(
                mediaAssetId: DatabaseCore.columnText(statement: statement, index: 0),
                sha256: DatabaseCore.columnText(statement: statement, index: 1)
            )
        }
    }

    private func loadLocalSyncDiagnosticsExistingMediaBlobCacheRows() throws -> [LocalSyncDiagnosticsMediaBlobCacheRow] {
        let rows = try self.core.query(
            sql: """
            SELECT sha256, size_bytes, local_relative_path, last_accessed_at
            FROM media_blob_cache
            """,
            values: []
        ) { statement in
            LocalSyncDiagnosticsMediaBlobCacheRow(
                sha256: DatabaseCore.columnText(statement: statement, index: 0),
                sizeBytes: DatabaseCore.columnInt64(statement: statement, index: 1),
                localRelativePath: DatabaseCore.columnText(statement: statement, index: 2),
                lastAccessedAt: DatabaseCore.columnText(statement: statement, index: 3)
            )
        }

        return try rows.filter { row in
            try self.localSyncDiagnosticsMediaBlobFileExists(row: row)
        }
    }

    private func localSyncDiagnosticsMediaBlobFileExists(row: LocalSyncDiagnosticsMediaBlobCacheRow) throws -> Bool {
        let expectedRelativePath = try mediaBlobCacheRelativePath(sha256: row.sha256)
        guard row.localRelativePath == expectedRelativePath else {
            return false
        }

        let fileURL = self.databaseURL
            .deletingLastPathComponent()
            .appendingPathComponent(row.localRelativePath, isDirectory: false)
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDirectory)
            && isDirectory.boolValue == false
    }

    private func loadLocalSyncDiagnosticsCount(sql: String, values: [SQLiteValue]) throws -> Int {
        Int(try self.loadLocalSyncDiagnosticsInt64(sql: sql, values: values))
    }

    private func loadLocalSyncDiagnosticsInt64(sql: String, values: [SQLiteValue]) throws -> Int64 {
        let rows = try self.core.query(sql: sql, values: values) { statement in
            DatabaseCore.columnInt64(statement: statement, index: 0)
        }

        guard let value = rows.first else {
            throw LocalStoreError.database("Expected an integer result for local sync diagnostics SQL query")
        }

        return value
    }

    private func loadLocalSyncDiagnosticsDurableDownloadTransferCount(workspaceId: String) throws -> Int {
        try self.loadLocalSyncDiagnosticsCount(
            sql: "SELECT COUNT(*) FROM media_transfer_queue WHERE workspace_id = ? AND kind = 'download'",
            values: [.text(workspaceId)]
        )
    }

    private func loadLocalSyncDiagnosticsOptionalDownloadTransferCount(
        workspaceId: String,
        durableDownloadTransferCount: Int,
        statusSQL: String
    ) throws -> Int? {
        guard durableDownloadTransferCount > 0 else {
            return nil
        }

        return try self.loadLocalSyncDiagnosticsCount(
            sql: """
            SELECT COUNT(*)
            FROM media_transfer_queue
            WHERE workspace_id = ? AND kind = 'download' AND \(statusSQL)
            """,
            values: [.text(workspaceId)]
        )
    }

    private func loadLocalSyncDiagnosticsProblemRecords(
        workspaceId: String,
        missingMediaAssetIds: [String],
        assetRowsMissingBlob: [LocalSyncDiagnosticsMediaAssetRow]
    ) throws -> [LocalSyncDiagnosticsProblemRecord] {
        let outboxRecords = try self.loadLocalSyncDiagnosticsOutboxProblemRecords(workspaceId: workspaceId)
        let mediaTransferRecords = try self.loadLocalSyncDiagnosticsMediaTransferProblemRecords(
            workspaceId: workspaceId
        )
        let missingReferenceRecords = missingMediaAssetIds.prefix(localSyncDiagnosticsProblemRecordLimit).map { mediaAssetId in
            LocalSyncDiagnosticsProblemRecord(
                kind: .missingMediaReference,
                id: mediaAssetId,
                detail: "referenced_by=active_cards"
            )
        }
        let assetMissingBlobRecords = assetRowsMissingBlob
            .sorted { first, second in
                first.mediaAssetId < second.mediaAssetId
            }
            .prefix(localSyncDiagnosticsProblemRecordLimit)
            .map { mediaAsset in
                LocalSyncDiagnosticsProblemRecord(
                    kind: .assetMissingBlob,
                    id: mediaAsset.mediaAssetId,
                    detail: "sha256=\(mediaAsset.sha256)"
                )
            }

        let problemRecords = outboxRecords + mediaTransferRecords + missingReferenceRecords + assetMissingBlobRecords
        return Array(problemRecords.prefix(localSyncDiagnosticsProblemRecordLimit))
    }

    private func loadLocalSyncDiagnosticsOutboxProblemRecords(
        workspaceId: String
    ) throws -> [LocalSyncDiagnosticsProblemRecord] {
        let rows = try self.core.query(
            sql: """
            SELECT operation_id, entity_id, created_at, last_error
            FROM outbox
            WHERE workspace_id = ? AND entity_type = 'card'
            ORDER BY
                CASE WHEN last_error IS NULL THEN 1 ELSE 0 END ASC,
                created_at DESC,
                operation_id ASC
            LIMIT ?
            """,
            values: [
                .text(workspaceId),
                .integer(Int64(localSyncDiagnosticsProblemRecordLimit))
            ]
        ) { statement in
            LocalSyncDiagnosticsOutboxProblemRow(
                operationId: DatabaseCore.columnText(statement: statement, index: 0),
                entityId: DatabaseCore.columnText(statement: statement, index: 1),
                createdAt: DatabaseCore.columnText(statement: statement, index: 2),
                lastError: DatabaseCore.columnOptionalText(statement: statement, index: 3)
            )
        }

        return rows.map { row in
            LocalSyncDiagnosticsProblemRecord(
                kind: .cardOutboxEntry,
                id: row.operationId,
                detail: localSyncDiagnosticsOutboxProblemDetail(row: row)
            )
        }
    }

    private func loadLocalSyncDiagnosticsMediaTransferProblemRecords(
        workspaceId: String
    ) throws -> [LocalSyncDiagnosticsProblemRecord] {
        let rows = try self.core.query(
            sql: """
            SELECT transfer_id, media_asset_id, kind, status, last_error
            FROM media_transfer_queue
            WHERE workspace_id = ? AND status IN ('pending', 'in_progress', 'failed')
            ORDER BY
                CASE WHEN status = 'failed' THEN 0 ELSE 1 END ASC,
                updated_at DESC,
                transfer_id ASC
            LIMIT ?
            """,
            values: [
                .text(workspaceId),
                .integer(Int64(localSyncDiagnosticsProblemRecordLimit))
            ]
        ) { statement in
            LocalSyncDiagnosticsMediaTransferProblemRow(
                transferId: DatabaseCore.columnText(statement: statement, index: 0),
                mediaAssetId: DatabaseCore.columnText(statement: statement, index: 1),
                kind: DatabaseCore.columnText(statement: statement, index: 2),
                status: DatabaseCore.columnText(statement: statement, index: 3),
                lastError: DatabaseCore.columnOptionalText(statement: statement, index: 4)
            )
        }

        return rows.map { row in
            LocalSyncDiagnosticsProblemRecord(
                kind: .mediaTransfer,
                id: row.transferId,
                detail: localSyncDiagnosticsMediaTransferProblemDetail(row: row)
            )
        }
    }
}

private func localSyncDiagnosticsReferencedMediaAssetIds(
    cardTexts: [LocalSyncDiagnosticsCardTextRow]
) -> Set<String> {
    cardTexts.reduce(into: Set<String>()) { result, cardText in
        result.formUnion(managedMediaAssetIdsReferencedInMarkdown(text: cardText.frontText))
        result.formUnion(managedMediaAssetIdsReferencedInMarkdown(text: cardText.backText))
    }
}

private func localSyncDiagnosticsMediaBlobByteCount(rows: [LocalSyncDiagnosticsMediaBlobCacheRow]) -> Int64 {
    rows.reduce(Int64(0)) { result, row in
        result + row.sizeBytes
    }
}

private func localSyncDiagnosticsLatestCacheSuccess(
    activeMediaAssetSha256s: Set<String>,
    localMediaBlobCacheRows: [LocalSyncDiagnosticsMediaBlobCacheRow]
) -> String? {
    guard activeMediaAssetSha256s.isEmpty == false else {
        return nil
    }

    return localMediaBlobCacheRows
        .filter { row in
            activeMediaAssetSha256s.contains(row.sha256)
        }
        .map(\.lastAccessedAt)
        .max()
}

private func localSyncDiagnosticsOutboxProblemDetail(row: LocalSyncDiagnosticsOutboxProblemRow) -> String {
    [
        "cardId=\(row.entityId)",
        "createdAt=\(row.createdAt)",
        "error=\(localSyncDiagnosticsShortError(row.lastError))"
    ].joined(separator: " ")
}

private func localSyncDiagnosticsMediaTransferProblemDetail(
    row: LocalSyncDiagnosticsMediaTransferProblemRow
) -> String {
    [
        "mediaAssetId=\(row.mediaAssetId)",
        "kind=\(row.kind)",
        "status=\(row.status)",
        "error=\(localSyncDiagnosticsShortError(row.lastError))"
    ].joined(separator: " ")
}

private func localSyncDiagnosticsShortError(_ value: String?) -> String {
    guard let value else {
        return "-"
    }

    let trimmedValue = value
        .replacingOccurrences(of: "\r\n", with: " ")
        .replacingOccurrences(of: "\r", with: " ")
        .replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false else {
        return "-"
    }

    guard trimmedValue.count > localSyncDiagnosticsShortErrorMaximumLength else {
        return trimmedValue
    }

    let endIndex = trimmedValue.index(
        trimmedValue.startIndex,
        offsetBy: localSyncDiagnosticsShortErrorMaximumLength
    )
    return "\(String(trimmedValue[..<endIndex]))..."
}

import Foundation

struct LocalSyncDiagnosticsSnapshot: Codable, Hashable, Sendable {
    let cardsSync: LocalSyncDiagnosticsCardsSync
    let managedMediaSync: LocalSyncDiagnosticsManagedMediaSync
    let problemRecords: [LocalSyncDiagnosticsProblemRecord]

    enum CodingKeys: String, CodingKey {
        case cardsSync = "cards_sync"
        case managedMediaSync = "managed_media_sync"
        case problemRecords = "problem_records"
    }
}

struct LocalSyncDiagnosticsCardsSync: Codable, Hashable, Sendable {
    let workspaceId: String
    let installationId: String
    let cloudState: String
    let localActiveCards: Int
    let localDeletedCards: Int
    let pendingCardOperations: Int
    let failedCardOperations: Int
    let oldestPendingCardOperation: String?
    let latestCardSyncSuccess: String?
    let hotStateHydrated: Bool?
    let hotCursor: Int64?
    let reviewCursor: Int64?
    let latestSyncError: String?

    enum CodingKeys: String, CodingKey {
        case workspaceId = "workspace_id"
        case installationId = "installation_id"
        case cloudState = "cloud_state"
        case localActiveCards = "local_active_cards"
        case localDeletedCards = "local_deleted_cards"
        case pendingCardOperations = "pending_card_operations"
        case failedCardOperations = "failed_card_operations"
        case oldestPendingCardOperation = "oldest_pending_card_operation"
        case latestCardSyncSuccess = "latest_card_sync_success"
        case hotStateHydrated = "hot_state_hydrated"
        case hotCursor = "hot_cursor"
        case reviewCursor = "review_cursor"
        case latestSyncError = "latest_sync_error"
    }
}

struct LocalSyncDiagnosticsManagedMediaSync: Codable, Hashable, Sendable {
    let localActiveMediaAssets: Int
    let deletedMediaAssets: Int
    let localMediaBlobs: Int
    let localMediaBytes: Int64
    let referencedMediaInCards: Int
    let referencesMissingLocalAsset: Int
    let assetsMissingLocalBlob: Int
    let pendingMediaUploads: Int
    let failedMediaUploads: Int
    let pendingMediaDownloads: Int?
    let failedMediaDownloads: Int?
    let oldestPendingMediaTransfer: String?
    let latestMediaUploadSuccess: String?
    let latestMediaDownloadCacheSuccess: String?
    let latestMediaTransferError: String?

    enum CodingKeys: String, CodingKey {
        case localActiveMediaAssets = "local_active_media_assets"
        case deletedMediaAssets = "deleted_media_assets"
        case localMediaBlobs = "local_media_blobs"
        case localMediaBytes = "local_media_bytes"
        case referencedMediaInCards = "referenced_media_in_cards"
        case referencesMissingLocalAsset = "references_missing_local_asset"
        case assetsMissingLocalBlob = "assets_missing_local_blob"
        case pendingMediaUploads = "pending_media_uploads"
        case failedMediaUploads = "failed_media_uploads"
        case pendingMediaDownloads = "pending_media_downloads"
        case failedMediaDownloads = "failed_media_downloads"
        case oldestPendingMediaTransfer = "oldest_pending_media_transfer"
        case latestMediaUploadSuccess = "latest_media_upload_success"
        case latestMediaDownloadCacheSuccess = "latest_media_download_cache_success"
        case latestMediaTransferError = "latest_media_transfer_error"
    }
}

enum LocalSyncDiagnosticsProblemRecordKind: String, Codable, Hashable, Sendable {
    case cardOutboxEntry = "card_outbox_entry"
    case mediaTransfer = "media_transfer"
    case missingMediaReference = "missing_media_reference"
    case assetMissingBlob = "asset_missing_blob"
}

struct LocalSyncDiagnosticsProblemRecord: Codable, Hashable, Identifiable, Sendable {
    let kind: LocalSyncDiagnosticsProblemRecordKind
    let id: String
    let detail: String
}

struct LocalSyncDiagnosticsDisplaySection: Hashable, Identifiable {
    let id: String
    let title: String
    let rows: [LocalSyncDiagnosticsDisplayRow]
}

struct LocalSyncDiagnosticsDisplayRow: Hashable, Identifiable {
    let id: String
    let title: String
    let value: String
}

extension LocalSyncDiagnosticsSnapshot {
    var displaySections: [LocalSyncDiagnosticsDisplaySection] {
        [
            self.cardsSyncDisplaySection,
            self.managedMediaSyncDisplaySection,
            self.problemRecordsDisplaySection
        ]
    }

    private var cardsSyncDisplaySection: LocalSyncDiagnosticsDisplaySection {
        LocalSyncDiagnosticsDisplaySection(
            id: "cards_sync",
            title: aiSettingsLocalized("settings.localSyncDiagnostics.section.cardsSync", "Cards Sync"),
            rows: [
                LocalSyncDiagnosticsDisplayRow(
                    id: "workspace_id",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.workspaceId", "Workspace id"),
                    value: localSyncDiagnosticsTextValue(self.cardsSync.workspaceId)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "installation_id",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.installationId", "Installation id"),
                    value: localSyncDiagnosticsTextValue(self.cardsSync.installationId)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "cloud_state",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.cloudState", "Cloud state"),
                    value: localSyncDiagnosticsTextValue(self.cardsSync.cloudState)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "local_active_cards",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.localActiveCards", "Local active cards"),
                    value: localSyncDiagnosticsIntegerValue(self.cardsSync.localActiveCards)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "local_deleted_cards",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.localDeletedCards", "Local deleted cards"),
                    value: localSyncDiagnosticsIntegerValue(self.cardsSync.localDeletedCards)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "pending_card_operations",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.pendingCardOperations", "Pending card operations"),
                    value: localSyncDiagnosticsIntegerValue(self.cardsSync.pendingCardOperations)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "failed_card_operations",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.failedCardOperations", "Failed card operations"),
                    value: localSyncDiagnosticsIntegerValue(self.cardsSync.failedCardOperations)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "oldest_pending_card_operation",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.oldestPendingCardOperation", "Oldest pending card operation"),
                    value: localSyncDiagnosticsTextValue(self.cardsSync.oldestPendingCardOperation)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "latest_card_sync_success",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.latestCardSyncSuccess", "Latest card sync success"),
                    value: localSyncDiagnosticsTextValue(self.cardsSync.latestCardSyncSuccess)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "hot_state_hydrated",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.hotStateHydrated", "Hot state hydrated"),
                    value: localSyncDiagnosticsBooleanValue(self.cardsSync.hotStateHydrated)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "hot_cursor",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.hotCursor", "Hot cursor"),
                    value: localSyncDiagnosticsIntegerValue(self.cardsSync.hotCursor)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "review_cursor",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.reviewCursor", "Review cursor"),
                    value: localSyncDiagnosticsIntegerValue(self.cardsSync.reviewCursor)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "latest_sync_error",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.latestSyncError", "Latest sync error"),
                    value: localSyncDiagnosticsTextValue(self.cardsSync.latestSyncError)
                )
            ]
        )
    }

    private var managedMediaSyncDisplaySection: LocalSyncDiagnosticsDisplaySection {
        LocalSyncDiagnosticsDisplaySection(
            id: "managed_media_sync",
            title: aiSettingsLocalized("settings.localSyncDiagnostics.section.managedMediaSync", "Managed Media Sync"),
            rows: [
                LocalSyncDiagnosticsDisplayRow(
                    id: "local_active_media_assets",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.localActiveMediaAssets", "Local active media assets"),
                    value: localSyncDiagnosticsIntegerValue(self.managedMediaSync.localActiveMediaAssets)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "deleted_media_assets",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.deletedMediaAssets", "Deleted media assets"),
                    value: localSyncDiagnosticsIntegerValue(self.managedMediaSync.deletedMediaAssets)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "local_media_blobs",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.localMediaBlobs", "Local media blobs"),
                    value: localSyncDiagnosticsIntegerValue(self.managedMediaSync.localMediaBlobs)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "local_media_bytes",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.localMediaBytes", "Local media bytes"),
                    value: localSyncDiagnosticsIntegerValue(self.managedMediaSync.localMediaBytes)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "referenced_media_in_cards",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.referencedMediaInCards", "Referenced media in cards"),
                    value: localSyncDiagnosticsIntegerValue(self.managedMediaSync.referencedMediaInCards)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "references_missing_local_asset",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.referencesMissingLocalAsset", "References missing local asset"),
                    value: localSyncDiagnosticsIntegerValue(self.managedMediaSync.referencesMissingLocalAsset)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "assets_missing_local_blob",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.assetsMissingLocalBlob", "Assets missing local blob"),
                    value: localSyncDiagnosticsIntegerValue(self.managedMediaSync.assetsMissingLocalBlob)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "pending_media_uploads",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.pendingMediaUploads", "Pending media uploads"),
                    value: localSyncDiagnosticsIntegerValue(self.managedMediaSync.pendingMediaUploads)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "failed_media_uploads",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.failedMediaUploads", "Failed media uploads"),
                    value: localSyncDiagnosticsIntegerValue(self.managedMediaSync.failedMediaUploads)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "pending_media_downloads",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.pendingMediaDownloads", "Pending media downloads"),
                    value: localSyncDiagnosticsIntegerValue(self.managedMediaSync.pendingMediaDownloads)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "failed_media_downloads",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.failedMediaDownloads", "Failed media downloads"),
                    value: localSyncDiagnosticsIntegerValue(self.managedMediaSync.failedMediaDownloads)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "oldest_pending_media_transfer",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.oldestPendingMediaTransfer", "Oldest pending media transfer"),
                    value: localSyncDiagnosticsTextValue(self.managedMediaSync.oldestPendingMediaTransfer)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "latest_media_upload_success",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.latestMediaUploadSuccess", "Latest media upload success"),
                    value: localSyncDiagnosticsTextValue(self.managedMediaSync.latestMediaUploadSuccess)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "latest_media_download_cache_success",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.latestMediaDownloadCacheSuccess", "Latest media download/cache success"),
                    value: localSyncDiagnosticsTextValue(self.managedMediaSync.latestMediaDownloadCacheSuccess)
                ),
                LocalSyncDiagnosticsDisplayRow(
                    id: "latest_media_transfer_error",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.latestMediaTransferError", "Latest media transfer error"),
                    value: localSyncDiagnosticsTextValue(self.managedMediaSync.latestMediaTransferError)
                )
            ]
        )
    }

    private var problemRecordsDisplaySection: LocalSyncDiagnosticsDisplaySection {
        let rows: [LocalSyncDiagnosticsDisplayRow]
        if self.problemRecords.isEmpty {
            rows = [
                LocalSyncDiagnosticsDisplayRow(
                    id: "none",
                    title: aiSettingsLocalized("settings.localSyncDiagnostics.problemRecords", "Problem records"),
                    value: aiSettingsLocalized("settings.localSyncDiagnostics.none", "None")
                )
            ]
        } else {
            rows = self.problemRecords.map { problemRecord in
                LocalSyncDiagnosticsDisplayRow(
                    id: "\(problemRecord.kind.rawValue):\(problemRecord.id)",
                    title: localSyncDiagnosticsProblemRecordTitle(kind: problemRecord.kind),
                    value: "\(problemRecord.id) \(problemRecord.detail)"
                )
            }
        }

        return LocalSyncDiagnosticsDisplaySection(
            id: "problem_records",
            title: aiSettingsLocalized("settings.localSyncDiagnostics.section.problemRecords", "Problem Records"),
            rows: rows
        )
    }
}

private enum LocalSyncDiagnosticsReportValue: Encodable, Hashable, Sendable {
    case string(String)
    case int(Int)
    case int64(Int64)
    case bool(Bool)

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .int(let value):
            try container.encode(value)
        case .int64(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        }
    }
}

private struct LocalSyncDiagnosticsReport: Encodable {
    let cardsSync: LocalSyncDiagnosticsCardsSyncReport
    let managedMediaSync: LocalSyncDiagnosticsManagedMediaSyncReport
    let problemRecords: [LocalSyncDiagnosticsProblemRecord]

    enum CodingKeys: String, CodingKey {
        case cardsSync = "cards_sync"
        case managedMediaSync = "managed_media_sync"
        case problemRecords = "problem_records"
    }

    init(snapshot: LocalSyncDiagnosticsSnapshot) {
        self.cardsSync = LocalSyncDiagnosticsCardsSyncReport(cardsSync: snapshot.cardsSync)
        self.managedMediaSync = LocalSyncDiagnosticsManagedMediaSyncReport(
            managedMediaSync: snapshot.managedMediaSync
        )
        self.problemRecords = snapshot.problemRecords
    }
}

private struct LocalSyncDiagnosticsCardsSyncReport: Encodable {
    let workspaceId: LocalSyncDiagnosticsReportValue
    let installationId: LocalSyncDiagnosticsReportValue
    let cloudState: LocalSyncDiagnosticsReportValue
    let localActiveCards: LocalSyncDiagnosticsReportValue
    let localDeletedCards: LocalSyncDiagnosticsReportValue
    let pendingCardOperations: LocalSyncDiagnosticsReportValue
    let failedCardOperations: LocalSyncDiagnosticsReportValue
    let oldestPendingCardOperation: LocalSyncDiagnosticsReportValue
    let latestCardSyncSuccess: LocalSyncDiagnosticsReportValue
    let hotStateHydrated: LocalSyncDiagnosticsReportValue
    let hotCursor: LocalSyncDiagnosticsReportValue
    let reviewCursor: LocalSyncDiagnosticsReportValue
    let latestSyncError: LocalSyncDiagnosticsReportValue

    enum CodingKeys: String, CodingKey {
        case workspaceId = "workspace_id"
        case installationId = "installation_id"
        case cloudState = "cloud_state"
        case localActiveCards = "local_active_cards"
        case localDeletedCards = "local_deleted_cards"
        case pendingCardOperations = "pending_card_operations"
        case failedCardOperations = "failed_card_operations"
        case oldestPendingCardOperation = "oldest_pending_card_operation"
        case latestCardSyncSuccess = "latest_card_sync_success"
        case hotStateHydrated = "hot_state_hydrated"
        case hotCursor = "hot_cursor"
        case reviewCursor = "review_cursor"
        case latestSyncError = "latest_sync_error"
    }

    init(cardsSync: LocalSyncDiagnosticsCardsSync) {
        self.workspaceId = localSyncDiagnosticsReportTextValue(cardsSync.workspaceId)
        self.installationId = localSyncDiagnosticsReportTextValue(cardsSync.installationId)
        self.cloudState = localSyncDiagnosticsReportTextValue(cardsSync.cloudState)
        self.localActiveCards = localSyncDiagnosticsReportIntegerValue(cardsSync.localActiveCards)
        self.localDeletedCards = localSyncDiagnosticsReportIntegerValue(cardsSync.localDeletedCards)
        self.pendingCardOperations = localSyncDiagnosticsReportIntegerValue(cardsSync.pendingCardOperations)
        self.failedCardOperations = localSyncDiagnosticsReportIntegerValue(cardsSync.failedCardOperations)
        self.oldestPendingCardOperation = localSyncDiagnosticsReportTextValue(cardsSync.oldestPendingCardOperation)
        self.latestCardSyncSuccess = localSyncDiagnosticsReportTextValue(cardsSync.latestCardSyncSuccess)
        self.hotStateHydrated = localSyncDiagnosticsReportBooleanValue(cardsSync.hotStateHydrated)
        self.hotCursor = localSyncDiagnosticsReportIntegerValue(cardsSync.hotCursor)
        self.reviewCursor = localSyncDiagnosticsReportIntegerValue(cardsSync.reviewCursor)
        self.latestSyncError = localSyncDiagnosticsReportTextValue(cardsSync.latestSyncError)
    }
}

private struct LocalSyncDiagnosticsManagedMediaSyncReport: Encodable {
    let localActiveMediaAssets: LocalSyncDiagnosticsReportValue
    let deletedMediaAssets: LocalSyncDiagnosticsReportValue
    let localMediaBlobs: LocalSyncDiagnosticsReportValue
    let localMediaBytes: LocalSyncDiagnosticsReportValue
    let referencedMediaInCards: LocalSyncDiagnosticsReportValue
    let referencesMissingLocalAsset: LocalSyncDiagnosticsReportValue
    let assetsMissingLocalBlob: LocalSyncDiagnosticsReportValue
    let pendingMediaUploads: LocalSyncDiagnosticsReportValue
    let failedMediaUploads: LocalSyncDiagnosticsReportValue
    let pendingMediaDownloads: LocalSyncDiagnosticsReportValue
    let failedMediaDownloads: LocalSyncDiagnosticsReportValue
    let oldestPendingMediaTransfer: LocalSyncDiagnosticsReportValue
    let latestMediaUploadSuccess: LocalSyncDiagnosticsReportValue
    let latestMediaDownloadCacheSuccess: LocalSyncDiagnosticsReportValue
    let latestMediaTransferError: LocalSyncDiagnosticsReportValue

    enum CodingKeys: String, CodingKey {
        case localActiveMediaAssets = "local_active_media_assets"
        case deletedMediaAssets = "deleted_media_assets"
        case localMediaBlobs = "local_media_blobs"
        case localMediaBytes = "local_media_bytes"
        case referencedMediaInCards = "referenced_media_in_cards"
        case referencesMissingLocalAsset = "references_missing_local_asset"
        case assetsMissingLocalBlob = "assets_missing_local_blob"
        case pendingMediaUploads = "pending_media_uploads"
        case failedMediaUploads = "failed_media_uploads"
        case pendingMediaDownloads = "pending_media_downloads"
        case failedMediaDownloads = "failed_media_downloads"
        case oldestPendingMediaTransfer = "oldest_pending_media_transfer"
        case latestMediaUploadSuccess = "latest_media_upload_success"
        case latestMediaDownloadCacheSuccess = "latest_media_download_cache_success"
        case latestMediaTransferError = "latest_media_transfer_error"
    }

    init(managedMediaSync: LocalSyncDiagnosticsManagedMediaSync) {
        self.localActiveMediaAssets = localSyncDiagnosticsReportIntegerValue(
            managedMediaSync.localActiveMediaAssets
        )
        self.deletedMediaAssets = localSyncDiagnosticsReportIntegerValue(managedMediaSync.deletedMediaAssets)
        self.localMediaBlobs = localSyncDiagnosticsReportIntegerValue(managedMediaSync.localMediaBlobs)
        self.localMediaBytes = localSyncDiagnosticsReportIntegerValue(managedMediaSync.localMediaBytes)
        self.referencedMediaInCards = localSyncDiagnosticsReportIntegerValue(managedMediaSync.referencedMediaInCards)
        self.referencesMissingLocalAsset = localSyncDiagnosticsReportIntegerValue(
            managedMediaSync.referencesMissingLocalAsset
        )
        self.assetsMissingLocalBlob = localSyncDiagnosticsReportIntegerValue(managedMediaSync.assetsMissingLocalBlob)
        self.pendingMediaUploads = localSyncDiagnosticsReportIntegerValue(managedMediaSync.pendingMediaUploads)
        self.failedMediaUploads = localSyncDiagnosticsReportIntegerValue(managedMediaSync.failedMediaUploads)
        self.pendingMediaDownloads = localSyncDiagnosticsReportIntegerValue(managedMediaSync.pendingMediaDownloads)
        self.failedMediaDownloads = localSyncDiagnosticsReportIntegerValue(managedMediaSync.failedMediaDownloads)
        self.oldestPendingMediaTransfer = localSyncDiagnosticsReportTextValue(
            managedMediaSync.oldestPendingMediaTransfer
        )
        self.latestMediaUploadSuccess = localSyncDiagnosticsReportTextValue(
            managedMediaSync.latestMediaUploadSuccess
        )
        self.latestMediaDownloadCacheSuccess = localSyncDiagnosticsReportTextValue(
            managedMediaSync.latestMediaDownloadCacheSuccess
        )
        self.latestMediaTransferError = localSyncDiagnosticsReportTextValue(
            managedMediaSync.latestMediaTransferError
        )
    }
}

func localSyncDiagnosticsReportText(snapshot: LocalSyncDiagnosticsSnapshot) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(LocalSyncDiagnosticsReport(snapshot: snapshot))
    guard let reportText = String(data: data, encoding: .utf8) else {
        throw LocalStoreError.database("Local sync diagnostics report could not be encoded as UTF-8")
    }

    return reportText
}

private func localSyncDiagnosticsReportTextValue(_ value: String?) -> LocalSyncDiagnosticsReportValue {
    .string(localSyncDiagnosticsTextValue(value))
}

private func localSyncDiagnosticsReportIntegerValue(_ value: Int) -> LocalSyncDiagnosticsReportValue {
    .int(value)
}

private func localSyncDiagnosticsReportIntegerValue(_ value: Int64) -> LocalSyncDiagnosticsReportValue {
    .int64(value)
}

private func localSyncDiagnosticsReportIntegerValue(_ value: Int?) -> LocalSyncDiagnosticsReportValue {
    guard let value else {
        return .string("-")
    }

    return .int(value)
}

private func localSyncDiagnosticsReportIntegerValue(_ value: Int64?) -> LocalSyncDiagnosticsReportValue {
    guard let value else {
        return .string("-")
    }

    return .int64(value)
}

private func localSyncDiagnosticsReportBooleanValue(_ value: Bool?) -> LocalSyncDiagnosticsReportValue {
    guard let value else {
        return .string("-")
    }

    return .bool(value)
}

private func localSyncDiagnosticsTextValue(_ value: String?) -> String {
    guard let value else {
        return "-"
    }

    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedValue.isEmpty ? "-" : trimmedValue
}

private func localSyncDiagnosticsIntegerValue(_ value: Int) -> String {
    String(value)
}

private func localSyncDiagnosticsIntegerValue(_ value: Int64) -> String {
    String(value)
}

private func localSyncDiagnosticsIntegerValue(_ value: Int?) -> String {
    guard let value else {
        return "-"
    }

    return String(value)
}

private func localSyncDiagnosticsIntegerValue(_ value: Int64?) -> String {
    guard let value else {
        return "-"
    }

    return String(value)
}

private func localSyncDiagnosticsBooleanValue(_ value: Bool?) -> String {
    guard let value else {
        return "-"
    }

    return value ? "true" : "false"
}

private func localSyncDiagnosticsProblemRecordTitle(kind: LocalSyncDiagnosticsProblemRecordKind) -> String {
    switch kind {
    case .cardOutboxEntry:
        return aiSettingsLocalized("settings.localSyncDiagnostics.problem.cardOutboxEntry", "Card outbox")
    case .mediaTransfer:
        return aiSettingsLocalized("settings.localSyncDiagnostics.problem.mediaTransfer", "Media transfer")
    case .missingMediaReference:
        return aiSettingsLocalized("settings.localSyncDiagnostics.problem.missingMediaReference", "Missing media reference")
    case .assetMissingBlob:
        return aiSettingsLocalized("settings.localSyncDiagnostics.problem.assetMissingBlob", "Asset missing blob")
    }
}

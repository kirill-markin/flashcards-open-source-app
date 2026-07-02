import Foundation

private let mediaSha256AllowedScalars = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
private let mediaBlobCacheRelativePathPrefix = "media/blobs/sha256"

// Keep in sync with apps/backend/src/media/assets.ts::MediaAssetRecord and
// apps/web/src/types.ts::MediaAsset.
struct MediaAsset: Codable, Identifiable, Hashable, Sendable {
    let mediaAssetId: String
    let workspaceId: String
    let mimeType: String
    let sizeBytes: Int64
    let sha256: String
    let sourceUrl: String?
    let createdAt: String
    let clientUpdatedAt: String
    let lastModifiedByReplicaId: String
    let lastOperationId: String
    let updatedAt: String
    let deletedAt: String?

    var id: String {
        self.mediaAssetId
    }

    init(
        mediaAssetId: String,
        workspaceId: String,
        mimeType: String,
        sizeBytes: Int64,
        sha256: String,
        sourceUrl: String?,
        createdAt: String,
        clientUpdatedAt: String,
        lastModifiedByReplicaId: String,
        lastOperationId: String,
        updatedAt: String,
        deletedAt: String?
    ) {
        self.mediaAssetId = mediaAssetId
        self.workspaceId = workspaceId
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
        self.sha256 = sha256
        self.sourceUrl = sourceUrl
        self.createdAt = createdAt
        self.clientUpdatedAt = clientUpdatedAt
        self.lastModifiedByReplicaId = lastModifiedByReplicaId
        self.lastOperationId = lastOperationId
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
    }
}

struct MediaBlobCacheEntry: Hashable, Sendable {
    let sha256: String
    let mimeType: String
    let sizeBytes: Int64
    let localRelativePath: String
    let createdAt: String
    let lastAccessedAt: String
    let sourceMediaAssetId: String?
}

struct MediaBlobCacheUpsert: Hashable, Sendable {
    let sha256: String
    let mimeType: String
    let sizeBytes: Int64
    let createdAt: String
    let lastAccessedAt: String
    let sourceMediaAssetId: String?
}

enum MediaTransferKind: String, Codable, Hashable, Sendable {
    case upload
    case download
}

enum MediaTransferStatus: String, Codable, Hashable, Sendable {
    case pending
    case inProgress = "in_progress"
    case succeeded
    case failed
}

struct MediaTransferQueueEntry: Hashable, Sendable {
    let transferId: String
    let workspaceId: String
    let mediaAssetId: String
    let kind: MediaTransferKind
    let status: MediaTransferStatus
    let sha256: String
    let mimeType: String
    let sizeBytes: Int64
    let localRelativePath: String
    let attemptCount: Int
    let nextAttemptAt: String?
    let claimedAt: String?
    let lastError: String?
    let createdAt: String
    let updatedAt: String
}

struct MediaTransferEnqueueRequest: Hashable, Sendable {
    let transferId: String
    let workspaceId: String
    let mediaAssetId: String
    let kind: MediaTransferKind
    let sha256: String
    let mimeType: String
    let sizeBytes: Int64
    let createdAt: String
}

func normalizedMediaSha256(sha256: String) throws -> String {
    let normalizedSha256 = sha256.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard normalizedSha256.count == 64 else {
        throw LocalStoreError.validation("Media SHA-256 digest must be exactly 64 hexadecimal characters")
    }
    guard normalizedSha256.unicodeScalars.allSatisfy({ mediaSha256AllowedScalars.contains($0) }) else {
        throw LocalStoreError.validation("Media SHA-256 digest must contain only hexadecimal characters")
    }

    return normalizedSha256
}

func mediaBlobCacheRelativePath(sha256: String) throws -> String {
    let normalizedSha256 = try normalizedMediaSha256(sha256: sha256)
    let secondDirectoryStart = normalizedSha256.index(normalizedSha256.startIndex, offsetBy: 2)
    let secondDirectoryEnd = normalizedSha256.index(secondDirectoryStart, offsetBy: 2)
    let firstDirectory = String(normalizedSha256.prefix(2))
    let secondDirectory = String(normalizedSha256[secondDirectoryStart..<secondDirectoryEnd])

    return "\(mediaBlobCacheRelativePathPrefix)/\(firstDirectory)/\(secondDirectory)/\(normalizedSha256)"
}

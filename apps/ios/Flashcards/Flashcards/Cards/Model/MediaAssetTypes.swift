import Foundation

// Keep in sync with apps/backend/src/media/assets.ts::MediaAssetRecord and
// apps/web/src/types.ts::MediaAsset.
struct MediaAsset: Codable, Identifiable, Hashable, Sendable {
    let mediaAssetId: String
    let workspaceId: String
    let mimeType: String
    let sizeBytes: Int64
    let sha256: String
    let storageKey: String
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
        storageKey: String,
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
        self.storageKey = storageKey
        self.sourceUrl = sourceUrl
        self.createdAt = createdAt
        self.clientUpdatedAt = clientUpdatedAt
        self.lastModifiedByReplicaId = lastModifiedByReplicaId
        self.lastOperationId = lastOperationId
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
    }
}

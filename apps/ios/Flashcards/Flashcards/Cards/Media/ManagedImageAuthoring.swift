import Foundation

struct ManagedImageAuthoringResult: Hashable, Sendable {
    let mediaAsset: MediaAsset
    let cacheEntry: MediaBlobCacheEntry
    let transferEntry: MediaTransferQueueEntry
    let markdown: String
}

func authorManagedImage(
    database: LocalDatabase,
    workspaceId: String,
    installationId: String,
    sourceImageData: Data,
    altText: String
) throws -> ManagedImageAuthoringResult {
    let normalizedWorkspaceId = try nonEmptyManagedImageAuthoringText(
        value: workspaceId,
        fieldName: "Managed image workspace id"
    )
    let normalizedInstallationId = try nonEmptyManagedImageAuthoringText(
        value: installationId,
        fieldName: "Managed image installation id"
    )
    let preparedImage = try prepareManagedImageData(sourceImageData: sourceImageData)
    let mediaAssetId = UUID().uuidString.lowercased()
    let transferId = UUID().uuidString.lowercased()
    let createdAt = nowIsoTimestamp()
    let cacheURL = try managedImageBlobCacheFileURL(
        databaseURL: database.databaseURL,
        sha256: preparedImage.sha256
    )
    let cacheFileExistedBeforeWrite = FileManager.default.fileExists(atPath: cacheURL.path)

    try writeManagedImageBlobCacheFile(data: preparedImage.data, fileURL: cacheURL)

    do {
        let result = try database.core.inTransaction {
            let cacheEntry = try database.mediaTransferStore.upsertBlobCacheEntry(
                entry: MediaBlobCacheUpsert(
                    sha256: preparedImage.sha256,
                    mimeType: preparedImage.mimeType,
                    sizeBytes: preparedImage.sizeBytes,
                    createdAt: createdAt,
                    lastAccessedAt: createdAt,
                    sourceMediaAssetId: mediaAssetId
                )
            )
            let mediaAsset = MediaAsset(
                mediaAssetId: mediaAssetId,
                workspaceId: normalizedWorkspaceId,
                mimeType: preparedImage.mimeType,
                sizeBytes: preparedImage.sizeBytes,
                sha256: preparedImage.sha256,
                sourceUrl: nil,
                createdAt: createdAt,
                clientUpdatedAt: createdAt,
                lastModifiedByReplicaId: mediaUploadWorkspaceReplicaId(
                    workspaceId: normalizedWorkspaceId,
                    installationId: normalizedInstallationId
                ),
                lastOperationId: transferId,
                updatedAt: createdAt,
                deletedAt: nil
            )
            try database.mediaAssetStore.upsertMediaAsset(
                workspaceId: normalizedWorkspaceId,
                mediaAsset: mediaAsset
            )
            let transferEntry = try database.mediaTransferStore.enqueueTransfer(
                request: MediaTransferEnqueueRequest(
                    transferId: transferId,
                    workspaceId: normalizedWorkspaceId,
                    mediaAssetId: mediaAssetId,
                    kind: .upload,
                    sha256: preparedImage.sha256,
                    mimeType: preparedImage.mimeType,
                    sizeBytes: preparedImage.sizeBytes,
                    createdAt: createdAt
                )
            )

            return ManagedImageAuthoringResult(
                mediaAsset: mediaAsset,
                cacheEntry: cacheEntry,
                transferEntry: transferEntry,
                markdown: try managedImageMarkdownReference(
                    mediaAssetId: mediaAssetId,
                    altText: altText
                )
            )
        }

        return result
    } catch {
        if cacheFileExistedBeforeWrite == false {
            try removeManagedImageBlobCacheFileAfterFailure(fileURL: cacheURL, failure: error)
        }
        throw error
    }
}

private func nonEmptyManagedImageAuthoringText(value: String, fieldName: String) throws -> String {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false else {
        throw LocalStoreError.validation("\(fieldName) must not be empty")
    }

    return trimmedValue
}

private func managedImageBlobCacheFileURL(databaseURL: URL, sha256: String) throws -> URL {
    let localRelativePath = try mediaBlobCacheRelativePath(sha256: sha256)
    return databaseURL
        .deletingLastPathComponent()
        .appendingPathComponent(localRelativePath, isDirectory: false)
}

private func writeManagedImageBlobCacheFile(data: Data, fileURL: URL) throws {
    do {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: nil
        )
        try data.write(to: fileURL, options: [.atomic])
    } catch {
        throw LocalStoreError.database(
            "Managed image blob cache write failed path=\(fileURL.path): \(Flashcards.errorMessage(error: error))"
        )
    }
}

private func removeManagedImageBlobCacheFileAfterFailure(fileURL: URL, failure: Error) throws {
    guard FileManager.default.fileExists(atPath: fileURL.path) else {
        return
    }

    do {
        try FileManager.default.removeItem(at: fileURL)
    } catch {
        throw LocalStoreError.database(
            "Managed image authoring failed and cache cleanup failed path=\(fileURL.path): authoringError=\(Flashcards.errorMessage(error: failure)); cleanupError=\(Flashcards.errorMessage(error: error))"
        )
    }
}

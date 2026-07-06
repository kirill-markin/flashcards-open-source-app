import Foundation

func prepareReviewManagedMediaPartialDownloadFile(
    partialFileURL: URL,
    mediaAssetId: String,
    expectedSizeBytes: Int64
) throws -> Int64 {
    guard expectedSizeBytes >= 0 else {
        throw LocalStoreError.validation(
            "Managed media partial download expected size must be non-negative for mediaAssetId=\(mediaAssetId)"
        )
    }
    try createReviewManagedMediaCacheDirectory(
        directoryURL: partialFileURL.deletingLastPathComponent(),
        mediaAssetId: mediaAssetId
    )

    guard FileManager.default.fileExists(atPath: partialFileURL.path) else {
        guard FileManager.default.createFile(atPath: partialFileURL.path, contents: nil, attributes: nil) else {
            throw LocalStoreError.database(
                "Managed media partial download file could not be created for mediaAssetId=\(mediaAssetId) path=\(partialFileURL.path)"
            )
        }
        return 0
    }

    let sizeBytes = try reviewManagedMediaRegularFileSize(
        fileURL: partialFileURL,
        mediaAssetId: mediaAssetId
    )
    guard sizeBytes <= expectedSizeBytes else {
        let failure = LocalStoreError.database(
            "Managed media partial download was larger than expected for mediaAssetId=\(mediaAssetId): expected \(expectedSizeBytes), found \(sizeBytes); deleted partial file"
        )
        try removeReviewManagedMediaPartialDownloadAfterFailure(
            fileURL: partialFileURL,
            mediaAssetId: mediaAssetId,
            failure: failure,
            reason: "partial_size_exceeded_expected"
        )
    }

    return sizeBytes
}

private func createReviewManagedMediaCacheDirectory(
    directoryURL: URL,
    mediaAssetId: String
) throws {
    do {
        try FileManager.default.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true,
            attributes: nil
        )
    } catch {
        throw LocalStoreError.database(
            "Managed media cache directory creation failed for mediaAssetId=\(mediaAssetId) path=\(directoryURL.path): \(Flashcards.errorMessage(error: error))"
        )
    }
}

private func reviewManagedMediaRegularFileSize(
    fileURL: URL,
    mediaAssetId: String
) throws -> Int64 {
    let attributes: [FileAttributeKey: Any]
    do {
        attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
    } catch {
        throw LocalStoreError.database(
            "Managed media file attributes could not be read for mediaAssetId=\(mediaAssetId) path=\(fileURL.path): \(Flashcards.errorMessage(error: error))"
        )
    }

    guard let fileType = attributes[.type] as? FileAttributeType,
          fileType == .typeRegular else {
        let failure = LocalStoreError.database(
            "Managed media partial download path was not a regular file for mediaAssetId=\(mediaAssetId) path=\(fileURL.path); deleted partial path"
        )
        try removeReviewManagedMediaPartialDownloadAfterFailure(
            fileURL: fileURL,
            mediaAssetId: mediaAssetId,
            failure: failure,
            reason: "partial_path_not_regular_file"
        )
    }

    guard let sizeNumber = attributes[.size] as? NSNumber else {
        throw LocalStoreError.database(
            "Managed media file size attribute was missing for mediaAssetId=\(mediaAssetId) path=\(fileURL.path)"
        )
    }

    return sizeNumber.int64Value
}

func openReviewManagedMediaPartialFileForWriting(
    partialFileURL: URL,
    mediaAssetId: String
) throws -> FileHandle {
    do {
        return try FileHandle(forWritingTo: partialFileURL)
    } catch {
        throw LocalStoreError.database(
            "Managed media partial download file could not be opened for writing for mediaAssetId=\(mediaAssetId) path=\(partialFileURL.path): \(Flashcards.errorMessage(error: error))"
        )
    }
}

func seekReviewManagedMediaPartialFileToEnd(
    fileHandle: FileHandle,
    mediaAssetId: String
) throws {
    do {
        _ = try fileHandle.seekToEnd()
    } catch {
        throw LocalStoreError.database(
            "Managed media partial download seek failed for mediaAssetId=\(mediaAssetId): \(Flashcards.errorMessage(error: error))"
        )
    }
}

func appendReviewManagedMediaPartialChunk(
    fileHandle: FileHandle,
    chunk: Data,
    mediaAssetId: String
) throws {
    do {
        try fileHandle.write(contentsOf: chunk)
    } catch {
        throw LocalStoreError.database(
            "Managed media partial download write failed for mediaAssetId=\(mediaAssetId): \(Flashcards.errorMessage(error: error))"
        )
    }
}

func closeReviewManagedMediaPartialFile(
    fileHandle: FileHandle,
    mediaAssetId: String
) throws {
    do {
        try fileHandle.close()
    } catch {
        throw LocalStoreError.database(
            "Managed media partial download file close failed for mediaAssetId=\(mediaAssetId): \(Flashcards.errorMessage(error: error))"
        )
    }
}

func closeReviewManagedMediaPartialFileAfterFailure(
    fileHandle: FileHandle,
    mediaAssetId: String,
    failure: Error
) throws -> Never {
    do {
        try fileHandle.close()
    } catch {
        throw LocalStoreError.database(
            "Managed media partial download failed and file close failed for mediaAssetId=\(mediaAssetId): operationError=\(Flashcards.errorMessage(error: failure)); closeError=\(Flashcards.errorMessage(error: error))"
        )
    }

    throw failure
}

func publishReviewManagedMediaPartialBlobFile(
    partialFileURL: URL,
    destinationURL: URL,
    mediaAssetId: String
) throws -> URL {
    try createReviewManagedMediaCacheDirectory(
        directoryURL: destinationURL.deletingLastPathComponent(),
        mediaAssetId: mediaAssetId
    )

    guard FileManager.default.fileExists(atPath: destinationURL.path) else {
        do {
            try FileManager.default.moveItem(at: partialFileURL, to: destinationURL)
            return destinationURL
        } catch {
            throw LocalStoreError.database(
                "Managed media cache publish move failed for mediaAssetId=\(mediaAssetId) from=\(partialFileURL.path) to=\(destinationURL.path): \(Flashcards.errorMessage(error: error))"
            )
        }
    }

    do {
        let resultingURL = try FileManager.default.replaceItemAt(
            destinationURL,
            withItemAt: partialFileURL,
            backupItemName: nil,
            options: []
        )
        return resultingURL ?? destinationURL
    } catch {
        throw LocalStoreError.database(
            "Managed media cache publish replace failed for mediaAssetId=\(mediaAssetId) from=\(partialFileURL.path) to=\(destinationURL.path): \(Flashcards.errorMessage(error: error))"
        )
    }
}

private func removeReviewManagedMediaPartialDownload(
    fileURL: URL,
    mediaAssetId: String,
    reason: String
) throws {
    guard FileManager.default.fileExists(atPath: fileURL.path) else {
        return
    }

    do {
        try FileManager.default.removeItem(at: fileURL)
    } catch {
        throw LocalStoreError.database(
            "Managed media partial download cleanup failed for mediaAssetId=\(mediaAssetId) reason=\(reason): \(Flashcards.errorMessage(error: error))"
        )
    }
}

func removeReviewManagedMediaPartialDownloadAfterFailure(
    fileURL: URL,
    mediaAssetId: String,
    failure: Error,
    reason: String
) throws -> Never {
    do {
        try removeReviewManagedMediaPartialDownload(
            fileURL: fileURL,
            mediaAssetId: mediaAssetId,
            reason: reason
        )
    } catch {
        throw LocalStoreError.database(
            "Managed media partial download failed and cleanup failed for mediaAssetId=\(mediaAssetId) reason=\(reason): operationError=\(Flashcards.errorMessage(error: failure)); cleanupError=\(Flashcards.errorMessage(error: error))"
        )
    }

    throw failure
}

func reviewManagedMediaCacheFileURL(
    databaseURL: URL,
    cacheEntry: MediaBlobCacheEntry
) throws -> URL {
    let expectedRelativePath = try mediaBlobCacheRelativePath(sha256: cacheEntry.sha256)
    guard cacheEntry.localRelativePath == expectedRelativePath else {
        throw LocalStoreError.database(
            "Managed media cache path mismatch for sha256=\(cacheEntry.sha256)"
        )
    }

    return databaseURL
        .deletingLastPathComponent()
        .appendingPathComponent(expectedRelativePath, isDirectory: false)
}

func reviewManagedMediaCacheFileURL(
    databaseURL: URL,
    sha256: String
) throws -> URL {
    let localRelativePath = try mediaBlobCacheRelativePath(sha256: sha256)
    return databaseURL
        .deletingLastPathComponent()
        .appendingPathComponent(localRelativePath, isDirectory: false)
}

func reviewManagedMediaPartialCacheFileURL(
    databaseURL: URL,
    sha256: String
) throws -> URL {
    try reviewManagedMediaCacheFileURL(
        databaseURL: databaseURL,
        sha256: sha256
    ).appendingPathExtension("partial")
}

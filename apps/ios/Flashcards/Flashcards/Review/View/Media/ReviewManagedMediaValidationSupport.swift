import CryptoKit
import Foundation

private let reviewManagedMediaValidationChunkSizeBytes: Int = 1_048_576

func validateReviewManagedMediaBlob(
    fileURL: URL,
    mediaAsset: MediaAsset,
    expectedSha256: String
) throws {
    guard mediaAsset.sizeBytes >= 0 else {
        throw LocalStoreError.validation(
            "Managed media asset size must be non-negative for mediaAssetId=\(mediaAsset.mediaAssetId)"
        )
    }

    let fileHandle = try FileHandle(forReadingFrom: fileURL)
    let actual: ReviewManagedMediaBlobValidation
    do {
        actual = try streamReviewManagedMediaBlobValidation(fileHandle: fileHandle)
    } catch {
        try closeReviewManagedMediaFileHandleAfterFailure(
            fileHandle: fileHandle,
            mediaAssetId: mediaAsset.mediaAssetId,
            validationError: error
        )
        throw error
    }
    try closeReviewManagedMediaFileHandle(
        fileHandle: fileHandle,
        mediaAssetId: mediaAsset.mediaAssetId
    )

    guard actual.sizeBytes == mediaAsset.sizeBytes else {
        throw LocalStoreError.validation(
            "Managed media download size mismatch for mediaAssetId=\(mediaAsset.mediaAssetId): expected \(mediaAsset.sizeBytes), received \(actual.sizeBytes)"
        )
    }
    guard actual.sha256 == expectedSha256 else {
        throw LocalStoreError.validation(
            "Managed media download SHA-256 mismatch for mediaAssetId=\(mediaAsset.mediaAssetId): expected \(expectedSha256), received \(actual.sha256)"
        )
    }
}

private struct ReviewManagedMediaBlobValidation {
    let sizeBytes: Int64
    let sha256: String

    init(sizeBytes: Int64, sha256: String) {
        self.sizeBytes = sizeBytes
        self.sha256 = sha256
    }
}

private func streamReviewManagedMediaBlobValidation(fileHandle: FileHandle) throws -> ReviewManagedMediaBlobValidation {
    var hasher = SHA256()
    var sizeBytes: Int64 = 0

    while true {
        guard let chunk = try fileHandle.read(upToCount: reviewManagedMediaValidationChunkSizeBytes),
              chunk.isEmpty == false else {
            break
        }

        sizeBytes += Int64(chunk.count)
        hasher.update(data: chunk)
    }

    let sha256 = hasher.finalize().map { byte in
        String(format: "%02x", byte)
    }.joined()
    return ReviewManagedMediaBlobValidation(sizeBytes: sizeBytes, sha256: sha256)
}

private func closeReviewManagedMediaFileHandle(
    fileHandle: FileHandle,
    mediaAssetId: String
) throws {
    do {
        try fileHandle.close()
    } catch {
        throw LocalStoreError.database(
            "Managed media validation file close failed for mediaAssetId=\(mediaAssetId): \(Flashcards.errorMessage(error: error))"
        )
    }
}

private func closeReviewManagedMediaFileHandleAfterFailure(
    fileHandle: FileHandle,
    mediaAssetId: String,
    validationError: Error
) throws {
    do {
        try fileHandle.close()
    } catch {
        throw LocalStoreError.database(
            "Managed media validation failed and file close failed for mediaAssetId=\(mediaAssetId): validationError=\(Flashcards.errorMessage(error: validationError)); closeError=\(Flashcards.errorMessage(error: error))"
        )
    }
}

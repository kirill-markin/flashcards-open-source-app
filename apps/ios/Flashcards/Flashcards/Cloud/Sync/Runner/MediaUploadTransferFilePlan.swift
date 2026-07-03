import CryptoKit
import Foundation

struct MediaUploadPartPlan: Sendable {
    let partNumber: Int
    let offsetBytes: UInt64
    let sizeBytes: Int
    let sha256: String
}

struct MediaUploadTransferPlan: Sendable {
    let fileURL: URL
    let sha256: String
    let sizeBytes: Int64
    let partSizeBytes: Int64
    let parts: [MediaUploadPartPlan]
}

private struct MediaUploadFilePlanScan: Sendable {
    let sha256: String
    let sizeBytes: Int64
    let parts: [MediaUploadPartPlan]
}

func makeMediaUploadTransferPlanOffMain(
    databaseURL: URL,
    entry: MediaTransferQueueEntry
) async throws -> MediaUploadTransferPlan {
    let task = Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return try makeMediaUploadTransferPlan(databaseURL: databaseURL, entry: entry)
    }
    return try await withTaskCancellationHandler {
        try await task.value
    } onCancel: {
        task.cancel()
    }
}

func makeMediaUploadTransferPlan(databaseURL: URL, entry: MediaTransferQueueEntry) throws -> MediaUploadTransferPlan {
    guard entry.kind == .upload else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media transfer runner received non-upload transferId=\(entry.transferId) kind=\(entry.kind.rawValue)"
        )
    }
    guard entry.sizeBytes > 0 else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media upload size must be positive transferId=\(entry.transferId) sizeBytes=\(entry.sizeBytes)"
        )
    }

    let normalizedSha256 = try normalizedMediaSha256(sha256: entry.sha256)
    let expectedRelativePath = try mediaBlobCacheRelativePath(sha256: normalizedSha256)
    guard entry.localRelativePath == expectedRelativePath else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media upload local path mismatch transferId=\(entry.transferId) expected=\(expectedRelativePath) actual=\(entry.localRelativePath)"
        )
    }

    let fileURL = databaseURL
        .deletingLastPathComponent()
        .appendingPathComponent(entry.localRelativePath, isDirectory: false)
    guard FileManager.default.fileExists(atPath: fileURL.path) else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media upload local file is missing transferId=\(entry.transferId) path=\(entry.localRelativePath)"
        )
    }

    let partSizeBytes = min(entry.sizeBytes, mediaUploadMultipartPartSizeBytes)
    let scan = try streamMediaUploadFilePlan(
        fileURL: fileURL,
        mediaAssetId: entry.mediaAssetId,
        partSizeBytes: partSizeBytes
    )
    guard scan.sizeBytes == entry.sizeBytes else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media upload file size mismatch transferId=\(entry.transferId) expected=\(entry.sizeBytes) actual=\(scan.sizeBytes)"
        )
    }
    guard scan.sha256 == normalizedSha256 else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media upload SHA-256 mismatch transferId=\(entry.transferId) expected=\(normalizedSha256) actual=\(scan.sha256)"
        )
    }

    return MediaUploadTransferPlan(
        fileURL: fileURL,
        sha256: scan.sha256,
        sizeBytes: scan.sizeBytes,
        partSizeBytes: partSizeBytes,
        parts: scan.parts
    )
}

private func streamMediaUploadFilePlan(
    fileURL: URL,
    mediaAssetId: String,
    partSizeBytes: Int64
) throws -> MediaUploadFilePlanScan {
    guard partSizeBytes > 0 && partSizeBytes <= Int64(Int.max) else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media upload part size is invalid mediaAssetId=\(mediaAssetId) partSizeBytes=\(partSizeBytes)"
        )
    }

    let fileHandle = try FileHandle(forReadingFrom: fileURL)
    let scan = try scanMediaUploadFileHandle(
        fileHandle: fileHandle,
        mediaAssetId: mediaAssetId,
        partSizeBytes: partSizeBytes
    )
    try closeMediaUploadFileHandle(fileHandle: fileHandle, mediaAssetId: mediaAssetId)
    return scan
}

private func scanMediaUploadFileHandle(
    fileHandle: FileHandle,
    mediaAssetId: String,
    partSizeBytes: Int64
) throws -> MediaUploadFilePlanScan {
    do {
        var nextParts: [MediaUploadPartPlan] = []
        var offsetBytes: UInt64 = 0
        var sizeBytes: Int64 = 0
        var fullHasher = SHA256()
        while true {
            try Task.checkCancellation()
            let partData = try readMediaUploadChunk(
                fileHandle: fileHandle,
                maxSizeBytes: Int(partSizeBytes)
            )
            guard partData.isEmpty == false else {
                break
            }

            nextParts.append(
                MediaUploadPartPlan(
                    partNumber: nextParts.count + 1,
                    offsetBytes: offsetBytes,
                    sizeBytes: partData.count,
                    sha256: hexSHA256(data: partData)
                )
            )
            fullHasher.update(data: partData)
            sizeBytes += Int64(partData.count)
            offsetBytes += UInt64(partData.count)
        }
        guard nextParts.isEmpty == false else {
            throw MediaUploadTransferFailure(
                policy: .permanent,
                message: "Media upload file produced no upload parts mediaAssetId=\(mediaAssetId)"
            )
        }
        let scan = MediaUploadFilePlanScan(
            sha256: hexSHA256(digest: fullHasher.finalize()),
            sizeBytes: sizeBytes,
            parts: nextParts
        )
        return scan
    } catch {
        try closeMediaUploadFileHandleAfterFailure(
            fileHandle: fileHandle,
            mediaAssetId: mediaAssetId,
            failure: error
        )
    }
}

func readMediaUploadPartDataOffMain(
    fileURL: URL,
    part: MediaUploadPartPlan,
    mediaAssetId: String
) async throws -> Data {
    let task = Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return try readMediaUploadPartData(fileURL: fileURL, part: part, mediaAssetId: mediaAssetId)
    }
    return try await withTaskCancellationHandler {
        try await task.value
    } onCancel: {
        task.cancel()
    }
}

func readMediaUploadPartData(
    fileURL: URL,
    part: MediaUploadPartPlan,
    mediaAssetId: String
) throws -> Data {
    let fileHandle = try FileHandle(forReadingFrom: fileURL)
    let partData = try readMediaUploadPartDataFromHandle(
        fileHandle: fileHandle,
        part: part,
        mediaAssetId: mediaAssetId
    )
    try closeMediaUploadFileHandle(fileHandle: fileHandle, mediaAssetId: mediaAssetId)
    return partData
}

private func readMediaUploadPartDataFromHandle(
    fileHandle: FileHandle,
    part: MediaUploadPartPlan,
    mediaAssetId: String
) throws -> Data {
    do {
        try fileHandle.seek(toOffset: part.offsetBytes)
        let partData = try readMediaUploadChunk(fileHandle: fileHandle, maxSizeBytes: part.sizeBytes)
        guard partData.count == part.sizeBytes else {
            throw MediaUploadTransferFailure(
                policy: .permanent,
                message: "Media upload part read size mismatch mediaAssetId=\(mediaAssetId) partNumber=\(part.partNumber) expected=\(part.sizeBytes) actual=\(partData.count)"
            )
        }
        guard hexSHA256(data: partData) == part.sha256 else {
            throw MediaUploadTransferFailure(
                policy: .permanent,
                message: "Media upload part SHA-256 changed while uploading mediaAssetId=\(mediaAssetId) partNumber=\(part.partNumber)"
            )
        }
        return partData
    } catch {
        try closeMediaUploadFileHandleAfterFailure(
            fileHandle: fileHandle,
            mediaAssetId: mediaAssetId,
            failure: error
        )
    }
}

private func readMediaUploadChunk(fileHandle: FileHandle, maxSizeBytes: Int) throws -> Data {
    var data = Data()
    while data.count < maxSizeBytes {
        try Task.checkCancellation()
        guard let chunk = try fileHandle.read(upToCount: maxSizeBytes - data.count),
              chunk.isEmpty == false else {
            break
        }
        data.append(chunk)
    }
    return data
}

private func closeMediaUploadFileHandle(fileHandle: FileHandle, mediaAssetId: String) throws {
    do {
        try fileHandle.close()
    } catch {
        throw MediaUploadTransferFailure(
            policy: .transient,
            message: "Media upload file close failed mediaAssetId=\(mediaAssetId): \(Flashcards.errorMessage(error: error))"
        )
    }
}

private func closeMediaUploadFileHandleAfterFailure(
    fileHandle: FileHandle,
    mediaAssetId: String,
    failure: Error
) throws -> Never {
    do {
        try fileHandle.close()
    } catch {
        throw MediaUploadTransferFailure(
            policy: mediaUploadFailure(error: failure).policy,
            message: "Media upload file operation failed and close failed mediaAssetId=\(mediaAssetId): operationError=\(Flashcards.errorMessage(error: failure)); closeError=\(Flashcards.errorMessage(error: error))"
        )
    }

    throw failure
}

private func hexSHA256(data: Data) -> String {
    hexSHA256(digest: SHA256.hash(data: data))
}

private func hexSHA256(digest: SHA256.Digest) -> String {
    digest.map { byte in
        String(format: "%02x", byte)
    }.joined()
}

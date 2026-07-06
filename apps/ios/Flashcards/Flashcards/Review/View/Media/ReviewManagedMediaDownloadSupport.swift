import Foundation

private let reviewManagedMediaDownloadMaxAttempts: Int = 3
private let reviewManagedMediaDownloadRangeChunkSizeBytes: Int64 = 1_048_576
private let reviewManagedMediaDownloadRetryDelayNanoseconds: UInt64 = 500_000_000
private let reviewManagedMediaDownloadResponseBodyMaxBytes: Int = 2_048

private struct ReviewManagedMediaDownloadRange: Sendable {
    let startByte: Int64
    let endByte: Int64
    let totalSizeBytes: Int64
    let sizeBytes: Int64

    var headerValue: String {
        "bytes=\(self.startByte)-\(self.endByte)"
    }

    var isFullObjectRange: Bool {
        self.startByte == 0 && self.endByte == self.totalSizeBytes - 1
    }

    init(startByte: Int64, endByte: Int64, totalSizeBytes: Int64) {
        self.startByte = startByte
        self.endByte = endByte
        self.totalSizeBytes = totalSizeBytes
        self.sizeBytes = endByte - startByte + 1
    }
}

private struct ReviewManagedMediaContentRange: Sendable {
    let startByte: Int64
    let endByte: Int64
    let totalSizeBytes: Int64

    init(startByte: Int64, endByte: Int64, totalSizeBytes: Int64) {
        self.startByte = startByte
        self.endByte = endByte
        self.totalSizeBytes = totalSizeBytes
    }
}

private struct ReviewManagedMediaHTTPStatusError: LocalizedError, Sendable {
    let mediaAssetId: String
    let rangeHeader: String
    let statusCode: Int
    let responseBody: String

    var errorDescription: String? {
        "Managed media ranged download failed with status \(self.statusCode) for mediaAssetId=\(self.mediaAssetId) range=\(self.rangeHeader) responseBody=\(self.responseBody)"
    }

    init(mediaAssetId: String, rangeHeader: String, statusCode: Int, responseBody: String) {
        self.mediaAssetId = mediaAssetId
        self.rangeHeader = rangeHeader
        self.statusCode = statusCode
        self.responseBody = responseBody
    }
}

func downloadReviewManagedMediaBlobFileToCache(
    downloadURL: URL,
    databaseURL: URL,
    mediaAsset: MediaAsset,
    expectedSha256: String,
    session: URLSession,
    retryScope: IOSObservationScope
) async throws -> URL {
    let destinationURL = try reviewManagedMediaCacheFileURL(
        databaseURL: databaseURL,
        sha256: expectedSha256
    )
    let partialFileURL = try reviewManagedMediaPartialCacheFileURL(
        databaseURL: databaseURL,
        sha256: expectedSha256
    )
    let downloadedFileURL = try await downloadReviewManagedMediaBlob(
        downloadURL: downloadURL,
        partialFileURL: partialFileURL,
        mediaAsset: mediaAsset,
        session: session,
        retryScope: retryScope
    )

    do {
        try validateReviewManagedMediaBlob(
            fileURL: downloadedFileURL,
            mediaAsset: mediaAsset,
            expectedSha256: expectedSha256
        )
    } catch {
        try removeReviewManagedMediaPartialDownloadAfterFailure(
            fileURL: downloadedFileURL,
            mediaAssetId: mediaAsset.mediaAssetId,
            failure: error,
            reason: "validation_failed"
        )
    }

    let publishedURL = try publishReviewManagedMediaPartialBlobFile(
        partialFileURL: downloadedFileURL,
        destinationURL: destinationURL,
        mediaAssetId: mediaAsset.mediaAssetId
    )
    guard publishedURL.path == destinationURL.path else {
        throw LocalStoreError.database(
            "Managed media cache publish returned unexpected path for mediaAssetId=\(mediaAsset.mediaAssetId): expected \(destinationURL.path), received \(publishedURL.path)"
        )
    }

    return publishedURL
}

private func downloadReviewManagedMediaBlob(
    downloadURL: URL,
    partialFileURL: URL,
    mediaAsset: MediaAsset,
    session: URLSession,
    retryScope: IOSObservationScope
) async throws -> URL {
    guard mediaAsset.sizeBytes >= 0 else {
        throw LocalStoreError.validation(
            "Managed media asset size must be non-negative for mediaAssetId=\(mediaAsset.mediaAssetId)"
        )
    }

    var lastError: Error?
    for attempt in 1...reviewManagedMediaDownloadMaxAttempts {
        do {
            return try await downloadReviewManagedMediaBlobAttempt(
                downloadURL: downloadURL,
                partialFileURL: partialFileURL,
                mediaAsset: mediaAsset,
                session: session
            )
        } catch let error as CancellationError {
            throw error
        } catch let statusError as ReviewManagedMediaHTTPStatusError {
            lastError = statusError
            guard reviewManagedMediaDownloadHTTPStatusIsRetryable(statusCode: statusError.statusCode),
                  attempt < reviewManagedMediaDownloadMaxAttempts else {
                throw statusError
            }

            try await retryReviewManagedMediaDownload(
                messageSummary: Flashcards.errorMessage(error: statusError),
                attempt: attempt,
                retryScope: retryScope,
                transportDiagnostics: makeIOSNetworkTransportDiagnostics(
                    error: statusError,
                    httpMethod: "GET",
                    endpointPath: downloadURL.path,
                    apiBaseUrl: nil
                )
            )
        } catch let localError as LocalStoreError {
            throw localError
        } catch {
            let safeError = safeReviewManagedMediaDownloadError(
                error: error,
                mediaAssetId: mediaAsset.mediaAssetId
            )
            if isRequestCancellationError(error: error) {
                throw safeError
            }
            lastError = safeError
            guard isRetryableNetworkTransportFailure(error: error),
                  attempt < reviewManagedMediaDownloadMaxAttempts else {
                throw safeError
            }

            try await retryReviewManagedMediaDownload(
                messageSummary: Flashcards.errorMessage(error: safeError),
                attempt: attempt,
                retryScope: retryScope,
                transportDiagnostics: makeIOSNetworkTransportDiagnostics(
                    error: error,
                    httpMethod: "GET",
                    endpointPath: downloadURL.path,
                    apiBaseUrl: nil
                )
            )
        }
    }

    guard let lastError else {
        throw LocalStoreError.database("Managed media download retry failed without an error")
    }
    throw lastError
}

private func downloadReviewManagedMediaBlobAttempt(
    downloadURL: URL,
    partialFileURL: URL,
    mediaAsset: MediaAsset,
    session: URLSession
) async throws -> URL {
    try Task.checkCancellation()
    let resumedSizeBytes = try prepareReviewManagedMediaPartialDownloadFile(
        partialFileURL: partialFileURL,
        mediaAssetId: mediaAsset.mediaAssetId,
        expectedSizeBytes: mediaAsset.sizeBytes
    )
    guard resumedSizeBytes < mediaAsset.sizeBytes else {
        return partialFileURL
    }

    let fileHandle = try openReviewManagedMediaPartialFileForWriting(
        partialFileURL: partialFileURL,
        mediaAssetId: mediaAsset.mediaAssetId
    )
    do {
        var downloadedSizeBytes = resumedSizeBytes
        try seekReviewManagedMediaPartialFileToEnd(
            fileHandle: fileHandle,
            mediaAssetId: mediaAsset.mediaAssetId
        )
        while let range = try planNextReviewManagedMediaDownloadRange(
            startByte: downloadedSizeBytes,
            totalSizeBytes: mediaAsset.sizeBytes,
            chunkSizeBytes: reviewManagedMediaDownloadRangeChunkSizeBytes,
            mediaAssetId: mediaAsset.mediaAssetId
        ) {
            let chunk = try await downloadReviewManagedMediaRangeChunk(
                downloadURL: downloadURL,
                mediaAssetId: mediaAsset.mediaAssetId,
                range: range,
                session: session
            )
            try Task.checkCancellation()
            try appendReviewManagedMediaPartialChunk(
                fileHandle: fileHandle,
                chunk: chunk,
                mediaAssetId: mediaAsset.mediaAssetId
            )
            downloadedSizeBytes += Int64(chunk.count)
        }

        try closeReviewManagedMediaPartialFile(
            fileHandle: fileHandle,
            mediaAssetId: mediaAsset.mediaAssetId
        )
        return partialFileURL
    } catch {
        try closeReviewManagedMediaPartialFileAfterFailure(
            fileHandle: fileHandle,
            mediaAssetId: mediaAsset.mediaAssetId,
            failure: error
        )
    }
}

private func planNextReviewManagedMediaDownloadRange(
    startByte: Int64,
    totalSizeBytes: Int64,
    chunkSizeBytes: Int64,
    mediaAssetId: String
) throws -> ReviewManagedMediaDownloadRange? {
    guard totalSizeBytes >= 0 else {
        throw LocalStoreError.validation(
            "Managed media asset size must be non-negative for mediaAssetId=\(mediaAssetId)"
        )
    }
    guard chunkSizeBytes > 0 && chunkSizeBytes <= Int64(Int.max) else {
        throw LocalStoreError.validation(
            "Managed media download chunk size is invalid for mediaAssetId=\(mediaAssetId): chunkSizeBytes=\(chunkSizeBytes)"
        )
    }
    guard startByte >= 0 && startByte <= totalSizeBytes else {
        throw LocalStoreError.validation(
            "Managed media download range start is invalid for mediaAssetId=\(mediaAssetId): startByte=\(startByte), totalSizeBytes=\(totalSizeBytes)"
        )
    }
    guard startByte < totalSizeBytes else {
        return nil
    }

    let rangeSizeBytes = min(totalSizeBytes - startByte, chunkSizeBytes)
    let endByte = startByte + rangeSizeBytes - 1
    return ReviewManagedMediaDownloadRange(
        startByte: startByte,
        endByte: endByte,
        totalSizeBytes: totalSizeBytes
    )
}

private func downloadReviewManagedMediaRangeChunk(
    downloadURL: URL,
    mediaAssetId: String,
    range: ReviewManagedMediaDownloadRange,
    session: URLSession
) async throws -> Data {
    let (data, response) = try await session.data(
        for: reviewManagedMediaDownloadRequest(downloadURL: downloadURL, range: range)
    )
    guard let httpResponse = response as? HTTPURLResponse else {
        throw LocalStoreError.validation(
            "Managed media ranged download did not receive an HTTP response for mediaAssetId=\(mediaAssetId) range=\(range.headerValue)"
        )
    }

    if httpResponse.statusCode == 206 {
        try validateReviewManagedMediaPartialRangeResponse(
            httpResponse: httpResponse,
            data: data,
            range: range,
            mediaAssetId: mediaAssetId
        )
        return data
    }

    if httpResponse.statusCode == 200 && range.isFullObjectRange {
        try validateReviewManagedMediaFullRangeResponse(
            data: data,
            range: range,
            mediaAssetId: mediaAssetId
        )
        return data
    }

    if httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 {
        throw LocalStoreError.validation(
            "Managed media ranged download returned unsupported status \(httpResponse.statusCode) for mediaAssetId=\(mediaAssetId) range=\(range.headerValue)"
        )
    }

    throw ReviewManagedMediaHTTPStatusError(
        mediaAssetId: mediaAssetId,
        rangeHeader: range.headerValue,
        statusCode: httpResponse.statusCode,
        responseBody: reviewManagedMediaDownloadResponseBodySummary(data: data)
    )
}

private func retryReviewManagedMediaDownload(
    messageSummary: String,
    attempt: Int,
    retryScope: IOSObservationScope,
    transportDiagnostics: IOSNetworkTransportDiagnostics?
) async throws {
    FlashcardsObservability.addBreadcrumb(
        .cloudRetry(
            CloudRetryObservation(
                action: "review_managed_media_download_retry",
                scope: retryScope,
                attempt: attempt,
                maxAttempts: reviewManagedMediaDownloadMaxAttempts,
                apiBaseUrl: nil,
                messageSummary: messageSummary,
                transportDiagnostics: transportDiagnostics
            )
        )
    )
    try await Task.sleep(nanoseconds: reviewManagedMediaDownloadRetryDelayNanoseconds)
}

private func reviewManagedMediaDownloadHTTPStatusIsRetryable(statusCode: Int) -> Bool {
    statusCode == 408 || statusCode == 429 || (statusCode >= 500 && statusCode <= 599)
}

func makeReviewManagedMediaDownloadSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.httpCookieAcceptPolicy = .never
    configuration.httpShouldSetCookies = false
    configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    return URLSession(configuration: configuration)
}

private func reviewManagedMediaDownloadRequest(
    downloadURL: URL,
    range: ReviewManagedMediaDownloadRange
) -> URLRequest {
    var request = URLRequest(url: downloadURL)
    request.httpMethod = "GET"
    request.setValue(range.headerValue, forHTTPHeaderField: "Range")
    request.httpShouldHandleCookies = false
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    return request
}

private func validateReviewManagedMediaPartialRangeResponse(
    httpResponse: HTTPURLResponse,
    data: Data,
    range: ReviewManagedMediaDownloadRange,
    mediaAssetId: String
) throws {
    let contentRangeHeader = httpResponse.value(forHTTPHeaderField: "Content-Range") ?? ""
    let contentRange = try parseReviewManagedMediaContentRange(
        headerValue: contentRangeHeader,
        mediaAssetId: mediaAssetId
    )
    guard contentRange.startByte == range.startByte,
          contentRange.endByte == range.endByte,
          contentRange.totalSizeBytes == range.totalSizeBytes else {
        throw LocalStoreError.validation(
            "Managed media ranged download returned Content-Range '\(contentRangeHeader)' for mediaAssetId=\(mediaAssetId) expected bytes \(range.startByte)-\(range.endByte)/\(range.totalSizeBytes)"
        )
    }
    guard Int64(data.count) == range.sizeBytes else {
        throw LocalStoreError.validation(
            "Managed media ranged download size mismatch for mediaAssetId=\(mediaAssetId) range=\(range.headerValue): expected \(range.sizeBytes), received \(data.count)"
        )
    }
}

private func validateReviewManagedMediaFullRangeResponse(
    data: Data,
    range: ReviewManagedMediaDownloadRange,
    mediaAssetId: String
) throws {
    guard Int64(data.count) == range.totalSizeBytes else {
        throw LocalStoreError.validation(
            "Managed media full-object range response size mismatch for mediaAssetId=\(mediaAssetId): expected \(range.totalSizeBytes), received \(data.count)"
        )
    }
}

private func parseReviewManagedMediaContentRange(
    headerValue: String,
    mediaAssetId: String
) throws -> ReviewManagedMediaContentRange {
    let trimmedHeaderValue = headerValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedHeaderValue.lowercased().hasPrefix("bytes ") else {
        throw LocalStoreError.validation(
            "Managed media ranged download returned invalid Content-Range for mediaAssetId=\(mediaAssetId): \(headerValue)"
        )
    }

    let rangeAndTotal = String(trimmedHeaderValue.dropFirst("bytes ".count))
    let rangeParts = rangeAndTotal.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false)
    guard rangeParts.count == 2,
          let totalSizeBytes = Int64(String(rangeParts[1])) else {
        throw LocalStoreError.validation(
            "Managed media ranged download returned invalid Content-Range for mediaAssetId=\(mediaAssetId): \(headerValue)"
        )
    }

    let byteParts = rangeParts[0].split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
    guard byteParts.count == 2,
          let startByte = Int64(String(byteParts[0])),
          let endByte = Int64(String(byteParts[1])),
          startByte <= endByte,
          totalSizeBytes > endByte else {
        throw LocalStoreError.validation(
            "Managed media ranged download returned invalid Content-Range for mediaAssetId=\(mediaAssetId): \(headerValue)"
        )
    }

    return ReviewManagedMediaContentRange(
        startByte: startByte,
        endByte: endByte,
        totalSizeBytes: totalSizeBytes
    )
}

private func reviewManagedMediaDownloadResponseBodySummary(data: Data) -> String {
    guard data.isEmpty == false else {
        return ""
    }

    return String(decoding: data.prefix(reviewManagedMediaDownloadResponseBodyMaxBytes), as: UTF8.self)
}

private func safeReviewManagedMediaDownloadError(
    error: Error,
    mediaAssetId: String
) -> Error {
    if isRequestCancellationError(error: error) {
        return LocalStoreError.validation(
            "Managed media download was cancelled for mediaAssetId=\(mediaAssetId)"
        )
    }

    if let urlErrorCode = flashcardsURLErrorCode(error: error, remainingDepth: 4) {
        return LocalStoreError.validation(
            "Managed media download transport failed for mediaAssetId=\(mediaAssetId) with urlErrorCode=\(urlErrorCode.rawValue)"
        )
    }

    return LocalStoreError.validation(
        "Managed media download transport failed for mediaAssetId=\(mediaAssetId) with failureCategory=transport"
    )
}

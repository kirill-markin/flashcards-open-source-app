import CryptoKit
import Foundation

private let reviewManagedMediaDownloadMaxAttempts: Int = 3
private let reviewManagedMediaDownloadRangeChunkSizeBytes: Int64 = 1_048_576
private let reviewManagedMediaDownloadRetryDelayNanoseconds: UInt64 = 500_000_000
private let reviewManagedMediaDownloadResponseBodyMaxBytes: Int = 2_048
private let reviewManagedMediaValidationChunkSizeBytes: Int = 1_048_576

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

private struct ReviewManagedMediaDownloadTaskState {
    let id: String
    let task: Task<URL, Error>

    init(id: String, task: Task<URL, Error>) {
        self.id = id
        self.task = task
    }
}

@MainActor private var reviewManagedMediaDownloadTasks: [String: ReviewManagedMediaDownloadTaskState] = [:]

struct ReviewManagedMediaLoadResult: Hashable, Sendable {
    let mediaAsset: MediaAsset?
    let mediaURL: URL?

    init(mediaAsset: MediaAsset?, mediaURL: URL?) {
        self.mediaAsset = mediaAsset
        self.mediaURL = mediaURL
    }
}

@MainActor
extension FlashcardsStore {
    func loadReviewManagedMedia(mediaAssetId: String) async -> ReviewManagedMediaLoadResult {
        guard let database = self.database,
              let workspaceId = self.workspace?.workspaceId else {
            return ReviewManagedMediaLoadResult(mediaAsset: nil, mediaURL: nil)
        }

        let localMediaAsset: MediaAsset
        do {
            guard let loadedMediaAsset = try database.loadOptionalMediaAssetIncludingDeleted(
                workspaceId: workspaceId,
                mediaAssetId: mediaAssetId
            ), loadedMediaAsset.deletedAt == nil else {
                return ReviewManagedMediaLoadResult(mediaAsset: nil, mediaURL: nil)
            }
            localMediaAsset = loadedMediaAsset
        } catch {
            self.captureReviewManagedMediaLoadFailure(
                error: error,
                stage: "local_registry_load"
            )
            return ReviewManagedMediaLoadResult(mediaAsset: nil, mediaURL: nil)
        }

        do {
            if let cacheURL = try self.loadCachedReviewManagedMediaURL(
                database: database,
                mediaAsset: localMediaAsset
            ) {
                return ReviewManagedMediaLoadResult(mediaAsset: localMediaAsset, mediaURL: cacheURL)
            }
        } catch {
            self.captureReviewManagedMediaLoadFailure(
                error: error,
                stage: "cache_lookup"
            )
            return ReviewManagedMediaLoadResult(mediaAsset: localMediaAsset, mediaURL: nil)
        }

        guard let cloudSyncService = self.dependencies.cloudSyncService,
              let activeSession = self.cloudRuntime.activeCloudSession(),
              activeSession.workspaceId == workspaceId else {
            return ReviewManagedMediaLoadResult(mediaAsset: localMediaAsset, mediaURL: nil)
        }

        do {
            let normalizedSha256 = try normalizedMediaSha256(sha256: localMediaAsset.sha256)
            return ReviewManagedMediaLoadResult(
                mediaAsset: localMediaAsset,
                mediaURL: try await self.downloadReviewManagedMediaToCache(
                    database: database,
                    cloudSyncService: cloudSyncService,
                    activeSession: activeSession,
                    mediaAsset: localMediaAsset,
                    expectedSha256: normalizedSha256
                )
            )
        } catch {
            self.captureReviewManagedMediaLoadFailure(
                error: error,
                stage: "cache_download"
            )
            return ReviewManagedMediaLoadResult(mediaAsset: localMediaAsset, mediaURL: nil)
        }
    }

    private func loadCachedReviewManagedMediaURL(
        database: LocalDatabase,
        mediaAsset: MediaAsset
    ) throws -> URL? {
        guard let cacheEntry = try database.mediaTransferStore.resolveCacheHit(
            sha256: mediaAsset.sha256,
            accessedAt: nowIsoTimestamp()
        ) else {
            return nil
        }

        let cacheURL = try reviewManagedMediaCacheFileURL(
            databaseURL: database.databaseURL,
            cacheEntry: cacheEntry
        )
        guard FileManager.default.fileExists(atPath: cacheURL.path) else {
            return nil
        }

        return cacheURL
    }

    private func downloadReviewManagedMediaToCache(
        database: LocalDatabase,
        cloudSyncService: any CloudSyncServing,
        activeSession: CloudLinkedSession,
        mediaAsset: MediaAsset,
        expectedSha256: String
    ) async throws -> URL {
        let workspaceId = mediaAsset.workspaceId
        let response = try await self.withCloudSessionPreservingStableContext(linkedSession: activeSession) { session in
            try await cloudSyncService.loadMediaAssetDownloadURL(
                apiBaseUrl: session.apiBaseUrl,
                authorizationHeader: session.authorization.headerValue,
                workspaceId: workspaceId,
                mediaAssetId: mediaAsset.mediaAssetId
            )
        }

        guard response.mediaAsset.workspaceId == workspaceId,
              response.mediaAsset.mediaAssetId == mediaAsset.mediaAssetId,
              response.mediaAsset.deletedAt == nil,
              let downloadURL = URL(string: response.download.url) else {
            throw LocalStoreError.validation(
                "Managed media download URL response did not match mediaAssetId=\(mediaAsset.mediaAssetId)"
            )
        }
        guard response.download.method.uppercased() == "GET" else {
            throw LocalStoreError.validation(
                "Managed media download URL response returned unsupported method \(response.download.method)"
            )
        }
        guard response.mediaAsset.sha256 == expectedSha256,
              response.mediaAsset.sizeBytes == mediaAsset.sizeBytes else {
            throw LocalStoreError.validation(
                "Managed media download metadata changed for mediaAssetId=\(mediaAsset.mediaAssetId)"
            )
        }

        let cacheURL = try await self.deduplicatedReviewManagedMediaBlobFileToCache(
            downloadURL: downloadURL,
            database: database,
            mediaAsset: mediaAsset,
            expectedSha256: expectedSha256,
            retryScope: self.reviewManagedMediaObservationScope()
        )
        let now = nowIsoTimestamp()
        let cacheEntry = try database.mediaTransferStore.upsertBlobCacheEntry(
            entry: MediaBlobCacheUpsert(
                sha256: expectedSha256,
                mimeType: mediaAsset.mimeType,
                sizeBytes: mediaAsset.sizeBytes,
                createdAt: now,
                lastAccessedAt: now,
                sourceMediaAssetId: mediaAsset.mediaAssetId
            )
        )
        let persistedCacheURL = try reviewManagedMediaCacheFileURL(
            databaseURL: database.databaseURL,
            cacheEntry: cacheEntry
        )
        guard persistedCacheURL == cacheURL else {
            throw LocalStoreError.database(
                "Managed media cache path mismatch for sha256=\(expectedSha256)"
            )
        }

        return cacheURL
    }

    private func deduplicatedReviewManagedMediaBlobFileToCache(
        downloadURL: URL,
        database: LocalDatabase,
        mediaAsset: MediaAsset,
        expectedSha256: String,
        retryScope: IOSObservationScope
    ) async throws -> URL {
        if let activeTaskState = reviewManagedMediaDownloadTasks[expectedSha256] {
            do {
                return try await activeTaskState.task.value
            } catch {
                if reviewManagedMediaDownloadTasks[expectedSha256]?.id == activeTaskState.id {
                    reviewManagedMediaDownloadTasks[expectedSha256] = nil
                }
                if let cacheURL = try self.loadCachedReviewManagedMediaURL(
                    database: database,
                    mediaAsset: mediaAsset
                ) {
                    return cacheURL
                }
            }
        }
        if let activeTaskState = reviewManagedMediaDownloadTasks[expectedSha256] {
            return try await activeTaskState.task.value
        }

        let taskId = UUID().uuidString.lowercased()
        let databaseURL = database.databaseURL
        let downloadTask = Task {
            let session = makeReviewManagedMediaDownloadSession()
            defer {
                session.invalidateAndCancel()
            }
            return try await downloadReviewManagedMediaBlobFileToCache(
                downloadURL: downloadURL,
                databaseURL: databaseURL,
                mediaAsset: mediaAsset,
                expectedSha256: expectedSha256,
                session: session,
                retryScope: retryScope
            )
        }
        reviewManagedMediaDownloadTasks[expectedSha256] = ReviewManagedMediaDownloadTaskState(
            id: taskId,
            task: downloadTask
        )
        defer {
            if reviewManagedMediaDownloadTasks[expectedSha256]?.id == taskId {
                reviewManagedMediaDownloadTasks[expectedSha256] = nil
            }
        }

        return try await downloadTask.value
    }

    private func captureReviewManagedMediaLoadFailure(
        error: Error,
        stage: String
    ) {
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: IOSObservationScope(
                feature: .cards,
                userId: self.cloudSettings?.linkedUserId,
                workspaceId: self.workspace?.workspaceId,
                requestId: nil,
                clientRequestId: nil,
                sessionId: nil,
                runId: nil,
                cloudState: self.cloudSettings?.cloudState,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            ),
            action: "review_managed_media_load",
            stage: stage,
            statusCode: nil,
            backendCode: nil,
            requestId: nil
        )
    }

    private func reviewManagedMediaObservationScope() -> IOSObservationScope {
        IOSObservationScope(
            feature: .cards,
            userId: self.cloudSettings?.linkedUserId,
            workspaceId: self.workspace?.workspaceId,
            requestId: nil,
            clientRequestId: nil,
            sessionId: nil,
            runId: nil,
            cloudState: self.cloudSettings?.cloudState,
            configurationMode: try? self.currentCloudServiceConfiguration().mode
        )
    }
}

private func downloadReviewManagedMediaBlobFileToCache(
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

private func makeReviewManagedMediaDownloadSession() -> URLSession {
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

private func prepareReviewManagedMediaPartialDownloadFile(
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

private func openReviewManagedMediaPartialFileForWriting(
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

private func seekReviewManagedMediaPartialFileToEnd(
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

private func appendReviewManagedMediaPartialChunk(
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

private func closeReviewManagedMediaPartialFile(
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

private func closeReviewManagedMediaPartialFileAfterFailure(
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

private func publishReviewManagedMediaPartialBlobFile(
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

    var resultingURL: NSURL?
    do {
        try FileManager.default.replaceItemAt(
            destinationURL,
            withItemAt: partialFileURL,
            backupItemName: nil,
            options: [],
            resultingItemURL: &resultingURL
        )
    } catch {
        throw LocalStoreError.database(
            "Managed media cache publish replace failed for mediaAssetId=\(mediaAssetId) from=\(partialFileURL.path) to=\(destinationURL.path): \(Flashcards.errorMessage(error: error))"
        )
    }

    if let resultingURL {
        return resultingURL as URL
    }
    return destinationURL
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

private func removeReviewManagedMediaPartialDownloadAfterFailure(
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

private func validateReviewManagedMediaBlob(
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

private func reviewManagedMediaCacheFileURL(
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

private func reviewManagedMediaCacheFileURL(
    databaseURL: URL,
    sha256: String
) throws -> URL {
    let localRelativePath = try mediaBlobCacheRelativePath(sha256: sha256)
    return databaseURL
        .deletingLastPathComponent()
        .appendingPathComponent(localRelativePath, isDirectory: false)
}

private func reviewManagedMediaPartialCacheFileURL(
    databaseURL: URL,
    sha256: String
) throws -> URL {
    try reviewManagedMediaCacheFileURL(
        databaseURL: databaseURL,
        sha256: sha256
    ).appendingPathExtension("partial")
}

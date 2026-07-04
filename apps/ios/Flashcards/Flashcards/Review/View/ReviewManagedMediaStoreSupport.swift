import CryptoKit
import Foundation

private let reviewManagedMediaDownloadMaxAttempts: Int = 3
private let reviewManagedMediaDownloadRetryDelayNanoseconds: UInt64 = 500_000_000
private let reviewManagedMediaValidationChunkSizeBytes: Int = 1_048_576

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
            try await downloadReviewManagedMediaBlobFileToCache(
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
    let downloadedFileURL = try await downloadReviewManagedMediaBlob(
        downloadURL: downloadURL,
        mediaAssetId: mediaAsset.mediaAssetId,
        session: session,
        retryScope: retryScope
    )
    defer {
        try? FileManager.default.removeItem(at: downloadedFileURL)
    }

    try validateReviewManagedMediaBlob(
        fileURL: downloadedFileURL,
        mediaAsset: mediaAsset,
        expectedSha256: expectedSha256
    )
    try FileManager.default.createDirectory(
        at: destinationURL.deletingLastPathComponent(),
        withIntermediateDirectories: true,
        attributes: nil
    )
    if FileManager.default.fileExists(atPath: destinationURL.path) {
        try FileManager.default.removeItem(at: destinationURL)
    }
    try FileManager.default.moveItem(at: downloadedFileURL, to: destinationURL)

    return destinationURL
}

private func downloadReviewManagedMediaBlob(
    downloadURL: URL,
    mediaAssetId: String,
    session: URLSession,
    retryScope: IOSObservationScope
) async throws -> URL {
    var lastError: Error?
    for attempt in 1...reviewManagedMediaDownloadMaxAttempts {
        do {
            let (fileURL, response) = try await session.download(
                for: reviewManagedMediaDownloadRequest(downloadURL: downloadURL)
            )
            guard let httpResponse = response as? HTTPURLResponse else {
                try removeReviewManagedMediaTemporaryDownload(
                    fileURL: fileURL,
                    mediaAssetId: mediaAssetId
                )
                throw LocalStoreError.validation(
                    "Managed media download did not receive an HTTP response for mediaAssetId=\(mediaAssetId)"
                )
            }
            if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
                let statusError = LocalStoreError.validation(
                    "Managed media download failed with status \(httpResponse.statusCode) for mediaAssetId=\(mediaAssetId)"
                )
                try removeReviewManagedMediaTemporaryDownload(
                    fileURL: fileURL,
                    mediaAssetId: mediaAssetId
                )
                guard reviewManagedMediaDownloadHTTPStatusIsRetryable(statusCode: httpResponse.statusCode),
                      attempt < reviewManagedMediaDownloadMaxAttempts else {
                    throw statusError
                }

                lastError = statusError
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
                continue
            }

            return fileURL
        } catch let localError as LocalStoreError {
            throw localError
        } catch {
            let safeError = safeReviewManagedMediaDownloadError(
                error: error,
                mediaAssetId: mediaAssetId
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

private func reviewManagedMediaDownloadRequest(downloadURL: URL) -> URLRequest {
    var request = URLRequest(url: downloadURL)
    request.httpMethod = "GET"
    request.httpShouldHandleCookies = false
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    return request
}

private func removeReviewManagedMediaTemporaryDownload(
    fileURL: URL,
    mediaAssetId: String
) throws {
    guard FileManager.default.fileExists(atPath: fileURL.path) else {
        return
    }

    do {
        try FileManager.default.removeItem(at: fileURL)
    } catch {
        throw LocalStoreError.database(
            "Managed media temporary download cleanup failed for mediaAssetId=\(mediaAssetId): \(Flashcards.errorMessage(error: error))"
        )
    }
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

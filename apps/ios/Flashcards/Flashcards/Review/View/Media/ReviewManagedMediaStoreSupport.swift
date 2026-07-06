import Foundation

private struct ReviewManagedMediaDownloadTaskState {
    let id: String
    let task: Task<URL, Error>

    init(id: String, task: Task<URL, Error>) {
        self.id = id
        self.task = task
    }
}

@MainActor private var reviewManagedMediaDownloadTasks: [String: ReviewManagedMediaDownloadTaskState] = [:]

enum ReviewManagedMediaUnavailableReason: Hashable, Sendable {
    case missingRegistry
    case cacheOrDownloadUnavailable
}

struct ReviewManagedMediaLoadResult: Hashable, Sendable {
    let mediaAsset: MediaAsset?
    let mediaURL: URL?
    let unavailableReason: ReviewManagedMediaUnavailableReason?

    init(
        mediaAsset: MediaAsset?,
        mediaURL: URL?,
        unavailableReason: ReviewManagedMediaUnavailableReason?
    ) {
        self.mediaAsset = mediaAsset
        self.mediaURL = mediaURL
        self.unavailableReason = unavailableReason
    }
}

@MainActor
extension FlashcardsStore {
    func loadReviewManagedMedia(mediaAssetId: String) async -> ReviewManagedMediaLoadResult {
        guard let database = self.database,
              let workspaceId = self.workspace?.workspaceId else {
            return ReviewManagedMediaLoadResult(
                mediaAsset: nil,
                mediaURL: nil,
                unavailableReason: .cacheOrDownloadUnavailable
            )
        }

        let localMediaAsset: MediaAsset
        do {
            guard let loadedMediaAsset = try database.loadOptionalMediaAssetIncludingDeleted(
                workspaceId: workspaceId,
                mediaAssetId: mediaAssetId
            ), loadedMediaAsset.deletedAt == nil else {
                return ReviewManagedMediaLoadResult(
                    mediaAsset: nil,
                    mediaURL: nil,
                    unavailableReason: .missingRegistry
                )
            }
            localMediaAsset = loadedMediaAsset
        } catch {
            self.captureReviewManagedMediaLoadFailure(
                error: error,
                stage: "local_registry_load"
            )
            return ReviewManagedMediaLoadResult(
                mediaAsset: nil,
                mediaURL: nil,
                unavailableReason: .cacheOrDownloadUnavailable
            )
        }

        do {
            if let cacheURL = try self.loadCachedReviewManagedMediaURL(
                database: database,
                mediaAsset: localMediaAsset
            ) {
                return ReviewManagedMediaLoadResult(
                    mediaAsset: localMediaAsset,
                    mediaURL: cacheURL,
                    unavailableReason: nil
                )
            }
        } catch {
            self.captureReviewManagedMediaLoadFailure(
                error: error,
                stage: "cache_lookup"
            )
            return ReviewManagedMediaLoadResult(
                mediaAsset: localMediaAsset,
                mediaURL: nil,
                unavailableReason: .cacheOrDownloadUnavailable
            )
        }

        guard let cloudSyncService = self.dependencies.cloudSyncService,
              let activeSession = self.cloudRuntime.activeCloudSession(),
              activeSession.workspaceId == workspaceId else {
            return ReviewManagedMediaLoadResult(
                mediaAsset: localMediaAsset,
                mediaURL: nil,
                unavailableReason: .cacheOrDownloadUnavailable
            )
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
                ),
                unavailableReason: nil
            )
        } catch {
            self.captureReviewManagedMediaLoadFailure(
                error: error,
                stage: "cache_download"
            )
            return ReviewManagedMediaLoadResult(
                mediaAsset: localMediaAsset,
                mediaURL: nil,
                unavailableReason: .cacheOrDownloadUnavailable
            )
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

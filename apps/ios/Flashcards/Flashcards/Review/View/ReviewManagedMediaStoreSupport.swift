import Foundation

struct ReviewManagedMediaLoadResult: Hashable, Sendable {
    let mediaAsset: MediaAsset?
    let downloadURL: URL?

    init(mediaAsset: MediaAsset?, downloadURL: URL?) {
        self.mediaAsset = mediaAsset
        self.downloadURL = downloadURL
    }
}

@MainActor
extension FlashcardsStore {
    func loadReviewManagedMedia(mediaAssetId: String) async -> ReviewManagedMediaLoadResult {
        guard let database = self.database,
              let workspaceId = self.workspace?.workspaceId else {
            return ReviewManagedMediaLoadResult(mediaAsset: nil, downloadURL: nil)
        }

        let localMediaAsset: MediaAsset
        do {
            guard let loadedMediaAsset = try database.loadOptionalMediaAssetIncludingDeleted(
                workspaceId: workspaceId,
                mediaAssetId: mediaAssetId
            ), loadedMediaAsset.deletedAt == nil else {
                return ReviewManagedMediaLoadResult(mediaAsset: nil, downloadURL: nil)
            }
            localMediaAsset = loadedMediaAsset
        } catch {
            self.captureReviewManagedMediaLoadFailure(
                error: error,
                stage: "local_registry_load"
            )
            return ReviewManagedMediaLoadResult(mediaAsset: nil, downloadURL: nil)
        }

        guard let cloudSyncService = self.dependencies.cloudSyncService,
              let activeSession = self.cloudRuntime.activeCloudSession(),
              activeSession.workspaceId == workspaceId else {
            return ReviewManagedMediaLoadResult(mediaAsset: localMediaAsset, downloadURL: nil)
        }

        do {
            let response = try await self.withCloudSessionPreservingStableContext(linkedSession: activeSession) { session in
                try await cloudSyncService.loadMediaAssetDownloadURL(
                    apiBaseUrl: session.apiBaseUrl,
                    authorizationHeader: session.authorization.headerValue,
                    workspaceId: workspaceId,
                    mediaAssetId: mediaAssetId
                )
            }

            guard response.mediaAsset.workspaceId == workspaceId,
                  response.mediaAsset.mediaAssetId == mediaAssetId,
                  response.mediaAsset.deletedAt == nil,
                  response.download.method == "GET",
                  let downloadURL = URL(string: response.download.url) else {
                return ReviewManagedMediaLoadResult(mediaAsset: localMediaAsset, downloadURL: nil)
            }

            return ReviewManagedMediaLoadResult(mediaAsset: response.mediaAsset, downloadURL: downloadURL)
        } catch {
            self.captureReviewManagedMediaLoadFailure(
                error: error,
                stage: "download_url_load"
            )
            return ReviewManagedMediaLoadResult(mediaAsset: localMediaAsset, downloadURL: nil)
        }
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
}

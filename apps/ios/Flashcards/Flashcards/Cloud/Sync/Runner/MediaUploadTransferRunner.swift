import Foundation

@MainActor
struct MediaUploadTransferRunner {
    private static var activeWorkspaceIds: Set<String> = []

    let database: LocalDatabase
    let cloudSyncService: any CloudSyncServing

    init(database: LocalDatabase, cloudSyncService: any CloudSyncServing) {
        self.database = database
        self.cloudSyncService = cloudSyncService
    }

    func processDueUploads(linkedSession: CloudLinkedSession, now: Date) async throws {
        guard Self.activeWorkspaceIds.insert(linkedSession.workspaceId).inserted else {
            return
        }
        defer {
            Self.activeWorkspaceIds.remove(linkedSession.workspaceId)
        }

        let cloudSettings = try self.database.loadBootstrapSnapshot().cloudSettings
        var claimNow = now

        while true {
            if Task.isCancelled {
                throw CancellationError()
            }

            let claimedEntries = try self.database.mediaTransferStore.claimDueTransfers(
                workspaceId: linkedSession.workspaceId,
                kind: .upload,
                now: formatIsoTimestamp(date: claimNow),
                staleClaimedBefore: formatIsoTimestamp(
                    date: claimNow.addingTimeInterval(-mediaUploadTransferClaimLeaseSeconds)
                ),
                limit: mediaUploadTransferClaimLimit
            )
            guard claimedEntries.isEmpty == false else {
                return
            }

            for entry in claimedEntries {
                try await self.processClaimedUpload(
                    entry: entry,
                    linkedSession: linkedSession,
                    installationId: cloudSettings.installationId
                )
            }

            claimNow = Date()
        }
    }

    private func processClaimedUpload(
        entry: MediaTransferQueueEntry,
        linkedSession: CloudLinkedSession,
        installationId: String
    ) async throws {
        guard let claimedAt = entry.claimedAt else {
            throw LocalStoreError.database("Claimed media upload transfer is missing claimedAt transferId=\(entry.transferId)")
        }
        var claim = MediaUploadTransferClaim(entry: entry, claimedAt: claimedAt)

        do {
            let mediaAsset = try await self.uploadClaimedEntry(
                entry: entry,
                linkedSession: linkedSession,
                installationId: installationId,
                claim: &claim
            )
            try self.persistSucceededUpload(
                entry: entry,
                claimedAt: claim.claimedAt,
                mediaAsset: mediaAsset
            )
        } catch {
            if isRequestCancellationError(error: error) {
                throw error
            }

            try self.recordFailedUpload(
                entry: entry,
                claimedAt: claim.claimedAt,
                error: error
            )
        }
    }

    private func uploadClaimedEntry(
        entry: MediaTransferQueueEntry,
        linkedSession: CloudLinkedSession,
        installationId: String,
        claim: inout MediaUploadTransferClaim
    ) async throws -> MediaAsset {
        try self.renewUploadClaim(claim: &claim)
        let plan = try await makeMediaUploadTransferPlanOffMain(databaseURL: self.database.databaseURL, entry: entry)
        try self.renewUploadClaim(claim: &claim)
        let createResponse = try await self.cloudSyncService.createMediaAssetUploadSession(
            apiBaseUrl: linkedSession.apiBaseUrl,
            authorizationHeader: linkedSession.authorization.headerValue,
            workspaceId: entry.workspaceId,
            request: MediaAssetUploadSessionCreateRequest(
                mediaAssetId: entry.mediaAssetId,
                mimeType: entry.mimeType,
                sizeBytes: plan.sizeBytes,
                sha256: plan.sha256,
                partSizeBytes: plan.partSizeBytes,
                partCount: plan.parts.count,
                sourceUrl: nil,
                createdAt: entry.createdAt,
                clientUpdatedAt: entry.createdAt,
                lastModifiedByReplicaId: mediaUploadWorkspaceReplicaId(
                    workspaceId: entry.workspaceId,
                    installationId: installationId
                ),
                lastOperationId: entry.transferId
            )
        )
        try self.renewUploadClaim(claim: &claim)
        try validateMediaUploadSessionCreateResponse(
            response: createResponse,
            entry: entry,
            plan: plan
        )

        switch createResponse.status {
        case .alreadyAvailable:
            guard let mediaAsset = createResponse.mediaAsset else {
                throw MediaUploadTransferFailure(
                    policy: .permanent,
                    message: "Media upload session already_available response did not include mediaAsset transferId=\(entry.transferId)"
                )
            }
            try validateUploadedMediaAsset(mediaAsset: mediaAsset, entry: entry, plan: plan)
            return mediaAsset
        case .uploadRequired:
            guard let uploadSession = createResponse.uploadSession else {
                throw MediaUploadTransferFailure(
                    policy: .permanent,
                    message: "Media upload session upload_required response did not include uploadSession transferId=\(entry.transferId)"
                )
            }
            return try await self.uploadRequiredSession(
                entry: entry,
                linkedSession: linkedSession,
                uploadSession: uploadSession,
                plan: plan,
                claim: &claim
            )
        }
    }

    private func uploadRequiredSession(
        entry: MediaTransferQueueEntry,
        linkedSession: CloudLinkedSession,
        uploadSession: MediaAssetUploadSessionMetadata,
        plan: MediaUploadTransferPlan,
        claim: inout MediaUploadTransferClaim
    ) async throws -> MediaAsset {
        let completeResponse: MediaAssetUploadSessionCompleteResponse
        do {
            let completedParts = try await self.uploadParts(
                entry: entry,
                linkedSession: linkedSession,
                uploadSession: uploadSession,
                plan: plan,
                claim: &claim
            )
            try self.renewUploadClaim(claim: &claim)
            completeResponse = try await self.cloudSyncService.completeMediaAssetUploadSession(
                apiBaseUrl: linkedSession.apiBaseUrl,
                authorizationHeader: linkedSession.authorization.headerValue,
                workspaceId: entry.workspaceId,
                sessionId: uploadSession.sessionId,
                request: MediaAssetUploadSessionCompleteRequest(parts: completedParts)
            )
        } catch {
            if isRequestCancellationError(error: error) {
                throw error
            }

            let uploadFailure = mediaUploadFailure(error: error)
            do {
                _ = try await self.cloudSyncService.abortMediaAssetUploadSession(
                    apiBaseUrl: linkedSession.apiBaseUrl,
                    authorizationHeader: linkedSession.authorization.headerValue,
                    workspaceId: entry.workspaceId,
                    sessionId: uploadSession.sessionId
                )
            } catch {
                if isRequestCancellationError(error: error) {
                    throw error
                }

                let abortFailure = mediaUploadFailure(error: error)
                let combinedPolicy: MediaUploadTransferFailurePolicy
                switch (uploadFailure.policy, abortFailure.policy) {
                case (.transient, _), (_, .transient):
                    combinedPolicy = .transient
                case (.permanent, .permanent):
                    combinedPolicy = .permanent
                }
                throw MediaUploadTransferFailure(
                    policy: combinedPolicy,
                    message: "\(uploadFailure.message); abort failed for sessionId=\(uploadSession.sessionId): \(abortFailure.message)"
                )
            }

            throw error
        }

        try validateUploadedMediaAsset(mediaAsset: completeResponse.mediaAsset, entry: entry, plan: plan)
        return completeResponse.mediaAsset
    }

    private func uploadParts(
        entry: MediaTransferQueueEntry,
        linkedSession: CloudLinkedSession,
        uploadSession: MediaAssetUploadSessionMetadata,
        plan: MediaUploadTransferPlan,
        claim: inout MediaUploadTransferClaim
    ) async throws -> [CompletedMediaAssetUploadPart] {
        var completedParts: [CompletedMediaAssetUploadPart] = []
        let batches = try mediaUploadPartPlanBatches(parts: plan.parts, batchSize: mediaUploadPartURLBatchSize)

        for batch in batches {
            try self.renewUploadClaim(claim: &claim)
            let partURLResponse = try await self.cloudSyncService.loadMediaAssetUploadPartURLs(
                apiBaseUrl: linkedSession.apiBaseUrl,
                authorizationHeader: linkedSession.authorization.headerValue,
                workspaceId: entry.workspaceId,
                sessionId: uploadSession.sessionId,
                request: MediaAssetUploadPartURLsRequest(
                    parts: batch.map { part in
                        MediaAssetUploadPartURLRequestPart(
                            partNumber: part.partNumber,
                            sha256: part.sha256
                        )
                    }
                )
            )
            try self.renewUploadClaim(claim: &claim)
            let partURLsByNumber = try mediaUploadPartURLsByPartNumber(
                response: partURLResponse,
                uploadSession: uploadSession,
                expectedParts: batch
            )

            for part in batch {
                guard let partURL = partURLsByNumber[part.partNumber] else {
                    throw MediaUploadTransferFailure(
                        policy: .permanent,
                        message: "Media upload part URL response omitted partNumber=\(part.partNumber) transferId=\(entry.transferId)"
                    )
                }

                try validateMediaUploadPartURLFresh(partURL: partURL, now: Date())
                try self.renewUploadClaim(claim: &claim)
                let partData = try await readMediaUploadPartDataOffMain(
                    fileURL: plan.fileURL,
                    part: part,
                    mediaAssetId: entry.mediaAssetId
                )
                try self.renewUploadClaim(claim: &claim)
                try validateMediaUploadPartURLFresh(partURL: partURL, now: Date())
                let eTag = try await self.cloudSyncService.uploadMediaAssetPart(
                    partURL: partURL,
                    body: partData
                )
                try self.renewUploadClaim(claim: &claim)
                completedParts.append(
                    CompletedMediaAssetUploadPart(
                        partNumber: part.partNumber,
                        eTag: eTag,
                        sha256: part.sha256
                    )
                )
            }
        }

        return completedParts.sorted { left, right in
            left.partNumber < right.partNumber
        }
    }

    private func renewUploadClaim(claim: inout MediaUploadTransferClaim) throws {
        let renewedAt = nowIsoTimestamp()
        let renewedEntry = try self.database.mediaTransferStore.renewTransferClaim(
            transferId: claim.transferId,
            workspaceId: claim.workspaceId,
            kind: claim.kind,
            claimedAt: claim.claimedAt,
            renewedAt: renewedAt
        )
        guard let renewedClaimedAt = renewedEntry.claimedAt else {
            throw LocalStoreError.database("Renewed media upload transfer is missing claimedAt transferId=\(claim.transferId)")
        }
        claim.claimedAt = renewedClaimedAt
    }

    private func persistSucceededUpload(
        entry: MediaTransferQueueEntry,
        claimedAt: String,
        mediaAsset: MediaAsset
    ) throws {
        let now = nowIsoTimestamp()
        try self.database.core.inTransaction {
            try self.database.mediaAssetStore.upsertMediaAsset(
                workspaceId: entry.workspaceId,
                mediaAsset: mediaAsset
            )
            _ = try self.database.mediaTransferStore.upsertBlobCacheEntry(
                entry: MediaBlobCacheUpsert(
                    sha256: mediaAsset.sha256,
                    mimeType: mediaAsset.mimeType,
                    sizeBytes: mediaAsset.sizeBytes,
                    createdAt: now,
                    lastAccessedAt: now,
                    sourceMediaAssetId: mediaAsset.mediaAssetId
                )
            )
            _ = try self.database.mediaTransferStore.markTransferSucceeded(
                transferId: entry.transferId,
                claimedAt: claimedAt,
                updatedAt: now
            )
        }
    }

    private func recordFailedUpload(
        entry: MediaTransferQueueEntry,
        claimedAt: String,
        error: Error
    ) throws {
        let failure = mediaUploadFailure(error: error)
        let now = Date()
        let nextAttemptAt: String
        switch failure.policy {
        case .transient:
            nextAttemptAt = formatIsoTimestamp(
                date: now.addingTimeInterval(mediaUploadRetryDelaySeconds(attemptCount: entry.attemptCount))
            )
        case .permanent:
            nextAttemptAt = mediaUploadPermanentFailureNextAttemptAt
        }

        _ = try self.database.mediaTransferStore.markTransferFailed(
            transferId: entry.transferId,
            claimedAt: claimedAt,
            errorMessage: failure.message,
            nextAttemptAt: nextAttemptAt,
            updatedAt: formatIsoTimestamp(date: now)
        )
    }
}

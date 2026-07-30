import CryptoKit
import Foundation

let mediaUploadBaseRetryDelaySeconds: TimeInterval = 60
let mediaUploadMaxRetryDelaySeconds: TimeInterval = 3_600
let mediaUploadMultipartPartSizeBytes: Int64 = 8_388_608
let mediaUploadPartURLBatchSize: Int = 1
let mediaUploadPartURLExpirationSafetyMarginSeconds: TimeInterval = 300
let mediaUploadPermanentFailureNextAttemptAt: String = "9999-12-31T00:00:00.000Z"
let mediaUploadResponseDecodingFailedCode: String = "RESPONSE_DECODING_FAILED"
let mediaUploadTransferClaimLeaseSeconds: TimeInterval = 900
let mediaUploadTransferClaimLimit: Int = 3
private let mediaUploadSameSessionCompletionRetryErrorCodes: Set<String> = [
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
]

enum MediaUploadTransferFailurePolicy: Sendable {
    case transient
    case permanent
}

struct MediaUploadTransferFailure: LocalizedError, Sendable {
    let policy: MediaUploadTransferFailurePolicy
    let message: String

    var errorDescription: String? {
        self.message
    }
}

enum MediaUploadCompletionTerminalReason: String {
    case retryExhausted = "retry_exhausted"
    case interrupted
}

struct MediaUploadCompletionTerminalError: LocalizedError {
    let reason: MediaUploadCompletionTerminalReason
    let completionCause: Error
    let interruptionCause: Error?

    var errorDescription: String? {
        let interruptionDescription = self.interruptionCause.map { error in
            mediaUploadCompletionErrorDescription(error: error)
        } ?? "none"
        return "Media upload completion stopped for this local run: reason=\(self.reason.rawValue), "
            + "completionError=\(mediaUploadCompletionErrorDescription(error: self.completionCause)), "
            + "interruptionError=\(interruptionDescription)"
    }
}

struct MediaUploadCompletionReplayResult {
    let response: MediaAssetUploadSessionCompleteResponse
    let retryableCompletionCause: Error?
}

struct MediaUploadClaimedResult {
    let mediaAsset: MediaAsset
    let retryableCompletionCause: Error?
}

private func mediaUploadCompletionErrorDescription(error: Error) -> String {
    guard let cloudError = error as? CloudSyncError,
          case .invalidResponse(let details, let statusCode) = cloudError else {
        return Flashcards.errorMessage(error: error)
    }
    return [
        details.message,
        "status=\(statusCode)",
        "code=\(details.code ?? "none")",
        "requestId=\(details.requestId ?? "none")",
    ].joined(separator: " ")
}

struct MediaUploadTransferClaim: Sendable {
    let transferId: String
    let workspaceId: String
    let kind: MediaTransferKind
    var claimedAt: String

    init(entry: MediaTransferQueueEntry, claimedAt: String) {
        self.transferId = entry.transferId
        self.workspaceId = entry.workspaceId
        self.kind = entry.kind
        self.claimedAt = claimedAt
    }
}

func validateMediaUploadSessionCreateResponse(
    response: MediaAssetUploadSessionCreateResponse,
    entry: MediaTransferQueueEntry,
    plan: MediaUploadTransferPlan
) throws {
    guard response.workspaceId == entry.workspaceId,
          response.mediaAssetId == entry.mediaAssetId else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media upload session response identity mismatch transferId=\(entry.transferId)"
        )
    }

    if let uploadSession = response.uploadSession {
        guard uploadSession.partSizeBytes == plan.partSizeBytes,
              uploadSession.partCount == plan.parts.count else {
            throw MediaUploadTransferFailure(
                policy: .permanent,
                message: "Media upload session multipart shape mismatch transferId=\(entry.transferId)"
            )
        }
    }
}

func validateUploadedMediaAsset(
    mediaAsset: MediaAsset,
    entry: MediaTransferQueueEntry,
    plan: MediaUploadTransferPlan
) throws {
    guard mediaAsset.workspaceId == entry.workspaceId,
          mediaAsset.mediaAssetId == entry.mediaAssetId,
          mediaAsset.deletedAt == nil else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media upload completed asset identity mismatch transferId=\(entry.transferId)"
        )
    }
    guard mediaAsset.sizeBytes == plan.sizeBytes,
          try normalizedMediaSha256(sha256: mediaAsset.sha256) == plan.sha256,
          mediaAsset.mimeType.lowercased() == entry.mimeType.lowercased() else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media upload completed asset metadata mismatch transferId=\(entry.transferId)"
        )
    }
}

func mediaUploadPartURLsByPartNumber(
    response: MediaAssetUploadPartURLsResponse,
    uploadSession: MediaAssetUploadSessionMetadata,
    expectedParts: [MediaUploadPartPlan]
) throws -> [Int: MediaAssetUploadPartURL] {
    guard response.sessionId == uploadSession.sessionId else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media upload part URL response session mismatch sessionId=\(uploadSession.sessionId)"
        )
    }

    var partURLsByNumber: [Int: MediaAssetUploadPartURL] = [:]
    for partURL in response.partUrls {
        if partURLsByNumber[partURL.partNumber] != nil {
            throw MediaUploadTransferFailure(
                policy: .permanent,
                message: "Media upload part URL response duplicated partNumber=\(partURL.partNumber) sessionId=\(uploadSession.sessionId)"
            )
        }
        partURLsByNumber[partURL.partNumber] = partURL
    }

    let expectedPartNumbers = Set(expectedParts.map(\.partNumber))
    guard Set(partURLsByNumber.keys) == expectedPartNumbers else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media upload part URL response did not match requested part numbers sessionId=\(uploadSession.sessionId)"
        )
    }

    return partURLsByNumber
}

func validateMediaUploadPartURLFresh(partURL: MediaAssetUploadPartURL, now: Date) throws {
    guard let expiresAt = parseStrictIsoTimestamp(value: partURL.expiresAt) else {
        throw MediaUploadTransferFailure(
            policy: .permanent,
            message: "Media upload part URL response has invalid expiresAt partNumber=\(partURL.partNumber)"
        )
    }
    guard expiresAt.timeIntervalSince(now) > mediaUploadPartURLExpirationSafetyMarginSeconds else {
        throw MediaUploadTransferFailure(
            policy: .transient,
            message: "Media upload part URL expires too soon partNumber=\(partURL.partNumber) expiresAt=\(partURL.expiresAt)"
        )
    }
}

func mediaUploadPartPlanBatches(
    parts: [MediaUploadPartPlan],
    batchSize: Int
) throws -> [[MediaUploadPartPlan]] {
    guard batchSize > 0 else {
        throw LocalStoreError.validation("Media upload part URL batch size must be positive")
    }

    var batches: [[MediaUploadPartPlan]] = []
    var startIndex = 0
    while startIndex < parts.count {
        let endIndex = min(startIndex + batchSize, parts.count)
        batches.append(Array(parts[startIndex..<endIndex]))
        startIndex = endIndex
    }
    return batches
}

func mediaUploadWorkspaceReplicaId(workspaceId: String, installationId: String) -> String {
    let seed = "\(workspaceId):\(installationId)"
    var bytes = Array(SHA256.hash(data: Data(seed.utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x50
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    return UUID(uuid: (
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    )).uuidString.lowercased()
}

func mediaUploadRetryDelaySeconds(attemptCount: Int) -> TimeInterval {
    let boundedAttemptCount = max(0, min(attemptCount, 5))
    let multiplier = pow(2.0, Double(boundedAttemptCount))
    return min(mediaUploadMaxRetryDelaySeconds, mediaUploadBaseRetryDelaySeconds * multiplier)
}

func mediaUploadAuthOrRetryStatusIsTransient(statusCode: Int) -> Bool {
    statusCode == 401 || statusCode == 408 || statusCode == 429 || statusCode >= 500
}

func mediaUploadPartPutStatusIsTransient(statusCode: Int) -> Bool {
    statusCode == 403 || mediaUploadAuthOrRetryStatusIsTransient(statusCode: statusCode)
}

func mediaUploadFailure(error: Error) -> MediaUploadTransferFailure {
    if let terminalError = error as? MediaUploadCompletionTerminalError {
        return MediaUploadTransferFailure(
            policy: .permanent,
            message: terminalError.errorDescription ?? "Media upload completion stopped for this local run"
        )
    }
    if let failure = error as? MediaUploadTransferFailure {
        return failure
    }
    if let partHTTPError = error as? MediaAssetUploadPartHTTPError {
        let policy: MediaUploadTransferFailurePolicy
        if mediaUploadPartPutStatusIsTransient(statusCode: partHTTPError.statusCode) {
            policy = .transient
        } else {
            policy = .permanent
        }
        return MediaUploadTransferFailure(
            policy: policy,
            message: Flashcards.errorMessage(error: error)
        )
    }
    if let cloudError = error as? CloudSyncError {
        switch cloudError {
        case .invalidBaseUrl:
            return MediaUploadTransferFailure(policy: .permanent, message: Flashcards.errorMessage(error: error))
        case .invalidResponse(let details, let statusCode):
            if details.code == mediaUploadResponseDecodingFailedCode {
                return MediaUploadTransferFailure(policy: .permanent, message: Flashcards.errorMessage(error: error))
            }
            if details.code == "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED" {
                return MediaUploadTransferFailure(policy: .transient, message: Flashcards.errorMessage(error: error))
            }
            if mediaUploadAuthOrRetryStatusIsTransient(statusCode: statusCode) {
                return MediaUploadTransferFailure(policy: .transient, message: Flashcards.errorMessage(error: error))
            }
            if statusCode >= 400 && statusCode < 500 {
                return MediaUploadTransferFailure(policy: .permanent, message: Flashcards.errorMessage(error: error))
            }
            return MediaUploadTransferFailure(policy: .transient, message: Flashcards.errorMessage(error: error))
        }
    }
    if isRetryableNetworkTransportFailure(error: error) {
        return MediaUploadTransferFailure(policy: .transient, message: Flashcards.errorMessage(error: error))
    }
    if let localError = error as? LocalStoreError {
        switch localError {
        case .validation, .notFound:
            return MediaUploadTransferFailure(policy: .permanent, message: Flashcards.errorMessage(error: error))
        case .database, .uninitialized:
            return MediaUploadTransferFailure(policy: .transient, message: Flashcards.errorMessage(error: error))
        }
    }

    return MediaUploadTransferFailure(policy: .transient, message: Flashcards.errorMessage(error: error))
}

func isMediaUploadSameSessionCompletionRetryError(error: Error) -> Bool {
    guard let cloudError = error as? CloudSyncError,
          case .invalidResponse(let details, _) = cloudError,
          let code = details.code else {
        return false
    }
    return mediaUploadSameSessionCompletionRetryErrorCodes.contains(code)
}

func shouldAbortMediaUploadSessionAfterFailure(error: Error) -> Bool {
    error is MediaUploadCompletionTerminalError == false
        && !isMediaUploadSameSessionCompletionRetryError(error: error)
}

func mediaUploadSameSessionCompletionRetryDelayNanoseconds(error: Error) -> UInt64 {
    guard let cloudError = error as? CloudSyncError,
          case .invalidResponse(let details, _) = cloudError else {
        return cloudSyncTransportRetryDelayNanoseconds
    }
    return details.retryAfterDelayNanoseconds ?? cloudSyncTransportRetryDelayNanoseconds
}

@MainActor
func retryMediaUploadSessionCompletion(
    validateOwnership: () throws -> Void,
    complete: () async throws -> MediaAssetUploadSessionCompleteResponse,
    sleep: (UInt64) async throws -> Void
) async throws -> MediaUploadCompletionReplayResult {
    var lastRetryableCompletionError: Error?

    for attempt in 1...cloudSyncTransportMaxAttempts {
        if Task.isCancelled {
            let cancellationError = CancellationError()
            if let lastRetryableCompletionError {
                throw MediaUploadCompletionTerminalError(
                    reason: .interrupted,
                    completionCause: lastRetryableCompletionError,
                    interruptionCause: cancellationError
                )
            }
            throw cancellationError
        }

        do {
            try validateOwnership()
        } catch {
            if let lastRetryableCompletionError {
                throw MediaUploadCompletionTerminalError(
                    reason: .interrupted,
                    completionCause: lastRetryableCompletionError,
                    interruptionCause: error
                )
            }
            throw error
        }

        do {
            let response = try await complete()
            do {
                try validateOwnership()
            } catch {
                if let lastRetryableCompletionError {
                    throw MediaUploadCompletionTerminalError(
                        reason: .interrupted,
                        completionCause: lastRetryableCompletionError,
                        interruptionCause: error
                    )
                }
                throw error
            }
            return MediaUploadCompletionReplayResult(
                response: response,
                retryableCompletionCause: lastRetryableCompletionError
            )
        } catch {
            if error is MediaUploadCompletionTerminalError {
                throw error
            }
            if isRequestCancellationError(error: error) {
                if let lastRetryableCompletionError {
                    throw MediaUploadCompletionTerminalError(
                        reason: .interrupted,
                        completionCause: lastRetryableCompletionError,
                        interruptionCause: error
                    )
                }
                throw error
            }
            guard isMediaUploadSameSessionCompletionRetryError(error: error) else {
                if let lastRetryableCompletionError {
                    throw MediaUploadCompletionTerminalError(
                        reason: .interrupted,
                        completionCause: lastRetryableCompletionError,
                        interruptionCause: error
                    )
                }
                throw error
            }
            lastRetryableCompletionError = error
            guard attempt < cloudSyncTransportMaxAttempts else {
                throw MediaUploadCompletionTerminalError(
                    reason: .retryExhausted,
                    completionCause: error,
                    interruptionCause: nil
                )
            }

            do {
                try await sleep(mediaUploadSameSessionCompletionRetryDelayNanoseconds(error: error))
            } catch {
                throw MediaUploadCompletionTerminalError(
                    reason: .interrupted,
                    completionCause: lastRetryableCompletionError ?? error,
                    interruptionCause: error
                )
            }
        }
    }

    throw LocalStoreError.database("Media upload completion retry exited without a result")
}

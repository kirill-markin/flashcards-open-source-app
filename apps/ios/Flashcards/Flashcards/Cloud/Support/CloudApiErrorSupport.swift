import Foundation

private struct CloudApiErrorEnvelope: Decodable {
    let error: String?
    let requestId: String?
    let code: String?
    let details: CloudApiErrorPublicDetails?

    enum CodingKeys: String, CodingKey {
        case error
        case requestId
        case code
        case details
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.error = try container.decodeIfPresent(String.self, forKey: .error)
        self.requestId = try container.decodeIfPresent(String.self, forKey: .requestId)
        self.code = try container.decodeIfPresent(String.self, forKey: .code)
        self.details = try? container.decodeIfPresent(CloudApiErrorPublicDetails.self, forKey: .details)
    }
}

private struct CloudApiErrorPublicDetails: Decodable {
    let syncConflict: CloudSyncConflictDetails?
    let retryAfterSeconds: Int?
}

struct CloudSyncConflictDetails: Codable, Hashable {
    let phase: String
    let entityType: SyncEntityType
    let entityId: String
    let entryIndex: Int?
    let reviewEventIndex: Int?
    let recoverable: Bool
}

struct CloudApiErrorDetails: Hashable {
    let message: String
    let requestId: String?
    let code: String?
    let syncConflict: CloudSyncConflictDetails?
    let retryAfterDelayNanoseconds: UInt64?

    init(
        message: String,
        requestId: String?,
        code: String?,
        syncConflict: CloudSyncConflictDetails?
    ) {
        self.message = message
        self.requestId = requestId
        self.code = code
        self.syncConflict = syncConflict
        self.retryAfterDelayNanoseconds = nil
    }

    init(
        message: String,
        requestId: String?,
        code: String?,
        syncConflict: CloudSyncConflictDetails?,
        retryAfterDelayNanoseconds: UInt64?
    ) {
        self.message = message
        self.requestId = requestId
        self.code = code
        self.syncConflict = syncConflict
        self.retryAfterDelayNanoseconds = retryAfterDelayNanoseconds
    }
}

func decodeCloudApiErrorDetails(data: Data, requestId: String?) -> CloudApiErrorDetails {
    decodeCloudApiErrorDetails(
        data: data,
        requestId: requestId,
        retryAfterDelayNanoseconds: nil
    )
}

func decodeCloudApiErrorDetails(
    data: Data,
    requestId: String?,
    retryAfterDelayNanoseconds: UInt64?
) -> CloudApiErrorDetails {
    if let envelope = try? makeFlashcardsRemoteJSONDecoder().decode(CloudApiErrorEnvelope.self, from: data) {
        let message = envelope.error?.isEmpty == false
            ? envelope.error!
            : String(data: data, encoding: .utf8) ?? "<non-utf8-body>"
        let bodyRetryAfterDelayNanoseconds = envelope.details?.retryAfterSeconds.flatMap {
            cloudRetryAfterDelayNanoseconds(seconds: $0)
        }
        return CloudApiErrorDetails(
            message: message,
            requestId: envelope.requestId ?? requestId,
            code: envelope.code,
            syncConflict: envelope.details?.syncConflict,
            retryAfterDelayNanoseconds: retryAfterDelayNanoseconds ?? bodyRetryAfterDelayNanoseconds
        )
    }

    return CloudApiErrorDetails(
        message: String(data: data, encoding: .utf8) ?? "<non-utf8-body>",
        requestId: requestId,
        code: nil,
        syncConflict: nil,
        retryAfterDelayNanoseconds: retryAfterDelayNanoseconds
    )
}

func cloudRetryAfterDelayNanoseconds(value: String?) -> UInt64? {
    guard let value,
          let seconds = Int(value.trimmingCharacters(in: .whitespacesAndNewlines)) else {
        return nil
    }
    return cloudRetryAfterDelayNanoseconds(seconds: seconds)
}

private func cloudRetryAfterDelayNanoseconds(seconds: Int) -> UInt64? {
    guard seconds >= 0,
          UInt64(seconds) <= UInt64.max / 1_000_000_000 else {
        return nil
    }
    return UInt64(seconds) * 1_000_000_000
}

func appendCloudRequestIdReference(message: String, requestId: String?) -> String {
    guard let requestId, requestId.isEmpty == false else {
        return message
    }

    return "\(message) Reference: \(requestId)"
}

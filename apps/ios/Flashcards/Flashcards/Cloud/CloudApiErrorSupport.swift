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
}

func decodeCloudApiErrorDetails(data: Data, requestId: String?) -> CloudApiErrorDetails {
    if let envelope = try? makeFlashcardsRemoteJSONDecoder().decode(CloudApiErrorEnvelope.self, from: data) {
        let message = envelope.error?.isEmpty == false
            ? envelope.error!
            : String(data: data, encoding: .utf8) ?? "<non-utf8-body>"
        return CloudApiErrorDetails(
            message: message,
            requestId: envelope.requestId ?? requestId,
            code: envelope.code,
            syncConflict: envelope.details?.syncConflict
        )
    }

    return CloudApiErrorDetails(
        message: String(data: data, encoding: .utf8) ?? "<non-utf8-body>",
        requestId: requestId,
        code: nil,
        syncConflict: nil
    )
}

func appendCloudRequestIdReference(message: String, requestId: String?) -> String {
    guard let requestId, requestId.isEmpty == false else {
        return message
    }

    return "\(message) Reference: \(requestId)"
}

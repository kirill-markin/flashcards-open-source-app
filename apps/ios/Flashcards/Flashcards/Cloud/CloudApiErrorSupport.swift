import Foundation

private struct CloudApiErrorEnvelope: Decodable {
    let error: String?
    let requestId: String?
    let code: String?
}

struct CloudApiErrorDetails: Hashable {
    let message: String
    let requestId: String?
    let code: String?
}

func decodeCloudApiErrorDetails(data: Data, requestId: String?) -> CloudApiErrorDetails {
    if let envelope = try? makeFlashcardsRemoteJSONDecoder().decode(CloudApiErrorEnvelope.self, from: data) {
        let message = envelope.error?.isEmpty == false
            ? envelope.error!
            : String(data: data, encoding: .utf8) ?? "<non-utf8-body>"
        return CloudApiErrorDetails(
            message: message,
            requestId: envelope.requestId ?? requestId,
            code: envelope.code
        )
    }

    return CloudApiErrorDetails(
        message: String(data: data, encoding: .utf8) ?? "<non-utf8-body>",
        requestId: requestId,
        code: nil
    )
}

func appendCloudRequestIdReference(message: String, requestId: String?) -> String {
    guard let requestId, requestId.isEmpty == false else {
        return message
    }

    return "\(message) Reference: \(requestId)"
}

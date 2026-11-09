import Foundation

/*
 The watch never signs in on its own: it asks the paired iPhone for the account the iPhone app holds.
 A WatchConnectivity message is a dictionary whose only entry, under the message key, is the
 JSON-encoded request or reply; build and read messages only through the functions below. The watch
 and the iPhone ship together, so a message from a different contract version is rejected rather
 than interpreted.
 */

let watchHandoffContractVersion: Int = 1
let watchHandoffRequestMessageKey: String = "watchHandoffRequest"
let watchHandoffReplyMessageKey: String = "watchHandoffReply"

enum WatchHandoffMessageError: LocalizedError {
    case missingPayload(key: String, receivedKeys: [String])
    case iPhoneReplyFailed

    var errorDescription: String? {
        switch self {
        case .missingPayload(let key, let receivedKeys):
            return "Watch handoff message has no JSON data under \"\(key)\"; received keys: \(receivedKeys.sorted())"
        case .iPhoneReplyFailed:
            return "The iPhone could not build a watch handoff reply"
        }
    }
}

enum WatchHandoffContractError: LocalizedError {
    case unsupportedContractVersion(received: Int, supported: Int)

    var errorDescription: String? {
        switch self {
        case .unsupportedContractVersion(let received, let supported):
            return "Watch handoff contract version \(received) is not supported; this build speaks version \(supported)"
        }
    }
}

struct WatchHandoffRequest: Codable, Hashable, Sendable {
    let contractVersion: Int

    private enum CodingKeys: String, CodingKey {
        case contractVersion
    }

    init(contractVersion: Int) {
        self.contractVersion = contractVersion
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.contractVersion = try decodeSupportedWatchHandoffContractVersion(container: container, key: .contractVersion)
    }
}

/// The linked account the iPhone app is signed in to, with the workspace and Review filter it shows.
struct WatchHandoffSignedInAccount: Codable, Hashable, Sendable {
    let credentials: StoredCloudCredentials
    let linkedUserId: String
    let email: String?
    let workspaceId: String
    let reviewFilter: PersistedReviewFilter
}

enum WatchHandoffReplyState: String, Codable, Hashable, Sendable {
    case signedIn
    case signedOut
}

/// `signedOut` covers an iPhone app that is signed out or is a guest: the watch serves linked accounts only.
enum WatchHandoffReply: Codable, Hashable, Sendable {
    case signedIn(WatchHandoffSignedInAccount)
    case signedOut

    private enum CodingKeys: String, CodingKey {
        case contractVersion
        case state
        case account
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        _ = try decodeSupportedWatchHandoffContractVersion(container: container, key: .contractVersion)
        switch try container.decode(WatchHandoffReplyState.self, forKey: .state) {
        case .signedIn:
            self = .signedIn(try container.decode(WatchHandoffSignedInAccount.self, forKey: .account))
        case .signedOut:
            self = .signedOut
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(watchHandoffContractVersion, forKey: .contractVersion)
        switch self {
        case .signedIn(let account):
            try container.encode(WatchHandoffReplyState.signedIn, forKey: .state)
            try container.encode(account, forKey: .account)
        case .signedOut:
            try container.encode(WatchHandoffReplyState.signedOut, forKey: .state)
        }
    }
}

private func decodeSupportedWatchHandoffContractVersion<Key: CodingKey>(
    container: KeyedDecodingContainer<Key>,
    key: Key
) throws -> Int {
    let contractVersion = try container.decode(Int.self, forKey: key)
    guard contractVersion == watchHandoffContractVersion else {
        throw WatchHandoffContractError.unsupportedContractVersion(
            received: contractVersion,
            supported: watchHandoffContractVersion
        )
    }
    return contractVersion
}

func makeWatchHandoffRequestMessage(request: WatchHandoffRequest) throws -> [String: Any] {
    [watchHandoffRequestMessageKey: try JSONEncoder().encode(request)]
}

func decodeWatchHandoffRequest(message: [String: Any]) throws -> WatchHandoffRequest {
    try JSONDecoder().decode(
        WatchHandoffRequest.self,
        from: try watchHandoffMessagePayload(message: message, key: watchHandoffRequestMessageKey)
    )
}

func makeWatchHandoffReplyMessage(reply: WatchHandoffReply) throws -> [String: Any] {
    [watchHandoffReplyMessageKey: try JSONEncoder().encode(reply)]
}

/// Sent when the iPhone cannot build a reply, including for a request of another contract version, so the
/// watch fails at once instead of waiting for a timeout.
func makeWatchHandoffFailureReplyMessage() -> [String: Any] {
    [:]
}

func decodeWatchHandoffReply(message: [String: Any]) throws -> WatchHandoffReply {
    if message.isEmpty {
        throw WatchHandoffMessageError.iPhoneReplyFailed
    }
    return try JSONDecoder().decode(
        WatchHandoffReply.self,
        from: try watchHandoffMessagePayload(message: message, key: watchHandoffReplyMessageKey)
    )
}

private func watchHandoffMessagePayload(message: [String: Any], key: String) throws -> Data {
    guard let payload = message[key] as? Data else {
        throw WatchHandoffMessageError.missingPayload(key: key, receivedKeys: Array(message.keys))
    }
    return payload
}

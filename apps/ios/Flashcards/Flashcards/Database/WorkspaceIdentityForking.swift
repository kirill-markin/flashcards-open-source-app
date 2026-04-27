import CryptoKit
import Foundation

private let cardIdentityForkNamespace: UUID = UUID(uuidString: "5b0c7f2e-6f2a-4b7e-9e1b-2b5f0a4a91b1")!
private let deckIdentityForkNamespace: UUID = UUID(uuidString: "98e66f2c-d3c7-4e3f-a7df-55d8e19ad2b4")!
private let reviewEventIdentityForkNamespace: UUID = UUID(uuidString: "3a214a3e-9c89-426d-a21f-11a5f5c1d6e8")!

struct WorkspaceForkIdMappings {
    let cardIdsBySourceId: [String: String]
    let deckIdsBySourceId: [String: String]
    let reviewEventIdsBySourceId: [String: String]
}

func forkedCardIdForWorkspace(
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    sourceCardId: String
) -> String {
    forkedWorkspaceEntityId(
        namespace: cardIdentityForkNamespace,
        sourceWorkspaceId: sourceWorkspaceId,
        destinationWorkspaceId: destinationWorkspaceId,
        sourceEntityId: sourceCardId
    )
}

func forkedDeckIdForWorkspace(
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    sourceDeckId: String
) -> String {
    forkedWorkspaceEntityId(
        namespace: deckIdentityForkNamespace,
        sourceWorkspaceId: sourceWorkspaceId,
        destinationWorkspaceId: destinationWorkspaceId,
        sourceEntityId: sourceDeckId
    )
}

func forkedReviewEventIdForWorkspace(
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    sourceReviewEventId: String
) -> String {
    forkedWorkspaceEntityId(
        namespace: reviewEventIdentityForkNamespace,
        sourceWorkspaceId: sourceWorkspaceId,
        destinationWorkspaceId: destinationWorkspaceId,
        sourceEntityId: sourceReviewEventId
    )
}

private func forkedWorkspaceEntityId(
    namespace: UUID,
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    sourceEntityId: String
) -> String {
    if sourceWorkspaceId == destinationWorkspaceId {
        return sourceEntityId
    }

    let name = "\(sourceWorkspaceId):\(destinationWorkspaceId):\(sourceEntityId)"
    return uuidV5(namespace: namespace, name: name).uuidString.lowercased()
}

private func uuidV5(namespace: UUID, name: String) -> UUID {
    let hashInput = namespace.bigEndianBytes + Array(name.utf8)
    var hash = Array(Insecure.SHA1.hash(data: Data(hashInput)))
    hash[6] = (hash[6] & 0x0f) | 0x50
    hash[8] = (hash[8] & 0x3f) | 0x80
    return UUID(uuid: (
        hash[0],
        hash[1],
        hash[2],
        hash[3],
        hash[4],
        hash[5],
        hash[6],
        hash[7],
        hash[8],
        hash[9],
        hash[10],
        hash[11],
        hash[12],
        hash[13],
        hash[14],
        hash[15]
    ))
}

private extension UUID {
    var bigEndianBytes: [UInt8] {
        [
            self.uuid.0,
            self.uuid.1,
            self.uuid.2,
            self.uuid.3,
            self.uuid.4,
            self.uuid.5,
            self.uuid.6,
            self.uuid.7,
            self.uuid.8,
            self.uuid.9,
            self.uuid.10,
            self.uuid.11,
            self.uuid.12,
            self.uuid.13,
            self.uuid.14,
            self.uuid.15,
        ]
    }
}

extension Dictionary where Key == String, Value == String {
    func requireMappedId(entityType: String, sourceId: String) throws -> String {
        guard let mappedId = self[sourceId] else {
            throw LocalStoreError.database(
                "Workspace identity fork is missing mapped \(entityType) id for source id '\(sourceId)'"
            )
        }

        return mappedId
    }
}

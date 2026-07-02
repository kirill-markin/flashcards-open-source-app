/*
 Keep sync wire contracts aligned with:
 - apps/backend/src/sync/contracts/input.ts
 - apps/backend/src/sync/contracts/types.ts
 - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/cloud/remote/sync/CloudSyncRemoteApi.kt
 */

import Foundation

enum WorkspacePackageExportSelection: Codable, Hashable, Sendable {
    case allActiveCards
    case tagFilters(includeTags: [String], excludeTags: [String])
    case explicitCardIds(cardIds: [String])

    private enum Kind: String, Codable {
        case allActiveCards
        case tagFilters
        case explicitCardIds
    }

    private enum CodingKeys: String, CodingKey {
        case kind
        case includeTags
        case excludeTags
        case cardIds
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(Kind.self, forKey: .kind)
        switch kind {
        case .allActiveCards:
            self = .allActiveCards
        case .tagFilters:
            self = .tagFilters(
                includeTags: try container.decode([String].self, forKey: .includeTags),
                excludeTags: try container.decode([String].self, forKey: .excludeTags)
            )
        case .explicitCardIds:
            self = .explicitCardIds(cardIds: try container.decode([String].self, forKey: .cardIds))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .allActiveCards:
            try container.encode(Kind.allActiveCards, forKey: .kind)
        case .tagFilters(let includeTags, let excludeTags):
            try container.encode(Kind.tagFilters, forKey: .kind)
            try container.encode(includeTags, forKey: .includeTags)
            try container.encode(excludeTags, forKey: .excludeTags)
        case .explicitCardIds(let cardIds):
            try container.encode(Kind.explicitCardIds, forKey: .kind)
            try container.encode(cardIds, forKey: .cardIds)
        }
    }
}

struct WorkspacePackageExportTagPolicyInput: Codable, Hashable, Sendable {
    let additionalRemovedTags: [String]
}

struct WorkspacePackageExportMetadataInput: Codable, Hashable, Sendable {
    let label: String?
    let author: String?
    let comment: String?
    let createdAt: String?
    let sourceUrl: String?

    enum CodingKeys: String, CodingKey {
        case label
        case author
        case comment
        case createdAt
        case sourceUrl
    }

    init(label: String?, author: String?, comment: String?, createdAt: String?, sourceUrl: String?) {
        self.label = label
        self.author = author
        self.comment = comment
        self.createdAt = createdAt
        self.sourceUrl = sourceUrl
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.label, forKey: .label)
        try container.encode(self.author, forKey: .author)
        try container.encode(self.comment, forKey: .comment)
        try container.encode(self.createdAt, forKey: .createdAt)
        try container.encode(self.sourceUrl, forKey: .sourceUrl)
    }
}

struct WorkspacePackageExportRequest: Codable, Hashable, Sendable {
    let selection: WorkspacePackageExportSelection
    let tagPolicy: WorkspacePackageExportTagPolicyInput
    let packageMetadata: WorkspacePackageExportMetadataInput
}

struct WorkspacePackageExportTagCount: Codable, Hashable, Identifiable, Sendable {
    let tag: String
    let cardsCount: Int

    enum CodingKeys: String, CodingKey {
        case tag
        case cardsCount
    }

    var id: String {
        tag
    }

    init(tag: String, cardsCount: Int) {
        self.tag = tag
        self.cardsCount = cardsCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.tag = try container.decode(String.self, forKey: .tag)
        self.cardsCount = try decodeNonNegativeWorkspacePackageInt(from: container, forKey: .cardsCount)
    }
}

struct WorkspacePackageExportDefaultPackageMetadata: Codable, Hashable, Sendable {
    let label: String
    let author: String?
    let comment: String?
    let createdAt: String
    let sourceUrl: String?
}

struct WorkspacePackageExportPreviewResponse: Codable, Hashable, Sendable {
    let selectedCardCount: Int
    let availableTagCounts: [WorkspacePackageExportTagCount]
    let tagsSelectedForRemoval: [WorkspacePackageExportTagCount]
    let referencedMediaCount: Int
    let approximateReferencedMediaBytes: Int64
    let defaultPackageMetadata: WorkspacePackageExportDefaultPackageMetadata

    enum CodingKeys: String, CodingKey {
        case selectedCardCount
        case availableTagCounts
        case tagsSelectedForRemoval
        case referencedMediaCount
        case approximateReferencedMediaBytes
        case defaultPackageMetadata
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.selectedCardCount = try decodeNonNegativeWorkspacePackageInt(
            from: container,
            forKey: .selectedCardCount
        )
        self.availableTagCounts = try container.decode([WorkspacePackageExportTagCount].self, forKey: .availableTagCounts)
        self.tagsSelectedForRemoval = try container.decode(
            [WorkspacePackageExportTagCount].self,
            forKey: .tagsSelectedForRemoval
        )
        self.referencedMediaCount = try decodeNonNegativeWorkspacePackageInt(
            from: container,
            forKey: .referencedMediaCount
        )
        self.approximateReferencedMediaBytes = try decodeNonNegativeWorkspacePackageInt64(
            from: container,
            forKey: .approximateReferencedMediaBytes
        )
        self.defaultPackageMetadata = try container.decode(
            WorkspacePackageExportDefaultPackageMetadata.self,
            forKey: .defaultPackageMetadata
        )
    }
}

struct WorkspacePackageExportDownloadResponse: Hashable, Sendable {
    let packageBytes: Data
    let fileName: String
    let contentType: String
}

enum WorkspacePackageImportSourceKind: String, Codable, Hashable, Sendable {
    case zip
}

struct WorkspacePackageImportPreviewMetadata: Codable, Hashable, Sendable {
    let label: String?
    let author: String?
    let comment: String?
    let createdAt: String?
    let sourceUrl: String?
}

private func decodeNonNegativeWorkspacePackageInt<Key: CodingKey>(
    from container: KeyedDecodingContainer<Key>,
    forKey key: Key
) throws -> Int {
    let value = try container.decode(Int.self, forKey: key)
    guard value >= 0 else {
        throw DecodingError.dataCorruptedError(
            forKey: key,
            in: container,
            debugDescription: "\(key.stringValue) must be non-negative"
        )
    }

    return value
}

private func decodeNonNegativeWorkspacePackageInt64<Key: CodingKey>(
    from container: KeyedDecodingContainer<Key>,
    forKey key: Key
) throws -> Int64 {
    let value = try container.decode(Int64.self, forKey: key)
    guard value >= 0 else {
        throw DecodingError.dataCorruptedError(
            forKey: key,
            in: container,
            debugDescription: "\(key.stringValue) must be non-negative"
        )
    }

    return value
}

struct WorkspacePackageImportTagCount: Codable, Hashable, Identifiable, Sendable {
    let tag: String
    let cardsCount: Int

    enum CodingKeys: String, CodingKey {
        case tag
        case cardsCount
    }

    var id: String {
        tag
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.tag = try container.decode(String.self, forKey: .tag)
        self.cardsCount = try decodeNonNegativeWorkspacePackageInt(from: container, forKey: .cardsCount)
    }
}

struct WorkspacePackageImportWarning: Codable, Hashable, Identifiable, Sendable {
    let code: String
    let message: String
    let mediaPath: String

    var id: String {
        "\(code):\(mediaPath):\(message)"
    }
}

struct WorkspacePackageImportDefaultOptions: Codable, Hashable, Sendable {
    let addImportTag: Bool
    let suggestedImportTag: String
    let keptTags: [String]
    let removedTags: [String]
}

struct WorkspacePackageImportPreviewResponse: Codable, Hashable, Sendable {
    let sourceKind: WorkspacePackageImportSourceKind
    let packageMetadata: WorkspacePackageImportPreviewMetadata
    let cardCount: Int
    let tagCounts: [WorkspacePackageImportTagCount]
    let referencedMediaCount: Int
    let packageMediaFileCount: Int
    let warnings: [WorkspacePackageImportWarning]
    let defaultOptions: WorkspacePackageImportDefaultOptions

    enum CodingKeys: String, CodingKey {
        case sourceKind
        case packageMetadata
        case cardCount
        case tagCounts
        case referencedMediaCount
        case packageMediaFileCount
        case warnings
        case defaultOptions
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.sourceKind = try container.decode(WorkspacePackageImportSourceKind.self, forKey: .sourceKind)
        self.packageMetadata = try container.decode(
            WorkspacePackageImportPreviewMetadata.self,
            forKey: .packageMetadata
        )
        self.cardCount = try decodeNonNegativeWorkspacePackageInt(from: container, forKey: .cardCount)
        self.tagCounts = try container.decode([WorkspacePackageImportTagCount].self, forKey: .tagCounts)
        self.referencedMediaCount = try decodeNonNegativeWorkspacePackageInt(
            from: container,
            forKey: .referencedMediaCount
        )
        self.packageMediaFileCount = try decodeNonNegativeWorkspacePackageInt(
            from: container,
            forKey: .packageMediaFileCount
        )
        self.warnings = try container.decode([WorkspacePackageImportWarning].self, forKey: .warnings)
        self.defaultOptions = try container.decode(
            WorkspacePackageImportDefaultOptions.self,
            forKey: .defaultOptions
        )
    }
}

struct WorkspacePackageImportConfirmOptions: Codable, Hashable, Sendable {
    let addImportTag: Bool
    let importTag: String
    let removeTags: [String]
    let importedAt: String
    let importId: String
    let clientUpdatedAt: String
    let lastModifiedByReplicaId: String
    let operationIdPrefix: String
}

struct WorkspacePackageImportedCard: Codable, Hashable, Sendable {
    let cardId: String
    let frontText: String
    let backText: String
    let cardType: String
    let metadata: CardMetadata
    let tags: [String]
    let dueAt: String?
    let createdAt: String
    let reps: Int
    let lapses: Int
    let fsrsCardState: FsrsCardState
    let fsrsStepIndex: Int?
    let fsrsStability: Double?
    let fsrsDifficulty: Double?
    let fsrsLastReviewedAt: String?
    let fsrsScheduledDays: Int?
    let clientUpdatedAt: String
    let lastModifiedByReplicaId: String
    let lastOperationId: String
    let updatedAt: String
    let deletedAt: String?
}

struct WorkspacePackageImportedMediaAsset: Codable, Hashable, Sendable {
    let portablePath: String
    let mediaAsset: MediaAsset
    let applied: Bool
}

struct WorkspacePackageImportConfirmSummary: Codable, Hashable, Sendable {
    let cardCount: Int
    let cardBatchCount: Int
    let referencedMediaCount: Int
    let importedMediaAssetCount: Int
    let appliedMediaAssetCount: Int
    let keptTagCount: Int
    let removedTagCount: Int
    let importTag: String?

    enum CodingKeys: String, CodingKey {
        case cardCount
        case cardBatchCount
        case referencedMediaCount
        case importedMediaAssetCount
        case appliedMediaAssetCount
        case keptTagCount
        case removedTagCount
        case importTag
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.cardCount = try decodeNonNegativeWorkspacePackageInt(from: container, forKey: .cardCount)
        self.cardBatchCount = try decodeNonNegativeWorkspacePackageInt(
            from: container,
            forKey: .cardBatchCount
        )
        self.referencedMediaCount = try decodeNonNegativeWorkspacePackageInt(
            from: container,
            forKey: .referencedMediaCount
        )
        self.importedMediaAssetCount = try decodeNonNegativeWorkspacePackageInt(
            from: container,
            forKey: .importedMediaAssetCount
        )
        self.appliedMediaAssetCount = try decodeNonNegativeWorkspacePackageInt(
            from: container,
            forKey: .appliedMediaAssetCount
        )
        self.keptTagCount = try decodeNonNegativeWorkspacePackageInt(from: container, forKey: .keptTagCount)
        self.removedTagCount = try decodeNonNegativeWorkspacePackageInt(
            from: container,
            forKey: .removedTagCount
        )
        self.importTag = try container.decodeIfPresent(String.self, forKey: .importTag)
    }
}

struct WorkspacePackageImportConfirmResponse: Codable, Hashable, Sendable {
    let cards: [WorkspacePackageImportedCard]
    let importedMediaAssets: [WorkspacePackageImportedMediaAsset]
    let summary: WorkspacePackageImportConfirmSummary
}

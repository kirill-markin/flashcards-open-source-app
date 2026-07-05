import Foundation

private let mediaSha256AllowedScalars = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
private let mediaBlobCacheRelativePathPrefix = "media/blobs/sha256"
let managedMediaAssetReferenceSchemePrefix = "fcasset:"
private let managedMediaAssetReferenceExpression = makeManagedMediaAssetRegularExpression(
    pattern: #"(!)?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#
)
private let managedMediaFenceExpression = makeManagedMediaAssetRegularExpression(
    pattern: #"^\s{0,3}(`{3,}|~{3,})"#
)

// Keep in sync with apps/backend/src/media/assets.ts::MediaAssetRecord and
// apps/web/src/types.ts::MediaAsset.
struct MediaAsset: Codable, Identifiable, Hashable, Sendable {
    let mediaAssetId: String
    let workspaceId: String
    let mimeType: String
    let sizeBytes: Int64
    let sha256: String
    let sourceUrl: String?
    let createdAt: String
    let clientUpdatedAt: String
    let lastModifiedByReplicaId: String
    let lastOperationId: String
    let updatedAt: String
    let deletedAt: String?

    var id: String {
        self.mediaAssetId
    }

    init(
        mediaAssetId: String,
        workspaceId: String,
        mimeType: String,
        sizeBytes: Int64,
        sha256: String,
        sourceUrl: String?,
        createdAt: String,
        clientUpdatedAt: String,
        lastModifiedByReplicaId: String,
        lastOperationId: String,
        updatedAt: String,
        deletedAt: String?
    ) {
        self.mediaAssetId = mediaAssetId
        self.workspaceId = workspaceId
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
        self.sha256 = sha256
        self.sourceUrl = sourceUrl
        self.createdAt = createdAt
        self.clientUpdatedAt = clientUpdatedAt
        self.lastModifiedByReplicaId = lastModifiedByReplicaId
        self.lastOperationId = lastOperationId
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
    }
}

struct MediaBlobCacheEntry: Hashable, Sendable {
    let sha256: String
    let mimeType: String
    let sizeBytes: Int64
    let localRelativePath: String
    let createdAt: String
    let lastAccessedAt: String
    let sourceMediaAssetId: String?
}

struct MediaBlobCacheUpsert: Hashable, Sendable {
    let sha256: String
    let mimeType: String
    let sizeBytes: Int64
    let createdAt: String
    let lastAccessedAt: String
    let sourceMediaAssetId: String?
}

enum MediaTransferKind: String, Codable, Hashable, Sendable {
    case upload
    case download
}

enum MediaTransferStatus: String, Codable, Hashable, Sendable {
    case pending
    case inProgress = "in_progress"
    case succeeded
    case failed
}

struct MediaTransferQueueEntry: Hashable, Sendable {
    let transferId: String
    let workspaceId: String
    let mediaAssetId: String
    let kind: MediaTransferKind
    let status: MediaTransferStatus
    let sha256: String
    let mimeType: String
    let sizeBytes: Int64
    let localRelativePath: String
    let attemptCount: Int
    let nextAttemptAt: String?
    let claimedAt: String?
    let lastError: String?
    let createdAt: String
    let updatedAt: String
}

struct MediaTransferEnqueueRequest: Hashable, Sendable {
    let transferId: String
    let workspaceId: String
    let mediaAssetId: String
    let kind: MediaTransferKind
    let sha256: String
    let mimeType: String
    let sizeBytes: Int64
    let createdAt: String
}

func normalizedMediaSha256(sha256: String) throws -> String {
    let normalizedSha256 = sha256.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard normalizedSha256.count == 64 else {
        throw LocalStoreError.validation("Media SHA-256 digest must be exactly 64 hexadecimal characters")
    }
    guard normalizedSha256.unicodeScalars.allSatisfy({ mediaSha256AllowedScalars.contains($0) }) else {
        throw LocalStoreError.validation("Media SHA-256 digest must contain only hexadecimal characters")
    }

    return normalizedSha256
}

func mediaBlobCacheRelativePath(sha256: String) throws -> String {
    let normalizedSha256 = try normalizedMediaSha256(sha256: sha256)
    let secondDirectoryStart = normalizedSha256.index(normalizedSha256.startIndex, offsetBy: 2)
    let secondDirectoryEnd = normalizedSha256.index(secondDirectoryStart, offsetBy: 2)
    let firstDirectory = String(normalizedSha256.prefix(2))
    let secondDirectory = String(normalizedSha256[secondDirectoryStart..<secondDirectoryEnd])

    return "\(mediaBlobCacheRelativePathPrefix)/\(firstDirectory)/\(secondDirectory)/\(normalizedSha256)"
}

func managedImageMarkdownReference(mediaAssetId: String, altText: String) throws -> String {
    let trimmedMediaAssetId = mediaAssetId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedMediaAssetId.isEmpty == false else {
        throw LocalStoreError.validation("Managed media asset id must not be empty")
    }

    return "![\(parserSafeManagedImageMarkdownAltText(altText: altText))](\(managedMediaAssetReferenceSchemePrefix)\(trimmedMediaAssetId))"
}

func managedMediaAssetId(reference: String) -> String? {
    let trimmedReference = reference.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedReference.lowercased().hasPrefix(managedMediaAssetReferenceSchemePrefix) else {
        return nil
    }

    var rawAssetId = String(trimmedReference.dropFirst(managedMediaAssetReferenceSchemePrefix.count))
    while rawAssetId.hasPrefix("/") {
        rawAssetId.removeFirst()
    }

    let fragmentOrQueryStart = rawAssetId.firstIndex { character in
        character == "?" || character == "#"
    }
    if let fragmentOrQueryStart {
        rawAssetId = String(rawAssetId[..<fragmentOrQueryStart])
    }

    let mediaAssetId = rawAssetId.trimmingCharacters(in: .whitespacesAndNewlines)
    return mediaAssetId.isEmpty ? nil : mediaAssetId
}

func managedMediaAssetIdsReferencedInMarkdown(text: String) -> Set<String> {
    var activeFenceMarker: String?
    var mediaAssetIds = Set<String>()

    for line in text.components(separatedBy: .newlines) {
        let fenceMarker = managedMediaFenceMarker(line: line)

        if let currentFenceMarker = activeFenceMarker {
            if fenceMarker == currentFenceMarker {
                activeFenceMarker = nil
            }
            continue
        }

        if let fenceMarker {
            activeFenceMarker = fenceMarker
            continue
        }

        mediaAssetIds.formUnion(managedMediaAssetIdsReferencedInLine(line: line))
    }

    return mediaAssetIds
}

private func parserSafeManagedImageMarkdownAltText(altText: String) -> String {
    altText
        .replacingOccurrences(of: "\r\n", with: " ")
        .replacingOccurrences(of: "\r", with: " ")
        .replacingOccurrences(of: "\n", with: " ")
        .replacingOccurrences(of: "[", with: " ")
        .replacingOccurrences(of: "]", with: " ")
}

private func managedMediaAssetIdsReferencedInLine(line: String) -> Set<String> {
    let fullRange = NSRange(line.startIndex..<line.endIndex, in: line)
    let matches = managedMediaAssetReferenceExpression.matches(in: line, options: [], range: fullRange)
    var mediaAssetIds = Set<String>()

    for match in matches {
        guard let urlRange = Range(match.range(at: 3), in: line),
              let mediaAssetId = managedMediaAssetId(reference: String(line[urlRange])) else {
            continue
        }

        mediaAssetIds.insert(mediaAssetId)
    }

    return mediaAssetIds
}

private func managedMediaFenceMarker(line: String) -> String? {
    let range = NSRange(line.startIndex..<line.endIndex, in: line)
    guard let match = managedMediaFenceExpression.firstMatch(in: line, options: [], range: range),
          let markerRange = Range(match.range(at: 1), in: line) else {
        return nil
    }

    return String(line[markerRange])
}

private func makeManagedMediaAssetRegularExpression(pattern: String) -> NSRegularExpression {
    do {
        return try NSRegularExpression(
            pattern: pattern,
            options: [.anchorsMatchLines]
        )
    } catch {
        fatalError("Invalid managed media asset regex pattern: \(pattern)")
    }
}

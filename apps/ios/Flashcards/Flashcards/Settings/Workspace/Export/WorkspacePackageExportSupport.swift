import Foundation

private let workspacePackageExportGeneratedImportTagPrefix: String = "import:"

struct WorkspacePackageExportMetadataDraft: Hashable, Sendable {
    var label: String
    var author: String
    var comment: String
    var createdAt: String
    var sourceUrl: String

    init(label: String, author: String, comment: String, createdAt: String, sourceUrl: String) {
        self.label = label
        self.author = author
        self.comment = comment
        self.createdAt = createdAt
        self.sourceUrl = sourceUrl
    }

    init(defaultPackageMetadata: WorkspacePackageExportDefaultPackageMetadata) {
        self.init(
            label: defaultPackageMetadata.label,
            author: defaultPackageMetadata.author ?? "",
            comment: defaultPackageMetadata.comment ?? "",
            createdAt: defaultPackageMetadata.createdAt,
            sourceUrl: defaultPackageMetadata.sourceUrl ?? ""
        )
    }
}

struct WorkspacePackageExportTagOption: Hashable, Identifiable, Sendable {
    let tag: String
    let cardsCount: Int
    let isAlwaysRemoved: Bool

    var id: String {
        tag
    }
}

func makeDefaultWorkspacePackageExportPreviewRequest() -> WorkspacePackageExportRequest {
    WorkspacePackageExportRequest(
        selection: .allActiveCards,
        tagPolicy: WorkspacePackageExportTagPolicyInput(additionalRemovedTags: []),
        packageMetadata: WorkspacePackageExportMetadataInput(
            label: nil,
            author: nil,
            comment: nil,
            createdAt: nil,
            sourceUrl: nil
        )
    )
}

func makeWorkspacePackageExportRequest(
    preview: WorkspacePackageExportPreviewResponse,
    metadataDraft: WorkspacePackageExportMetadataDraft,
    removedTags: Set<String>
) -> WorkspacePackageExportRequest {
    WorkspacePackageExportRequest(
        selection: .allActiveCards,
        tagPolicy: WorkspacePackageExportTagPolicyInput(
            additionalRemovedTags: makeWorkspacePackageExportRemovedTags(preview: preview, removedTags: removedTags)
        ),
        packageMetadata: WorkspacePackageExportMetadataInput(
            label: optionalWorkspacePackageExportMetadataText(value: metadataDraft.label),
            author: optionalWorkspacePackageExportMetadataText(value: metadataDraft.author),
            comment: optionalWorkspacePackageExportMetadataText(value: metadataDraft.comment),
            createdAt: optionalWorkspacePackageExportMetadataText(value: metadataDraft.createdAt),
            sourceUrl: optionalWorkspacePackageExportMetadataText(value: metadataDraft.sourceUrl)
        )
    )
}

func makeWorkspacePackageExportTagOptions(
    preview: WorkspacePackageExportPreviewResponse,
    removedTags: Set<String>
) -> [WorkspacePackageExportTagOption] {
    preview.availableTagCounts.map { tagCount in
        let isAlwaysRemoved = isWorkspacePackageExportGeneratedImportTag(tag: tagCount.tag)
        WorkspacePackageExportTagOption(
            tag: tagCount.tag,
            cardsCount: tagCount.cardsCount,
            isAlwaysRemoved: isAlwaysRemoved
        )
    }
}

func makeWorkspacePackageExportRemovedTags(
    preview: WorkspacePackageExportPreviewResponse,
    removedTags: Set<String>
) -> [String] {
    preview.availableTagCounts
        .map(\.tag)
        .filter { tag in
            isWorkspacePackageExportGeneratedImportTag(tag: tag) || removedTags.contains(tag)
        }
}

func formatWorkspacePackageExportByteCount(byteCount: Int64) -> String {
    let formatter = ByteCountFormatter()
    formatter.allowedUnits = [.useBytes, .useKB, .useMB, .useGB]
    formatter.countStyle = .file
    return formatter.string(fromByteCount: byteCount)
}

func prepareWorkspacePackageExportDownload(
    response: WorkspacePackageExportDownloadResponse,
    fileManager: FileManager,
    temporaryDirectory: URL
) throws -> URL {
    let fileName = response.fileName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard workspacePackageExportFileNameIsSafe(fileName: fileName) else {
        throw LocalStoreError.validation("Workspace package export filename is invalid: \(response.fileName)")
    }

    let fileURL = temporaryDirectory.appendingPathComponent(fileName, isDirectory: false)
    if fileManager.fileExists(atPath: fileURL.path) {
        try fileManager.removeItem(at: fileURL)
    }

    try response.packageBytes.write(to: fileURL, options: .atomic)
    return fileURL
}

private func optionalWorkspacePackageExportMetadataText(value: String) -> String? {
    let normalizedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if normalizedValue.isEmpty {
        return nil
    }

    return normalizedValue
}

private func isWorkspacePackageExportGeneratedImportTag(tag: String) -> Bool {
    tag.hasPrefix(workspacePackageExportGeneratedImportTagPrefix)
}

private func workspacePackageExportFileNameIsSafe(fileName: String) -> Bool {
    fileName.isEmpty == false
        && fileName.rangeOfCharacter(from: .controlCharacters) == nil
        && fileName.contains("/") == false
        && fileName.contains("\\") == false
}

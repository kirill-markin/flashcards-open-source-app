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

    var id: String {
        tag
    }
}

func makeWorkspacePackageExportPreviewRequest(
    selectedCardTags: Set<String>,
    additionalRemovedTags: Set<String>
) -> WorkspacePackageExportRequest {
    WorkspacePackageExportRequest(
        selection: makeWorkspacePackageExportSelection(selectedCardTags: selectedCardTags),
        tagPolicy: WorkspacePackageExportTagPolicyInput(additionalRemovedTags: additionalRemovedTags.sorted()),
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
    selectedCardTags: Set<String>,
    includedTags: Set<String>
) -> WorkspacePackageExportRequest {
    WorkspacePackageExportRequest(
        selection: makeWorkspacePackageExportSelection(selectedCardTags: selectedCardTags),
        tagPolicy: WorkspacePackageExportTagPolicyInput(
            additionalRemovedTags: makeWorkspacePackageExportAdditionalRemovedTags(
                preview: preview,
                includedTags: includedTags
            )
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

func makeWorkspacePackageExportTagOptions(preview: WorkspacePackageExportPreviewResponse) -> [WorkspacePackageExportTagOption] {
    preview.availableTagCounts
        .filter { tagCount in
            isWorkspacePackageExportGeneratedImportTag(tag: tagCount.tag) == false
        }
        .map { tagCount in
            WorkspacePackageExportTagOption(
                tag: tagCount.tag,
                cardsCount: tagCount.cardsCount
            )
        }
}

func makeWorkspacePackageExportInitialIncludedTags(preview: WorkspacePackageExportPreviewResponse) -> Set<String> {
    let removedTags = Set(preview.tagsSelectedForRemoval.map(\.tag))
    return Set(preview.availableTagCounts
        .map(\.tag)
        .filter { tag in
            isWorkspacePackageExportGeneratedImportTag(tag: tag) == false && removedTags.contains(tag) == false
        })
}

func makeWorkspacePackageExportAdditionalRemovedTags(
    preview: WorkspacePackageExportPreviewResponse,
    includedTags: Set<String>
) -> [String] {
    preview.availableTagCounts
        .map(\.tag)
        .filter { tag in
            isWorkspacePackageExportGeneratedImportTag(tag: tag) == false && includedTags.contains(tag) == false
        }
}

func workspacePackageExportHasGeneratedImportTags(preview: WorkspacePackageExportPreviewResponse) -> Bool {
    preview.availableTagCounts.contains { tagCount in
        isWorkspacePackageExportGeneratedImportTag(tag: tagCount.tag)
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

private func makeWorkspacePackageExportSelection(selectedCardTags: Set<String>) -> WorkspacePackageExportSelection {
    let selectedTags = selectedCardTags.sorted()
    if selectedTags.isEmpty {
        return .allActiveCards
    }

    return .tagFilters(includeTags: selectedTags, excludeTags: [])
}

func isWorkspacePackageExportGeneratedImportTag(tag: String) -> Bool {
    tag.hasPrefix(workspacePackageExportGeneratedImportTagPrefix)
}

private func workspacePackageExportFileNameIsSafe(fileName: String) -> Bool {
    fileName.isEmpty == false
        && fileName.rangeOfCharacter(from: .controlCharacters) == nil
        && fileName.contains("/") == false
        && fileName.contains("\\") == false
}

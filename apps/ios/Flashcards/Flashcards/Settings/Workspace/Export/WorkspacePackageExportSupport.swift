import Foundation

private let workspacePackageExportGeneratedImportTagPrefix: String = "import:"

extension WorkspacePackageExportFormat {
    var localizedTitle: String {
        switch self {
        case .nibomo: String(localized: "library.row.export.nibomo.title", table: "Foundation")
        case .anki: String(localized: "library.row.export.anki.title", table: "Foundation")
        }
    }
}

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

    var packageMetadata: WorkspacePackageExportMetadataInput {
        WorkspacePackageExportMetadataInput(
            label: optionalWorkspacePackageExportMetadataText(value: self.label),
            author: optionalWorkspacePackageExportMetadataText(value: self.author),
            comment: optionalWorkspacePackageExportMetadataText(value: self.comment),
            createdAt: optionalWorkspacePackageExportMetadataText(value: self.createdAt),
            sourceUrl: optionalWorkspacePackageExportMetadataText(value: self.sourceUrl)
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
    packageMetadata: WorkspacePackageExportMetadataInput,
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
        packageMetadata: packageMetadata
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

func makeWorkspaceAnkiExportMetadata(deckName: String) -> WorkspacePackageExportMetadataInput {
    WorkspacePackageExportMetadataInput(
        label: optionalWorkspacePackageExportMetadataText(value: deckName),
        author: nil,
        comment: nil,
        createdAt: nil,
        sourceUrl: nil
    )
}

func workspaceAnkiExportSelectionIsEmpty(error: Error) -> Bool {
    guard case CloudSyncError.invalidResponse(let details, 400) = technicalErrorPresentationSource(error: error) else {
        return false
    }
    return details.code == "WORKSPACE_PACKAGE_EXPORT_ANKI_EMPTY"
}

func workspacePackageExportFailureMessage(error: Error, format: WorkspacePackageExportFormat) -> String {
    if format == .anki, isRetryableNetworkTransportFailure(error: error) {
        return String(localized: "library.export.anki.connectionError", table: "Foundation")
    }
    return Flashcards.errorMessage(error: error)
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

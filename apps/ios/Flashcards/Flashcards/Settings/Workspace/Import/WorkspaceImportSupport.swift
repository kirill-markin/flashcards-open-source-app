import CryptoKit
import Foundation
import UniformTypeIdentifiers

private let workspacePackageImportMaximumZipBytes: Int64 = 4_000_000
private let workspacePackageImportMaximumZipMegabytes: Int = 4

struct WorkspacePackageImportSelectedFile: Hashable, Sendable {
    let fileName: String
    let packageBytes: Data
}

struct WorkspacePackageImportTagOption: Hashable, Identifiable, Sendable {
    let tag: String
    let cardsCount: Int
    let isKept: Bool

    var id: String {
        tag
    }
}

func workspacePackageImportAllowedContentTypes() -> [UTType] {
    [UTType.zip]
}

func readWorkspacePackageImportSelectedFile(url: URL) throws -> WorkspacePackageImportSelectedFile {
    guard url.pathExtension.lowercased() == "zip" else {
        throw LocalStoreError.validation(
            aiSettingsLocalized(
                "settings.workspace.import.invalidFile",
                "Choose a Flashcards ZIP package."
            )
        )
    }

    let didStartAccessing = url.startAccessingSecurityScopedResource()
    defer {
        if didStartAccessing {
            url.stopAccessingSecurityScopedResource()
        }
    }

    let fileSizeBytes = try workspacePackageImportFileSizeBytes(url: url)
    guard fileSizeBytes <= workspacePackageImportMaximumZipBytes else {
        throw LocalStoreError.validation(
            aiSettingsLocalizedFormat(
                "settings.workspace.import.fileTooLarge",
                "Choose a ZIP package up to %d MB.",
                workspacePackageImportMaximumZipMegabytes
            )
        )
    }

    return WorkspacePackageImportSelectedFile(
        fileName: url.lastPathComponent,
        packageBytes: try Data(contentsOf: url)
    )
}

private func workspacePackageImportFileSizeBytes(url: URL) throws -> Int64 {
    let resourceValues = try url.resourceValues(forKeys: [.fileSizeKey])
    guard let fileSize = resourceValues.fileSize else {
        throw LocalStoreError.validation(
            aiSettingsLocalized(
                "settings.workspace.import.invalidFile",
                "Choose a Flashcards ZIP package."
            )
        )
    }

    return Int64(fileSize)
}

func makeWorkspacePackageImportTagOptions(
    preview: WorkspacePackageImportPreviewResponse,
    removedTags: Set<String>
) -> [WorkspacePackageImportTagOption] {
    preview.tagCounts.map { tagCount in
        WorkspacePackageImportTagOption(
            tag: tagCount.tag,
            cardsCount: tagCount.cardsCount,
            isKept: removedTags.contains(tagCount.tag) == false
        )
    }
}

func makeWorkspacePackageImportRemovedTags(
    preview: WorkspacePackageImportPreviewResponse,
    removedTags: Set<String>
) -> [String] {
    preview.tagCounts
        .map(\.tag)
        .filter { tag in
            removedTags.contains(tag)
        }
}

func workspacePackageImportReplicaId(workspaceId: String, installationId: String) throws -> String {
    guard workspaceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
        throw LocalStoreError.validation("Workspace package import requires a workspace id")
    }
    guard installationId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
        throw LocalStoreError.validation("Workspace package import requires an installation id")
    }

    return workspacePackageImportUuidFromSeed(seed: "\(workspaceId):\(installationId)")
}

func makeWorkspacePackageImportConfirmOptions(
    preview: WorkspacePackageImportPreviewResponse,
    addImportTag: Bool,
    importTag: String,
    removedTags: Set<String>,
    lastModifiedByReplicaId: String,
    now: Date
) throws -> WorkspacePackageImportConfirmOptions {
    let normalizedImportTag = importTag.trimmingCharacters(in: .whitespacesAndNewlines)
    guard addImportTag == false || normalizedImportTag.isEmpty == false else {
        throw LocalStoreError.validation(
            aiSettingsLocalized(
                "settings.workspace.import.missingImportTag",
                "Enter an import tag before importing."
            )
        )
    }

    let importId = UUID().uuidString.lowercased()
    let importedAt = formatIsoTimestamp(date: now)
    return WorkspacePackageImportConfirmOptions(
        addImportTag: addImportTag,
        importTag: normalizedImportTag,
        removeTags: makeWorkspacePackageImportRemovedTags(preview: preview, removedTags: removedTags),
        importedAt: importedAt,
        importId: importId,
        clientUpdatedAt: importedAt,
        lastModifiedByReplicaId: lastModifiedByReplicaId,
        operationIdPrefix: importId
    )
}

private func workspacePackageImportUuidFromSeed(seed: String) -> String {
    var digest = Array(SHA256.hash(data: Data(seed.utf8)))
    digest[6] = (digest[6] & 0x0f) | 0x50
    digest[8] = (digest[8] & 0x3f) | 0x80
    return UUID(uuid: (
        digest[0],
        digest[1],
        digest[2],
        digest[3],
        digest[4],
        digest[5],
        digest[6],
        digest[7],
        digest[8],
        digest[9],
        digest[10],
        digest[11],
        digest[12],
        digest[13],
        digest[14],
        digest[15]
    )).uuidString.lowercased()
}

func workspacePackageImportWarningMessage(warning: WorkspacePackageImportWarning) -> String {
    if warning.mediaPath.isEmpty {
        return warning.message
    }

    return aiSettingsLocalizedFormat(
        "settings.workspace.import.warningWithPath",
        "%@: %@",
        warning.mediaPath,
        warning.message
    )
}

func workspacePackageImportSuccessMessage(summary: WorkspacePackageImportConfirmSummary) -> String {
    if let importTag = summary.importTag, importTag.isEmpty == false {
        return aiSettingsLocalizedFormat(
            "settings.workspace.import.successWithTag",
            "Imported %d cards with tag %@.",
            summary.cardCount,
            importTag
        )
    }

    return aiSettingsLocalizedFormat(
        "settings.workspace.import.success",
        "Imported %d cards.",
        summary.cardCount
    )
}

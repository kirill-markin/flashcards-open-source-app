import Foundation

struct WorkspaceAnkiImportFile: Identifiable, Sendable {
    let url: URL
    let stagedDirectory: URL?

    var id: URL { self.url }

    func removeStagedCopy() {
        if let stagedDirectory {
            removeAnkiImportDirectory(url: stagedDirectory)
        }
    }
}

private struct AnkiImportFileError: LocalizedError {
    let fileName: String
    let underlyingError: any Error

    var errorDescription: String? {
        "\(self.fileName): \(Flashcards.errorMessage(error: self.underlyingError))"
    }
}

func validateAnkiImportFileExtension(fileName: String) throws {
    let fileExtension = (fileName as NSString).pathExtension.lowercased()
    guard fileExtension == "apkg" else {
        throw AnkiImportFileError(fileName: fileName, underlyingError: aiChatUnsupportedFileTypeError(fileExtension: fileExtension))
    }
}

func stageAnkiImportDropFile(url: URL, fileName: String) throws -> WorkspaceAnkiImportFile {
    try validateAnkiImportFileExtension(fileName: fileName)
    do {
        let didAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true, let size = values.fileSize, size > 0 else {
            throw CocoaError(.fileReadCorruptFile)
        }
        try aiChatValidateAttachmentSize(byteCount: size, maximumByteCount: aiChatMaximumFileAttachmentBytes)

        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        let copy = directory.appendingPathComponent(fileName, isDirectory: false)
        do {
            try FileManager.default.copyItem(at: url, to: copy)
        } catch {
            removeAnkiImportDirectory(url: directory)
            throw error
        }
        return WorkspaceAnkiImportFile(url: copy, stagedDirectory: directory)
    } catch {
        throw AnkiImportFileError(fileName: fileName, underlyingError: error)
    }
}

private func removeAnkiImportDirectory(url: URL) {
    do {
        try FileManager.default.removeItem(at: url)
    } catch {
        logAIChatStoreEvent(
            action: "anki_import_drop_directory_remove_failed",
            metadata: ["path": url.path, "error": Flashcards.errorMessage(error: error)]
        )
    }
}

func collectAnkiImportDropFiles(
    drops: [AsyncStream<Result<WorkspaceAnkiImportFile, any Error>>]
) async throws -> [WorkspaceAnkiImportFile] {
    var files: [WorkspaceAnkiImportFile] = []
    var firstError: (any Error)?
    for drop in drops {
        for await result in drop {
            switch result {
            case .success(let file):
                files.append(file)
            case .failure(let error):
                firstError = firstError ?? error
            }
        }
    }
    if let firstError {
        files.forEach { $0.removeStagedCopy() }
        throw firstError
    }
    return files
}

func stageAnkiImportFiles(urls: [URL]) throws -> [AIChatAttachment] {
    var attachments: [AIChatAttachment] = []
    do {
        for url in urls {
            try Task.checkCancellation()
            do {
                let attachment = try aiChatMakeAttachmentFromFile(url: url)
                attachments.append(attachment)
                if case .localFile(_, _, let sizeBytes) = attachment.payload {
                    guard sizeBytes > 0 else {
                        throw CocoaError(.fileReadCorruptFile)
                    }
                    try aiChatValidateAttachmentSize(
                        byteCount: sizeBytes,
                        maximumByteCount: aiChatMaximumFileAttachmentBytes
                    )
                }
            } catch {
                throw AnkiImportFileError(fileName: url.lastPathComponent, underlyingError: error)
            }
        }
        try validateAIChatOutgoingAttachments(attachments: attachments)
        return attachments
    } catch {
        aiChatRemoveAttachmentFiles(attachments: attachments)
        throw error
    }
}

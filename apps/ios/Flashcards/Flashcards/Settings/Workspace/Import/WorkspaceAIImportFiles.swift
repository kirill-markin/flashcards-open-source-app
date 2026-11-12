import Foundation

struct WorkspaceAIImportFile: Identifiable, Sendable {
    let url: URL
    let stagedDirectory: URL?

    var id: URL { self.url }

    func removeStagedCopy() {
        if let stagedDirectory {
            removeAIImportDirectory(url: stagedDirectory)
        }
    }
}

enum AIImportFileError: LocalizedError {
    case invalidFile(fileName: String, source: AIImportSource)
    case tooLarge(fileName: String)
    case unreadable(fileName: String, underlyingError: any Error)

    var errorDescription: String? {
        switch self {
        case .invalidFile(let fileName, let source):
            return source.localizedInvalidFileMessage(fileName: fileName)
        case .tooLarge(let fileName):
            return aiSettingsLocalizedFormat(
                "settings.workspace.import.aiImport.fileTooLarge",
                "“%1$@” exceeds %2$d MiB. Choose a smaller export.",
                fileName,
                aiChatMaximumFileAttachmentBytes / (1024 * 1024)
            )
        case .unreadable(let fileName, let underlyingError):
            return "\(fileName): \(Flashcards.errorMessage(error: underlyingError))"
        }
    }
}

func validateAIImportFileExtension(fileName: String, source: AIImportSource) throws {
    guard case .files(let extensions) = source.input,
          extensions.contains((fileName as NSString).pathExtension.lowercased()) else {
        throw AIImportFileError.invalidFile(fileName: fileName, source: source)
    }
}

private func validateAIImportFileSize(fileName: String, source: AIImportSource, byteCount: Int) throws {
    guard byteCount > 0 else {
        throw AIImportFileError.invalidFile(fileName: fileName, source: source)
    }
    guard byteCount <= aiChatMaximumFileAttachmentBytes else {
        throw AIImportFileError.tooLarge(fileName: fileName)
    }
}

func stageAIImportDropFile(url: URL, fileName: String, source: AIImportSource) throws -> WorkspaceAIImportFile {
    try validateAIImportFileExtension(fileName: fileName, source: source)
    let didAccess = url.startAccessingSecurityScopedResource()
    defer {
        if didAccess {
            url.stopAccessingSecurityScopedResource()
        }
    }

    let values: URLResourceValues
    do {
        values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    } catch {
        throw AIImportFileError.unreadable(fileName: fileName, underlyingError: error)
    }
    guard values.isRegularFile == true, let size = values.fileSize else {
        throw AIImportFileError.invalidFile(fileName: fileName, source: source)
    }
    try validateAIImportFileSize(fileName: fileName, source: source, byteCount: size)

    do {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        let copy = directory.appendingPathComponent(fileName, isDirectory: false)
        do {
            try FileManager.default.copyItem(at: url, to: copy)
        } catch {
            removeAIImportDirectory(url: directory)
            throw error
        }
        return WorkspaceAIImportFile(url: copy, stagedDirectory: directory)
    } catch {
        throw AIImportFileError.unreadable(fileName: fileName, underlyingError: error)
    }
}

private func removeAIImportDirectory(url: URL) {
    do {
        try FileManager.default.removeItem(at: url)
    } catch {
        logAIChatStoreEvent(
            action: "ai_import_drop_directory_remove_failed",
            metadata: ["path": url.path, "error": Flashcards.errorMessage(error: error)]
        )
    }
}

func collectAIImportDropFiles(
    drops: [AsyncStream<Result<WorkspaceAIImportFile, any Error>>]
) async throws -> [WorkspaceAIImportFile] {
    var files: [WorkspaceAIImportFile] = []
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

func stageAIImportFiles(urls: [URL], source: AIImportSource) throws -> [AIChatAttachment] {
    var attachments: [AIChatAttachment] = []
    do {
        for url in urls {
            try Task.checkCancellation()
            let fileName = url.lastPathComponent
            let attachment: AIChatAttachment
            do {
                attachment = try aiChatMakeAttachmentFromFile(url: url)
            } catch {
                switch aiChatAttachmentErrorCode(error: error) {
                case .tooLarge:
                    throw AIImportFileError.tooLarge(fileName: fileName)
                case .unsupportedType:
                    throw AIImportFileError.invalidFile(fileName: fileName, source: source)
                case .imageEncodeFailed, .imageDimensionsInvalid, nil:
                    throw AIImportFileError.unreadable(fileName: fileName, underlyingError: error)
                }
            }
            attachments.append(attachment)
            if case .localFile(_, _, let sizeBytes) = attachment.payload {
                try validateAIImportFileSize(fileName: fileName, source: source, byteCount: sizeBytes)
            }
        }
        try validateAIChatOutgoingAttachments(attachments: attachments)
        return attachments
    } catch {
        aiChatRemoveAttachmentFiles(attachments: attachments)
        throw error
    }
}

func stageAIImportPastedText(text: String, fileName: String) throws -> AIChatAttachment {
    let data = Data(text.utf8)
    guard data.count <= aiChatMaximumFileAttachmentBytes else {
        throw AIImportFileError.tooLarge(fileName: fileName)
    }
    let attachmentId = UUID().uuidString.lowercased()
    do {
        try data.write(to: try aiChatAttachmentFileURL(attachmentId: attachmentId), options: .atomic)
    } catch {
        throw AIImportFileError.unreadable(fileName: fileName, underlyingError: error)
    }
    return AIChatAttachment(
        id: attachmentId,
        payload: .localFile(fileName: fileName, mediaType: "text/plain", sizeBytes: data.count)
    )
}

import Foundation
import UniformTypeIdentifiers

/**
 * Turns dropped or pasted items into draft attachments through the same builders as the pickers: a
 * file of a supported type goes through `aiChatMakeAttachmentFromFile(url:)`, image data through
 * `aiChatMakeImageAttachment(data:fileName:mediaType:)`, and anything else fails as an unsupported type.
 *
 * All or nothing: on the first failure the attachments already made are removed and the error is rethrown.
 */
@MainActor
func aiChatMakeAttachments(itemProviders: [NSItemProvider]) async throws -> [AIChatAttachment] {
    var attachments: [AIChatAttachment] = []
    do {
        for itemProvider in itemProviders {
            attachments.append(try await aiChatMakeAttachment(itemProvider: itemProvider))
        }
    } catch {
        aiChatRemoveAttachmentFiles(attachments: attachments)
        throw error
    }

    return attachments
}

/// Copied or dragged text stays text unless it comes with a file; documents can arrive as data alone, from Mail or Quick Look.
private func aiChatIsSupportedDocumentType(contentType: UTType) -> Bool {
    contentType.conforms(to: .text) == false
        && aiChatImporterContentTypes().contains { contentType.conforms(to: $0) }
}

/**
 * The item's types in registration order, which runs from highest fidelity down: Office and browser copies of
 * text register a picture of it after the text, so only a leading image or document makes an attachment.
 * Types alone, so the edit menu can ask without reading the pasteboard.
 */
func aiChatContentTypesMakeAttachment(contentTypes: [UTType]) -> Bool {
    if contentTypes.contains(where: { $0.conforms(to: .fileURL) }) {
        return true
    }
    guard let leadingType = contentTypes.first else {
        return false
    }
    return leadingType.conforms(to: .image) || aiChatIsSupportedDocumentType(contentType: leadingType)
}

/// Files drags on iPad register their types for open in place instead of a file URL.
func aiChatItemProviderCanMakeAttachment(itemProvider: NSItemProvider) -> Bool {
    itemProvider.registeredContentTypesForOpenInPlace.isEmpty == false
        || aiChatContentTypesMakeAttachment(contentTypes: itemProvider.registeredContentTypes)
}

@MainActor
private func aiChatMakeAttachment(itemProvider: NSItemProvider) async throws -> AIChatAttachment {
    let registeredTypes = itemProvider.registeredContentTypes
    if registeredTypes.contains(where: { $0.conforms(to: .fileURL) }) {
        // Finder registers the file name as text and its icon as an image beside the URL, so of the item's
        // own types only a document is surely the file; otherwise the URL is read.
        if let documentType = registeredTypes.first(where: { aiChatIsSupportedDocumentType(contentType: $0) }) {
            return try await aiChatMakeFileAttachment(itemProvider: itemProvider, contentType: documentType)
        }
        return try aiChatMakeAttachmentFromFileURL(url: try await aiChatLoadItemProviderFileURL(itemProvider: itemProvider))
    }
    let isOpenInPlace = itemProvider.registeredContentTypesForOpenInPlace.isEmpty == false
    let supportedFileTypes = aiChatImporterContentTypes()
    // Without a file only the leading type counts, as in `aiChatContentTypesMakeAttachment`.
    let candidateTypes = isOpenInPlace ? registeredTypes : Array(registeredTypes.prefix(1))
    for registeredType in candidateTypes {
        let isAttachableFileType = isOpenInPlace
            ? supportedFileTypes.contains { registeredType.conforms(to: $0) }
            : aiChatIsSupportedDocumentType(contentType: registeredType)
        if isAttachableFileType {
            return try await aiChatMakeFileAttachment(itemProvider: itemProvider, contentType: registeredType)
        }
        if registeredType.conforms(to: .image) {
            let data = try await aiChatLoadItemProviderData(itemProvider: itemProvider, contentType: registeredType)
            return try aiChatMakeImageAttachment(
                data: data,
                fileName: aiChatItemProviderImageFileName(
                    suggestedName: itemProvider.suggestedName,
                    imageType: registeredType
                ),
                mediaType: registeredType.preferredMIMEType ?? "image/jpeg"
            )
        }
    }

    let suggestedExtension = itemProvider.suggestedName.map { URL(fileURLWithPath: $0).pathExtension } ?? ""
    throw aiChatUnsupportedFileTypeError(
        fileExtension: suggestedExtension.isEmpty
            ? registeredTypes.first?.preferredFilenameExtension ?? ""
            : suggestedExtension.lowercased()
    )
}

/// An image file takes the photo path, as a picked photo would; any other file goes through the "Choose File" checks.
private func aiChatMakeAttachmentFromFileURL(url: URL) throws -> AIChatAttachment {
    guard let imageType = UTType(filenameExtension: url.pathExtension), imageType.conforms(to: .image) else {
        return try aiChatMakeAttachmentFromFile(url: url)
    }

    let didAccess = url.startAccessingSecurityScopedResource()
    defer {
        if didAccess {
            url.stopAccessingSecurityScopedResource()
        }
    }
    return try aiChatMakeImageAttachment(
        data: try Data(contentsOf: url),
        fileName: url.lastPathComponent,
        mediaType: imageType.preferredMIMEType ?? "image/jpeg"
    )
}

@MainActor
private func aiChatLoadItemProviderFileURL(itemProvider: NSItemProvider) async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
        _ = itemProvider.loadObject(ofClass: URL.self) { url, error in
            if let error {
                continuation.resume(throwing: error)
                return
            }
            guard let url else {
                continuation.resume(throwing: CocoaError(.fileReadUnknown))
                return
            }

            continuation.resume(returning: url)
        }
    }
}

private func aiChatItemProviderImageFileName(suggestedName: String?, imageType: UTType) -> String {
    let baseName = suggestedName.map { URL(fileURLWithPath: $0).deletingPathExtension().lastPathComponent } ?? ""
    let fileExtension = imageType.preferredFilenameExtension ?? "jpg"
    return "\(baseName.isEmpty ? "photo" : baseName).\(fileExtension)"
}

/// The loaded file keeps the item's own name and extension, so the extension check decides exactly as for "Choose File".
@MainActor
private func aiChatMakeFileAttachment(
    itemProvider: NSItemProvider,
    contentType: UTType
) async throws -> AIChatAttachment {
    try await withCheckedThrowingContinuation { continuation in
        // The loaded copy is deleted once this handler returns, so the attachment is made inside it.
        _ = itemProvider.loadFileRepresentation(for: contentType, openInPlace: false) { url, _, error in
            if let error {
                continuation.resume(throwing: error)
                return
            }
            guard let url else {
                continuation.resume(throwing: CocoaError(.fileReadUnknown))
                return
            }

            continuation.resume(with: Result {
                guard url.pathExtension.isEmpty, let fileExtension = contentType.preferredFilenameExtension else {
                    return try aiChatMakeAttachmentFromFile(url: url)
                }
                return try aiChatMakeAttachmentFromRenamedFile(
                    url: url,
                    fileName: "\(url.lastPathComponent).\(fileExtension)"
                )
            })
        }
    }
}

private func aiChatMakeAttachmentFromRenamedFile(url: URL, fileName: String) throws -> AIChatAttachment {
    let directoryURL = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    defer {
        do {
            try FileManager.default.removeItem(at: directoryURL)
        } catch {
            logAIChatStoreEvent(
                action: "ai_chat_item_provider_directory_remove_failed",
                metadata: [
                    "path": directoryURL.path,
                    "error": Flashcards.errorMessage(error: error)
                ]
            )
        }
    }

    let renamedURL = directoryURL.appendingPathComponent(fileName, isDirectory: false)
    try FileManager.default.moveItem(at: url, to: renamedURL)
    return try aiChatMakeAttachmentFromFile(url: renamedURL)
}

@MainActor
private func aiChatLoadItemProviderData(itemProvider: NSItemProvider, contentType: UTType) async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in
        _ = itemProvider.loadDataRepresentation(for: contentType) { data, error in
            if let error {
                continuation.resume(throwing: error)
                return
            }
            guard let data else {
                continuation.resume(throwing: CocoaError(.fileReadUnknown))
                return
            }

            continuation.resume(returning: data)
        }
    }
}

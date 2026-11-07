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

/// Finder drags on Mac carry a file URL and Files drags on iPad register their types for open in place;
/// dragged text and links carry neither, so they never become file attachments.
private func aiChatItemProviderIsFileBacked(itemProvider: NSItemProvider) -> Bool {
    itemProvider.registeredContentTypes.contains { $0.conforms(to: .fileURL) }
        || itemProvider.registeredContentTypesForOpenInPlace.isEmpty == false
}

func aiChatItemProviderCanMakeAttachment(itemProvider: NSItemProvider) -> Bool {
    aiChatItemProviderIsFileBacked(itemProvider: itemProvider)
        || itemProvider.registeredContentTypes.contains { $0.conforms(to: .image) }
}

@MainActor
private func aiChatMakeAttachment(itemProvider: NSItemProvider) async throws -> AIChatAttachment {
    let registeredTypes = itemProvider.registeredContentTypes
    let isFileBacked = aiChatItemProviderIsFileBacked(itemProvider: itemProvider)
    let supportedFileTypes = aiChatImporterContentTypes()
    // Registration order, so a browser image that also registers HTML or text attaches the image.
    for registeredType in registeredTypes {
        if isFileBacked && supportedFileTypes.contains(where: { registeredType.conforms(to: $0) }) {
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

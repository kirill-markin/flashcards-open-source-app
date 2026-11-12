import Foundation
import UniformTypeIdentifiers

/// Start loading during the drop callback and consume the temporary file before the provider releases it.
func loadWorkspaceImportDrop<File: Sendable>(
    provider: NSItemProvider,
    contentTypes: [UTType],
    readFile: @escaping @Sendable (URL, String) throws -> File
) -> AsyncStream<Result<File, any Error>> {
    AsyncStream { continuation in
        let complete: @Sendable (Result<File, any Error>) -> Void = { result in
            continuation.yield(result)
            continuation.finish()
        }
        if let type = provider.registeredContentTypes.first(where: { candidate in
            contentTypes.contains(where: { candidate.conforms(to: $0) })
        }) {
            let suggestedName = provider.suggestedName
            _ = provider.loadFileRepresentation(for: type, openInPlace: false) { url, _, error in
                complete(Result {
                    if let error { throw error }
                    guard let url else { throw CocoaError(.fileReadUnknown) }
                    let fileName = workspaceImportDropFileName(url: url, suggestedName: suggestedName, contentType: type)
                    return try readFile(url, fileName)
                })
            }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            _ = provider.loadObject(ofClass: URL.self) { url, error in
                complete(Result {
                    if let error { throw error }
                    guard let url, url.isFileURL else { throw CocoaError(.fileReadUnsupportedScheme) }
                    return try readFile(url, url.lastPathComponent)
                })
            }
        } else {
            complete(.failure(CocoaError(.fileReadUnknown)))
        }
    }
}

private func workspaceImportDropFileName(url: URL, suggestedName: String?, contentType: UTType) -> String {
    if url.pathExtension.isEmpty == false {
        return url.lastPathComponent
    }
    let fileName = suggestedName.map { ($0 as NSString).lastPathComponent } ?? url.lastPathComponent
    if (fileName as NSString).pathExtension.isEmpty, let fileExtension = contentType.preferredFilenameExtension {
        return "\(fileName).\(fileExtension)"
    }
    return fileName
}

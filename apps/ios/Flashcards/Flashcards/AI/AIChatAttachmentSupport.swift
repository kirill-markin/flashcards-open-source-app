import Foundation
import UniformTypeIdentifiers

enum AIChatAttachmentMenuAction: String, CaseIterable, Identifiable {
    case takePhoto
    case choosePhoto
    case chooseFile

    var id: String {
        self.rawValue
    }

    var title: String {
        switch self {
        case .takePhoto:
            return "Take Photo"
        case .choosePhoto:
            return "Choose Photo"
        case .chooseFile:
            return "Choose File"
        }
    }

    var systemImage: String {
        switch self {
        case .takePhoto:
            return "camera"
        case .choosePhoto:
            return "photo"
        case .chooseFile:
            return "doc"
        }
    }
}

func aiChatAttachmentMenuActions() -> [AIChatAttachmentMenuAction] {
    [
        .takePhoto,
        .choosePhoto,
        .chooseFile,
    ]
}

func aiChatImporterContentTypes() -> [UTType] {
    let baseTypes = aiChatSupportedFileExtensions.compactMap { fileExtension in
        UTType(filenameExtension: fileExtension)
    }

    return baseTypes.sorted { left, right in
        left.identifier < right.identifier
    }
}

func aiChatMakeAttachmentFromFile(url: URL) throws -> AIChatAttachment {
    let fileExtension = url.pathExtension.lowercased()
    guard aiChatSupportedFileExtensions.contains(fileExtension) else {
        throw NSError(
            domain: "AIChatAttachment",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Unsupported file type: .\(fileExtension)"]
        )
    }

    let didAccess = url.startAccessingSecurityScopedResource()
    defer {
        if didAccess {
            url.stopAccessingSecurityScopedResource()
        }
    }

    let data = try Data(contentsOf: url)
    try aiChatValidateAttachmentSize(data: data)
    let contentType = UTType(filenameExtension: fileExtension)

    return AIChatAttachment(
        id: UUID().uuidString.lowercased(),
        fileName: url.lastPathComponent,
        mediaType: contentType?.preferredMIMEType ?? "application/octet-stream",
        base64Data: data.base64EncodedString()
    )
}

func aiChatMakeImageAttachment(data: Data, fileName: String, mediaType: String) throws -> AIChatAttachment {
    try aiChatValidateAttachmentSize(data: data)

    return AIChatAttachment(
        id: UUID().uuidString.lowercased(),
        fileName: fileName,
        mediaType: mediaType,
        base64Data: data.base64EncodedString()
    )
}

enum AIChatAttachmentPresentationResult: Equatable {
    case present
    case stopSilently
    case showAlert(AIChatAlert)
}

func aiChatCameraPresentationResult(
    initialStatus: AccessPermissionStatus,
    requestedStatus: AccessPermissionStatus?
) -> AIChatAttachmentPresentationResult {
    switch initialStatus {
    case .allowed:
        return .present
    case .askEveryTime:
        guard let requestedStatus else {
            return .stopSilently
        }

        switch requestedStatus {
        case .allowed:
            return .present
        case .blocked, .askEveryTime:
            return .stopSilently
        case .limited, .unavailable:
            return .showAlert(.generalError(message: "Camera is not available on this device."))
        }
    case .blocked, .limited:
        return .showAlert(.attachmentSettings(source: .camera))
    case .unavailable:
        return .showAlert(.generalError(message: "Camera is not available on this device."))
    }
}

func aiChatPhotoPresentationResult(
    initialStatus: AccessPermissionStatus,
    requestedStatus: AccessPermissionStatus?
) -> AIChatAttachmentPresentationResult {
    switch initialStatus {
    case .allowed, .limited:
        return .present
    case .askEveryTime:
        guard let requestedStatus else {
            return .stopSilently
        }

        switch requestedStatus {
        case .allowed, .limited:
            return .present
        case .blocked, .askEveryTime:
            return .stopSilently
        case .unavailable:
            return .showAlert(.generalError(message: "Photo access is not available on this device."))
        }
    case .blocked:
        return .showAlert(.attachmentSettings(source: .photos))
    case .unavailable:
        return .showAlert(.generalError(message: "Photo access is not available on this device."))
    }
}

func aiChatFileImportAlert(error: Error) -> AIChatAlert {
    if aiChatIsFilePermissionError(error: error) {
        return .attachmentSettings(source: .files)
    }

    return .generalError(message: Flashcards.errorMessage(error: error))
}

func aiChatIsFilePermissionError(error: Error) -> Bool {
    let nsError = error as NSError
    if nsError.domain == NSCocoaErrorDomain {
        let noPermissionCodes = [
            CocoaError.Code.fileReadNoPermission.rawValue,
            CocoaError.Code.fileWriteNoPermission.rawValue,
        ]
        return noPermissionCodes.contains(nsError.code)
    }

    if nsError.domain == NSPOSIXErrorDomain {
        let noPermissionCodes = [
            Int(EACCES),
            Int(EPERM),
        ]
        return noPermissionCodes.contains(nsError.code)
    }

    return false
}

private func aiChatValidateAttachmentSize(data: Data) throws {
    if data.count > aiChatMaximumAttachmentBytes {
        throw NSError(
            domain: "AIChatAttachment",
            code: 2,
            userInfo: [
                NSLocalizedDescriptionKey: "File is too large. Maximum allowed size is 20 MB.",
            ]
        )
    }
}
